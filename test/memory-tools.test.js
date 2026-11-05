import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'one',type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('shared proposal inspection and recovery redact configured credentials',async()=>{
  const secret=['synthetic','proposal','secret'].join('-'),seen=[];
  const app=startInstance(':memory:',0,{env:{OPENROUTER_API_KEY:secret},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
    seen.push(structuredClone(messages));
    return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'await capabilities.memory_remember({scope:{kind:"user"},text:["synthetic","proposal","secret"].join("-")}); throw Error("fixture");'});
  }})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};
  try {
    token=(await call('/api/pair',{code:app.code})).token;
    const bot=await call('/api/bots',{name:'Proposal privacy',toolMode:'hybrid'});
    await call('/api/commands',{id:'proposal-privacy',botId:bot.id,content:'Perform fixture operation.'});
    let command;for(let n=0;n<500;n++){command=await call('/api/commands/proposal-privacy');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed',command.error);
    assert.equal(command.workActions.length,1);
    assert.equal(command.codeExecutions[0].outcome,'error');
    assert.equal(JSON.stringify(command).includes(secret),false);
    assert.equal(JSON.stringify(seen).includes(secret),false);
    assert.match(command.workActions[0].result,/REDACTED/);
  } finally {await app.close();}
});

test('registered memory action changes the owner-visible store',async()=>{
  const offers=[];
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){offers.push(tools.map(x=>x.function.name));return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('memory_remember',{scope:{kind:'agent'},text:'fixture amber'});}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();};
  try {
    token=(await call('/api/pair',{code:app.code})).token;
    const bot=await call('/api/bots',{name:'Memory',toolMode:'direct'});
    await call('/api/commands',{id:'memory-fixture',botId:bot.id,content:'Please perform the fixture operation.'});
    let command;for(let i=0;i<500;i++){command=await call('/api/commands/memory-fixture');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed',command.error);
    assert.ok(offers[0].includes('memory_remember'));
    assert.equal(command.workActions.length,1);
    assert.equal(command.workActions[0].state,'succeeded');
    assert.equal((await call(`/api/memories/bot/${bot.id}`))[0].text,'fixture amber');
  } finally {await app.close();}
});

test('all modes share scoped store, owner confirmation, conflicts, and restart persistence',async()=>{
  const {mkdtempSync,rmSync,writeFileSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const dir=mkdtempSync(join(tmpdir(),'staf-memory-actions-')),path=join(dir,'instance.sqlite');
  let plan,app,port,token,sequence=0;const seen=[];
  const factory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
    const after=messages.slice(messages.findLastIndex(m=>m.role==='user')+1);
    seen.push({tools:tools.map(x=>x.function.name),messages:structuredClone(after)});
    if(after.some(m=>m.role==='tool'))return {role:'assistant',content:'fixture complete'};
    if(plan.route==='direct')return tool(plan.name,plan.input);
    return tool('code_mode',{source:`return await capabilities[${JSON.stringify(plan.name)}](${JSON.stringify(plan.input)});`});
  }});
  const start=async()=>{app=startInstance(path,0,{env:{},providerFactory:factory});port=await app.listen();};
  const call=async(route,body,credential=token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.ok(r.ok,`${route}: ${r.status} ${JSON.stringify(data)}`);return data;};
  const wait=async id=>{for(let n=0;n<1000;n++){const c=await call('/api/commands/'+id);if(c.state!=='pending')return c;await new Promise(r=>setTimeout(r,10));}throw Error('Command timed out');};
  const run=async(bot,route,name,input,expected='succeeded')=>{plan={route,name,input};const commandId=`fixture-${++sequence}`;const offset=seen.length;await call('/api/commands',{id:commandId,botId:bot.id,content:`Execute fixture ${sequence}.`});const command=await wait(commandId);assert.equal(command.state,'completed',command.error);assert.equal(command.workActions.length,1,JSON.stringify(command));assert.equal(command.workActions[0].state,expected);if(route==='code'){assert.equal(command.codeExecutions.length,1);assert.equal(command.codeExecutions[0].actions[0],command.workActions[0].id);}else assert.ok(seen[offset].tools.includes(name));return {command,result:seen.at(-1).messages.findLast(m=>m.role==='tool')?.content};};
  try {
    await start();const pair=await call('/api/pair',{code:app.code},null);token=pair.token;const other=(await call('/api/pair',{code:app.issueCode()},null)).token;
    const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify(pair));
    const bots={};for(const mode of ['direct','hybrid','code'])bots[mode]=await call('/api/bots',{name:`Memory ${mode}`,toolMode:mode});
    for(const mode of ['direct','hybrid','code']) {
      const bot=bots[mode],route=mode==='direct'?'direct':'code',scope={kind:'agent'};
      await run(bot,route,'memory_remember',{scope,text:`amber ${mode}`});
      let entries=await call(`/api/memories/bot/${bot.id}`);assert.equal(entries.length,1);let item=entries[0];assert.equal(item.version,1);
      let read=await run(bot,route,'memory_read',{scope,id:item.id});assert.match(read.result,new RegExp(item.id));
      let search=await run(bot,route,'memory_search',{scope,query:'amber'});assert.match(search.result,new RegExp(item.id));
      await run(bot,route,'memory_update',{scope,id:item.id,version:1,text:`blue ${mode}`});
      entries=await call(`/api/memories/bot/${bot.id}`);assert.equal(entries[0].version,2);assert.equal(entries[0].text,`blue ${mode}`);
      await run(bot,route,'memory_update',{scope,id:item.id,version:1,text:'stale'},'failed');assert.equal((await call(`/api/memories/bot/${bot.id}`))[0].text,`blue ${mode}`);
      await run(bot,route,'memory_forget',{scope,id:item.id,version:2});assert.deepEqual(await call(`/api/memories/bot/${bot.id}`),[]);
    }
    const bot=bots.hybrid,scope={kind:'user'};
    const proposal=await run(bot,'direct','memory_remember',{scope,text:'shared violet'});const proposalId=JSON.parse(proposal.result).proposal.id;
    assert.match(proposal.command.workActions[0].result,/shared violet/);assert.match(proposal.command.workActions[0].result,new RegExp(proposalId));
    assert.deepEqual(await call('/api/memories/user'),[]);
    const status=await run(bot,'code','memory_proposal_status',{id:proposalId});assert.match(status.result,/pending/);
    await call('/api/commands',{id:'owner-confirm',botId:bot.id,content:`Confirm shared memory ${proposalId}`},other);assert.equal((await wait('owner-confirm')).state,'completed');
    let shared=(await call('/api/memories/user'))[0];assert.equal(shared.text,'shared violet');
    const sharedCli=await promisify(execFile)(process.execPath,['dist/cli.js','instance','memory-list',`http://127.0.0.1:${port}`,credential,'user']);assert.match(sharedCli.stdout,/shared violet/);
    assert.match((await run(bot,'direct','memory_proposal_status',{id:proposalId})).result,/confirmed/);
    await run(bot,'code','memory_update',{scope,id:shared.id,version:shared.version,text:'shared green'});
    shared=(await call('/api/memories/user'))[0];assert.equal(shared.version,2);
    await call(`/api/memories/user/${shared.id}/edit`,{version:2,text:'owner changed'},other);
    await run(bot,'direct','memory_forget',{scope,id:shared.id,version:2},'failed');
    shared=(await call('/api/memories/user'))[0];assert.equal(shared.version,3);
    await run(bot,'code','memory_read',{scope:{kind:'agent'},id:shared.id},'failed');
    await run(bot,'code','memory_forget',{scope,id:shared.id,version:3});assert.deepEqual(await call('/api/memories/user'),[]);
    for(const mode of ['direct','code']) {
      const scopedBot=bots[mode],route=mode==='direct'?'direct':'code';
      const proposed=await run(scopedBot,route,'memory_remember',{scope,text:`shared ${mode}`});
      const result=JSON.parse(proposed.result);const proposalId=route==='code'?result.value.value.proposal.id:result.proposal.id;
      await call('/api/commands',{id:`confirm-${mode}`,botId:scopedBot.id,content:`Confirm shared memory ${proposalId}`},other);assert.equal((await wait(`confirm-${mode}`)).state,'completed');
      const item=(await call('/api/memories/user'))[0];assert.equal(item.text,`shared ${mode}`);
      assert.match((await run(scopedBot,route,'memory_search',{scope,query:`shared ${mode}`})).result,new RegExp(item.id));
      assert.match((await run(scopedBot,route,'memory_read',{scope,id:item.id})).result,new RegExp(item.id));
      await run(scopedBot,route,'memory_update',{scope,id:item.id,version:1,text:`revised ${mode}`});
      assert.equal((await call('/api/memories/user'))[0].text,`revised ${mode}`);
      await run(scopedBot,route,'memory_forget',{scope,id:item.id,version:2});assert.deepEqual(await call('/api/memories/user'),[]);
    }
    const otherItem=await call(`/api/memories/bot/${bots.direct.id}`,{text:'private other'});
    await run(bot,'direct','memory_read',{scope:{kind:'agent'},id:otherItem.id},'failed');
    await run(bot,'direct','memory_remember',{scope:{kind:'agent'},text:'persisted cobalt'});
    const cli=await promisify(execFile)(process.execPath,['dist/cli.js','instance','memory-list',`http://127.0.0.1:${port}`,credential,`bot:${bot.id}`]);assert.match(cli.stdout,/persisted cobalt/);
    await app.close();await start();assert.equal((await call(`/api/memories/bot/${bot.id}`))[0].text,'persisted cobalt');
  } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('completed mutation resumes after guest error without applying its stale version twice',async()=>{
  let item;const seen=[];
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
    const current=messages.slice(messages.findLastIndex(m=>m.role==='user')+1),results=current.filter(m=>m.role==='tool');seen.push(structuredClone(results));
    const input={scope:{kind:'agent'},id:item.id,version:1,text:'changed once'};
    if(!results.length)return tool('code_mode',{source:`await capabilities.memory_update(${JSON.stringify(input)}); throw Error('fixture error');`});
    if(results.length===1){const recovery=JSON.parse(results[0].content);return tool('memory_update',{...input,_staf:{kind:'resume',actionId:recovery.recovery.actions[0].id}});}
    return {role:'assistant',content:'done'};
  }})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
  try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Recovery',toolMode:'hybrid'});item=await call(`/api/memories/bot/${bot.id}`,{text:'before'});await call('/api/commands',{id:'recover',botId:bot.id,content:'Perform operation fixture.'});let c;for(let i=0;i<1000;i++){c=await call('/api/commands/recover');if(c.state!=='pending')break;await new Promise(r=>setTimeout(r,10));}assert.equal(c.state,'completed',c.error);assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.equal(c.codeExecutions[0].outcome,'error');assert.match(seen.at(-1).at(-1).content,/changed once/);const [updated]=await call(`/api/memories/bot/${bot.id}`);assert.equal(updated.version,2);assert.equal(updated.text,'changed once');}
  finally {await app.close();}
});

test('agent substitution is rejected and cannot address another agent',async()=>{
  let other;const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return tool('memory_remember',{scope:{kind:'agent',botId:other.id},text:'forged'});}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
  try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Executor',toolMode:'direct'});other=await call('/api/bots',{name:'Other'});await call('/api/commands',{id:'forged-memory',botId:bot.id,content:'Perform fixture.'});let c;for(let i=0;i<1000;i++){c=await call('/api/commands/forged-memory');if(c.state!=='pending')break;await new Promise(r=>setTimeout(r,10));}assert.equal(c.workActions.length,0);assert.deepEqual(await call(`/api/memories/bot/${bot.id}`),[]);assert.deepEqual(await call(`/api/memories/bot/${other.id}`),[]);}
  finally{await app.close();}
});

test('memory registration uses actual task ownership and recovery admission',async()=>{
  const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');
  const instance=new Instance(':memory:');
  try {
    const bot=instance.createBot({name:'Task memory',instructions:'',toolMode:'hybrid'});const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);
    instance.acceptTask({id:'task-memory',botId:bot.id,objective:'fixture',limitMs:10000});instance.taskStart('task-memory');const controller=new AbortController();const actions=registry.open({kind:'task',id:'task-memory'},controller.signal);
    const source=callId=>({kind:'provider',responseId:'fixture',callId});const input={scope:{kind:'agent'},text:'task data'};
    const first=await actions.invoke({source:source('first'),name:'memory_remember',input,intent:{kind:'new'}});assert.equal(first.kind,'completed');assert.equal(instance.memories.list({kind:'bot',botId:bot.id}).length,1);
    actions.beginRecovery();const replay=await actions.invoke({source:source('new'),name:'memory_remember',input,intent:{kind:'new'}});assert.equal(replay.kind,'repeat-required');assert.equal(instance.memories.list({kind:'bot',botId:bot.id}).length,1);
    const resumed=await actions.invoke({source:source('resume'),name:'memory_remember',input,intent:{kind:'resume',actionId:first.actionId}});assert.equal(resumed.value.id,first.value.id);
    controller.abort();await assert.rejects(()=>actions.invoke({source:source('stopped'),name:'memory_remember',input:{...input,text:'after stop'},intent:{kind:'new'}}));assert.equal(instance.memories.list({kind:'bot',botId:bot.id}).length,1);actions.dispose();
  } finally {instance.close();}
});

test('an uncertain real-store update fences a later memory change',async()=>{
  const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');
  const instance=new Instance(':memory:');try {
    const bot=instance.createBot({name:'Uncertain',instructions:'',toolMode:'hybrid'});instance.claim({id:'uncertain-memory',botId:bot.id,content:'fixture'});
    const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);const actions=registry.open({kind:'command',id:'uncertain-memory'},new AbortController().signal);
    const item=instance.memories.create({scope:{kind:'bot',botId:bot.id},text:'before'});
    instance.db.exec("CREATE TRIGGER memory_fixture_failure AFTER UPDATE ON memories BEGIN SELECT RAISE(FAIL, 'fixture lost result'); END");
    const first=await actions.invoke({source:{kind:'guest',executionId:'fixture',sequence:1},name:'memory_update',input:{scope:{kind:'agent'},id:item.id,version:1,text:'after'},intent:{kind:'new'}});
    assert.equal(first.kind,'status');assert.equal(first.action.state,'uncertain');
    const second=await actions.invoke({source:{kind:'provider',responseId:'fixture',callId:'later'},name:'memory_forget',input:{scope:{kind:'agent'},id:item.id,version:2},intent:{kind:'new'}});
    assert.equal(second.kind,'blocked');assert.match(second.reason,/reconciliation/);assert.equal(instance.memories.list({kind:'bot',botId:bot.id})[0].text,'after');actions.dispose();
  } finally {instance.close();}
});
