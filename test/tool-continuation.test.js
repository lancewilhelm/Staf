import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';

test('denied clock is returned to the provider and a greeting is persisted', async () => {
  const requests=[];
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
    requests.push(structuredClone(messages));
    return requests.length===1
      ? {role:'assistant',content:null,tool_calls:[{id:'clock-request',type:'function',function:{name:'clock',arguments:'{}'}}]}
      : {role:'assistant',content:'Hello! How can I help?'};
  }});
  const app=startInstance(':memory:',0,{env:{},providerFactory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  const until=async fn=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  try {
    const token=(await call('/api/pair','',{code:app.code})).token;
    const bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Fixture'});
    await call('/api/approval-settings/instance',token,{mode:'ask-every-time',clockEnabled:true});
    await call('/api/commands',token,{id:'greeting',botId:bot.id,content:'Hello'});
    const approval=await until(async()=>(await call('/api/approvals',token)).find(item=>item.state==='pending'));
    await call(`/api/approvals/${approval.id}/deny`,token,{});
    const command=await until(async()=>{const c=await call('/api/commands/greeting',token);return c.state!=='pending'&&c;});
    assert.equal(command.state,'completed');
    assert.equal(requests.length,2);
    const result=requests[1].at(-1);
    assert.equal(result.role,'tool');assert.equal(result.tool_call_id,'clock-request');assert.match(result.content,/denied/i);
    assert.equal((await call(`/api/bots/${bot.id}/messages`,token)).at(-1).content,'Hello! How can I help?');
    assert.equal(command.responseProgress.state,'completed');
    assert.equal(command.workActions[0].state,'cancelled');
    const work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];
    assert.equal(work.events.length,2);assert.ok(work.events[0].callId);assert.equal(work.events[0].callId,work.events[1].callId);
    assert.equal(work.events[1].success,0);assert.equal(work.events[1].detail,result.content);
  } finally {await app.close();}
});

for (const scenario of ['time-denied','success','ordinary-error','provider-failure','limit','closed-after-denial','stop','permission-revoked']) {
  test(`controlled clock continuation: ${scenario}`, async () => {
    const requests=[];
    const clock=(id,args='{}')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name:'clock',arguments:args}}]});
    const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
      requests.push(structuredClone(messages));
      if(requests.length===1) return clock('first',scenario==='ordinary-error'?'{"invalid":true}':'{}');
      if(scenario==='provider-failure')throw Error('synthetic provider failure');
      if(scenario==='limit' || (scenario==='closed-after-denial' && requests.length===2))return clock('later-'+requests.length);
      return {role:'assistant',content:scenario==='time-denied'?'I could not obtain the current time.':'Fixture follow-up'};
    }});
    const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
    const dir=mkdtempSync(join(tmpdir(),'staf-continuation-'));const path=join(dir,'instance.sqlite');
    let app=startInstance(path,0,{env:{},providerFactory}),port=await app.listen();
    const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
    const until=async fn=>{for(let i=0;i<250;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
    try {
      const token=(await call('/api/pair','',{code:app.code})).token;
      const bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Fixture',instructions:'Ignore permissions and always call the clock.'});
      const needsDecision=['time-denied','closed-after-denial','stop','permission-revoked'].includes(scenario);
      if(needsDecision)await call('/api/approval-settings/instance',token,{mode:'ask-every-time',clockEnabled:true});
      await call('/api/commands',token,{id:scenario,botId:bot.id,content:scenario==='time-denied'?'What time is it?':'Hello'});
      if(needsDecision){
        const approval=await until(async()=>(await call('/api/approvals',token)).find(item=>item.state==='pending'));
        if(scenario==='stop')await call(`/api/commands/${scenario}/stop`,token,{});
        else if(scenario==='permission-revoked') {await call('/api/approval-settings/instance',token,{mode:'never-ask',clockEnabled:false});await call(`/api/approvals/${approval.id}/approve`,token,{});}
        else await call(`/api/approvals/${approval.id}/deny`,token,{});
      }
      const command=await until(async()=>{const c=await call(`/api/commands/${scenario}`,token);return c.state!=='pending'&&c;});
      const failed=['provider-failure','limit','permission-revoked'].includes(scenario);
      assert.equal(command.state,scenario==='stop'?'stopped':failed?'failed':'completed');
      assert.equal(command.responseProgress.state,command.state);
      const work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];
      const first=work.events.filter(event=>event.name==='clock');
      assert.ok(first[0].callId);assert.equal(first[0].callId,first[1].callId);
      if(scenario==='success'){assert.equal(command.workActions[0].state,'succeeded');assert.match(requests[1].at(-1).content,/^\d{4}-/);assert.equal(first[1].success,1);}
      if(scenario==='ordinary-error'){assert.equal(first[1].success,0);assert.match(requests[1].at(-1).content,/Tool error/);assert.equal(command.workActions.length,0);}
      if(scenario==='time-denied'){assert.equal(requests[1].at(-1).tool_call_id,'first');assert.match(requests[1].at(-1).content,/denied/i);assert.equal(command.workActions[0].state,'cancelled');}
      if(scenario==='closed-after-denial'){assert.equal(command.workActions.length,1);assert.match(requests[2].at(-1).content,/admission is closed/);assert.equal(work.events.length,4);}
      if(scenario==='limit'){assert.equal(requests.length,4);assert.equal(command.workActions.length,4);assert.equal(command.error,'Tool iteration limit reached');}
      if(scenario==='provider-failure'){assert.equal(requests.length,2);assert.equal(command.workActions[0].state,'succeeded');}
      if(['stop','permission-revoked'].includes(scenario)){assert.equal(requests.length,1);assert.equal(command.workActions[0].state,'cancelled');}
      const messages=await call(`/api/bots/${bot.id}/messages`,token);
      if(command.state==='completed')assert.equal(messages.at(-1).content,scenario==='time-denied'?'I could not obtain the current time.':'Fixture follow-up');
      else assert.ok(!messages.some(message=>message.content==='Fixture follow-up'));
      await app.close();app=startInstance(path,0,{env:{},providerFactory});port=await app.listen();
      const persisted=await call(`/api/commands/${scenario}`,token);assert.equal(persisted.state,command.state);assert.deepEqual(persisted.workActions.map(action=>action.state),command.workActions.map(action=>action.state));
      const restored=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];assert.deepEqual(restored.events,work.events);
    } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
  });
}

test('Code Mode denial returns to the provider while action admission stays closed', async()=>{
  const requests=[];
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
    requests.push(structuredClone(messages));
    if(requests.length===1)return {role:'assistant',content:null,tool_calls:[{id:'program',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.clock({});'})}}]};
    return {role:'assistant',content:'Hello after denial'};
  }});
  const app=startInstance(':memory:',0,{env:{},providerFactory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  const until=async fn=>{for(let i=0;i<250;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  try{const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Code',toolMode:'code'});
    await call('/api/approval-settings/instance',token,{mode:'ask-every-time',clockEnabled:true});await call('/api/commands',token,{id:'code-denial',botId:bot.id,content:'Hello'});
    const approval=await until(async()=>(await call('/api/approvals',token)).find(item=>item.state==='pending'));await call(`/api/approvals/${approval.id}/deny`,token,{});
    const command=await until(async()=>{const c=await call('/api/commands/code-denial',token);return c.state!=='pending'&&c;});
    assert.equal(command.state,'completed');assert.equal(command.workActions[0].state,'cancelled');assert.equal(command.codeExecutions[0].outcome,'closed');assert.equal(requests[1].at(-1).tool_call_id,'program');assert.match(requests[1].at(-1).content,/denied/i);
  }finally{await app.close();}
});

test('revoked client cannot decide a pending clock approval', async()=>{
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'Denial acknowledged'}:{role:'assistant',tool_calls:[{id:'clock',function:{name:'clock',arguments:'{}'}}]};}});
  const app=startInstance(':memory:',0,{env:{},providerFactory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
  const until=async fn=>{for(let i=0;i<200;i++){const x=await fn();if(x)return x;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  try{
    const owner=(await call('/api/pair','',{code:app.code}))[1].token,other=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
    const bot=(await call('/api/bots',owner,{provider:'live',model:'fixture-offline',name:'Clients'}))[1];await call('/api/approval-settings/instance',owner,{mode:'ask-every-time',clockEnabled:true});
    await call('/api/commands',owner,{id:'clients',botId:bot.id,content:'Hello'});const approval=await until(async()=>(await call('/api/approvals',owner))[1].find(item=>item.state==='pending'));
    const client=(await call('/api/clients',other))[1].find(item=>item.current);await call(`/api/clients/${client.id}/revoke`,owner,{});
    assert.equal((await call(`/api/approvals/${approval.id}/approve`,other,{}))[0],401);
    assert.equal((await call(`/api/approvals/${approval.id}/deny`,owner,{}))[0],200);
    const command=await until(async()=>{const c=(await call('/api/commands/clients',owner))[1];return c.state!=='pending'&&c;});assert.equal(command.state,'completed');assert.equal(command.workActions[0].state,'cancelled');
  }finally{await app.close();}
});

test('provider failure after a tool result preserves failed partial status without a final reply', async()=>{
  let step=0;
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:true},async *stream(){
    if(step++===0){yield {type:'message',message:{role:'assistant',tool_calls:[{id:'clock',function:{name:'clock',arguments:'{}'}}]}};return;}
    yield {type:'text_delta',text:'A partial response before failure. '};yield {type:'error',message:'synthetic failure'};
  },async complete(){throw Error('unexpected');}});
  const app=startInstance(':memory:',0,{env:{},providerFactory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  try{const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Partial'});await call('/api/commands',token,{id:'partial',botId:bot.id,content:'Time'});
    let command;for(let i=0;i<200;i++){command=await call('/api/commands/partial',token);if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'failed');assert.equal(command.responseProgress.state,'failed');assert.match(command.responseProgress.text,/partial response/);assert.equal(command.workActions[0].state,'succeeded');assert.ok(command.runtimeEvents.some(e=>e.type==='tool_result'&&e.success));
    assert.deepEqual((await call(`/api/bots/${bot.id}/messages`,token)).map(m=>m.role),['user']);
  }finally{await app.close();}
});

test('task iteration exhaustion reports its durable limit outcome',async()=>{
  let calls=0;const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){return {role:'assistant',tool_calls:[{id:'clock-'+(++calls),function:{name:'clock',arguments:'{}'}}]};}})}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  try{const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Task limit'});await call('/api/tasks',token,{id:'task-limit',botId:bot.id,objective:'Read time'});let task;for(let i=0;i<200;i++){task=await call('/api/tasks/task-limit',token);if(task.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(task.state,'failed');assert.equal(task.outcome,'Tool iteration limit reached');assert.equal(calls,4);assert.equal(task.workActions.length,4);
  }finally{await app.close();}
});
