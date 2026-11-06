import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from '../dist/instance-service.js';

test('background task and chat run independently, retain activity, and survive restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-task-')), path=join(dir,'db');
  let release, entered; const gate=new Promise(r=>release=r), started=new Promise(r=>entered=r);
  const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages){if(profile.chatId==='attempt-one'){entered();await gate;return {role:'assistant',content:'background result',usage:{scope:'request',status:'reported',source:'fixture',metrics:{input:7}}};}return {role:'assistant',content:'chat result'};}});
  let app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
  const wait=async(route,token,predicate)=>{for(let i=0;i<200;i++){const v=(await call(route,token))[1];if(predicate(v))return v;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');};
  try {
    const token=(await call('/api/pair','',{code:app.code}))[1].token, bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];
    const req={id:'attempt-one',botId:bot.id,objective:'Investigate',limitMs:10000};
    assert.equal((await call('/api/tasks',token,req))[1].kind,'accepted'); await started;
    assert.equal((await call('/api/tasks',token,{...req,id:'other'}))[1].kind,'busy');
    assert.equal((await call('/api/commands',token,{id:'chat',botId:bot.id,content:'Hello'}))[1].kind,'accepted');
    assert.equal((await wait('/api/commands/chat',token,c=>c.state!=='pending')).state,'completed');
    assert.equal((await call(`/api/bots/${bot.id}/archive`,token,{revision:bot.revision}))[0],409);
    assert.equal((await call('/api/tasks/attempt-one/stop',token,{}))[1].state,'stopping');
    release(); const completed=await wait('/api/tasks/attempt-one',token,t=>t.state==='completed');
    assert.equal(completed.outcome,'background result');assert.equal(completed.usage[0].metrics.input,7);
    assert.ok(completed.activity.some(e=>e.type==='stopping'));assert.ok(completed.activity.some(e=>e.type==='assistant'));
    assert.equal((await call('/api/tasks',token,req))[1].kind,'existing');
    await app.close(); app=startInstance(path,0,{providerFactory:factory});port=await app.listen();
    assert.equal((await call('/api/tasks/attempt-one',token))[1].outcome,'background result');
  } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('failure retains tool activity and explicit retry survives interruption', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-task-recovery-')),path=join(dir,'db');let calls=0, waiting;const chatRequests=[];
  const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(_messages,_tools,{signal}){
    if(profile.chatId==='failed-attempt') {calls++;if(calls===1)return {role:'assistant',content:null,tool_calls:[{id:'clock-call',type:'function',function:{name:'clock',arguments:'{}'}}],usage:{scope:'request',status:'reported',source:'fixture',metrics:{input:3}}};throw Error('fixture failed');}
    if(profile.chatId !== 'retry-attempt'){chatRequests.push(structuredClone(_messages));return {role:'assistant',content:'chat answer'};}
    await new Promise(resolve=>{waiting=resolve;if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('cancelled');
  }});
  let app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
  const wait=async(route,token,predicate)=>{for(let i=0;i<200;i++){const v=(await call(route,token))[1];if(predicate(v))return v;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');};
  try {const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];
    await call('/api/tasks',token,{id:'failed-attempt',botId:bot.id,objective:'Inspect'});
    const failed=await wait('/api/tasks/failed-attempt',token,t=>t.state==='failed');
    assert.ok(failed.activity.some(e=>e.type==='tool_result'));assert.equal(failed.usage[0].metrics.input,3);
    const retry=(await call('/api/tasks',token,{id:'retry-attempt',botId:bot.id,objective:'Inspect',predecessor:'failed-attempt'}))[1];
    assert.equal(retry.attempt.taskId,failed.taskId);while(!waiting) await new Promise(r=>setTimeout(r,1));
    await app.close();app=startInstance(path,0,{providerFactory:factory});port=await app.listen();
    const interrupted=(await call('/api/tasks/retry-attempt',token))[1];assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.predecessor,'failed-attempt');assert.ok(interrupted.activity.some(e=>e.type==='interrupted'));
    const notices=(await call(`/api/bots/${bot.id}/messages`,token))[1];assert.ok(notices.some(m=>m.content.includes('Task retry-attempt interrupted: Instance restarted during execution')));
    await call('/api/commands',token,{id:'after-restart',botId:bot.id,content:'What happened?'});await wait('/api/commands/after-restart',token,c=>c.state==='completed');
    assert.match(chatRequests.at(-1).at(-1).content,/Task retry-attempt interrupted: Instance restarted during execution/);
  } finally {waiting?.();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('replacement waits for settlement, preserves late text, and chat sees actual task notices', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-task-replace-')),path=join(dir,'db');let release,entered,oldSignal,steps=[];const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const chats=[];
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,_tools,{signal}){
   if(profile.chatId==='old-task'){oldSignal=signal;entered();await gate;return {role:'assistant',content:'Observed late text',tool_calls:[{id:'must-not-run',type:'function',function:{name:'clock',arguments:'{}'}}],usage:{scope:'request',status:'reported',source:'fixture',metrics:{input:5}}};}
   if(profile.chatId==='new-task'){steps.push('replacement');return {role:'assistant',content:'replacement result'};}
   chats.push(structuredClone(messages));return {role:'assistant',content:'chat answer'};
 }});
 const app=startInstance(path,0,{providerFactory:factory});const port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 const wait=async(route,token,predicate)=>{for(let i=0;i<200;i++){const v=(await call(route,token))[1];if(predicate(v))return v;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];
  await call('/api/commands',token,{id:'before',botId:bot.id,content:'first chat'});await wait('/api/commands/before',token,c=>c.state==='completed');
  await call('/api/tasks',token,{id:'old-task',botId:bot.id,objective:'Original objective'});await started;
  await call('/api/commands',token,{id:'unrelated',botId:bot.id,content:'Please tell me something else'});await wait('/api/commands/unrelated',token,c=>c.state==='completed');
  assert.equal((await call('/api/tasks/old-task',token))[1].state,'running');assert.equal(oldSignal.aborted,false);
  const replacement=(await call('/api/tasks/old-task/replace',token,{id:'new-task',objective:'Changed objective'}))[1];assert.equal(replacement.attempt.state,'waiting');assert.equal(oldSignal.aborted,true);assert.deepEqual(steps,[]);
  assert.equal((await call('/api/tasks/old-task/replace',token,{id:'new-task',objective:'Changed objective'}))[1].kind,'existing');
  assert.equal((await call('/api/tasks',token,{id:'competitor',botId:bot.id,objective:'Other'}))[1].kind,'busy');
  release();const old=await wait('/api/tasks/old-task',token,t=>t.state==='stopped');assert.ok(old.activity.some(e=>e.type==='assistant_observed' && e.text==='Observed late text'));assert.ok(!old.activity.some(e=>e.type==='tool_start'));assert.equal(old.usage[0].metrics.input,5);
  const next=await wait('/api/tasks/new-task',token,t=>t.state==='completed');assert.equal(next.predecessor,'old-task');assert.notEqual(next.taskId,old.taskId);assert.deepEqual(steps,['replacement']);
  await call('/api/commands',token,{id:'after',botId:bot.id,content:'What happened?'});await wait('/api/commands/after',token,c=>c.state==='completed');
  assert.match(chats.at(-1).at(-1).content,/replacement result/);assert.match(chats.at(-1).at(-1).content,/What happened\?/);
 } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('completed task data and terminal state commit together', async () => {
 const {Instance}=await import('../dist/instance.js');const dir=mkdtempSync(join(tmpdir(),'staf-task-atomic-')),path=join(dir,'db');let store=new Instance(path);
 try {const bot=store.createBot({name:'A',instructions:'',provider:'demo'});store.acceptTask({id:'atomic',botId:bot.id,objective:'test',limitMs:300000});store.taskStart('atomic');
  const session={version:1,id:'atomic',provider:'demo',messages:[{role:'user',content:'test'},{role:'assistant',content:'real answer'}],events:[],usage:[]};
  store.db.exec("CREATE TRIGGER reject_completion BEFORE UPDATE OF state ON task_attempts WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(()=>store.taskComplete('atomic',session),/injected failure/);assert.equal(store.taskAttempt('atomic').state,'running');assert.ok(!store.taskAttempt('atomic').activity.some(e=>e.type==='assistant'));
  store.db.exec('DROP TRIGGER reject_completion');store.taskComplete('atomic',session);store.close();store=new Instance(path);
  const result=store.taskAttempt('atomic');assert.equal(result.state,'completed');assert.equal(result.outcome,'real answer');assert.ok(result.activity.some(e=>e.type==='assistant' && e.text==='real answer'));
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI lists and follows the same completed task as the service', async () => {
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util'),run=promisify(execFile);const dir=mkdtempSync(join(tmpdir(),'staf-task-cli-')),app=startInstance(join(dir,'db'));const port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
 const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try {await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'A','--provider','demo'));const submitted=await cli('task-start',url,credential,bot.id,'Look at the task');const id=submitted.match(/Task attempt ID: ([\w-]+)/)?.[1];assert.ok(id);
  const followed=JSON.parse(await cli('task-follow',url,credential,id));assert.equal(followed.state,'completed');const listed=JSON.parse(await cli('tasks',url,credential,bot.id));assert.equal(listed[0].id,id);assert.equal(JSON.parse(await cli('task',url,credential,id)).outcome,followed.outcome);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('explicit directions reach a held task in order, and an explicit clarification answer resumes it', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-input-')),path=join(dir,'db');let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),requests=[];
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,tools){
  requests.push(structuredClone(messages));if(requests.length===1){entered();await gate;return {role:'assistant',content:'first result'};}
  if(requests.length===2){assert.ok(tools.some(t=>t.function.name==='ask_owner'));return {role:'assistant',content:null,tool_calls:[{id:'question-call',type:'function',function:{name:'ask_owner',arguments:JSON.stringify({question:'Which file?'})}}]};}
  return {role:'assistant',content:'finished'};
 }});
 const app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();let closed=false;
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 let token='';const wait=async(predicate)=>{for(let i=0;i<300;i++){const v=(await call('/api/tasks/task'))[1];if(predicate(v))return v;await new Promise(r=>setTimeout(r,5));}throw Error('timed out');};
 try {token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{provider:'demo',name:'A'}))[1];await call('/api/tasks',{id:'task',botId:bot.id,objective:'Inspect'});await started;
  const one={id:'one',kind:'direction',text:'First'},two={id:'two',kind:'direction',text:'Second'};
  const accepted=(await call('/api/tasks/task/input',one))[1];assert.equal(accepted.kind,'accepted');assert.ok(!('digest' in accepted.input));
  const existing=(await call('/api/tasks/task/input',one))[1];assert.equal(existing.kind,'existing');assert.ok(!('digest' in existing.input));
  assert.equal((await call('/api/tasks/task/input',{...one,text:'Different'}))[0],400);
  assert.equal((await call('/api/tasks/task/input',two))[1].kind,'accepted');
  const detail=(await call('/api/tasks/task'))[1];assert.ok(detail.inbox.inputs.every(input=>!('digest' in input)));release();
  const asking=await wait(t=>t.inbox.questions.some(q=>q.state==='open'));const question=asking.inbox.questions[0];assert.equal(asking.waitReason,'owner-input');assert.match(requests[1].at(-1).content,/First[\s\S]*Second/);
  assert.equal((await call('/api/tasks/task/input',{id:'answer',kind:'answer',questionId:question.id,text:'report.txt'}))[1].kind,'accepted');
  const done=await wait(t=>t.state==='completed');assert.equal(done.outcome,'finished');assert.match(requests[2].at(-1).content,/report.txt/);assert.deepEqual(done.inbox.inputs.map(i=>i.status),['applied','applied','applied']);
  assert.equal((await call('/api/tasks/task/input',{id:'late',kind:'direction',text:'too late'}))[0],400);
  await app.close();closed=true;const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);const session=JSON.parse(db.prepare('SELECT session FROM task_attempts WHERE id=?').get('task').session);db.close();
  const {validSession}=await import('../dist/validation.js');assert.ok(validSession(session,'task'));
  const {responsesInput}=await import('../dist/codex-direct.js');const codex=responsesInput(requests[2],'fixture');assert.equal(codex.at(-2).type,'function_call_output');assert.match(codex.at(-1).content[0].text,/report.txt/);
  const {openRouterProvider}=await import('../dist/providers.js');let outbound;const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'fixture',async (_url,init)=>{outbound=JSON.parse(init.body);return Response.json({choices:[{message:{role:'assistant',content:'ok'}}]});});await provider.complete(requests[2],[]);assert.equal(outbound.messages.at(-2).role,'tool');assert.match(outbound.messages.at(-1).content,/report.txt/);
 }finally{release();if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});


test('stopped and interrupted attempts cancel unapplied input atomically', async () => {
 const {Instance}=await import('../dist/instance.js');const dir=mkdtempSync(join(tmpdir(),'staf-unapplied-')),path=join(dir,'db');let store=new Instance(path);
 try {const bot=store.createBot({name:'A',instructions:'',provider:'demo'});
  store.acceptTask({id:'stopped',botId:bot.id,objective:'One',limitMs:300000});store.taskStart('stopped');
  store.taskInput({attemptId:'stopped',commandId:'input-one',kind:'direction',text:'first'},'first');
  store.taskStop('stopped','Stop');store.taskFinish('stopped','stopped','Stopped');
  const stopped=store.taskAttempt('stopped');assert.equal(stopped.inbox.inputs[0].status,'cancelled');assert.equal(stopped.inbox.inputs[0].text,'first');assert.ok(stopped.activity.some(e=>e.type==='input_cancelled'));
  store.acceptTask({id:'interrupted',botId:bot.id,objective:'Two',limitMs:300000});store.taskStart('interrupted');
  store.taskInput({attemptId:'interrupted',commandId:'input-two',kind:'direction',text:'second'},'second');store.close();store=new Instance(path);
  const interrupted=store.taskAttempt('interrupted');assert.equal(interrupted.state,'interrupted');assert.equal(interrupted.inbox.inputs[0].status,'cancelled');assert.equal(interrupted.inbox.inputs[0].text,'second');assert.ok(interrupted.activity.some(e=>e.type==='input_cancelled'));
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});


test('direction accepted during provider setup merges with objective before the first call', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-setup-input-')),path=join(dir,'db');let release,entered,seen;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const factory=async()=>{entered();await gate;return {name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages){seen=structuredClone(messages);return {role:'assistant',content:'done'};}};};
 const app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();let token='',closed=false;
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return await r.json();};
 try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{provider:'demo',name:'A'});await call('/api/tasks',{id:'setup',botId:bot.id,objective:'Inspect'});await started;await call('/api/tasks/setup/input',{id:'input',kind:'direction',text:'focus here'});release();
  for(let i=0;i<200;i++){if((await call('/api/tasks/setup')).state==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(seen.length,1);assert.match(seen[0].content,/Inspect[\s\S]*focus here/);await app.close();closed=true;
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);const session=JSON.parse(db.prepare('SELECT session FROM task_attempts WHERE id=?').get('setup').session);db.close();const {validSession}=await import('../dist/validation.js');assert.ok(validSession(session,'setup'));
 }finally{release();if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});
