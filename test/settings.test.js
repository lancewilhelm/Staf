import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SettingsStore, SettingsSession, resolveSettings, validateSetting } from '../dist/settings.js';
import { settingsCommand } from '../dist/settings-commands.js';

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'staf-settings-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new SettingsStore(root);
  return {root,store};
}
const input={file:{},shell:{},cli:{}};
function cli(root,args=[],text='/quit\n',extra={}) {
  const env={...process.env,...extra};
  for(const key of ['STAF_MODEL','STAF_CODEX_MODEL','LMSTUDIO_MODEL','LMSTUDIO_BASE_URL','STAF_BASE_URL']) if(!Object.hasOwn(extra,key)) delete env[key];
  return spawnSync(process.execPath,['dist/cli.js',...args,'--data-dir',root],{input:text,encoding:'utf8',env});
}

test('versioned defaults survive restart; session overrides and terminal-style default writes remain separate',async t=>{
  const {store,root}=await setup(t);
  await store.update('provider','lmstudio'); await store.update('model.lmstudio','local-model');
  const session=await SettingsSession.begin(store,input);
  session.setSession('provider','demo',false);
  assert.equal(session.effective().provider.source,'this session');
  assert.equal((await store.load()).defaults.provider,'lmstudio');
  await session.saveDefault('provider','openrouter');
  assert.equal(session.effective().provider.value,'demo');
  assert.equal((await SettingsSession.begin(new SettingsStore(root),input)).effective().provider.value,'openrouter');
  session.setSession('provider','codex',true); assert.equal(session.effective().provider.value,'codex');
  assert.equal((await lstat(store.path)).mode & 0o777,0o600);
});

test('effective settings expose saved/file/shell/CLI/session precedence and empty env masks file',()=>{
  const base={saved:{provider:'openrouter','model.openrouter':'saved'},file:{STAF_MODEL:'file'},shell:{STAF_MODEL:'shell'},cli:{},session:{}};
  assert.deepEqual(resolveSettings(base).model,{value:'shell',source:'shell'});
  assert.deepEqual(resolveSettings({...base,cli:{model:'cli'}}).model,{value:'cli',source:'CLI'});
  assert.deepEqual(resolveSettings({...base,cli:{model:'cli'},session:{'model.openrouter':'session'}}).model,{value:'session',source:'this session'});
  assert.deepEqual(resolveSettings({...base,shell:{}}).model,{value:'file',source:'.env'});
  assert.deepEqual(resolveSettings({...base,shell:{STAF_MODEL:''}}).model,{value:'',source:'shell'});
  assert.equal(resolveSettings({...base,file:{},shell:{}}).model.source,'saved default');
  assert.equal(resolveSettings({...base,saved:{},file:{},shell:{}}).provider.value,'demo');
  const emptyEndpoint=resolveSettings({saved:{provider:'lmstudio'},file:{},shell:{LMSTUDIO_BASE_URL:''},cli:{},session:{}}).endpoint;
  assert.equal(emptyEndpoint.value,'http://localhost:1234/v1/');
  assert.equal(emptyEndpoint.source,'shell');
  assert.match(emptyEndpoint.detail,/fallback/);
});

test('settings validate provider-specific fields and never accept credentials or URL secrets',async t=>{
  const {store}=await setup(t);
  for(const [key,value] of [['provider','unknown'],['model.demo','x'],['apiKey','private'],['model.openrouter','sk-or-v1-private'],['endpoint.live','https://user:pass@example.test/v1'],['endpoint.live','http://remote.example/v1'],['endpoint.live','https://example.test/v1/chat/completions']]) {
    await assert.rejects(store.update(key,value));
  }
  const protectedStore=new SettingsStore(store.path+'.other',{OPENROUTER_API_KEY:'dummy-secret'});
  await assert.rejects(protectedStore.update('model.openrouter','dummy-secret'),error=>!error.message.includes('dummy-secret'));
  validateSetting('endpoint.lmstudio','http://localhost:1234/v1/');
  validateSetting('model.codex','test-model');
});

test('malformed/unknown-version/unknown-field configs remain unchanged; failure before rename preserves valid snapshot',async t=>{
  const {root,store}=await setup(t);
  await mkdir(join(root,'config'));
  for(const raw of ['{','{"version":2,"defaults":{}}','{"version":1,"defaults":{"apiKey":"secret-do-not-print"}}']) {
    await writeFile(store.path,raw);
    await assert.rejects(store.load(),error=>!error.message.includes('secret-do-not-print'));
    await assert.rejects(store.update('provider','demo'));
    assert.equal(await readFile(store.path,'utf8'),raw);
  }
  await writeFile(store.path,'{"version":1,"defaults":{"provider":"demo"}}');
  const before=await readFile(store.path,'utf8');
  const failing=new SettingsStore(root,{},async()=>{throw new Error('simulated write failure');});
  await assert.rejects(failing.update('provider','codex'),/write failure/);
  assert.equal(await readFile(store.path,'utf8'),before);
  await store.update('provider','lmstudio'); // failed write cleaned lock
  const linkedRoot=join(root,'linked-root');await mkdir(join(linkedRoot,'config'),{recursive:true});
  await symlink(store.path,join(linkedRoot,'config','settings.json'));
  await assert.rejects(new SettingsStore(linkedRoot).load(),/safely/);
  const parentRoot=join(root,'parent-root');await mkdir(parentRoot);
  await symlink(join(root,'config'),join(parentRoot,'config'));
  await assert.rejects(new SettingsStore(parentRoot).update('provider','demo'),/symlink/);
  assert.equal((await store.load()).defaults.provider,'lmstudio');
});

test('same deterministic menu operations support repetition/cancel and forbid terminal session scope',async t=>{
  const {store}=await setup(t);const session=await SettingsSession.begin(store,input);
  for(const command of [[],[],['back'],['cancel']]) assert.ok(await settingsCommand(store,session,command));
  assert.deepEqual((await store.load()).defaults,{});
  await assert.rejects(settingsCommand(store,session,['set','session','provider','codex'],false,true),/This-session/);
  assert.match(await settingsCommand(store,session,['show']),/built-in/);
});

test('CLI settings bootstrap works without keys/model; commands never enter messages or settings secrets',async t=>{
  const {root,store}=await setup(t);
  let result=cli(root,['settings','set','default','provider','openrouter']);assert.equal(result.status,0,result.stderr);
  result=cli(root,['settings','show']);assert.match(result.stdout,/OPENROUTER_API_KEY|model identifier/);
  result=cli(root,[], '/settings\n/settings cancel\nhello\n/settings set session provider demo\nwhat time is it?\n/settings set default provider codex\n/settings show\n/settings set session provider openrouter\n/quit\n',{OPENROUTER_API_KEY:''});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/tool_result/);assert.ok(!result.stderr.includes('fixed after'));
  const {readdir}=await import('node:fs/promises');
  const file=(await readdir(root)).find(name=>name.endsWith('.json'));
  const saved=JSON.parse(await readFile(join(root,file),'utf8'));
  assert.equal(saved.messages.filter(m=>m.role==='user').length,1);
  assert.ok(!JSON.stringify(saved).includes('/settings'));
  assert.equal((await store.load()).defaults.provider,'codex');
  assert.match(result.stdout,/"value": "codex"/); // remembered edit switches current session
  const next=cli(root,['settings','show']);assert.match(next.stdout,/"value": "codex"/);
});

test('corruption still allows menu/path recovery; separate-process demo resume and session override nonpersistence',async t=>{
  const {root,store}=await setup(t);await mkdir(join(root,'config'));await writeFile(store.path,'broken');
  const bad=cli(root,[], '/settings\n/settings path\n/settings reload\n/quit\n');
  assert.equal(bad.status,0);assert.match(bad.stdout,/settings.json/);assert.equal(await readFile(store.path,'utf8'),'broken');
  await rm(store.path);
  const first=cli(root,[], '/settings set session provider demo\nhello\n/quit\n');assert.equal(first.status,0,first.stderr);
  const id=first.stdout.match(/session ([0-9a-f-]{36})/)[1];
  const next=cli(root,['--session',id],'hello again\n/quit\n');assert.equal(next.status,0,next.stderr);assert.match(next.stdout,/User turns saved: 2/);
  assert.deepEqual((await store.load()).defaults,{});
});

test('completed and resumed chat edits apply next request while remembered defaults survive restart',async t=>{
 const {root}=await setup(t);
 const first=cli(root,[], 'hello\n/settings set default provider lmstudio\n/settings set default model.lmstudio local\n/settings show\n/settings set session provider demo\nhello again\n/quit\n');
 assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/User turns saved: 2/);assert.match(first.stdout,/Applied to next request and remembered/);
 const id=first.stdout.match(/session ([0-9a-f-]{36})/)[1];
 const resumed=cli(root,['--session',id],'/settings set session provider demo\nhello third\n/quit\n');
 assert.equal(resumed.status,0,resumed.stderr);assert.match(resumed.stdout,/User turns saved: 3/);
 const next=cli(root,['settings','show']);assert.match(next.stdout,/"value": "lmstudio"/);assert.match(next.stdout,/"value": "local"/);
});

test('launch input snapshots cannot be mutated by a caller and later explicit session edits remain available',async t=>{
  const {store}=await setup(t);
  const launch={file:{STAF_MODEL:'file-model'},shell:{},cli:{provider:'openrouter'}};
  const session=await SettingsSession.begin(store,launch);
  launch.file.STAF_MODEL='changed-externally';launch.cli.provider='codex';
  assert.equal(session.effective().provider.value,'openrouter');
  assert.equal(session.effective().model.value,'file-model');
  session.lockSession();
  session.setSession('provider','demo',false); assert.equal(session.effective().provider.value,'demo');
});


test('active proposals reset stale reasoning, expose override/destination warnings and roll back failed checks/writes',async t=>{
 const {root,store}=await setup(t);
 const session=await SettingsSession.begin(store,{file:{},shell:{STAF_MODEL:'environment-model'},cli:{provider:'openrouter',model:'launch-model',reasoning:'high'}});
 assert.match(session.preview('provider','lmstudio').join(' '),/history will be sent/);
 await session.apply('provider','lmstudio',false);
 assert.equal(session.effective().model.value,'');assert.equal(session.effective().reasoning.value,'default');
 await session.apply('model.codex','mock-model',true);
 assert.equal(session.effective().provider.value,'codex');assert.equal(session.effective().model.source,'this session');
 const before=structuredClone(session.effective()),saved=await readFile(store.path,'utf8');
 await assert.rejects(session.apply('reasoning.codex','high',true,async()=>{throw Error('unsupported by model');}),/unsupported/);
 assert.deepEqual(session.effective(),before);assert.equal(await readFile(store.path,'utf8'),saved);
 await session.apply('reasoning.codex','low',false,async effective=>{assert.equal(effective.model.value,'mock-model');});
 await session.apply('model.codex','new-model',false);assert.equal(session.effective().reasoning.value,'default');
 const failing=new SettingsStore(root,{},async()=>{throw Error('write failure');});
 const active=await SettingsSession.begin(failing,input);const previous=active.effective();
 await assert.rejects(active.apply('provider','demo',true),/write failure/);assert.deepEqual(active.effective(),previous);
 const restarted=await SettingsSession.begin(store,input);assert.equal(restarted.effective().model.value,'mock-model');
});
