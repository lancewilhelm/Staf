import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseModels, discoverModels, verifyReasoning, validateEffort } from '../dist/models.js';
import { resolveSettings, SettingsStore, SettingsSession } from '../dist/settings.js';
import { openRouterProvider } from '../dist/providers.js';
import { codexProvider } from '../dist/codex.js';
import { runTurn } from '../dist/runtime.js';
import { Store } from '../dist/store.js';

function effective(provider,model='test-model',effort='default') {
 return resolveSettings({saved:{provider,[`model.${provider}`]:model},file:{},shell:{},cli:{reasoning:effort},session:{}});
}
const catalog={data:[{id:'test-model',name:'Test',reasoning:{supported_efforts:['low','high','none'],default_effort:'low',mandatory:true}}]};

test('model-specific metadata preserves unknown/mandatory/null effort semantics and strips other fields',()=>{
 const parsed=parseModels(catalog,'openrouter')[0];assert.deepEqual(parsed.reasoning,['low','high']);assert.equal(parsed.defaultReasoning,'low');
 const unknown=parseModels({data:[{id:'router',supported_parameters:['reasoning']}]},'openrouter')[0];assert.equal(unknown.reasoning,null);assert.equal(unknown.reasoningStatus,'unknown');
 const all=parseModels({data:[{id:'all',reasoning:{supported_efforts:null}}]},'openrouter')[0];assert.ok(all.reasoning.includes('minimal'));
 const codex=parseModels({models:[{slug:'c',model_messages:{secret:'not-returned'},supported_reasoning_levels:[{effort:'low'},{effort:'ultra'}]}]},'codex')[0];
 assert.deepEqual(codex.reasoning,['low']);assert.deepEqual(codex.advertisedReasoning,['low','ultra']);assert.ok(!JSON.stringify(codex).includes('not-returned'));
 const lm=parseModels({data:[{id:'local'}]},'lmstudio')[0];assert.equal(lm.reasoningStatus,'unsupported-transport');
});

test('metadata calls use exact catalog roots, no credentials, no redirects; errors keep manual fallback explicit',async()=>{
 const settings=effective('openrouter');
 const options={env:{OPENROUTER_API_KEY:'do-not-send'},dataDir:'/unused',request:async(url,init)=>{
  assert.equal(String(url),'https://openrouter.ai/api/v1/models');assert.deepEqual(init.headers,{});assert.equal(init.redirect,'error');return Response.json(catalog);
 }};
 assert.equal((await discoverModels(settings,options)).models.length,1);
 await verifyReasoning(effective('openrouter','test-model','high'),options);
 await assert.rejects(verifyReasoning(effective('openrouter','test-model','none'),options),/does not advertise/);
 await assert.rejects(verifyReasoning(effective('openrouter','missing','low'),options),/does not advertise/);
 await assert.rejects(discoverModels(settings,{...options,request:async()=>{throw new Error('do-not-print');}}),error=>/manually/.test(error.message)&&!error.message.includes('do-not-print'));
 await assert.rejects(discoverModels(settings,{...options,request:async()=>Response.json({bad:1})}),/discovery unavailable/);
 let calls=0;await verifyReasoning(settings,{...options,request:async()=>{calls++;throw Error('not called');}});assert.equal(calls,0);
 const lm=await discoverModels(effective('lmstudio'),{...options,request:async(url,init)=>{assert.equal(String(url),'http://localhost:1234/v1/models');assert.deepEqual(init.headers,{});return Response.json({data:[{id:'local'}]});}});assert.equal(lm.models[0].reasoningStatus,'unsupported-transport');
});

test('discovery cache is memory-only, marks freshness and refreshes explicitly',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json(catalog);});
 const options={env:{},dataDir:'/unused',refresh:true};
 const first=await discoverModels(effective('openrouter'),options);assert.equal(first.cached,false);
 const cached=await discoverModels(effective('openrouter'),{...options,refresh:false});assert.equal(cached.cached,true);assert.equal(calls,1);
 await discoverModels(effective('openrouter'),options);assert.equal(calls,2);
});

test('reasoning changes actual HTTP payload/Codex arguments and session identity; default omits controls',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'staf-effort-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const effort of ['default','high']) {
  const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'test-model',async(_,init)=>{
   const body=JSON.parse(init.body);assert.deepEqual(body.reasoning,effort==='default'?undefined:{effort:'high'});return Response.json({choices:[{message:{role:'assistant',content:'ok'}}]});
  },effort);
  await provider.complete([],[]);assert.equal(provider.name.includes('reasoning='),effort!=='default');
 }
 const runner=async args=>{
  if(args[0]==='login')return 'Logged in using ChatGPT';if(args[0]==='mcp')return '[]';
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes('shell_tool')); // reasoning must not enable native commands
  await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({kind:'text',text:'ok'}));return '';
 };
 const codex=await codexProvider('c',runner,'high');await codex.complete([],[]);assert.match(codex.name,/reasoning=high/);
 const store=new Store(dir),session=await store.create();
 await runTurn({store,session,provider:openRouterProvider({OPENROUTER_API_KEY:'dummy'},'test-model',async()=>Response.json({choices:[{message:{role:'assistant',content:'ok'}}]}),'high'),text:'hi'});
 await assert.rejects(runTurn({store,session:await store.load(session.id),provider:{name:'openrouter:test-model',complete:async()=>{throw Error('must not run');}},text:'again'}),/must not run/);
 assert.ok(!(await readFile(store.path(session.id),'utf8')).includes('dummy'));
});

test('reasoning defaults persist with provenance, session overrides do not, unsupported transports fail',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'staf-effort-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new SettingsStore(dir);await store.update('provider','codex');await store.update('reasoning.codex','low');
 const session=await SettingsSession.begin(store,{file:{STAF_CODEX_REASONING:'medium'},shell:{STAF_CODEX_REASONING:'high'},cli:{reasoning:'max'}});
 assert.deepEqual(session.effective().reasoning,{value:'max',source:'CLI'});
 session.setSession('reasoning.codex','low');assert.equal(session.effective().reasoning.source,'this session');
 await session.saveDefault('reasoning.codex','high');assert.equal(session.effective().reasoning.value,'low');
 assert.equal((await SettingsSession.begin(store,{file:{},shell:{},cli:{}})).effective().reasoning.value,'high');
 for(const provider of ['demo','lmstudio','live'])assert.throws(()=>validateEffort(provider,'high'),/not supported/);
 assert.throws(()=>validateEffort('codex','ultra'),/Unsupported/);
 assert.throws(()=>validateEffort('openrouter','made-up'),/Unsupported/);
});


test('shared model/reasoning shortcuts retain scope and expose demo discovery without a request',async t=>{
 const {settingsCommand}=await import('../dist/settings-commands.js');
 const dir=await mkdtemp(join(tmpdir(),'staf-selector-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new SettingsStore(dir),session=await SettingsSession.begin(store,{file:{},shell:{},cli:{}});
 assert.match(await settingsCommand(store,session,['models']),/built-in demo/);
 const original=session.models.bind(session);
 session.models=async()=>({source:'mock',fetchedAt:'fixed',cached:false,models:[{id:'keep',label:'Chosen',reasoning:['low'],reasoningStatus:'advertised'},{id:'other',label:'Other',reasoning:null,reasoningStatus:'unknown'}],note:'mock only'});
 const filtered=await settingsCommand(store,session,['models','chosen']);assert.match(filtered,/keep/);assert.ok(!filtered.includes('other |'));
 session.models=original;
 await assert.rejects(settingsCommand(store,session,['model','session','x']),/Demo has no/);
 session.setSession('provider','codex');
 await settingsCommand(store,session,['model','session','manual-model']);
 await assert.rejects(session.apply('reasoning.codex','low',false,async()=>{throw Error('mock unsupported model');}),/mock unsupported/);
 assert.equal(session.effective().model.value,'manual-model');assert.equal(session.effective().reasoning.value,'default');
 await settingsCommand(store,session,['model','default','saved-model']);
 assert.equal((await store.load()).defaults['model.codex'],'saved-model');assert.equal(session.effective().model.value,'saved-model');
});


test('terminal selector commands parse provider/model/reasoning flags outside menu arguments',async t=>{
 const {spawnSync}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'staf-selector-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const set=spawnSync(process.execPath,['dist/cli.js','settings','model','default','manual-code-model','--provider','codex','--data-dir',dir],{encoding:'utf8'});
 assert.equal(set.status,0,set.stderr);assert.match(set.stdout,/Default saved/);
 const show=spawnSync(process.execPath,['dist/cli.js','settings','show','--provider','codex','--model','manual-override','--reasoning','high','--data-dir',dir],{encoding:'utf8'});
 assert.equal(show.status,0,show.stderr);assert.match(show.stdout,/manual-override/);assert.match(show.stdout,/"value": "high"/);
});
