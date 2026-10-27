import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {directCodexProvider,responsesInput} from '../dist/codex-direct.js';
import {runTurn} from '../dist/runtime.js';
import {Store} from '../dist/store.js';
import {liveProvider} from '../dist/providers.js';
import {validSession} from '../dist/validation.js';

const model='boundary-model';
const message=(text,extra={})=>({type:'message',role:'assistant',content:[{type:'output_text',text}],...extra});
const call={type:'function_call',status:'completed',call_id:'clock-call',name:'clock',arguments:'{}'};
const reasoning={type:'reasoning',encrypted_content:'opaque',status:'completed'};
const added=(index,item)=>({type:'response.output_item.added',output_index:index,item});
const done=(index,item)=>({type:'response.output_item.done',output_index:index,item});
const completed=(output,usage)=>({type:'response.completed',response:{status:'completed',model,output,...(usage?{usage}:{})}});
const refusal=(text,extra={})=>({type:'message',role:'assistant',content:[{type:'refusal',refusal:text}],...extra});
function sse(events){
 const bytes=new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
 let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+7));offset=Math.min(offset+7,bytes.length);}}));
}
const provider=request=>directCodexProvider({model,sessionId:'boundary-session',dataDir:'/unused',token:async()=>'boundary-secret',request});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'staf-boundary-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=new Store(root);return {store,session:await store.create()};}

const invalidStreams=[
 ['unfinished trailing message',[done(0,call),added(1,message('partial',{status:'in_progress'})),completed([])]],
 ['unfinished leading reasoning',[added(0,{...reasoning,status:'in_progress'}),done(1,call),completed([])]],
 ['announced gap',[done(0,call),added(2,message('partial')),completed([])]],
 ['full output omits announced trailing item',[done(0,call),added(1,message('partial')),completed([call])]],
 ['incomplete full function',[completed([{...call,status:'incomplete'}])]],
 ['incomplete full message',[completed([call,message('partial',{status:'in_progress'})])]],
 ['incomplete full reasoning',[completed([call,{...reasoning,status:'incomplete'}])]],
 ['conflicting done',[done(0,call),done(0,{...call,arguments:'{ }'}),completed([])]],
 ...[-1,32,0.5,'0',undefined].map(index=>['invalid added index '+String(index),[added(index,message('partial')),completed([call])]]),
 ...[-1,32,0.5,'0',undefined].map(index=>['invalid done index '+String(index),[done(index,call),completed([])]]),
];
for(const [name,events] of invalidStreams)test('direct output rejects '+name+' before any tools or history',async t=>{
 const {store,session}=await fixture(t);let requests=0,clocks=0;
 const p=provider(async()=>sse(++requests===1?events:[completed([message('finished')])]));
 const outcome=await runTurn({store,session,provider:p,text:'time',clock:()=>{clocks++;return 'clock';}}).then(()=>undefined,error=>error);
 assert.equal(clocks,0,'incomplete output must never execute clock');
 assert.ok(outcome instanceof Error,'the turn must fail');
 assert.deepEqual(session.messages,[]);
 assert.deepEqual((await store.load(session.id)).messages,[]);
});

test('added, done, duplicates and out-of-order items commit once and preserve replay order',async t=>{
 const {store,session}=await fixture(t);let requests=0,clocks=0;
 const p=provider(async(_,init)=>{
  requests++;
  if(requests===1)return sse([added(1,{...call,status:'in_progress'}),done(1,call),added(1,{...call,status:'in_progress'}),done(0,reasoning),done(1,call),completed([],{input_tokens:10,output_tokens:2}),completed([call])]);
  const body=JSON.parse(init.body);
  assert.deepEqual(body.input.slice(1,4).map(item=>item.type),['reasoning','function_call','function_call_output']);
  return sse([added(0,message('provisional',{status:'in_progress'})),done(0,message('finished')),done(0,message('finished')),completed([],{input_tokens:15,output_tokens:3})]);
 });
 await runTurn({store,session,provider:p,text:'time',clock:()=>{clocks++;return 'clock';}});
 assert.equal(clocks,1);assert.equal(requests,2);
 assert.equal(session.messages.at(-1).content,'finished');
 assert.equal(session.events.filter(event=>event.type==='assistant').length,1);
 assert.equal(session.usage.length,2);
 assert.deepEqual(session.usage.map(item=>item.metrics.input),[10,15]);
});

test('full terminal output completes announced items without done and supplies authoritative text once',async t=>{
 const {store,session}=await fixture(t);let requests=0,clocks=0;
 const p=provider(async()=>{
  requests++;
  if(requests===1)return sse([added(0,{...call,status:'in_progress'}),completed([call],{input_tokens:5,output_tokens:1})]);
  return sse([added(0,message('partial',{status:'in_progress'})),done(0,message('old')),completed([message('final',{status:'completed'})],{input_tokens:7,output_tokens:2})]);
 });
 await runTurn({store,session,provider:p,text:'time',clock:()=>{clocks++;return 'clock';}});
 assert.equal(clocks,1);assert.equal(requests,2);assert.equal(session.messages.at(-1).content,'final');
 assert.equal(session.usage.length,2);assert.equal(session.events.filter(event=>event.type==='assistant').length,1);
});

for(const emptyTerminal of [false,true])test('refusal text and native replay survive '+(emptyTerminal?'empty':'full')+' terminal output, persistence and provider changes',async t=>{
 const {store,session}=await fixture(t);
 const parts=[{type:'output_text',text:'Before. '},{type:'refusal',refusal:'I cannot do that. '},{type:'output_text',text:'After.'}];
 const item={...refusal('unused'),content:parts,status:'completed',phase:'final_answer'};
 let requests=0;
 const p=provider(async(_,init)=>{
  requests++;
  if(requests===1)return sse(emptyTerminal?[done(1,item),done(0,reasoning),completed([])]:[completed([reasoning,item])]);
  const body=JSON.parse(init.body);
  assert.deepEqual(body.input[1],{type:'reasoning',encrypted_content:'opaque',summary:[]});
  assert.deepEqual(body.input[2],{type:'message',role:'assistant',phase:'final_answer',content:parts});
  assert.equal(body.input.filter(value=>value.type==='message').length,1);
  return sse([completed([message('next')])]);
 });
 await runTurn({store,session,provider:p,text:'request'});
 const saved=await store.load(session.id);
 assert.equal(saved.version,1);assert.equal(saved.messages[1].content,'Before. I cannot do that. After.');
 assert.deepEqual(saved.messages[1].responseReplay.items[1].content,parts);assert.ok(validSession(saved,saved.id));
 const switched=responsesInput(saved.messages,'different-model');
 assert.equal(switched[1].content[0].text,'Before. I cannot do that. After.');
 assert.ok(!JSON.stringify(switched).includes('opaque'));assert.ok(!JSON.stringify(switched).includes('"refusal"'));
 await runTurn({store,session:saved,provider:p,text:'same model'});
 const http=liveProvider({STAF_API_KEY:'offline-key',STAF_MODEL:'other'},async(_,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.messages.find(value=>value.role==='assistant').content,'Before. I cannot do that. After.');
  assert.ok(!init.body.includes('responseReplay'));assert.ok(!init.body.includes('opaque'));
  return Response.json({choices:[{message:{role:'assistant',content:'other provider'}}]});
 });
 await runTurn({store,session:saved,provider:http,text:'other provider'});
 assert.ok(validSession(saved,saved.id));
});

test('refusal-only commentary is readable and bearer material is redacted in text and native replay',async()=>{
 const item=refusal('No boundary-secret.',{phase:'commentary'});
 const reply=await provider(async()=>sse([completed([item])])).complete([],[]);
 assert.equal(reply.content,'No [REDACTED].');
 assert.deepEqual(reply.responseReplay.items,[{type:'message',role:'assistant',phase:'commentary',content:[{type:'refusal',refusal:'No [REDACTED].'}]}]);
 assert.ok(!JSON.stringify(reply).includes('boundary-secret'));
});

for(const part of [{type:'refusal',text:'wrong field'},{type:'refusal',refusal:12},{type:'refusal',refusal:null}])test('malformed refusal content is rejected '+JSON.stringify(part),async()=>{
 await assert.rejects(provider(async()=>sse([completed([{...message(''),content:[part]}])])).complete([],[]));
 const session={version:1,id:'test',provider:'codex-direct:'+model,events:[],messages:[{role:'user',content:'request'},{role:'assistant',content:'no',responseReplay:{provider:'codex-direct',model,items:[{type:'message',role:'assistant',content:[part]}]}}]};
 assert.equal(validSession(session,'test'),false);
});
