import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startInstance} from './fixtures/controlled-instance.mjs';
import {SecretRequests} from '../dist/secret-requests.js';

test('paired owner saves a requested secret without exposing its value to the model or ordinary records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-request-')),seen=[];
 const secret='synthetic-example-credential-48152';
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));return messages.at(-1).role==='tool'?{role:'assistant',content:'Request completed'}:{role:'assistant',content:null,tool_calls:[{id:'secret',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Example service',purpose:'Connect an example',destination:'example.test'})}}]};}})});
 try {
  const port=await app.listen();let token;
  const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  token=(await call('/api/pair',{code:app.code})).token;
  const bot=await call('/api/bots',{name:'Requester',provider:'live',model:'fixture-offline',toolMode:'direct'});
  await call('/api/commands',{id:'secret-request',botId:bot.id,content:'Request the example credential'});
  let request;for(let i=0;i<500;i++){request=(await call('/api/inbox')).find(item=>item.kind==='secret');if(request)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.ok(request,'request appears in paired inbox');assert.equal(request.name,'Example service');assert.equal(request.botId,bot.id);
  assert.deepEqual(await call(`/api/secret-requests/${request.id}/save`,{value:secret}),{status:'saved'});
  let command;for(let i=0;i<500;i++){command=await call('/api/commands/secret-request');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(command.state,'completed');assert.ok(seen.some(item=>item.includes('saved')));assert.ok(!JSON.stringify(seen).includes(secret));assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(join(dir,'instance.sqlite')).includes(Buffer.from(secret)));
  assert.ok(readFileSync(join(dir,'secrets','credentials.sqlite')).includes(Buffer.from(secret)));const names=await call('/api/secrets');assert.deepEqual(names,[{name:'Example service',purpose:'Connect an example',destination:'example.test'}]);assert.ok(!JSON.stringify(names).includes(secret));assert.deepEqual(await call('/api/secrets/delete',{name:'Example service',confirm:true}),{deleted:true});assert.deepEqual(await call('/api/secrets'),[]);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('unverified host execution and file tools fail closed in every tool mode',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-closed-')),marker=join(dir,'marker');
 let mode='direct',callIndex=0;const transcripts=[];
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:process.platform==='linux'?{}:{STAF_LINUX_HOST_EXECUTION:'1'},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){transcripts.push(JSON.stringify(messages));if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const name=callIndex++%2?'file_write':'terminal_run',input=name==='file_write'?{path:marker,content:'should not exist'}:{command:`touch '${marker}'`};return {role:'assistant',content:null,tool_calls:[{id:'attempt',type:'function',function:mode==='direct'?{name,arguments:JSON.stringify(input)}:{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.${name}(${JSON.stringify(input)});`})}}]};}})});
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};
  token=(await call('/api/pair',{code:app.code})).token;
  for(mode of ['direct','hybrid','code']) {const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture-offline',toolMode:mode});for(let n=0;n<2;n++){const id=`${mode}-${n}`;await call('/api/commands',{id,botId:bot.id,content:'Attempt the operation'});let done;for(let i=0;i<500;i++){done=await call('/api/commands/'+id);if(done.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(done.state,'completed');assert.equal(existsSync(marker),false);}
   for(let n=0;n<2;n++){const id=`task-${mode}-${n}`;await call('/api/tasks',{id,botId:bot.id,objective:'Attempt the operation'});let task;for(let i=0;i<500;i++){task=await call('/api/tasks/'+id);if(!['queued','running'].includes(task.state))break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(task.state,'completed');assert.equal(existsSync(marker),false);}}
  assert.ok(transcripts.some(text=>text.includes('credential isolation is not established')));
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('requests in all tool modes return only skipped or dismissed status',async()=>{
 let mode='direct';const transcripts=[];
 const app=startInstance(':memory:',0,{providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){transcripts.push(JSON.stringify(messages));if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const input={name:`${mode} secret`,purpose:'Test request'};return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:mode==='direct'?{name:'request_secret',arguments:JSON.stringify(input)}:{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.request_secret(${JSON.stringify(input)});`})}}]};}})});
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};token=(await call('/api/pair',{code:app.code})).token;
  for(mode of ['direct','hybrid','code']) {const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture-offline',toolMode:mode});const id=`request-${mode}`;await call('/api/commands',{id,botId:bot.id,content:'Ask for a secret'});let request;for(let i=0;i<500;i++){request=(await call('/api/inbox')).find(item=>item.kind==='secret'&&item.botId===bot.id);if(request)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(request);const decision=mode==='code'?'dismiss':'skip';assert.equal((await call(`/api/secret-requests/${request.id}/${decision}`,{})).status,decision==='skip'?'skipped':'dismissed');let done;for(let i=0;i<500;i++){done=await call('/api/commands/'+id);if(done.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(done.state,'completed');}
  assert.ok(transcripts.some(text=>text.includes('skipped')));assert.ok(transcripts.some(text=>text.includes('dismissed')));
 } finally {await app.close();}
});

test('revoked clients cannot save and interrupted requests survive restart without replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-restart-')),path=join(dir,'instance.sqlite');let app,token,port;
 const options={dataDir:dir,providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Restart secret',purpose:'Test recovery'})}}]};}})};
 const call=async(route,body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 try {app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code},'')).value.token;const other=(await call('/api/pair',{code:app.issueCode()},'')).value.token;const bot=(await call('/api/bots',{name:'Recovery',provider:'live',model:'fixture-offline',toolMode:'direct'})).value;await call('/api/commands',{id:'restart-request',botId:bot.id,content:'Ask for secret'});let request;for(let i=0;i<500;i++){request=(await call('/api/inbox')).value.find(item=>item.kind==='secret');if(request)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(request);
  const clients=(await call('/api/clients',undefined,other)).value;const revoked=clients.find(client=>!client.current);assert.ok(revoked);assert.equal((await call(`/api/clients/${revoked.id}/revoke`,{},other)).status,200);assert.equal((await call(`/api/secret-requests/${request.id}/save`,{value:'synthetic-only'},token)).status,401);token=other;
  await app.close();app=startInstance(path,0,options);port=await app.listen();const restored=(await call('/api/inbox')).value.find(item=>item.id===request.id);assert.equal(restored.state,'interrupted');assert.equal((await call(`/api/secret-requests/${request.id}/save`,{value:'synthetic-only'})).status,400);assert.equal((await call(`/api/secret-requests/${request.id}/dismiss`,{})).value.status,'dismissed');
 } finally {if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('background request pauses its execution limit and completes after paired input',async()=>{
 const app=startInstance(':memory:',0,{providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'task-secret',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Task secret',purpose:'Test background request'})}}]};}})});
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Task agent',provider:'live',model:'fixture-offline',toolMode:'direct'});await call('/api/tasks',{id:'background-secret',botId:bot.id,objective:'Request secret',limitMs:1000});let request;for(let i=0;i<500;i++){request=(await call('/api/inbox')).find(item=>item.kind==='secret');if(request)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(request.work.kind,'task');await new Promise(resolve=>setTimeout(resolve,1300));assert.equal((await call('/api/tasks/background-secret')).state,'running');await call(`/api/secret-requests/${request.id}/skip`,{});let task;for(let i=0;i<500;i++){task=await call('/api/tasks/background-secret');if(task.state!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(task.state,'completed');
 } finally {await app.close();}
});

test('a malformed secret request cannot put an extra value in ordinary records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-malformed-')),secret='synthetic-malformed-secret-9831';
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){return {role:'assistant',content:null,tool_calls:[{id:'bad',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Name',purpose:'Purpose',value:secret})}}]};}})});
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Bad request',provider:'live',model:'fixture-offline',toolMode:'direct'});await call('/api/commands',{id:'bad-secret-request',botId:bot.id,content:'Request'});let command;for(let i=0;i<500;i++){command=await call('/api/commands/bad-secret-request');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(join(dir,'instance.sqlite')).includes(Buffer.from(secret)));assert.equal((await call('/api/inbox')).filter(item=>item.kind==='secret').length,0);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('named secret storage survives reopening and does not expose values in metadata',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-store-')),secret='synthetic-store-value-6193';let store;
 try {store=new SecretRequests(dir,false);store.create('request','agent',{kind:'command',id:'work'},{name:'Persistent',purpose:'Future use'});store.decide('request','saved',secret);store.close();store=new SecretRequests(dir,false);assert.deepEqual(store.values(),[secret]);assert.ok(!JSON.stringify(store.names()).includes(secret));assert.equal(store.delete('Persistent'),true);assert.deepEqual(store.values(),[]);}
 finally {store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('malformed guest secret arguments are not copied into activity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-guest-')),secret='synthetic-guest-private-764';
 const source=`const value=['synthetic','guest','private','764'].join('-'); return await capabilities.request_secret({name:'Name',purpose:'Purpose',value});`;
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'guest',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source})}}]};}})});
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Guest',provider:'live',model:'fixture-offline',toolMode:'code'});await call('/api/commands',{id:'bad-guest-secret',botId:bot.id,content:'Request'});let command;for(let i=0;i<500;i++){command=await call('/api/commands/bad-guest-secret');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(join(dir,'instance.sqlite')).includes(Buffer.from(secret)));assert.equal((await call('/api/inbox')).filter(item=>item.kind==='secret').length,0);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a question answer queued during a secret request continues once after it resolves',async()=>{
 const messagesSeen=[];
 const app=startInstance(':memory:',0,{providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,_offers,opts){messagesSeen.push(opts.currentUserInput);const current=messages.slice(messages.findLastIndex(message=>message.role==='user')+1);if(opts.currentUserInput==='Ask both'&&!current.some(message=>message.role==='tool'))return {role:'assistant',content:null,tool_calls:[{id:'questions',type:'function',function:{name:'ask_questions',arguments:JSON.stringify({questions:[{kind:'text',prompt:'Which account?'}]})}},{id:'secret',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Combined',purpose:'Set up account'})}}]};return {role:'assistant',content:'Done'};}})});
 const until=async fn=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
 try {const port=await app.listen();let token;const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Both',provider:'live',model:'fixture-offline',toolMode:'direct'});await call('/api/commands',{id:'both',botId:bot.id,content:'Ask both'});const q=await until(async()=>(await call('/api/question-sets'))[0]);const secret=await until(async()=>(await call('/api/inbox')).find(item=>item.kind==='secret'));await call(`/api/question-sets/${q.id}/draft`,{answers:[{choices:[],writeIn:'example account'}]});await call(`/api/question-sets/${q.id}/submit`,{});assert.equal((await call('/api/question-sets'))[0].continuationState,null);await call(`/api/secret-requests/${secret.id}/skip`,{});await until(async()=>(await call('/api/question-sets'))[0].continuationState==='completed');assert.equal(messagesSeen.filter(value=>value?.includes('example account')).length,1);
 } finally {await app.close();}
});

test('schema 53 upgrade keeps named secrets while adding task questions and Slack reviews',async()=>{
 const {Instance,INSTANCE_SCHEMA_VERSION}=await import('../dist/instance.js');
 const {DatabaseSync}=await import('node:sqlite');
 const dir=mkdtempSync(join(tmpdir(),'staf-secret-schema-')),path=join(dir,'instance.sqlite');
 const value='synthetic-upgrade-secret-7301';let instance,store;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',provider:'live',model:'fixture',instructions:''});instance.close();instance=undefined;
  store=new SecretRequests(dir,false);
  store.create('saved-request',bot.id,{kind:'command',id:'old-work'},{name:'Example',purpose:'Test upgrade'});
  store.decide('saved-request','saved',value);
  store.create('pending-request',bot.id,{kind:'task',id:'old-task'},{name:'Pending',purpose:'Test interruption'});
  store.close();store=undefined;
  let db=new DatabaseSync(path);db.exec('DROP TABLE task_question_sets; DROP TABLE slack_outcome_reviews; PRAGMA user_version=53');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.bot(bot.id).name,'Existing');instance.close();instance=undefined;
  db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);
  for(const table of ['question_sets','task_question_sets','slack_outcome_reviews','gmail_reply_proposals','inbox_assessment_history'])assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),table);
  db.close();assert.equal(readFileSync(path).includes(Buffer.from(value)),false);
  store=new SecretRequests(dir,false);assert.deepEqual(store.values(),[value]);assert.equal(store.names()[0].name,'Example');
  assert.equal(store.list().find(request=>request.id==='pending-request').state,'interrupted');
 } finally {store?.close();instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('a background question followed by a secret request stays private and resumes once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-task-question-secret-')),path=join(dir,'instance.sqlite');
 const value='synthetic-task-credential-9271',seen=[];
 const app=startInstance(path,0,{dataDir:dir,providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  seen.push(JSON.stringify(messages));const count=messages.filter(message=>message.role==='tool').length;
  if(count===0)return {role:'assistant',content:null,tool_calls:[{id:'question',type:'function',function:{name:'ask_questions',arguments:JSON.stringify({questions:[{kind:'text',prompt:'Which account?'}]})}}]};
  if(count===1)return {role:'assistant',content:null,tool_calls:[{id:'secret',type:'function',function:{name:'request_secret',arguments:JSON.stringify({name:'Task fixture',purpose:'Continue setup'})}}]};
  return {role:'assistant',content:'Finished'};
 }})});
 const until=async fn=>{for(let i=0;i<500;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
 try {
  const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;};
  token=(await call('/api/pair',{code:app.code})).token;
  const bot=await call('/api/bots',{name:'Task fixture',provider:'live',model:'fixture-offline',toolMode:'direct'});
  await call('/api/tasks',{id:'combined-task',botId:bot.id,objective:'Ask and request'});
  const question=await until(async()=>(await call('/api/question-sets')).find(item=>item.workKind==='task' && item.workId==='combined-task'));
  await call(`/api/question-sets/${question.id}/draft`,{answers:[{choices:[],writeIn:'example account'}]});await call(`/api/question-sets/${question.id}/submit`,{});
  const request=await until(async()=>(await call('/api/inbox')).find(item=>item.kind==='secret' && item.work.id==='combined-task'));
  await call(`/api/secret-requests/${request.id}/save`,{value});
  const task=await until(async()=>{const item=await call('/api/tasks/combined-task');return item.state==='completed' && item;});
  assert.equal(task.workActions.filter(item=>item.state==='succeeded').length,2);
  assert.ok(seen.some(message=>message.includes('example account')));
  assert.ok(seen.every(message=>!message.includes(value)));
  assert.ok(!JSON.stringify(task).includes(value));assert.equal(readFileSync(path).includes(Buffer.from(value)),false);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
