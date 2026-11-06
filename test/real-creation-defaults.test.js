import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Instance } from '../dist/instance.js';

// Model a retained pre-removal configuration through its authoritative file.
// This keeps migration coverage independent of new-provider selection.
function legacyDemo(instance, name, instructions) {
 const created=instance.createBot({name,instructions,provider:'lmstudio',model:'legacy-fixture'});
 const file=join(created.configDir,'agent.toml');
 const content=readFileSync(file,'utf8').replace('provider = "lmstudio"','provider = "demo"').replace('model = "legacy-fixture"\n','');
 writeFileSync(file,content);
 return instance.bot(created.id);
}

test('real defaults migrate active and archived Demo agents without changing history or other providers', () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-real-defaults-')), path=join(dir,'db'); let instance=new Instance(path);
 try {
  assert.equal(instance.creationDefaults().provider, '');
  assert.throws(()=>instance.createBot({name:'Unset',instructions:''}), /choose.*provider/i);
  const demo=legacyDemo(instance,'Demo','Keep me');
  const archived=legacyDemo(instance,'Archived','Soul');
  const real=instance.createBot({name:'Real',instructions:'Other',provider:'lmstudio',model:'local'});
  instance.claim({id:'history',botId:demo.id,content:'Hello'});instance.complete('history','Answer');
  instance.claim({id:'pending',botId:demo.id,content:'Before migration'});
  instance.setArchived(archived.id,archived.revision,true);
  const defaults=instance.creationDefaults();
  instance.setCreationDefaults({...defaults,provider:'codex',model:'model-one',reasoning:'high'});
  assert.equal(instance.bot(demo.id).provider,'codex');assert.equal(instance.bot(demo.id).instructions,'Keep me');
  assert.equal(instance.bot(archived.id).provider,'codex');assert.equal(instance.bot(archived.id).archived,true);
  assert.equal(instance.bot(real.id).provider,'lmstudio');
  assert.equal(instance.execution('pending').profile.provider,'demo');
  assert.deepEqual(instance.messages(demo.id).map(m=>m.content),['Hello','Answer','Before migration']);
  const created=instance.createBot({name:'New',instructions:''});assert.equal(created.model,'model-one');
  instance.close();instance=new Instance(path);assert.equal(instance.bot(demo.id).chatId,demo.chatId);assert.equal(instance.bot(created.id).provider,'codex');
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('paired clients save real defaults and create without provider authentication', async () => {
 const {startInstance}=await import('../dist/instance-service.js');
 const app=startInstance(':memory:',0,{env:{}});const port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
 try {
  const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  assert.equal((await call('/api/bots',a,{name:'Needs setup'}))[0],400);
  const defaults=(await call('/api/creation-defaults',a))[1];
  assert.equal((await call('/api/creation-defaults',a,{...defaults,provider:'codex',model:'synthetic'}))[0],200);
  assert.equal((await call('/api/creation-defaults',b,{...defaults,provider:'openrouter',model:'other'}))[0],409);
  const created=await call('/api/bots',b,{name:'Configured'});assert.equal(created[0],201);assert.equal(created[1].provider,'codex');assert.equal(created[1].model,'synthetic');
 } finally {await app.close();}
});

test('interrupted migration resumes without overwriting a concurrent real-provider edit', () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-migration-retry-')),path=join(dir,'db');let instance=new Instance(path);
 try {
  const first=legacyDemo(instance,'First','One');
  const second=legacyDemo(instance,'Second','Two');
  const file=join(second.configDir,'agent.toml'),original=readFileSync(file,'utf8');
  writeFileSync(file,'invalid = [');
  const initial=instance.creationDefaults();
  assert.throws(()=>instance.setCreationDefaults({...initial,provider:'codex',model:'chosen'}),/migration incomplete/i);
  assert.equal(instance.bot(first.id).provider,'codex');
  const firstNow=instance.bot(first.id);
  instance.editBot(first.id,{...firstNow,provider:'lmstudio',model:'owner-model'});
  instance.close();writeFileSync(file,original);instance=new Instance(path);
  instance.resumeDemoMigration();instance.resumeDemoMigration();
  assert.equal(instance.bot(first.id).provider,'lmstudio');assert.equal(instance.bot(first.id).model,'owner-model');
  assert.equal(instance.bot(second.id).provider,'codex');assert.equal(instance.bot(second.id).instructions,'Two');
  assert.equal(instance.bots().length,2);
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('old dataset with a real default resumes migration after upgrade', async () => {
 const {DatabaseSync}=await import('node:sqlite');
 const dir=mkdtempSync(join(tmpdir(),'staf-old-defaults-')),path=join(dir,'db');let instance=new Instance(path);
 try {
  const bot=legacyDemo(instance,'Legacy','Preserved');instance.close();
  const db=new DatabaseSync(path);db.exec("DROP TABLE demo_migration; UPDATE creation_defaults SET provider='openrouter',model='fixture/model',reasoning=NULL; PRAGMA user_version=36");db.close();
  instance=new Instance(path);assert.equal(instance.bot(bot.id).provider,'openrouter');assert.equal(instance.bot(bot.id).model,'fixture/model');assert.equal(instance.bot(bot.id).instructions,'Preserved');assert.ok(instance.migrationBackup);
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('paired terminal can choose defaults before a main agent exists', async () => {
 const {startInstance}=await import('../dist/instance-service.js');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=mkdtempSync(join(tmpdir(),'staf-defaults-cli-'));const app=startInstance(join(dir,'db'),0,{env:{}});const port=await app.listen(),url=`http://127.0.0.1:${port}`;
 try {
  const response=await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})});const credential=join(dir,'client.json');writeFileSync(credential,JSON.stringify(await response.json()));
  const run=promisify(execFile);const result=await run(process.execPath,['dist/cli.js','settings','set-defaults','codex','fixture-model','--instance',url,'--credential',credential]);
  assert.equal(JSON.parse(result.stdout).model,'fixture-model');
  const inspected=await run(process.execPath,['dist/cli.js','settings','defaults','--instance',url,'--credential',credential]);assert.match(inspected.stdout,/ChatGPT/);assert.match(inspected.stdout,/fixture-model/);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
