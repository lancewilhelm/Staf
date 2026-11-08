import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';

test('tool availability persists independently of permissions and configuration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-tools-'));const path=join(dir,'db');let app=startInstance(path,0,{env:{}}),port=await app.listen();
 const call=async(route,body,token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try{
  assert.equal((await call('/api/tool-defaults'))[0],401);
  const token=(await call('/api/pair',{code:app.code}))[1].token;
  const defaults=(await call('/api/tool-defaults',undefined,token))[1];
  assert.deepEqual(defaults,{revision:1,clock:true,memory:true,web:true,files:true});
  const permissions=(await call('/api/approval-settings/instance',undefined,token))[1];
  const search=(await call('/api/search-config',undefined,token))[1];
  assert.equal(search.origin,null);
  const disabled={...defaults,clock:false,memory:false,web:false,files:false};
  assert.equal((await call('/api/tool-defaults',disabled,token))[0],200);
  assert.equal((await call('/api/tool-defaults',defaults,token))[0],409);
  assert.deepEqual((await call('/api/approval-settings/instance',undefined,token))[1],permissions);
  assert.deepEqual((await call('/api/search-config',undefined,token))[1],search);
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  const retained=(await call('/api/tool-defaults',undefined,token))[1];assert.deepEqual(retained,{...disabled,revision:2});
  const enabled=(await call('/api/tool-defaults',{...retained,clock:true,memory:true,web:true,files:true},token))[1];assert.equal(enabled.revision,3);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('availability gates all tool modes while preserving terminal and independent permissions',async()=>{
 const offersByTurn=new Map();
 const factory=async profile=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages,offers,options){
  const turn=options.currentUserInput;
  if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'done'};
  offersByTurn.set(turn,structuredClone(offers));
  const target=turn.includes('file')?'file_read':turn.includes('memory')?'memory_search':'clock';
  const input=target==='file_read'?{path:'missing.txt'}:target==='memory_search'?{scope:{kind:'agent'},query:''}:{};
  return {role:'assistant',content:null,tool_calls:[profile.toolMode==='code'?{id:'call',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.${target}(${JSON.stringify(input)});`})}}:{id:'call',type:'function',function:{name:target,arguments:JSON.stringify(input)}}]};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory}),port=await app.listen();
 const call=async(route,body,token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();assert.ok(r.ok,`${route} ${r.status} ${JSON.stringify(v)}`);return v;};
 const until=async(fn)=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 try{
  const token=(await call('/api/pair',{code:app.code})).token;
  const defaults=await call('/api/tool-defaults',undefined,token);
  const search=await call('/api/search-config',undefined,token);
  await call('/api/search-config',{revision:search.revision,origin:'http://127.0.0.1:9999'},token);
  await call('/api/search-permissions/instance',{enabled:true},token);await call('/api/web-permissions/instance',{enabled:true},token);
  for(const mode of ['direct','hybrid','code']){
   const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode},token);
   await call('/api/search-permissions/bot:'+bot.id,{enabled:true},token);await call('/api/web-permissions/bot:'+bot.id,{enabled:true},token);
   async function turn(label){const id=mode+'-'+label;await call('/api/commands',{id,botId:bot.id,content:id},token);return until(async()=>{const value=await call('/api/commands/'+id,undefined,token);return value.state!=='pending'&&value;});}
   let setting=await call('/api/tool-defaults',undefined,token);
   await call('/api/tool-defaults',{...setting,clock:false,memory:false,files:false,web:false},token);
   for(const label of ['clock-off','memory-off','file-off'])assert.equal((await turn(label)).workActions.length,0);
   const disabled=JSON.stringify(offersByTurn.get(mode+'-clock-off'));
   for(const name of ['"clock"','memory_search','file_read','read_web','search_web'])assert.ok(!disabled.includes(name),`${mode} still offers ${name}`);
   assert.match(disabled,/terminal_run/);
   setting=await call('/api/tool-defaults',undefined,token);await call('/api/tool-defaults',{...setting,...defaults,revision:setting.revision},token);
   const clock=await turn('clock-on');assert.equal(clock.workActions.length,1);assert.equal(clock.workActions[0].state,'succeeded');
   const enabled=JSON.stringify(offersByTurn.get(mode+'-clock-on'));
   for(const name of ['clock','memory_search','file_read','read_web','search_web','terminal_run'])assert.ok(enabled.includes(name),`${mode} missing ${name}`);
   await call('/api/approval-settings/instance',{mode:'never-ask',clockEnabled:false},token);
   assert.equal((await turn('clock-permission-off')).workActions.length,0);
   await call('/api/approval-settings/instance',{mode:'ask-for-risky-actions',clockEnabled:true},token);
  }
 }finally{await app.close();}
});

test('disabling clock while approval is pending prevents the effect after approval',async()=>{
 const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1)?.role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'clock',type:'function',function:{name:'clock',arguments:'{}'}}]};}})}),port=await app.listen();
 const call=async(route,body,token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return r.json();};
 const until=async(fn)=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 try{const token=(await call('/api/pair',{code:app.code})).token,bot=await call('/api/bots',{name:'Clock',provider:'live',model:'fixture-offline'},token);
  await call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true},token);
  await call('/api/commands',{id:'pending-clock',botId:bot.id,content:'time'},token);
  const pending=await until(async()=>(await call('/api/approvals',undefined,token)).find(x=>x.state==='pending'));
  const settings=await call('/api/tool-defaults',undefined,token);await call('/api/tool-defaults',{...settings,clock:false},token);
  await call('/api/approvals/'+pending.id+'/approve',{},token);
  const work=await until(async()=>{const value=await call('/api/commands/pending-clock',undefined,token);return value.state!=='pending'&&value;});
  assert.ok(work.workActions.every(action=>action.state!=='succeeded'));
 }finally{await app.close();}
});

test('version 39 instance upgrades without changing existing agents, memory or permissions',async()=>{
 const {Instance}=await import('../dist/instance.js');const {DatabaseSync}=await import('node:sqlite');
 const dir=mkdtempSync(join(tmpdir(),'staf-existing-')),path=join(dir,'db');let instance=new Instance(path);
 try{
  const bot=instance.createBot({name:'Existing',provider:'live',model:'fixture-offline',instructions:'keep'});
  instance.memories.create({scope:{kind:'bot',botId:bot.id},text:'retained memory'});
  instance.setApprovalSettings('instance','never-ask',false);instance.setSearchPermission('instance',false);
  instance.close();instance=undefined;
  const db=new DatabaseSync(path);db.exec('DROP TABLE tool_defaults; PRAGMA user_version=39');db.close();
  instance=new Instance(path);
  assert.equal(instance.bot(bot.id).name,'Existing');assert.equal(instance.memories.list({kind:'bot',botId:bot.id})[0].text,'retained memory');
  assert.equal(instance.approvalSettings('instance').clockEnabled,false);assert.equal(instance.searchPermission('instance').enabled,false);
  assert.deepEqual(instance.toolDefaults(),{revision:1,clock:true,memory:true,web:true,files:true});
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('disabling memory stops automatic recall without deleting owner-visible records',async()=>{
 const {Instance}=await import('../dist/instance.js');const dir=mkdtempSync(join(tmpdir(),'staf-recall-')),path=join(dir,'db');
 const setup=new Instance(path),bot=setup.createBot({name:'Recall',provider:'live',model:'fixture-offline',instructions:''});
 setup.memories.create({scope:{kind:'bot',botId:bot.id},text:'The owner likes apricots.'});setup.close();
 const seen=[];const app=startInstance(path,0,{env:{},providerFactory:async()=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));return {role:'assistant',content:'done'};}})}),port=await app.listen();
 const call=async(route,body,token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(r.ok,route);return r.json();};
 const until=async(fn)=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 try{const token=(await call('/api/pair',{code:app.code})).token,settings=await call('/api/tool-defaults',undefined,token);
  await call('/api/tool-defaults',{...settings,memory:false},token);
  await call('/api/commands',{id:'recall-off',botId:bot.id,content:'apricots'},token);await until(async()=>(await call('/api/commands/recall-off',undefined,token)).state==='completed');
  assert.doesNotMatch(seen[0],/The owner likes apricots/);assert.equal((await call('/api/memories/bot/'+bot.id,undefined,token))[0].text,'The owner likes apricots.');
  const disabled=await call('/api/tool-defaults',undefined,token);await call('/api/tool-defaults',{...disabled,memory:true},token);
  await call('/api/commands',{id:'recall-on',botId:bot.id,content:'apricots'},token);await until(async()=>(await call('/api/commands/recall-on',undefined,token)).state==='completed');
  assert.match(seen[1],/The owner likes apricots/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('accepted tasks in each mode obey current availability without widening task scope',async()=>{
 const app=startInstance(':memory:',0,{env:{},providerFactory:async profile=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages){
  if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'done'};
  const call=profile.toolMode==='code'?{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.clock({});'})}:{name:'clock',arguments:'{}'};
  return {role:'assistant',content:null,tool_calls:[{id:'clock-call',type:'function',function:call}]};
 }})}),port=await app.listen();
 const call=async(route,body,token)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();assert.ok(r.ok,`${route}: ${JSON.stringify(value)}`);return value;};
 const until=async(fn)=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 try{const token=(await call('/api/pair',{code:app.code})).token;
  for(const mode of ['direct','hybrid','code']){
   const bot=await call('/api/bots',{name:'Task '+mode,provider:'live',model:'fixture-offline',toolMode:mode},token);
   const settings=await call('/api/tool-defaults',undefined,token);await call('/api/tool-defaults',{...settings,clock:false},token);
   const id='task-'+mode;await call('/api/tasks',{id,botId:bot.id,objective:'Read clock'},token);
   const task=await until(async()=>{const value=await call('/api/tasks/'+id,undefined,token);return ['completed','failed','stopped'].includes(value.state)&&value;});
   assert.equal(task.workActions.length,0);
  }
 }finally{await app.close();}
});
