import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from './fixtures/controlled-instance.mjs';

test('a new agent exposes the saved Hybrid tool mode through the paired service', async () => {
  const app=startInstance(':memory:',0,{env:{}});
  const port=await app.listen();
  const call=async(path,body,token)=>{
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{
      method:body?'POST':'GET',
      headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    assert.ok(response.ok,`${path}: ${response.status}`);
    return response.json();
  };
  try {
    const {token}=await call('/api/pair',{code:app.code});
    const agent=await call('/api/bots',{name:'Clock agent',provider:'live',model:'fixture-offline'},token);
    assert.equal(agent.toolMode,'hybrid');
    assert.equal((await call(`/api/bots/${agent.id}`,undefined,token)).toolMode,'hybrid');
  } finally {await app.close();}
});


import {Instance, INSTANCE_SCHEMA_VERSION} from '../dist/instance.js';
import {parseToolMode} from '../dist/tool-mode.js';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

test('defaults, explicit choices, creation retry and profile conflicts retain their identities', () => {
  const instance=new Instance(':memory:');
  try {
    const defaults=instance.creationDefaults();
    assert.equal(defaults.toolMode,'hybrid');
    instance.setCreationDefaults({...defaults,provider:'codex',model:'fixture-model',toolMode:'code'});
    const input={name:'A',instructions:'',operationId:'creation'};
    const agent=instance.createBot(input);
    assert.equal(agent.toolMode,'code');
    const next=instance.creationDefaults();instance.setCreationDefaults({...next,toolMode:'direct'});
    assert.equal(instance.createBot(input).id,agent.id);
    assert.equal(instance.bot(agent.id).toolMode,'code');
    assert.throws(()=>instance.createBot({...input,toolMode:'hybrid'}),/conflict/i);
    assert.equal(instance.createBot({name:'Explicit',instructions:'',toolMode:'hybrid'}).toolMode,'hybrid');
    assert.throws(()=>instance.setCreationDefaults({...next,toolMode:'code'}),/changed/i);
    assert.throws(()=>instance.createBot({name:'Bad',instructions:'',toolMode:'other'}),/toolMode/);
    const edited=instance.editBot(agent.id,{...agent,toolMode:'hybrid'});
    assert.equal(edited.toolMode,'hybrid');
    assert.throws(()=>instance.editBot(agent.id,{...agent,toolMode:'direct'}),/changed/i);
    assert.throws(()=>instance.editBot(agent.id,{...edited,toolMode:null}),/toolMode/);
  } finally {instance.close();}
});

test('direct file edits preserve comments and legacy modes, and reject invalid values', () => {
  const instance=new Instance(':memory:');
  try {
    const agent=instance.createBot({name:'File',provider:'live',model:'fixture-offline',instructions:'',toolMode:'code'});
    const path=join(agent.configDir,'agent.toml');
    let source=readFileSync(path,'utf8').replace('toolMode = "code"','toolMode = "direct" # keep this comment');
    writeFileSync(path,source);
    const direct=instance.bot(agent.id);assert.equal(direct.toolMode,'direct');
    const edited=instance.editBot(agent.id,{...direct,toolMode:'hybrid'});
    assert.match(readFileSync(join(edited.configDir,'agent.toml'),'utf8'),/toolMode = "hybrid" # keep this comment/);
    const legacyPath=join(edited.configDir,'agent.toml');source=readFileSync(legacyPath,'utf8').replace(/^toolMode\s*=.*\n/m,'');writeFileSync(legacyPath,source);
    assert.equal(instance.bot(agent.id).toolMode,'direct');
    writeFileSync(legacyPath,source.replace('name =','toolMode = "bad"\nname ='));
    assert.throws(()=>instance.bot(agent.id),/Invalid toolMode/);
    assert.throws(()=>instance.claim({id:'invalid',botId:agent.id,content:'Hi'}),/Invalid toolMode/);
    assert.match(readFileSync(legacyPath,'utf8'),/toolMode = "bad"/);
    assert.equal(parseToolMode(undefined),'direct');assert.throws(()=>parseToolMode(null),/toolMode/);
  } finally {instance.close();}
});

test('accepted command and task profiles keep their mode and validate legacy and invalid captures', () => {
  const instance=new Instance(':memory:');
  try {
    let agent=instance.createBot({name:'Capture',provider:'live',model:'fixture-offline',instructions:'',toolMode:'code'});
    instance.claim({id:'chat',botId:agent.id,content:'Hello'});
    instance.acceptTask({id:'task',botId:agent.id,objective:'Work',limitMs:1000});
    agent=instance.editBot(agent.id,{...agent,toolMode:'direct'});
    assert.equal(instance.execution('chat').profile.toolMode,'code');
    assert.equal(instance.command('chat').toolMode,'code');
    assert.equal(instance.chatWork(agent.id).requests[0].toolMode,'code');
    assert.equal(instance.taskExecution('task').profile.toolMode,'code');
    assert.equal(instance.taskAttempt('task').toolMode,'code');
    assert.equal(instance.claim({id:'chat',botId:agent.id,content:'Hello'}).command.toolMode,'code');
    for(const [table,key,id] of [['command_profiles','command_id','chat'],['task_attempts','id','task']]) {
      const raw=instance.db.prepare(`SELECT profile FROM ${table} WHERE ${key}=?`).get(id).profile;
      const profile=JSON.parse(raw);delete profile.toolMode;
      instance.db.prepare(`UPDATE ${table} SET profile=? WHERE ${key}=?`).run(JSON.stringify(profile),id);
    }
    assert.equal(instance.execution('chat').profile.toolMode,'direct');
    assert.equal(instance.taskExecution('task').profile.toolMode,'direct');
    for(const [table,key,id] of [['command_profiles','command_id','chat'],['task_attempts','id','task']])instance.db.prepare(`UPDATE ${table} SET profile=json_set(profile,'$.toolMode','invalid') WHERE ${key}=?`).run(id);
    assert.throws(()=>instance.execution('chat'),/toolMode/);
    assert.throws(()=>instance.taskExecution('task'),/toolMode/);
  } finally {instance.close();}
});

test('version 30 databases migrate with backup and preserve existing configuration', () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-mode-migration-')),path=join(dir,'instance.sqlite');
  try {
    let instance=new Instance(path);const agent=instance.createBot({name:'Existing',provider:'live',model:'fixture-offline',instructions:''});instance.close();
    let db=new DatabaseSync(path);db.exec('ALTER TABLE creation_defaults DROP COLUMN tool_mode; PRAGMA user_version=30');db.close();
    instance=new Instance(path);assert.ok(instance.migrationBackup && existsSync(instance.migrationBackup));
    assert.equal(instance.creationDefaults().toolMode,'hybrid');assert.equal(instance.bot(agent.id).name,'Existing');
    assert.equal(INSTANCE_SCHEMA_VERSION,41);instance.close();
    db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);db.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);

test('paired CLI and service share creation defaults and agent mode', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-mode-cli-'));
  const app=startInstance(':memory:',0,{env:{}}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
  const cli=async(...args)=>JSON.parse((await execFileAsync(process.execPath,['dist/cli.js','instance',...args])).stdout);
  try {
    const response=await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})});
    const paired=await response.json();writeFileSync(credential,JSON.stringify(paired));
    const defaults=await cli('defaults',url,credential);assert.equal(defaults.toolMode,'hybrid');
    await cli('defaults-set',url,credential,String(defaults.revision),'codex','fixture-model','-','code');
    const agent=await cli('create',url,credential,'CLI agent','--tool-mode','direct','--operation-id','cli-mode');
    assert.equal(agent.toolMode,'direct');
    const inspected=await cli('inspect',url,credential,agent.id);assert.equal(inspected.toolMode,'direct');
    const path=join(dir,'profile.json');writeFileSync(path,JSON.stringify({...inspected,toolMode:'hybrid'}));
    assert.equal((await cli('edit',url,credential,agent.id,path)).toolMode,'hybrid');
    assert.equal((await cli('inspect',url,credential,agent.id)).toolMode,'hybrid');
    assert.equal((await cli('create',url,credential,'Default agent')).toolMode,'code');
    const terminal=async(...args)=>(await execFileAsync(process.execPath,['dist/cli.js',...args,'--data-dir',join(dir,'terminal'),'--instance',url,'--credential',credential])).stdout;
    assert.match(await terminal('settings','set','toolMode','code'),/Saved toolMode: code/);
    assert.match(await terminal('settings','show'),/Tool mode: code/);
    assert.match(await terminal('settings','set-default','toolMode','hybrid'),/Saved new bot default toolMode: hybrid/);
    assert.match(await terminal('settings','defaults'),/Tool mode: hybrid/);
    const invalid=await fetch(url+'/api/bots',{method:'POST',headers:{Authorization:`Bearer ${paired.token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Invalid',toolMode:null})});assert.equal(invalid.status,400);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
