import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore, SettingsSession, resolveSettings, validateSetting } from '../dist/settings.js';
import { settingsCommand } from '../dist/settings-commands.js';

async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'staf-settings-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const store=new SettingsStore(root);
  return {root,store};
}
const input={file:{},shell:{},cli:{}};

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

test('settings bootstrap works without keys or a model and saves no secrets',async t=>{
  const {root,store}=await setup(t);
  const session=await SettingsSession.begin(store,input);
  await settingsCommand(store,session,['set','default','provider','openrouter']);
  assert.match(await settingsCommand(store,session,['show']),/OPENROUTER_API_KEY|model identifier/);
  await settingsCommand(store,session,['set','default','provider','codex']);
  assert.equal(session.effective().provider.value,'codex');
  assert.equal((await store.load()).defaults.provider,'codex');
  const next=await SettingsSession.begin(new SettingsStore(root),input);
  assert.equal(next.effective().provider.value,'codex');
  assert.doesNotMatch(await readFile(store.path,'utf8'),/OPENROUTER_API_KEY|\/settings/);
});

test('corrupt settings remain available for recovery; session overrides do not persist',async t=>{
  const {root,store}=await setup(t);await mkdir(join(root,'config'));await writeFile(store.path,'broken');
  await assert.rejects(store.load());assert.match(store.path,/settings.json/);assert.equal(await readFile(store.path,'utf8'),'broken');
  await rm(store.path);
  const session=await SettingsSession.begin(store,input);session.setSession('provider','demo');
  const next=await SettingsSession.begin(new SettingsStore(root),input);
  assert.equal(next.effective().provider.value,'demo');assert.equal(next.effective().provider.source,'built-in');
  assert.deepEqual((await store.load()).defaults,{});
});

test('settings edits apply to subsequent requests while remembered defaults survive restart',async t=>{
 const {root,store}=await setup(t);
 const session=await SettingsSession.begin(store,input);
 assert.match(await settingsCommand(store,session,['set','default','provider','lmstudio']),/Applied to next request and remembered/);
 await settingsCommand(store,session,['set','default','model.lmstudio','local']);
 assert.equal(session.effective().provider.value,'lmstudio');assert.equal(session.effective().model.value,'local');
 session.setSession('provider','demo');assert.equal(session.effective().provider.value,'demo');
 const next=await SettingsSession.begin(new SettingsStore(root),input);
 assert.equal(next.effective().provider.value,'lmstudio');assert.equal(next.effective().model.value,'local');
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
