import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

const callTool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('paired tasks use captured tool mode and the real action service',async()=>{
  const offers=[];
  const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
    offers.push({mode:profile.toolMode,names:tools.map(t=>t.function.name)});
    if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};
    return profile.toolMode==='direct'?callTool('clock',{}):callTool('code_mode',{source:'return (await capabilities.clock({})).value;'});
  }})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try {token=(await call('/api/pair',{code:app.code})).token;
    for(const mode of ['direct','hybrid','code']) {const bot=await call('/api/bots',{name:mode,toolMode:mode});const index=offers.length;await call('/api/tasks',{id:mode,botId:bot.id,objective:'Read time'});let task;for(let i=0;i<500;i++){task=await call('/api/tasks/'+mode);if(!['queued','running'].includes(task.state))break;await new Promise(r=>setTimeout(r,10));}assert.equal(task.state,'completed',JSON.stringify(task));const individual=['terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize','clock','file_read','file_write','file_edit','file_search','memory_search','memory_read','memory_remember','memory_update','memory_forget','memory_proposal_status','ask_owner','discover_bots','request_bot_help','answer_bot'];assert.deepEqual(offers[index].names,mode==='code'?['code_mode']:mode==='hybrid'?[...individual,'code_mode']:individual);assert.equal(task.workActions.length,1);assert.equal(task.workActions[0].state,'succeeded');}
  } finally {await app.close();}
});

test('owner answers defer queued calls and the next task iteration can still act',async()=>{
  for(const mode of ['direct','hybrid','code']) {
    let calls=0,seenAnswer=false;
    const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
      const user=messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
      if(user.includes('Use the blue file'))seenAnswer=true;
      calls++;
      if(calls===1) {
        assert.equal(tools.some(t=>t.function.name==='ask_owner'),mode!=='code');
        return mode==='direct'?callTool('ask_owner',{question:'Which file?'}):callTool('code_mode',{source:'const q=capabilities.ask_owner({question:"Which file?"}); const c=capabilities.clock({}).catch(e=>String(e)); return [await q,await c];'});
      }
      if(calls===2)return mode==='code'?callTool('code_mode',{source:'return await capabilities.clock({});'}):callTool('clock',{});
      return {role:'assistant',content:'done'};
    }})});
    const port=await app.listen();let token;
    const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
    const until=async fn=>{for(let i=0;i<1000;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
    try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:mode,toolMode:mode});await call('/api/tasks',{id:'task',botId:bot.id,objective:'Choose file'});
      const question=await until(async()=>{const task=await call('/api/tasks/task');return task.inbox.questions.find(q=>q.state==='open');});
      await call('/api/tasks/task/input',{id:'answer',kind:'answer',questionId:question.id,text:'Use the blue file'});
      const task=await until(async()=>{const task=await call('/api/tasks/task');return !['queued','running'].includes(task.state)&&task;});
      assert.equal(task.state,'completed',JSON.stringify(task));assert.ok(seenAnswer);assert.equal(task.workActions.filter(a=>a.summary==='Read UTC clock').length,1);assert.equal(task.workActions.filter(a=>a.state==='succeeded').length,2);
    } finally {await app.close();}
  }
});

test('a delegated helper uses its own captured mode and task scope',async()=>{
  let helperId,rootCalls=0,helperCalls=0,helperOffers;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
    if(profile.chatId==='root')return rootCalls++===0?callTool('request_bot_help',{helperId,objective:'Check time',context:'Use only this brief'}):{role:'assistant',content:'done'};
    helperOffers=tools.map(t=>t.function.name);
    return helperCalls++===0?callTool('code_mode',{source:'return (await capabilities.clock({})).value;'}):{role:'assistant',content:'Helper completed'};
  }})});
  const port=await app.listen();let token,timer;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try {token=(await call('/api/pair',{code:app.code})).token;const root=await call('/api/bots',{name:'Requester',toolMode:'direct'});const helper=await call('/api/bots',{name:'Helper',toolMode:'code'});helperId=helper.id;
    timer=setInterval(async()=>{try{for(const d of (await call('/api/disclosures')).filter(d=>d.state==='pending'))await call(`/api/disclosures/${d.id}/approve`,{});}catch{}},20);
    await call('/api/tasks',{id:'root',botId:root.id,objective:'Investigate',delegateClock:true});let result;for(let i=0;i<1000;i++){result=await call('/api/tasks/root');if(!['queued','running'].includes(result.state))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(result.state,'completed',JSON.stringify(result));assert.deepEqual(helperOffers,['code_mode']);const tasks=await call(`/api/bots/${helperId}/tasks`);const task=await call('/api/tasks/'+tasks[0].id);assert.equal(task.toolMode,'code');assert.equal(task.workActions.filter(a=>a.summary==='Read UTC clock').length,1);assert.equal(task.codeExecutions[0].outcome,'return');assert.deepEqual(result.collaborations[0].messages.map(m=>m.kind),['request','result']);
  } finally {clearInterval(timer);await app.close();}
});

test('held task and its explicit retry keep the accepted profile',async()=>{
  let started,release;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),seen=[];
  const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,tools){seen.push({mode:profile.toolMode,instructions:profile.instructions,offers:tools.map(t=>t.function.name)});if(seen.length===1){started();await gate;throw Error('fixture failure');}return {role:'assistant',content:'done'};}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const wait=async id=>{for(let i=0;i<500;i++){const t=await call('/api/tasks/'+id);if(!['queued','running'].includes(t.state))return t;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
  try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'captured',instructions:'Before',toolMode:'code'});const request={id:'first',botId:bot.id,objective:'Test',limitMs:300000};await call('/api/tasks',request);await entered;await call(`/api/bots/${bot.id}/profile`,{...bot,instructions:'After',toolMode:'direct'});assert.equal((await call('/api/tasks',request)).kind,'existing');release();assert.equal((await wait('first')).state,'failed');await call('/api/tasks',{...request,id:'retry',predecessor:'first'});assert.equal((await wait('retry')).state,'completed');assert.deepEqual(seen.map(x=>[x.mode,x.instructions]),[['code','Before'],['code','Before']]);assert.deepEqual(seen.map(x=>x.offers),[['code_mode'],['code_mode']]);}
  finally{release();await app.close();}
});

test('direction during approval defers the action without closing task admission',async()=>{
  let calls=0,seenDirection=false;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){calls++;if(messages.some(m=>m.role==='user' && m.content.includes('New direction')))seenDirection=true;if(calls===1)return callTool('code_mode',{source:'return await Promise.allSettled([capabilities.clock({}),capabilities.clock({})]);'});if(calls===2)return callTool('clock',{});return {role:'assistant',content:'done'};}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async fn=>{for(let i=0;i<1000;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
  try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Direction',toolMode:'hybrid'});await call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});await call('/api/tasks',{id:'task',botId:bot.id,objective:'Read clock'});const first=await until(async()=>(await call('/api/approvals')).find(a=>a.state==='pending'));await call('/api/tasks/task/input',{id:'direction',kind:'direction',text:'New direction'});await call(`/api/approvals/${first.id}/approve`,{});const second=await until(async()=>(await call('/api/approvals')).find(a=>a.state==='pending' && a.id!==first.id));await call(`/api/approvals/${second.id}/approve`,{});const task=await until(async()=>{const t=await call('/api/tasks/task');return !['queued','running'].includes(t.state)&&t;});assert.equal(task.state,'completed',JSON.stringify(task));assert.ok(seenDirection);assert.deepEqual(task.workActions.map(a=>a.state),['cancelled','succeeded']);}
  finally{await app.close();}
});

test('paired CLI task inspection exposes the same scripted task actions',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile),dir=mkdtempSync(join(tmpdir(),'staf-task-actions-cli-'));
  const app=startInstance(join(dir,'db'),0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:callTool('code_mode',{source:'return await capabilities.clock({});'});}})});const port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
  try {await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'CLI'));const submitted=await cli('task-start',url,credential,bot.id,'Read clock');const id=submitted.match(/Task attempt ID: ([\w-]+)/)?.[1];assert.ok(id);await cli('task-follow',url,credential,id);const task=JSON.parse(await cli('task',url,credential,id));assert.equal(task.state,'completed');assert.equal(task.workActions[0].state,'succeeded');assert.equal(task.codeExecutions[0].outcome,'return');}
  finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('direction during helper disclosure records no effect and permits later task work',async()=>{
  let helperId,calls=0;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){if(profile.chatId!=='root')throw Error('Helper must not start');calls++;return calls===1?callTool('request_bot_help',{helperId,objective:'Check',context:'Brief'}):calls===2?callTool('clock',{}):{role:'assistant',content:'done'};}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async fn=>{for(let i=0;i<1000;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
  try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Root',toolMode:'direct'});helperId=(await call('/api/bots',{name:'Helper'})).id;await call('/api/tasks',{id:'root',botId:bot.id,objective:'Work'});const disclosure=await until(async()=>(await call('/api/disclosures')).find(d=>d.state==='pending'));await call('/api/tasks/root/input',{id:'direction',kind:'direction',text:'Work alone'});await call(`/api/disclosures/${disclosure.id}/approve`,{});const task=await until(async()=>{const t=await call('/api/tasks/root');return !['queued','running'].includes(t.state)&&t;});assert.equal(task.state,'completed',JSON.stringify(task));assert.deepEqual(task.workActions.map(a=>a.state),['failed','succeeded']);assert.equal((await call(`/api/bots/${helperId}/tasks`)).length,0);}
  finally{await app.close();}
});

test('task guest errors retain completed actions and continue only in the captured mode',async()=>{
  for(const mode of ['hybrid','code']){
    let calls=0,offers=[];
    const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){offers=tools.map(t=>t.function.name);calls++;if(calls===1)return callTool('code_mode',{source:'await capabilities.clock({}); throw Error("ordinary error");'});if(calls===2){assert.match(messages.at(-1).content,/recovery/);return mode==='hybrid'?callTool('clock',{}):callTool('code_mode',{source:'return await capabilities.clock({});'});}return {role:'assistant',content:'recovered'};}})});const port=await app.listen();let token;
    const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
    try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:mode,toolMode:mode});await call('/api/tasks',{id:'task',botId:bot.id,objective:'Work'});let task;for(let i=0;i<500;i++){task=await call('/api/tasks/task');if(!['queued','running'].includes(task.state))break;await new Promise(r=>setTimeout(r,10));}assert.equal(task.state,'completed',JSON.stringify(task));assert.equal(task.workActions.length,2);assert.equal(task.codeExecutions[0].outcome,'error');assert.equal(offers.includes('clock'),mode==='hybrid');}
    finally{await app.close();}
  }
});

test('task Stop prevents queued calls in each mode',async()=>{
  for(const mode of ['direct','hybrid','code']){
    const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){return mode==='direct'?{role:'assistant',content:null,tool_calls:[{id:'one',type:'function',function:{name:'clock',arguments:'{}'}},{id:'two',type:'function',function:{name:'clock',arguments:'{}'}}]}:callTool('code_mode',{source:'return await Promise.all([capabilities.clock({}),capabilities.clock({})]);'});}})});const port=await app.listen();let token;
    const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
    const until=async fn=>{for(let i=0;i<1000;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
    try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:mode,toolMode:mode});await call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});await call('/api/tasks',{id:'task',botId:bot.id,objective:'Read clock'});await until(async()=>(await call('/api/approvals')).find(a=>a.state==='pending'));await call('/api/tasks/task/stop',{});const task=await until(async()=>{const t=await call('/api/tasks/task');return t.state==='stopped'&&t;});assert.equal(task.workActions.filter(a=>a.state==='succeeded').length,0);assert.ok(task.workActions.length<=1);assert.equal((await call('/api/approvals')).filter(a=>a.state==='pending').length,0);}
    finally{await app.close();}
  }
});

test('actual tasks share registered search, file, memory and native actions',async()=>{
  const {createServer}=await import('node:http');let requests=0,release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const server=createServer(async(req,res)=>{for await(const _ of req){}requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Fixture',url:'https://example.test/result',content:'local'}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const offers=[];let calls=0;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){offers.push(tools.map(t=>t.function.name));if(calls++===0){entered();await gate;return callTool('code_mode',{source:'const s=await capabilities.search_web({query:"task query"}); const f=await capabilities.file_write({path:"task.txt",content:"task content"}); const m=await capabilities.memory_remember({scope:{kind:"agent"},text:"task memory"}); const p=await capabilities.terminal_run({command:"printf task-native"}); return [s.value,f.value,m.value,p.value];'});}return {role:'assistant',content:'done'};}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async fn=>{for(let i=0;i<1000;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
  try{token=(await call('/api/pair',{code:app.code})).token;const config=await call('/api/search-config');await call('/api/search-config',{revision:config.revision,origin:`http://127.0.0.1:${server.address().port}`});await call('/api/search-permissions/instance',{enabled:true});const bot=await call('/api/bots',{name:'Combined',toolMode:'hybrid'});await call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});await call('/api/tasks',{id:'combined',botId:bot.id,objective:'Run registered actions',limitMs:1000});await ready;await call('/api/search-permissions/task:combined',{enabled:true});release();const approval=await until(async()=>(await call('/api/search-approvals')).find(a=>a.work.id==='combined'));assert.equal(approval.work.kind,'task');await new Promise(r=>setTimeout(r,1200));assert.equal((await call('/api/tasks/combined')).state,'running');await call(`/api/search-approvals/${approval.id}/approve`,{});const task=await until(async()=>{const t=await call('/api/tasks/combined');return !['running','queued'].includes(t.state)&&t;});assert.equal(task.state,'completed',JSON.stringify(task));assert.equal(offers[0].filter(n=>n==='search_web').length,1);assert.equal(requests,1);assert.equal(task.workActions.length,4);assert.ok(task.workActions.every(a=>a.state==='succeeded'),JSON.stringify(task.workActions));assert.equal(task.codeExecutions[0].outcome,'return');assert.deepEqual(task.codeExecutions[0].actions,task.workActions.map(a=>a.id));assert.match(JSON.stringify(task.codeExecutions[0].result),/local/);const values=task.codeExecutions[0].result.value;const {readFileSync}=await import('node:fs');assert.equal(readFileSync(values[1].path,'utf8'),'task content');assert.match(JSON.stringify(values[2]),/task memory/);const processes=await call('/api/processes');const process=processes.find(p=>p.work.id==='combined');assert.equal(process.botId,bot.id);assert.equal(process.actionId,task.workActions[3].id);const output=await until(async()=>{const page=await call(`/api/processes/${process.id}/output`);return page.chunks.some(c=>c.text?.includes('task-native')) && page;});assert.ok(output.chunks.some(c=>c.text?.includes('task-native')));}
  finally{release();await app.close();await new Promise(r=>server.close(r));}
});
