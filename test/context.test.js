import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {contextStatus,contextLine,contextDetails,contextFooter} from '../dist/context-status.js';
import {parseModels,cachedModelCatalog,discoverModels} from '../dist/models.js';
import {resolveSettings} from '../dist/settings.js';
import {Store} from '../dist/store.js';
import {runTurn} from '../dist/runtime.js';
import {demoProvider} from '../dist/providers.js';
const effective=(provider='openrouter',model='test')=>resolveSettings({saved:{},file:{},shell:{},cli:{provider,model:provider==='demo'?undefined:model},session:{}});
const catalog={source:'synthetic catalog',fetchedAt:'2026-10-26T00:00:00Z',cached:true,models:[{id:'test',label:'Test',reasoning:null,reasoningStatus:'unknown',contextWindow:8000}],note:'mock'};
const session={version:1,id:'00000000-0000-0000-0000-000000000000',provider:'openrouter:test',messages:[{role:'user',content:'hello'},{role:'assistant',content:'world'}],events:[]};

test('context window mapping accepts only verified positive fields and exact selected model, never invented limits/triggers',()=>{
 assert.equal(parseModels({data:[{id:'m',context_length:8000}]},'openrouter')[0].contextWindow,8000);
 assert.equal(parseModels({models:[{slug:'m',context_window:32000,max_context_window:1000000,auto_compact_token_limit:20000}]},'codex')[0].contextWindow,32000);
 for(const value of [null,-1,0,NaN,Infinity,'8000'])assert.equal(parseModels({data:[{id:'m',context_length:value}]},'openrouter')[0].contextWindow,undefined);
 assert.equal(parseModels({data:[{id:'m',context_length:8000}]},'lmstudio')[0].contextWindow,undefined);
 assert.equal(contextStatus(session,effective(),'draft',catalog).window,8000);
 const changed=contextStatus(session,effective('openrouter','other'),undefined,catalog);assert.equal(changed.window,undefined);assert.match(contextLine(changed),/unknown window/);
 assert.match(contextLine(changed),/Compaction: not implemented/);assert.ok(!contextLine(changed).includes('90%'));
});

test('payload proxy includes Staf instructions/tools and pending input but is independent of cumulative consumption',()=>{
 const first=contextStatus(session,effective(),undefined,catalog);
 const pending=contextStatus(session,effective(),'a'.repeat(400),catalog);
 assert.ok(first.bytes>Buffer.byteLength(JSON.stringify(session.messages)));assert.ok(pending.proxyTokens>first.proxyTokens);assert.equal(pending.messages,3);
 const used={...session,usage:[{id:'one',attempt:'one',turnStart:0,provider:'openrouter:test',status:'reported',source:'OpenRouter response.usage (cost in account credits)',latencyMs:1,outcome:'response',metrics:{input:100000,output:200000}}]};
 assert.equal(contextStatus(used,effective(),undefined,catalog).proxyTokens,first.proxyTokens);
 assert.equal(contextStatus(used,effective(),undefined,catalog).bytes,first.bytes);
 const detail=contextDetails(used,effective(),undefined,catalog);assert.match(detail,/100000 tokens/);assert.match(detail,/labeled historical request, not the next context/);assert.match(detail,/not a tokenizer/);assert.match(detail,/Output reserve: not configured/);assert.match(detail,/fetched 2026/);
 const native=contextDetails({...used,usage:[{...used.usage[0],provider:'codex:test',source:'Codex fresh exec cumulative usage; total not reported'}]},effective('codex'),undefined,catalog);
 assert.match(native,/cumulative aggregate, NOT native context/);assert.match(native,/next payload/);
 assert.match(contextLine(contextStatus(session,effective('demo'))),/demo \(no model tokens\/window\)/);
});

test('model catalog passive lookup never reads network; explicit metadata can be reused and remains endpoint-scoped',async t=>{
 const root=await mkdtemp(join(tmpdir(),'staf-context-meta-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const base=effective('lmstudio','local');base.endpoint.value='http://localhost:47999/v1/';assert.equal(cachedModelCatalog(base),undefined);
 let calls=0;await discoverModels(base,{dataDir:root,env:{},request:async()=>{calls++;return Response.json({data:[{id:'local'}]});}});
 // Injected catalogs are intentionally not globally cached; no implicit fetch follows.
 assert.equal(cachedModelCatalog(base),undefined);assert.equal(calls,1);assert.equal(contextStatus(session,base).window,undefined);
});

test('context recomputes after resume without changing ledger, history, settings or context size interpretation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'staf-context-resume-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new Store(root),saved=await store.create();
 await runTurn({session:saved,store,provider:demoProvider,text:'hello'});
 const before=await readFile(store.path(saved.id),'utf8');const resumed=await store.load(saved.id);
 assert.deepEqual(contextStatus(saved,effective(),undefined,catalog),contextStatus(resumed,effective(),undefined,catalog));
 assert.equal(await readFile(store.path(saved.id),'utf8'),before);assert.equal(resumed.usage.length,1);
 const result=spawnSync(process.execPath,['dist/cli.js','--provider','demo','--data-dir',root,'--session',saved.id],{input:'/context\n/usage\n/settings set session provider lmstudio\n/context\n/quit\n',encoding:'utf8',env:{...process.env,NO_COLOR:''}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Context: demo/);assert.match(result.stdout,/next payload ~\d+ tokens \(bytes\/4 proxy\) \/ unknown window/);assert.match(result.stdout,/Compaction: not implemented/);assert.ok(!result.stdout.includes('\x1b'));assert.equal(await readFile(store.path(saved.id),'utf8'),before);
});


test('HTTP measurements show latest tool request, cache subset once and timestamps; reasoning output is not context delta',async t=>{
 const {openRouterProvider}=await import('../dist/providers.js');
 const root=await mkdtemp(join(tmpdir(),'staf-measured-context-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new Store(root),saved=await store.create();let calls=0;
 const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'test',async()=>{calls++;return Response.json({model:'reported-model',usage:{prompt_tokens:calls===1?100:170,prompt_tokens_details:{cached_tokens:calls===1?50:120},completion_tokens:1000,completion_tokens_details:{reasoning_tokens:900}},choices:[{message:calls===1?{role:'assistant',content:null,tool_calls:[{id:'clock',function:{name:'clock',arguments:'{}'}}]}:{role:'assistant',content:'short visible answer'}}]});});
 await runTurn({session:saved,store,provider,text:'time',clock:()=> 'fixed'});
 assert.equal(saved.usage.length,2);assert.equal(saved.usage[1].scope,'request');assert.ok(Number.isFinite(Date.parse(saved.usage[1].observedAt)));
 const status=contextStatus(saved,effective(),undefined,catalog),display=contextLine(status);
 assert.match(display,/last HTTP request input 170 tokens \(120 cached, already included\)/);assert.match(display,/historical: openrouter:test \/ reported model reported-model; \d{4}-/);assert.ok(!display.includes('290 tokens'));
 const altered=structuredClone(saved);altered.usage[1].metrics.reasoningOutput=1;altered.usage[1].metrics.output=1;
 assert.equal(contextStatus(altered,effective(),undefined,catalog).proxyTokens,status.proxyTokens);
 const resumed=await store.load(saved.id);assert.deepEqual(contextStatus(resumed,effective(),undefined,catalog),status);
 const switched=contextDetails(resumed,effective('lmstudio','different'));
 assert.match(switched,/historical: openrouter:test/);assert.match(switched,/unknown window/);assert.match(switched,/no exact request\/template fingerprint/);assert.ok(!switched.includes('measured baseline'));
 const edited=structuredClone(resumed);edited.messages[0].content='edited history';assert.match(contextDetails(edited,effective()),/No measured-plus-delta baseline/);
 const stale=contextStatus(saved,effective(),undefined,{...catalog,stale:true});assert.match(contextLine(stale),/advertised \[stale\]/);
});

test('old/missing usage and Codex execution scope are not relabeled as measured request context',()=>{
 const base={id:'one',attempt:'one',turnStart:0,provider:'openrouter:test',status:'reported',source:'OpenRouter response.usage (cost in account credits)',latencyMs:1,outcome:'response',metrics:{input:0,cachedInput:0}};
 assert.match(contextLine(contextStatus({...session,usage:[base]},effective())),/last HTTP request input 0 tokens \(0 cached, already included\).*time unavailable/);
 const absent={...base,metrics:{},status:'unavailable'};assert.match(contextLine(contextStatus({...session,usage:[base,absent]},effective())),/last request input unavailable/);
 const codex={...base,scope:'execution',provider:'codex:test',metrics:{input:9000},source:'Codex fresh exec cumulative usage; total not reported'};
 const display=contextLine(contextStatus({...session,usage:[codex]},effective('codex')));assert.match(display,/last exec input 9000 tokens \(cumulative aggregate, NOT native context\)/);assert.match(display,/next payload/);assert.ok(!display.includes('last HTTP request input 9000'));
});


test('recurring footer is concise; detailed measurements remain only on explicit context output',async t=>{
 const native=contextStatus(session,effective('codex'),undefined,catalog);
 assert.match(contextFooter(native),/Context: ~/);
 const http=contextStatus(session,effective(),undefined,catalog);assert.match(contextFooter(http),/^Context: ~[0-9.k]+ \/ 8k \(est\.\)$/);assert.ok(contextFooter(http).length<=32);
 assert.match(contextFooter({...http,window:undefined}),/^Context: ~[0-9.k]+ tokens \(est\.\)$/);
 assert.ok(!contextFooter({...http,stale:true}).includes('/ 8k'));
 assert.equal(contextFooter(contextStatus(session,effective('demo'))),'Context: demo');
 assert.match(contextDetails(session,effective('codex')),/Direct|direct|Responses/);
 const root=await mkdtemp(join(tmpdir(),'staf-footer-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const result=spawnSync(process.execPath,['dist/cli.js','--provider','demo','--data-dir',root],{input:'hello\n/quit\n',encoding:'utf8',env:{...process.env,NO_COLOR:''}});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Context: demo/);assert.ok(!/Measured:|bytes\/4|Compaction:/.test(result.stdout));assert.ok(!result.stdout.includes('\x1b'));
});
