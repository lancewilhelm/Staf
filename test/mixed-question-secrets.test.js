import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';

const wait=async fn=>{for(let i=0;i<400;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');};

test('mixed question sets protect saved and selected secrets in every tool mode',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-mixed-questions-')),path=join(dir,'instance.sqlite'),seen=[];
 const secret='synthetic-protected-642881',existing='synthetic-existing-271334';let app,port,token;
 const options={dataDir:dir,env:{},providerFactory:async profile=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages,_tools,opts){seen.push(JSON.stringify(messages));const turn=messages.slice(messages.findLastIndex(m=>m.role==='user')+1);if(opts.currentUserInput==='Ask for setup' && !turn.some(m=>m.role==='tool')){const input={questions:[{kind:'text',prompt:'Account?'},{kind:'secret',prompt:'Client secret?',name:'Client '+profile.toolMode,purpose:'Test protected entry'},{kind:'single',prompt:'Continue?',choices:['Yes','No']}]};const guest=profile.toolMode==='code';return {role:'assistant',content:null,tool_calls:[{id:'q',type:'function',function:guest?{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.ask_questions(${JSON.stringify(input)});`})}:{name:'ask_questions',arguments:JSON.stringify(input)}}]};}return {role:'assistant',content:'Ready'};}})};
 const call=async(route,body,auth=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${auth}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 try {app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code},'')).value.token;await call('/api/secrets/add',{name:'Existing',purpose:'Reusable test secret',value:existing});
  for(const mode of ['direct','hybrid','code']){
   const bot=(await call('/api/bots',{name:mode,provider:'live',model:'fixture-offline',toolMode:mode})).value,id='ask-'+mode;
   await call('/api/commands',{id,botId:bot.id,content:'Ask for setup'});await wait(async()=>(await call('/api/commands/'+id)).value.state==='completed');
   const q=(await call('/api/question-sets')).value.find(item=>item.workId===id);assert.ok(q);
   assert.equal((await call(`/api/question-sets/${q.id}/draft`,{answers:[null,{choices:[],writeIn:secret},null]})).status,400);
   assert.equal((await call(`/api/question-sets/${q.id}/draft`,{answers:[{choices:[],writeIn:'owner@example.test'},null,null]})).status,200);
   if(mode==='hybrid'){const selected=(await call('/api/secrets')).value.find(item=>item.name==='Existing');assert.equal((await call(`/api/question-sets/${q.id}/secret/1/select`,{name:selected.name,revision:selected.revision})).status,200);}
   else assert.equal((await call(`/api/question-sets/${q.id}/secret/1/save`,{value:secret+'-'+mode})).status,200);
   assert.equal((await call(`/api/question-sets/${q.id}/secret/1/save`,{value:'duplicate'})).status,400);
   if(mode==='direct'){await app.close();app=startInstance(path,0,options);port=await app.listen();}
   assert.equal((await call('/api/question-sets')).value.find(item=>item.id===q.id).secretStatuses[1],'saved');
   assert.equal((await call(`/api/question-sets/${q.id}/submit`,{})).status,200);
   const done=await wait(async()=>{const item=(await call('/api/question-sets')).value.find(row=>row.id===q.id);return item.continuationState==='completed'&&item;});
   assert.equal(done.result.answers[1].status,'saved');assert.equal(done.result.answers[2].status,'skipped');
  }
  assert.ok(seen.some(value=>value.includes('saved') && value.includes('Owner response to question set')));for(const value of [secret,existing]){assert.ok(!JSON.stringify(seen).includes(value));assert.ok(!readFileSync(path).includes(Buffer.from(value)));}
 } finally {if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('secret steps survive dismissal and reject revoked clients and stale selections',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-mixed-authority-')),path=join(dir,'instance.sqlite');let app,port,token;
 const questions=[{kind:'secret',prompt:'Credential?',name:'Fixture secret',purpose:'Test selection'}];
 const options={dataDir:dir,env:{},providerFactory:async()=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages,_tools,opts){const turn=messages.slice(messages.findLastIndex(m=>m.role==='user')+1);if(opts.currentUserInput==='Ask'&&!turn.some(m=>m.role==='tool'))return {role:'assistant',content:null,tool_calls:[{id:'q',type:'function',function:{name:'ask_questions',arguments:JSON.stringify({questions})}}]};return {role:'assistant',content:'Ready'};}})};
 const call=async(route,body,auth=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(auth?{Authorization:`Bearer ${auth}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 try {app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code},'')).value.token;const other=(await call('/api/pair',{code:app.issueCode()},'')).value.token;
  await call('/api/secrets/add',{name:'Existing',purpose:'Reuse',value:'first-synthetic-value'});const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture',toolMode:'direct'})).value;await call('/api/commands',{id:'request',botId:bot.id,content:'Ask'});await wait(async()=>(await call('/api/commands/request')).value.state==='completed');const q=(await call('/api/question-sets')).value[0];
  const client=(await call('/api/clients',undefined,other)).value.find(item=>!item.current);await call(`/api/clients/${client.id}/revoke`,{},other);assert.equal((await call(`/api/question-sets/${q.id}/secret/0/save`,{value:'unauthorized'})).status,401);token=other;
  const prior=(await call('/api/secrets')).value.find(item=>item.name==='Existing');await call('/api/secrets/replace',{name:prior.name,revision:prior.revision,value:'second-synthetic-value',confirm:true});assert.equal((await call(`/api/question-sets/${q.id}/secret/0/select`,{name:prior.name,revision:prior.revision})).status,400);
  const current=(await call('/api/secrets')).value.find(item=>item.name==='Existing');assert.equal((await call(`/api/question-sets/${q.id}/secret/0/select`,{name:current.name,revision:current.revision})).status,200);
  await call('/api/secrets/delete',{name:current.name,revision:current.revision,confirm:true});assert.equal((await call('/api/question-sets')).value[0].secretStatuses[0],'unavailable');assert.equal((await call(`/api/question-sets/${q.id}/secret/0/save`,{value:'independent-synthetic-value'})).status,200);
  await call(`/api/question-sets/${q.id}/dismiss`,{});assert.ok((await call('/api/secrets')).value.some(item=>item.name==='Fixture secret'));
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('background mixed questions pause work and return only secret status in every mode',async()=>{
 const seen=[];const questions=[{kind:'text',prompt:'Account?'},{kind:'secret',prompt:'Credential?',name:'Background secret',purpose:'Protected input'}];
 const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));if(!messages.some(m=>m.role==='tool')){const input={questions},guest=profile.toolMode==='code';return {role:'assistant',content:null,tool_calls:[{id:'q',type:'function',function:guest?{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.ask_questions(${JSON.stringify(input)});`})}:{name:'ask_questions',arguments:JSON.stringify(input)}}]};}return {role:'assistant',content:'Done'};}})});let token;
 try{const port=await app.listen();const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};token=(await call('/api/pair',{code:app.code})).token;
  for(const mode of ['direct','hybrid','code']){const id='background-'+mode,bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture',toolMode:mode});await call('/api/tasks',{id,botId:bot.id,objective:'Ask'});const q=await wait(async()=>(await call('/api/question-sets')).find(item=>item.workId===id));if(mode==='direct')await call(`/api/question-sets/${q.id}/secret/1/save`,{value:'background-synthetic-value'});await call(`/api/question-sets/${q.id}/submit`,{});await wait(async()=>(await call('/api/tasks/'+id)).state==='completed');}
  assert.ok(seen.some(value=>value.includes('saved')));assert.ok(seen.some(value=>value.includes('skipped')));assert.ok(!JSON.stringify(seen).includes('background-synthetic-value'));
 }finally{await app.close();}
});

test('interrupted background mixed request cannot accept a protected value after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-mixed-interrupted-')),path=join(dir,'instance.sqlite');let app,port,token;let requests=0;
 const options={dataDir:dir,env:{},providerFactory:async()=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages){if(!messages.some(m=>m.role==='tool')){requests++;return {role:'assistant',content:null,tool_calls:[{id:'q',type:'function',function:{name:'ask_questions',arguments:JSON.stringify({questions:[{kind:'text',prompt:'Account?'},{kind:'secret',prompt:'Secret?',name:'Restart secret',purpose:'Test interruption'}]})}}]};}return {role:'assistant',content:'Done'};}})};
 const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 try{app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code})).value.token;const bot=(await call('/api/bots',{name:'Restart',provider:'live',model:'fixture',toolMode:'direct'})).value;await call('/api/tasks',{id:'restart-task',botId:bot.id,objective:'Ask'});const q=await wait(async()=>(await call('/api/question-sets')).value.find(item=>item.workId==='restart-task'));await call(`/api/question-sets/${q.id}/draft`,{answers:[{choices:[],writeIn:'owner@example.test'},null]});await app.close();app=startInstance(path,0,options);port=await app.listen();const restored=(await call('/api/question-sets')).value.find(item=>item.id===q.id);assert.equal(restored.originState,'interrupted');assert.equal(restored.draft[0].writeIn,'owner@example.test');assert.equal((await call(`/api/question-sets/${q.id}/secret/1/save`,{value:'never-saved'})).status,400);assert.equal((await call(`/api/question-sets/${q.id}/submit`,{})).value.result.answers[1].status,'skipped');assert.equal((await call('/api/tasks/restart-task')).value.state,'interrupted');assert.equal(requests,1);}
 finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
