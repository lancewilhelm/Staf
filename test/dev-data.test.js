import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Instance } from '../dist/instance.js';
import { startInstance } from '../dist/instance-service.js';
import { DatabaseSync } from 'node:sqlite';
import { prepareUpgrade, finishUpgrade } from '../scripts/dev-upgrade.mjs';

const command = (root, action) => spawnSync(process.execPath, ['scripts/dev-data.mjs', action], {cwd:process.cwd(), env:{...process.env,STAF_DEV_DATA_DIR:root}, encoding:'utf8'});
test('reset builds fresh representative data while retaining connections and a complete backup', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-data-')), path=join(root,'instance.sqlite');
  try {
    mkdirSync(join(root,'auth')); writeFileSync(join(root,'auth','codex-host.json'),'synthetic-registration');
    let prior=new Instance(path); const bot=prior.createBot({name:'Before reset',instructions:'Keep this soul',provider:'demo'}); prior.close();
    const result=command(root,'reset'); assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(join(root,'auth','codex-host.json'),'utf8'),'synthetic-registration');
    const next=new Instance(path); const bots=next.bots(); assert.ok(bots.length>=3); assert.ok(!bots.some(item=>item.id===bot.id));
    assert.ok(bots.some(item=>next.messages(item.id).length>=8)); next.close();
    assert.match(result.stdout,/backup/i);
    const backup=result.stdout.match(/Backup: (.+)/)?.[1]; assert.ok(backup);
    prior=new Instance(join(backup,'instance.sqlite')); assert.equal(prior.bot(bot.id).instructions,'Keep this soul'); prior.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('dataset identity survives restart and changes on reset', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-identity-')),path=join(root,'instance.sqlite');
  try {
    let instance=new Instance(path); const identity=instance.datasetIdentity(); instance.close();
    instance=new Instance(path); assert.equal(instance.datasetIdentity(),identity); instance.close();
    const result=command(root,'reset'); assert.equal(result.status,0,result.stderr);
    instance=new Instance(path); assert.notEqual(instance.datasetIdentity(),identity); instance.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

async function interrupt(root, action) {
  const child=fork('scripts/dev-data.mjs',[action],{cwd:process.cwd(),env:{...process.env,STAF_DEV_DATA_DIR:root,STAF_DEV_TEST_PAUSE:'database-published'},stdio:['ignore','ignore','pipe','ipc']});
  let errors='';child.stderr.on('data',data=>errors+=data);
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('exit',()=>reject(Error('Exited before checkpoint: '+errors)));});
  child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
}
test('reset and repeated recovery interruptions retain a usable complete backup', async () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-crash-')),path=join(root,'instance.sqlite');
  try {
    let instance=new Instance(path);const bot=instance.createBot({name:'Retained agent',instructions:'Retained soul',provider:'demo'});instance.claim({id:'before',botId:bot.id,content:'Saved message'});instance.complete('before','Saved response');instance.close();
    await interrupt(root,'reset');assert.ok(existsSync(path+'.maintenance.json'));assert.throws(()=>new Instance(path),/maintenance/i);
    await interrupt(root,'recover');assert.ok(existsSync(path+'.maintenance.json'));assert.throws(()=>new Instance(path),/maintenance/i);
    const result=command(root,'recover');assert.equal(result.status,0,result.stderr);assert.equal(existsSync(path+'.maintenance.json'),false);
    instance=new Instance(path);assert.equal(instance.bot(bot.id).instructions,'Retained soul');assert.deepEqual(instance.messages(bot.id).map(row=>row.content),['Saved message','Saved response']);instance.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('reset refuses an exclusive database owner', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-busy-')),path=join(root,'instance.sqlite');
  let instance;
  try {instance=new Instance(path);instance.createBot({name:'Busy',instructions:'',provider:'demo'});const result=command(root,'reset');assert.notEqual(result.status,0);assert.equal(instance.bots()[0].name,'Busy');assert.equal(existsSync(path+'.maintenance.json'),false);}
  finally {instance?.close();rmSync(root,{recursive:true,force:true});}
});

test('development upgrade snapshots the database and agent files before migration', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-upgrade-')),path=join(root,'instance.sqlite');
  try {
    let instance=new Instance(path);const bot=instance.createBot({name:'Upgrade',instructions:'Soul before upgrade',provider:'demo'});instance.close();
    let db=new DatabaseSync(path);db.exec('PRAGMA user_version=29');db.close();
    const upgrade=prepareUpgrade(root);assert.ok(upgrade);assert.throws(()=>new Instance(path),/maintenance/i);
    db=new DatabaseSync(join(upgrade.backup,'instance.sqlite'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);db.close();
    assert.ok(existsSync(join(upgrade.backup,'agents',bot.id,'current')));
    instance=new Instance(path,undefined,upgrade.token);finishUpgrade(root);assert.equal(instance.bot(bot.id).instructions,'Soul before upgrade');instance.close();
    db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);db.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('an interrupted upgrade restores the complete pre-upgrade dataset', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-upgrade-recover-')),path=join(root,'instance.sqlite');
  try {
    let instance=new Instance(path);const bot=instance.createBot({name:'Upgrade recovery',instructions:'Original instructions',provider:'demo'});instance.close();
    let db=new DatabaseSync(path);db.exec('PRAGMA user_version=29');db.close();prepareUpgrade(root);
    const result=command(root,'recover');assert.equal(result.status,0,result.stderr);
    db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,29);db.close();
    instance=new Instance(path);assert.equal(instance.bot(bot.id).instructions,'Original instructions');instance.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('reset preserves synthetic connections but requires new pairing and does not resurrect revoked clients', async () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-auth-')),path=join(root,'instance.sqlite');
  mkdirSync(join(root,'auth'));
  const direct=JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'synthetic',clientId:'fixture-client',hostId:'fixture-host',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',idToken:'synthetic-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000});
  const host=JSON.stringify({version:1,hostId:'fixture-host'}),router=JSON.stringify({key:'synthetic-openrouter-key'});
  for(const [name,value] of [['codex-direct.json',direct],['codex-host.json',host],['openrouter.json',router]])writeFileSync(join(root,'auth',name),value);
  let app=startInstance(path,0,{env:{}}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
  try {
    const a=(await call('/api/pair',null,{code:app.code}))[1].token,b=(await call('/api/pair',null,{code:app.issueCode()}))[1].token;
    const clients=(await call('/api/clients',b))[1],id=clients.find(client=>!client.current).id;assert.equal((await call(`/api/clients/${id}/revoke`,b,{}))[0],200);
    await app.close();const result=command(root,'reset');assert.equal(result.status,0,result.stderr);
    app=startInstance(path,0,{env:{}});port=await app.listen();assert.equal((await call('/api/bots',a))[0],401);assert.equal((await call('/api/bots',b))[0],401);
    const c=(await call('/api/pair',null,{code:app.code}))[1].token;assert.equal((await call('/api/clients',c))[1].length,1);
    assert.equal((await call('/api/codex-auth/credential',c))[1].signedIn,true);assert.equal((await call('/api/openrouter-connection',c))[1].saved,true);
    for(const [name,value] of [['codex-direct.json',direct],['codex-host.json',host],['openrouter.json',router]])assert.equal(readFileSync(join(root,'auth',name),'utf8'),value);
  } finally {await app.close();rmSync(root,{recursive:true,force:true});}
});
test('explicit restore replaces the complete dataset and preserves its own recovery backup', () => {
  const root=mkdtempSync(join(tmpdir(),'staf-dev-restore-')),path=join(root,'instance.sqlite');
  try {
    let instance=new Instance(path);const bot=instance.createBot({name:'Restore me',instructions:'Restored instructions',provider:'demo'});const oldIdentity=instance.datasetIdentity();instance.authorize('old-token');instance.close();
    const reset=command(root,'reset');assert.equal(reset.status,0,reset.stderr);const backup=reset.stdout.match(/Backup: (.+)/)?.[1];assert.ok(backup);
    const restore=spawnSync(process.execPath,['scripts/dev-data.mjs','restore',backup],{cwd:process.cwd(),env:{...process.env,STAF_DEV_DATA_DIR:root},encoding:'utf8'});assert.equal(restore.status,0,restore.stderr);assert.match(restore.stdout,/Backup:/);
    instance=new Instance(path);assert.equal(instance.bot(bot.id).instructions,'Restored instructions');assert.notEqual(instance.datasetIdentity(),oldIdentity);assert.equal(instance.authorized('old-token'),false);instance.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
