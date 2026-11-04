import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from '../dist/instance-service.js';
import { Instance } from '../dist/instance.js';

test('artifact revisions retain bytes, provenance and retry identity across clients and restart', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-artifacts-')),path=join(dir,'db');let app=startInstance(path,0,{env:{}}),port=await app.listen();
 const call=async(route,token,body)=>fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(...args)=>{const r=await call(...args);return [r.status,await r.json()]};
 try{
  const a=(await json('/api/pair',null,{code:app.code}))[1].token,b=(await json('/api/pair',null,{code:app.issueCode()}))[1].token;
  const bot=(await json('/api/bots',a,{name:'Author'}))[1],other=(await json('/api/bots',a,{name:'Other'}))[1];
  await json('/api/commands',a,{id:'artifact-source-command',botId:bot.id,content:'source'});
  let command;for(let i=0;i<100;i++){command=(await json('/api/commands/artifact-source-command',a))[1];if(command.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}assert.equal(command.state,'completed');
  const messages=(await json(`/api/bots/${bot.id}/messages`,a))[1],message=messages.find(m=>m.role==='assistant');assert.ok(message);
  const root=`/api/bots/${bot.id}/artifacts`,source={sessionId:bot.chatId,messageId:message.id};
  const create={operationId:'create-one',name:'../My report\r\n',format:'markdown',content:'# Hello\r\n🌍\0after\n',source};
  const [status,first]=await json(root,a,create);assert.equal(status,201);assert.equal(first.revision,1);assert.equal(first.sourceMessageId,message.id);assert.equal(first.sourceSessionId,bot.chatId);
  assert.deepEqual((await json(root,b,create))[1],first);
  assert.equal((await json(root,a,{...create,content:'changed'}))[0],409);
  assert.equal((await json(root,a,{...create,operationId:'bad-source',source:{sessionId:other.chatId,messageId:message.id}}))[0],400);
  assert.equal((await json(`/api/bots/${other.id}/artifacts`,a,{...create,operationId:'bad-owner'}))[0],400);
  assert.equal((await json(`/api/bots/${other.id}/artifacts/${first.id}/revisions/1`,a))[0],400);
  const revisions=`${root}/${first.id}/revisions`,edit={operationId:'edit-one',expectedRevision:1,content:'second,é\n'};
  const [editedStatus,edited]=await json(revisions,b,edit);assert.equal(editedStatus,201);assert.equal(edited.revision,2);
  assert.deepEqual((await json(revisions,a,edit))[1],edited);
  assert.equal((await json(revisions,a,{...edit,content:'other'}))[0],409);
  assert.equal((await json(revisions,a,{operationId:'stale',expectedRevision:1,content:'unsaved'}))[0],409);
  for(const [n,expected] of [[1,create.content],[2,edit.content]]){const download=await call(`${revisions}/${n}/download`,b);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'text/markdown; charset=utf-8');assert.match(download.headers.get('content-disposition'),/^attachment; filename="[A-Za-z0-9_-]+\.md"$/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(expected));}
  assert.equal((await json(root,a,{operationId:'exact-limit',name:'limit',format:'text',content:'x'.repeat(1048576)}))[0],201);
  assert.equal((await json(root,a,{operationId:'invalid-unicode',name:'invalid',format:'text',content:'\ud800'}))[0],400);
  assert.equal((await json(root,a,{operationId:'too-big',name:'large',format:'text',content:'x'.repeat(1048577)}))[0],400);
  assert.equal((await json(root,a,{operationId:'bad-format',name:'x',format:'html',content:'x'}))[0],400);
  const clients=(await json('/api/clients',a))[1],otherClient=clients.find(c=>!c.current);await json(`/api/clients/${otherClient.id}/revoke`,a,{});
  assert.equal((await call(`${revisions}/1/download`,b)).status,401);
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  assert.equal((await json(`${revisions}/1`,a))[1].content,create.content);assert.equal((await json(`${revisions}/2`,a))[1].digest,edited.digest);
  assert.equal((await json(root,a))[1].find(item=>item.id===first.id).revision,2);assert.equal((await json(revisions,a))[1].length,2);
  assert.equal((await json(revisions,a,edit))[1].revision,2);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('scoped artifact capabilities recheck active command and same agent',()=>{
 const instance=new Instance(':memory:');try{
  const bot=instance.createBot({name:'A',instructions:''}),other=instance.createBot({name:'B',instructions:''});
  instance.claim({id:'scoped-command',botId:bot.id,content:'hello'});
  const abort=new AbortController(),captured={botId:bot.id,sessionId:bot.chatId,commandId:'scoped-command',signal:abort.signal},scope=instance.artifactCapabilities(captured);
  captured.botId=other.id;captured.sessionId=other.chatId;
  const item=scope.create({operationId:'scope-create',name:'x',format:'text',content:'hello'});assert.equal(scope.read(item.id,1).content,'hello');
  assert.throws(()=>instance.artifactCapabilities({botId:other.id,sessionId:other.chatId,commandId:'scoped-command',signal:abort.signal}).read(item.id,1),/scope/);
  abort.abort();assert.throws(()=>scope.read(item.id,1));
 }finally{instance.close();}
});

test('slot 33 upgrades a version 30 dataset with a protected backup', async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {statSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'staf-artifact-migration-')),path=join(dir,'db');let instance=new Instance(path);
 try{const bot=instance.createBot({name:'Persist',instructions:''});instance.close();let db=new DatabaseSync(path);db.exec('DROP TABLE artifact_operations; DROP TABLE artifact_revisions; DROP TABLE artifacts; PRAGMA user_version=30');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(statSync(instance.migrationBackup).mode & 0o077,0);assert.equal(instance.artifacts(bot.id).length,0);assert.equal(instance.artifactCreate(bot.id,{operationId:'migrated',name:'x',format:'text',content:'kept'}).revision,1);instance.close();
  db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,33);db.close();const backup=new DatabaseSync(instance.migrationBackup,{readOnly:true});assert.equal(backup.prepare('PRAGMA user_version').get().user_version,30);backup.close();instance=undefined;
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});
