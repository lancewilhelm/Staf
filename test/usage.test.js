import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {httpUsage,codexUsage,sanitizeMetrics,usageText,isUsageObservation} from '../dist/usage.js';
import {openRouterProvider,lmStudioProvider,liveProvider,demoProvider} from '../dist/providers.js';
import {codexProvider} from '../dist/codex.js';
import {Store} from '../dist/store.js';
import {runTurn} from '../dist/runtime.js';
import {validSession} from '../dist/validation.js';
const raw={prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:60,cache_write_tokens:10},completion_tokens_details:{reasoning_tokens:8},cost:0.002,cost_details:{upstream_inference_cost:9}};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'staf-usage-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new Store(root);return{root,store,session:await store.create()};}

test('usage mappings preserve reported zero/missing, subsets, credit units and reject invalid numbers',()=>{
 const report=httpUsage({usage:raw,model:'route/model'},'openrouter');assert.equal(report.metrics.total,120);assert.equal(report.metrics.cachedInput,60);assert.equal(report.metrics.reasoningOutput,8);assert.equal(report.metrics.costCredits,.002);assert.ok(!JSON.stringify(report).includes('upstream'));
 assert.deepEqual(httpUsage({usage:{prompt_tokens:0,completion_tokens:0}},'lmstudio').metrics,{input:0,output:0});
 assert.equal(httpUsage({},'openrouter').status,'unavailable');assert.equal(httpUsage({usage:raw},'live').status,'unavailable');
 assert.deepEqual(httpUsage({usage:raw},'lmstudio').metrics,{input:100,output:20,total:120});
 assert.deepEqual(sanitizeMetrics({input:10,output:2,total:100,cachedInput:11,reasoningOutput:3,cacheWriteInput:-1,costCredits:NaN}),{input:10,output:2});
 assert.deepEqual(sanitizeMetrics({input:Infinity,output:1.5,total:-1,costCredits:'0'}),{});
});

test('HTTP adapters attach structured reports without modifying generation payloads or exposing keys',async()=>{
 for(const kind of ['openrouter','lmstudio','live']){
  const request=async(_,init)=>{const body=JSON.parse(init.body);assert.ok(!Object.hasOwn(body,'usage'));return Response.json({model:'actual-model',usage:raw,choices:[{message:{role:'assistant',content:'ok'}}]});};
  const provider=kind==='openrouter'?openRouterProvider({OPENROUTER_API_KEY:'dummy-secret'},'test',request):kind==='lmstudio'?lmStudioProvider({},'test',request):liveProvider({STAF_API_KEY:'dummy-secret',STAF_MODEL:'test'},request);
  const result=await provider.complete([],[]);assert.equal(result.usage.status,kind==='live'?'unavailable':'reported');assert.ok(!JSON.stringify(result).includes('dummy-secret'));
 }
});

test('Codex uses JSONL last cumulative snapshot once per fresh exec and retains sandbox/auth boundaries',async()=>{
 const line=usage=>JSON.stringify({type:'turn.completed',usage});
 const jsonl=line({input_tokens:3,output_tokens:1})+'\n'+line({input_tokens:10,cached_input_tokens:7,cache_write_input_tokens:2,output_tokens:4,reasoning_output_tokens:1})+'\n'+line({input_tokens:10,cached_input_tokens:7,cache_write_input_tokens:2,output_tokens:4,reasoning_output_tokens:1});
 assert.deepEqual(codexUsage(jsonl).metrics,{input:10,output:4,cachedInput:7,cacheWriteInput:2,reasoningOutput:1});assert.equal(codexUsage('not json').status,'unavailable');
 const run=async args=>{if(args[0]==='login')return 'Logged in using ChatGPT';if(args[0]==='mcp')return '[]';assert.ok(args.includes('--json'));assert.ok(args.includes('--ephemeral'));assert.ok(!args.includes('resume'));assert.ok(args.includes('read-only'));assert.ok(args.includes('shell_tool'));await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({kind:'text',text:'ok'}));return jsonl;};
 const result=await(await codexProvider('mock',run)).complete([],[]);assert.equal(result.usage.metrics.input,10);assert.equal(result.usage.metrics.costCredits,undefined);
});

test('tool continuations, failed attempts and retry accounting survive resume without failed history or double counting',async t=>{
 const {store,session}=await fixture(t);let count=0;
 const provider={...demoProvider,name:'mock:first',complete:async messages=>{assert.ok(messages.every(m=>!Object.hasOwn(m,'usage')));count++;if(count===2)throw Error('offline failure');return {role:'assistant',content:null,tool_calls:[{id:'a',function:{name:'clock',arguments:'{}'}}],usage:httpUsage({usage:raw},'openrouter')};}};
 await assert.rejects(runTurn({store,session,provider,text:'time'}),/offline failure/);assert.deepEqual(session.messages,[]);assert.equal(session.usage.length,2);assert.equal(session.usage[0].metrics.input,100);assert.equal(session.usage[1].status,'unavailable');
 const resumed=await store.load(session.id);
 await runTurn({store,session:resumed,provider:{...demoProvider,name:'mock:second',complete:async()=>({role:'assistant',content:'ok',usage:httpUsage({usage:{prompt_tokens:0,completion_tokens:2,total_tokens:2}},'lmstudio')})},text:'retry'});
 assert.equal(resumed.messages.length,2);assert.equal(resumed.usage.length,3);assert.equal(new Set(resumed.usage.map(r=>r.id)).size,3);
 const text=usageText(resumed,true);assert.match(text,/input: 100 reported subtotal \(2\/3 calls\)/);assert.match(text,/mock:first/);assert.match(text,/mock:second/);assert.match(text,/cachedInput: 60/);
 assert.equal(validSession({...resumed,usage:[...resumed.usage,resumed.usage[0]]},resumed.id),false);
 assert.equal(isUsageObservation({...resumed.usage[0],metrics:{input:-1}}),false);
 const before=await readFile(store.path(session.id),'utf8');assert.ok(!before.includes('dummy-secret'));
});

test('legacy sessions disclose incomplete coverage and mixed providers keep per-turn identity',async t=>{
 const {store,session}=await fixture(t);await runTurn({store,session,provider:demoProvider,text:'hello'});delete session.usage;await store.save(session);
 assert.match(usageText(session),/incomplete coverage/);
 await runTurn({store,session,provider:{...demoProvider,name:'mock:next'},text:'again'});
 assert.equal(session.turns.length,2);assert.equal(session.usage.length,1);assert.match(usageText(session),/1 observed turn starts; 2 saved user turns/);
 assert.equal(validSession({...session,turns:[{start:-1,end:2,provider:'bad'}]},session.id),false);
});

test('usage CLI is deterministic, plain, nonsecret and persists across separate processes without model access',async t=>{
 const {root}=await fixture(t);const run=(args,input)=>spawnSync(process.execPath,['dist/cli.js','--provider','demo','--data-dir',root,...args],{input,encoding:'utf8',env:{...process.env,NO_COLOR:''}});
 const first=run([],'/usage\nwhat time is it?\n/usage details\n/usage help\n/quit\n');assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/not-applicable/);assert.match(first.stdout,/Calls observed: 2/);assert.match(first.stdout,/writes may be charged/);assert.ok(!first.stdout.includes('\x1b'));
 const id=first.stdout.match(/session ([0-9a-f-]{36})/)[1];const next=run(['--session',id],'/usage\n/quit\n');assert.equal(next.status,0,next.stderr);assert.match(next.stdout,/Calls observed: 2/);assert.match(next.stdout,/Account quota.*unavailable/);
});
