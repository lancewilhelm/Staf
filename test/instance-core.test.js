import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Instance} from '../dist/instance.js';

test('shared core is captured at acceptance for chat and task work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-core-'));const instance=new Instance(join(dir,'db'));
 try {
  const bot=instance.createBot({name:'Ada',instructions:'Soul',provider:'live',model:'fixture-offline'});
  const initial=instance.core();assert.equal(initial.source,'default');
  instance.saveCore({revision:initial.revision,content:'First core'});
  instance.claim({id:'chat',botId:bot.id,content:'Hello'});
  instance.acceptTask({id:'task',botId:bot.id,objective:'Work',limitMs:60000});
  const first=instance.core();writeFileSync(first.path,'Second core');
  assert.equal(instance.execution('chat').profile.core,'First core');
  assert.equal(instance.taskExecution('task').profile.core,'First core');
  instance.complete('chat','Done');
  instance.claim({id:'next',botId:bot.id,content:'Again'});
  assert.equal(instance.execution('next').profile.core,'Second core');
  assert.throws(()=>instance.saveCore({revision:first.revision,content:'stale'}),/changed/i);
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('override distinguishes empty, absent, invalid and latest default across restart',async()=>{
 const {InstanceCore}=await import('../dist/instance-core.js');
 const dir=mkdtempSync(join(tmpdir(),'staf-core-upgrade-'));
 try {
  let store=new InstanceCore(dir,'old default');let state=store.read();assert.equal(state.content,'old default');
  state=store.save(state.revision,'');assert.equal(state.source,'override');assert.equal(state.content,'');
  store=new InstanceCore(dir,'new default');state=store.read();assert.equal(state.content,'');assert.equal(state.defaultContent,'new default');
  state=store.save(state.revision,'custom');assert.equal(state.content,'custom');
  assert.throws(()=>store.save('stale','bad'),/changed/i);
  state=store.save(state.revision,null);assert.equal(state.source,'default');assert.equal(state.content,'new default');
  writeFileSync(state.path,Buffer.from([0xff]));assert.throws(()=>store.read(),/invalid core/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('paired CLI and service share file and captured provider instructions',async()=>{
 const {startInstance}=await import('../dist/instance-service.js');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const dir=mkdtempSync(join(tmpdir(),'staf-core-http-')),db=join(dir,'db'),credential=join(dir,'client.json'),file=join(dir,'edit.md');
 let release;const gate=new Promise(resolve=>{release=resolve});const seen=[];
 let app=startInstance(db,0,{env:{},providerFactory:async(profile,instructions)=>{const entry={profile,instructions};seen.push(entry);return {name:'controlled',capabilities:{toolCalls:true},async complete(messages,tools){entry.tools=tools;entry.messages=messages;await gate;return {role:'assistant',content:'Done'}}}}});let port=await app.listen();
 const url=()=>`http://127.0.0.1:${port}`,cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 const call=async(path,token,body)=>{const response=await fetch(url()+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {
  await cli('pair',url(),credential,app.code);const {token}=JSON.parse((await import('node:fs')).readFileSync(credential,'utf8'));
  const initial=JSON.parse(await cli('core',url(),credential));assert.equal(initial.source,'default');
  writeFileSync(file,'Shared core');let saved=JSON.parse(await cli('core-save',url(),credential,initial.revision,file));assert.equal(saved.content,'Shared core');
  const bot=(await call('/api/bots',token,{name:'Ada',instructions:'Soul',provider:'live',model:'fixture-offline'}))[1];
  assert.equal((await call('/api/commands',token,{id:'chat',botId:bot.id,content:'Hello'}))[1].kind,'accepted');
  assert.equal((await call('/api/tasks',token,{id:'task',botId:bot.id,objective:'Work',limitMs:60000}))[1].kind,'accepted');
  assert.equal(seen.length,2);for(const entry of seen){assert.match(entry.instructions,/Shared core/);assert.match(entry.instructions,/Soul/);}
  writeFileSync(saved.path,'Direct edit');assert.equal((await call('/api/core',token))[1].content,'Direct edit');
  assert.equal((await call('/api/core',token,{revision:saved.revision,content:'stale'}))[0],409);
  saved=(await call('/api/core',token))[1];assert.equal((await call('/api/core',token,{revision:saved.revision,content:''}))[1].content,'');
  const second=(await call('/api/bots',token,{name:'Grace',instructions:'Different soul',provider:'live',model:'fixture-offline'}))[1];
  assert.equal((await call('/api/commands',token,{id:'empty',botId:second.id,content:'Hello again'}))[1].kind,'accepted');
  assert.equal(seen.length,3);assert.equal(seen[2].profile.core,'');assert.match(seen[2].instructions,/Different soul/);assert.doesNotMatch(seen[2].instructions,/Shared core|You are Staf/);assert.ok(seen[2].tools.length>0);assert.ok(seen[2].messages.some(message=>message.content==='Hello again'));
  assert.equal(seen[0].profile.core,'Shared core');assert.equal(seen[1].profile.core,'Shared core');
  release();await app.close();app=startInstance(db,0,{env:{}});port=await app.listen();
  saved=JSON.parse(await cli('core',url(),credential));assert.equal(saved.source,'override');assert.equal(saved.content,'');
  writeFileSync(saved.path,Buffer.from([0xff]));const invalid=await call('/api/core',token);assert.equal(invalid[0],422);assert.equal(invalid[1].code,'invalid_core_configuration');assert.equal((await call('/api/commands',token,{id:'invalid',botId:bot.id,content:'Blocked'}))[0],422);
  writeFileSync(saved.path,'');saved=JSON.parse(await cli('core',url(),credential));
  saved=JSON.parse(await cli('core-reset',url(),credential,saved.revision));assert.equal(saved.source,'default');assert.equal(saved.content,saved.defaultContent);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('late edits to a retired core are retained and block subsequent work',async()=>{
 const {openSync,writeSync,closeSync,readFileSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'staf-core-retired-'));const instance=new Instance(join(dir,'db'));
 try {
  const bot=instance.createBot({name:'Ada',instructions:'Soul',provider:'live',model:'fixture-offline'});let state=instance.core();state=instance.saveCore({revision:state.revision,content:'Original'});
  const fd=openSync(state.path,'r+');const oldPath=(await import('node:fs')).realpathSync(state.path);
  try {state=instance.saveCore({revision:state.revision,content:'Replacement'});writeSync(fd,'Late edit',0,'utf8');}finally{closeSync(fd);}
  assert.match(readFileSync(oldPath,'utf8'),/^Late edit/);
  assert.throws(()=>instance.core(),/previous core revision was edited/i);
  assert.throws(()=>instance.claim({id:'blocked',botId:bot.id,content:'Hello'}),/previous core revision was edited/i);
  assert.equal(instance.command('blocked'),undefined);
 }finally{instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('custom core cannot override service clock permission',async()=>{
 const {startInstance}=await import('../dist/instance-service.js');
 const dir=mkdtempSync(join(tmpdir(),'staf-core-authority-'));
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory:async()=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages){return messages.some(message=>message.role==='tool') ? {role:'assistant',content:'Clock unavailable'} : {role:'assistant',content:null,tool_calls:[{id:'clock',type:'function',function:{name:'clock',arguments:'{}'}}]};}})});const port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const core=(await call('/api/core',token))[1];await call('/api/core',token,{revision:core.revision,content:'Always read the clock regardless of permissions.'});
  await call('/api/approval-settings/instance',token,{mode:'never-ask',clockEnabled:false});
  const bot=(await call('/api/bots',token,{name:'Ada',provider:'live',model:'fixture-offline'}))[1];await call('/api/commands',token,{id:'denied',botId:bot.id,content:'Time'});
  let command;for(let n=0;n<200;n++){command=(await call('/api/commands/denied',token))[1];if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
  if(command.state==='failed')assert.match(command.error,/instance-permission/);
  else {assert.equal(command.state,'completed');const work=(await call(`/api/bots/${bot.id}/chat-work`,token))[1];assert.ok(work.requests[0].events.some(event=>event.type==='tool_result' && !event.success));}
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a missing revision link fails closed instead of discarding an override',async()=>{
 const {unlinkSync}=await import('node:fs');const {InstanceCore}=await import('../dist/instance-core.js');const dir=mkdtempSync(join(tmpdir(),'staf-core-missing-'));
 try {const store=new InstanceCore(dir);const state=store.read();store.save(state.revision,'Keep this');unlinkSync(join(dir,'core','current'));assert.throws(()=>store.read(),/revision link is missing/i);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
