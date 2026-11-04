import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Instance } from '../dist/instance.js';

test('fresh sessions retain original history and bind commands across restart', () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-sessions-')), path=join(dir,'db'); let instance=new Instance(path);
 try {
  const bot=instance.createBot({name:'Ada',instructions:'Soul',provider:'demo'}), other=instance.createBot({name:'Other',instructions:'',provider:'demo'});
  const first=instance.currentSession(bot.id);
  instance.claim({id:'old',botId:bot.id,sessionId:first.id,content:'old source'});
  assert.throws(()=>instance.createSession({botId:bot.id,expectedSessionId:first.id,operationId:'new'}),/busy/i);
  instance.completeMemoryCommand('old',null,'old answer');
  const next=instance.createSession({botId:bot.id,expectedSessionId:first.id,operationId:'new'});
  assert.equal(instance.createSession({botId:bot.id,expectedSessionId:first.id,operationId:'new'}).id,next.id);
  assert.throws(()=>instance.createSession({botId:bot.id,expectedSessionId:first.id,operationId:'other'}),/session/i);
  assert.throws(()=>instance.claim({id:'stale',botId:bot.id,sessionId:first.id,content:'stale'}),/session/i);
  assert.equal(instance.claim({id:'old',botId:bot.id,sessionId:first.id,content:'old source'}).kind,'existing');
  assert.throws(()=>instance.claim({id:'old',botId:bot.id,sessionId:next.id,content:'old source'}),/conflict/i);
  assert.deepEqual(instance.messages(bot.id),[]);
  assert.equal(instance.searchSessions(bot.id,'old').length,2);
  assert.equal(instance.listSessions(bot.id,0,1).length,1);assert.equal(instance.listSessions(bot.id,1,1)[0].id,first.id);assert.equal(instance.readSession(bot.id,first.id,1,1).messages.length,1);assert.throws(()=>instance.readSession(bot.id,first.id,0,201),/page/);
  const old=instance.readSession(bot.id,first.id); assert.equal(old.messages.length,2);
  assert.equal(instance.resolveSessionMessage(bot.id,{kind:'session-message',sessionId:first.id,messageId:old.messages[0].id}).content,'old source');
  assert.throws(()=>instance.resolveSessionMessage(other.id,{kind:'session-message',sessionId:first.id,messageId:old.messages[0].id}));
  instance.claim({id:'fresh',botId:bot.id,sessionId:next.id,content:'new source'});
  assert.deepEqual(instance.execution('fresh').session.messages,[]);
  instance.completeMemoryCommand('fresh',null,'new answer'); instance.close(); instance=new Instance(path);
  assert.equal(instance.currentSession(bot.id).id,next.id);assert.deepEqual(instance.messages(bot.id).map(m=>m.content),['new source','new answer']);
  assert.equal(instance.readSession(bot.id,first.id).messages.length,2);
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('version 30 migration backs up original records and private replay', async () => {
 const {DatabaseSync}=await import('node:sqlite'); const {existsSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'staf-session-migrate-')),path=join(dir,'db');let instance=new Instance(path);
 try {
  const bot=instance.createBot({name:'Ada',instructions:'',provider:'demo'});
  instance.claim({id:'before',botId:bot.id,content:'original'});
  const replay={version:1,id:bot.chatId,provider:'synthetic',messages:[{role:'user',content:'original'},{role:'assistant',content:'answer'}],events:[{type:'assistant',text:'answer'}]};
  instance.saveExecution('before',replay,true);instance.claim({id:'stopped-before',botId:bot.id,content:'stop me'});instance.updateResponse('stopped-before','partial');instance.requestResponseStop('stopped-before');instance.settleResponseStop('stopped-before');instance.close();
  const db=new DatabaseSync(path);db.exec('DROP TRIGGER conversation_new_bot; DROP TRIGGER conversation_new_message; DROP TRIGGER conversation_new_command; DROP TABLE conversation_session_operations; DROP TABLE conversation_command_sessions; DROP TABLE conversation_message_sessions; DROP TABLE conversation_sessions; PRAGMA user_version=30');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup && existsSync(instance.migrationBackup));assert.equal(instance.currentSession(bot.id).id,bot.chatId);
  assert.deepEqual(instance.chatSession(bot.id),replay);assert.equal(instance.commandSession('before'),bot.chatId);assert.equal(instance.commandSession('stopped-before'),bot.chatId);assert.equal(instance.responseProgress('stopped-before').state,'stopped');assert.equal(instance.responseProgress('stopped-before').text,'partial');
  instance.createSession({botId:bot.id,expectedSessionId:bot.chatId,operationId:'migrated'});
  assert.deepEqual(instance.chatSession(bot.id).messages,[]);assert.equal(instance.readSession(bot.id,bot.chatId).messages.length,4);
  const backup=new DatabaseSync(instance.migrationBackup,{readOnly:true});try {assert.equal(backup.prepare('SELECT session FROM sessions WHERE bot_id=?').get(bot.id).session,JSON.stringify(replay));}finally{backup.close()}
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('paired API holds creation during work and keeps requests isolated', async () => {
 const {startInstance}=await import('../dist/instance-service.js');const dir=mkdtempSync(join(tmpdir(),'staf-session-http-')),path=join(dir,'db');
 let release;const gate=new Promise(resolve=>{release=resolve});const seen=[],instructions=[];
 let app=startInstance(path,0,{providerFactory:async(_profile,system)=>{instructions.push(system);return ({name:'synthetic',capabilities:{toolCalls:false},async complete(request){seen.push(JSON.stringify(request));if(seen.length===1)await gate;return {role:'assistant',content:'answer'}}})}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()]};
 try {
  const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const bot=(await call('/api/bots',a,{name:'Ada',instructions:'soul'}))[1];const route=`/api/bots/${bot.id}/sessions`;
  const first=(await call(route,b))[1].current.id,op={operationId:'new-session',expectedSessionId:first,name:'Fresh'};
  assert.equal((await call('/api/commands',a,{id:'held',botId:bot.id,sessionId:first,content:'secret old conversation'}))[1].kind,'accepted');
  assert.equal((await call(route,b,op))[0],409);release();
  for(let i=0;i<100;i++){if((await call('/api/commands/held',a))[1].state==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await call('/api/commands/held',a))[1].state,'completed');
  const fresh=(await call(route,b,op))[1].id;assert.ok(fresh);assert.equal((await call(route,a,op))[1].id,fresh);
  assert.equal((await call('/api/commands',a,{id:'stale',botId:bot.id,sessionId:first,content:'wrong'}))[0],409);
  assert.equal((await call('/api/commands',a,{id:'held',botId:bot.id,sessionId:first,content:'secret old conversation'}))[1].kind,'existing');
  assert.equal((await call('/api/commands',a,{id:'next',botId:bot.id,sessionId:fresh,content:'fresh conversation'}))[1].kind,'accepted');
  for(let i=0;i<100;i++){if((await call('/api/commands/next',a))[1].state==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(seen.length,2);assert.ok(instructions.every(text=>text.includes('soul')));assert.match(seen[0],/secret old conversation/);assert.doesNotMatch(seen[1],/secret old conversation/);assert.match(seen[1],/fresh conversation/);
  assert.equal((await call(`/api/bots/${bot.id}/session-search?q=secret`,b))[1].length,1);
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  assert.equal((await call(route,a))[1].current.id,fresh);assert.equal((await call(`${route}/${first}`,b))[1].messages.length,2);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('scoped history capabilities stop when captured work ends or aborts', async () => {
 const {sessionCapabilities}=await import('../dist/session-capabilities.js');const instance=new Instance(':memory:');
 try {
  const bot=instance.createBot({name:'Ada',instructions:'',provider:'demo'}),other=instance.createBot({name:'Other',instructions:'',provider:'demo'});
  const sessionId=instance.currentSession(bot.id).id;instance.claim({id:'work',botId:bot.id,sessionId,content:'current'});
  const abort=new AbortController(),api=sessionCapabilities(instance,{botId:bot.id,sessionId,commandId:'work',signal:abort.signal});
  assert.equal(api.current().id,sessionId);assert.equal(api.read(sessionId).messages[0].content,'current');
  assert.throws(()=>api.read(instance.currentSession(other.id).id),/not found/);
  instance.complete('work','done');assert.throws(()=>api.list(),/authorized/);
  const next=instance.createSession({botId:bot.id,expectedSessionId:sessionId,operationId:'create-next'}).id;
  instance.claim({id:'work2',botId:bot.id,sessionId:next,content:'next'});const scoped=sessionCapabilities(instance,{botId:bot.id,sessionId:next,commandId:'work2',signal:abort.signal});abort.abort();assert.throws(()=>scoped.search('current'));
 }finally{instance.close()}
});

test('isolated schema versions reconcile missing features without changing session history or replay', async () => {
 const {DatabaseSync}=await import('node:sqlite');
 for (const version of [31,32,33]) {
  const dir=mkdtempSync(join(tmpdir(),'staf-feature-reconcile-')),path=join(dir,'db');let instance=new Instance(path);
  try {
   const bot=instance.createBot({name:'Existing',instructions:'',provider:'demo'}),first=instance.currentSession(bot.id).id;
   instance.claim({id:'old',botId:bot.id,content:'original'});
   const replay={version:1,id:first,provider:'synthetic',messages:[{role:'user',content:'original'},{role:'assistant',content:'answer'}],events:[]};
   instance.saveExecution('old',replay,true);
   const oldMessage=instance.readSession(bot.id,first).messages[0].id;
   const fresh=instance.createSession({botId:bot.id,expectedSessionId:first,operationId:'fresh'}).id;
   instance.claim({id:'new',botId:bot.id,content:'fresh'});instance.complete('new','done');instance.close();instance=undefined;
   const db=new DatabaseSync(path);db.exec(`DROP TABLE command_references; DROP TABLE document_excerpts; DROP TABLE document_sources; DROP TABLE artifact_operations; DROP TABLE artifact_revisions; DROP TABLE artifacts; PRAGMA user_version=${version}`);db.close();
   instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.currentSession(bot.id).id,fresh);
   assert.equal(instance.readSession(bot.id,first).messages[0].id,oldMessage);assert.equal(instance.commandSession('old'),first);assert.equal(instance.commandSession('new'),fresh);
   assert.deepEqual(instance.readSession(bot.id,first).messages.map(m=>m.content),['original','answer']);assert.deepEqual(instance.messages(bot.id).map(m=>m.content),['fresh','done']);
   assert.equal(instance.artifactCreate(bot.id,{operationId:'old-source',name:'saved',format:'text',content:'saved',source:{sessionId:first,messageId:oldMessage}}).sourceSessionId,first);
   assert.throws(()=>instance.artifactCreate(bot.id,{operationId:'wrong-source',name:'saved',format:'text',content:'saved',source:{sessionId:fresh,messageId:oldMessage}}),/Source message/);
   const doc=await instance.documentImport({botId:bot.id,operationId:'document',name:'source.txt',bytes:Buffer.from('document text')},new AbortController().signal,()=>{});assert.equal(instance.documentRead(bot.id,doc.id).excerpts[0].text,'document text');
   const backupPath=instance.migrationBackup;instance.close();instance=undefined;const verified=new DatabaseSync(path,{readOnly:true});try{assert.equal(verified.prepare('PRAGMA user_version').get().user_version,34);assert.ok(verified.prepare("SELECT 1 FROM sqlite_master WHERE name='command_references'").get());assert.equal(verified.prepare('SELECT replay FROM conversation_sessions WHERE id=?').get(first).replay,JSON.stringify(replay));}finally{verified.close()}
   const backup=new DatabaseSync(backupPath,{readOnly:true});try{assert.equal(backup.prepare('PRAGMA user_version').get().user_version,version);}finally{backup.close()}
  } finally {instance?.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('isolated versions without session tables restore initial history and replay', async () => {
 const {DatabaseSync}=await import('node:sqlite');
 for (const version of [31,32,33]) {
  const dir=mkdtempSync(join(tmpdir(),'staf-missing-session-')),path=join(dir,'db');let instance=new Instance(path);
  try {
   const bot=instance.createBot({name:'Existing',instructions:'',provider:'demo'});
   instance.claim({id:'original',botId:bot.id,content:'saved'});
   const replay={version:1,id:bot.chatId,provider:'synthetic',messages:[{role:'user',content:'saved'},{role:'assistant',content:'answer'}],events:[]};
   instance.saveExecution('original',replay,true);instance.close();instance=undefined;
   const db=new DatabaseSync(path);db.exec(`DROP TRIGGER conversation_new_bot; DROP TRIGGER conversation_new_message; DROP TRIGGER conversation_new_command; DROP TABLE conversation_session_operations; DROP TABLE conversation_command_sessions; DROP TABLE conversation_message_sessions; DROP TABLE conversation_sessions; PRAGMA user_version=${version}`);db.close();
   instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.currentSession(bot.id).id,bot.chatId);assert.equal(instance.commandSession('original'),bot.chatId);assert.deepEqual(instance.messages(bot.id).map(m=>m.content),['saved','answer']);assert.deepEqual(instance.chatSession(bot.id),replay);
  } finally {instance?.close();rmSync(dir,{recursive:true,force:true});}
 }
});
