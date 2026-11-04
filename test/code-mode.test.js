import test from 'node:test';
import assert from 'node:assert/strict';
import {workerMessage} from '../dist/code-mode/protocol.js';
import {startNativeLabGuest} from '../dist/code-mode/executor.js';

test('bridge accepts both terminal variants and rejects extra authority fields', () => {
  assert.equal(workerMessage.parse({type:'end',outcome:'return',value:42,guestMs:2}).value,42);
  assert.equal(workerMessage.parse({type:'end',outcome:'syntax',guestMs:2}).outcome,'syntax');
  assert.throws(()=>workerMessage.parse({type:'call',seq:1,name:'clock.read',input:{},commandId:'forged'}));
});
test('real worker awaits host promises without Node globals or a module loader', async () => {
  let called=0;
  const guest=startNativeLabGuest({source:'const value=await capabilities["clock.read"]({}); return {value,process:typeof process,require:typeof require,fetch:typeof fetch,bridge:typeof __bridge};',names:['clock.read'],guestMs:1000,
    request:async request=>{called++;assert.equal(request.name,'clock.read');return {ok:true,value:42};},phase:()=>{}});
  const result=await guest.finished;
  assert.equal(result.outcome,'return');assert.equal(called,1);
  assert.deepEqual(result.value,{value:42,process:'undefined',require:'undefined',fetch:'undefined',bridge:'undefined'});
});

import {Instance} from '../dist/instance.js';
import {CodeModeWork} from '../dist/code-mode/host.js';
import {CodeApprovals} from '../dist/code-mode/approvals.js';
import {CapabilityRegistry,applicationCapability,dataSchema,resourceScope,scopeClaim,json} from '../dist/code-mode/contract.js';
import {z} from 'zod';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const input=dataSchema(z.strictObject({value:z.string().max(2000)}));
const output=dataSchema(z.strictObject({value:z.string()}));
const noop=async()=>scopeClaim(()=>undefined);
function setup(t, options={}) {
  const instance=new Instance(options.path??':memory:');
  const bot=instance.createBot({name:'Code test',instructions:'Test'});
  instance.claim({id:'code-test',botId:bot.id,content:'Test code'});
  const controller=new AbortController();
  const context=Object.freeze({botId:bot.id,sessionId:bot.chatId,commandId:'code-test',signal:controller.signal});
  const store=instance.codeModeStore(context);
  let calls=[];
  const capability=(kind='read',invoke=async(call,input)=>{calls.push({call,input});return input;},checkScope=noop)=>applicationCapability({description:'Synthetic application method',input,output,effect:{kind,resource:(call)=>resourceScope({family:'synthetic',owner:call.context.botId,key:call.context.sessionId})},checkScope,invoke});
  const registry=new CapabilityRegistry(options.makeCapabilities?.({capability,context,calls})??options.capabilities??{'fixture.read':capability()});
  const approvals=new CodeApprovals(options.approvalMs??86_400_000,options.now);
  const work=new CodeModeWork({store,registry,approvals,policy:options.policy??(()=> 'allow'),redact:options.redact??(s=>s),limits:options.limits});
  t.after(async()=>{controller.abort();await work.dispose();instance.close();});
  return {instance,bot,context,store,work,approvals,controller,calls,capability};
}
const execute=(x,source,id='call-1')=>x.work.execute({source,providerCallId:id});
async function until(fn) {for(let i=0;i<200;i++){const value=fn();if(value)return value;await delay(5);}throw Error('Condition did not arrive');}

test('schema-backed scoped calls retain selected values and actual actions, not unused reads',async t=>{
  const x=setup(t);
  const report=await execute(x,'const read=await capabilities["fixture.read"]({value:"raw-temporary"}); await staf.emit({partial:"kept"}); return {answer:read.value.length};');
  assert.equal(report.reason,'completed');assert.deepEqual(report.outputs,[{partial:'kept'},{answer:13}]);
  assert.equal(report.actions[0].state,'succeeded');assert.equal(report.receipts.length,1);
  assert.equal(x.calls[0].call.context.sessionId,x.context.sessionId);assert.equal(x.calls[0].call.context.commandId,'code-test');
  assert.equal(x.calls[0].call.context.signal,x.context.signal);
  assert.ok(x.calls[0].call.signal.aborted);
  assert.ok(x.calls[0].call.operationId);assert.notEqual(x.calls[0].call.operationId,x.calls[0].call.childId);
  assert.equal(x.store.inspect().actions[0].result,'Action completed');
  assert.equal(x.store.events().some(event=>event.kind==='output' && JSON.stringify(event.value).includes('raw-temporary')),false);
});

test('denial fences caught errors and later outer invocations',async t=>{
  const x=setup(t,{policy:()=> 'prompt'});
  const running=execute(x,'try {await capabilities["fixture.read"]({value:"exact"});} catch {} return await capabilities["fixture.read"]({value:"workaround"});');
  const approval=await until(()=>x.approvals.list()[0]);assert.deepEqual(approval.input,{value:'exact'});
  assert.equal(x.approvals.decide(approval.id,'deny'),true);
  const report=await running;assert.equal(report.reason,'denied');assert.equal(x.calls.length,0);assert.equal(report.actions.length,1);
  assert.throws(()=>execute(x,'return 1','later'),/fenced/);assert.equal(x.approvals.decide(approval.id,'approve'),false);
});

test('presented approval expires after 24h without consuming approval-only active time',async t=>{
  let now=100;
  const x=setup(t,{policy:()=> 'prompt',now:()=>now,limits:{activeMs:80}});
  const running=execute(x,'return await capabilities["fixture.read"]({value:"waiting"});');
  const approval=await until(()=>x.approvals.list()[0]);assert.equal(approval.expiresAt,now+86_400_000);
  await delay(120);assert.equal(x.approvals.list().length,1);
  now=approval.expiresAt;
  assert.equal(x.approvals.decide(approval.id,'approve'),false);
  const report=await running;assert.equal(report.reason,'expired');assert.equal(x.calls.length,0);
});

test('revocation after approval and Stop during queued scope validation prevent dispatch',async t=>{
  let allowed=true;
  const x=setup(t,{policy:()=>allowed?'prompt':'block'});
  const running=execute(x,'return await capabilities["fixture.read"]({value:"x"});');
  const approval=await until(()=>x.approvals.list()[0]);allowed=false;x.approvals.decide(approval.id,'approve');
  assert.equal((await running).actions[0].state,'cancelled');assert.equal(x.calls.length,0);
});

test('successful reads can be explicitly reused only inside the accepted request',async t=>{
  const x=setup(t);
  const first=await execute(x,'return await capabilities["fixture.read"]({value:"reused"});');
  const next=await execute(x,`return await staf.reuse(${JSON.stringify(first.receipts[0].id)});`,'call-2');
  assert.equal(next.reason,'completed');assert.deepEqual(next.outputs,[{value:'reused'}]);assert.equal(x.calls.length,1);
  assert.equal(next.actions[0].result,'Cached read released');
  assert.throws(()=>x.instance.codeModeStore(x.context),/owned/);
  assert.throws(()=>new CodeModeWork({store:x.store,registry:new CapabilityRegistry({}),approvals:x.approvals,policy:()=> 'allow',redact:s=>s}),/owned/);
});

test('JSON boundaries reject non-finite values, accessors, sparse arrays and invalid prototypes',()=>{
  for(const value of [NaN,Infinity,undefined,()=>{},new Date(),[,,],{get value(){throw Error('getter ran');}}])assert.throws(()=>json(value));
  const loop={};loop.loop=loop;assert.throws(()=>json(loop));
});

test('source must be retainable verbatim and repeated provider identities never replay',async t=>{
  const x=setup(t,{redact:s=>s.replaceAll('known-secret','[redacted]')});
  await assert.rejects(execute(x,'return "known-secret";'),/faithfully/);
  const report=await execute(x,'return 42;');
  assert.equal((await execute(x,'return 42;')).executionId,report.executionId);
  assert.equal(x.store.events().filter(e=>e.kind==='execution').length,1);
  await assert.rejects(execute(x,'return 43;'),/identity conflict/);
});

test('pre-action corrections and cumulative child/output budgets are finite',async t=>{
  const x=setup(t);
  assert.equal((await execute(x,'return (','bad-1')).reason,'syntax');
  assert.equal((await execute(x,'return (','bad-2')).reason,'syntax');
  assert.equal((await execute(x,'return (','bad-3')).reason,'limit');
  assert.throws(()=>execute(x,'return 1','after-limit'),/fenced/);
});

test('Stop kills a computing guest and closes approval admission',async t=>{
  const x=setup(t);
  const running=execute(x,'while(true){}');
  await delay(100);x.controller.abort();
  const report=await running;assert.equal(report.reason,'stopped');assert.equal(x.approvals.list().length,0);
});

test('three independent reads overlap, changes stay exclusive and ordered',async t=>{
  let reads=0,changes=0,maximum=0;const order=[];
  const x=setup(t,{makeCapabilities:({capability})=>({
    'fixture.read':capability('read',async(call,input)=>{assert.equal(changes,0);reads++;maximum=Math.max(maximum,reads);await delay(20);reads--;return input;}),
    'fixture.change':capability('change',async(call,input)=>{assert.equal(reads,0);assert.equal(changes,0);changes++;order.push(input.value);await delay(20);changes--;return input;}),
  })});
  const report=await execute(x,'return await Promise.all([...[1,2,3,4,5].map(n=>capabilities["fixture.read"]({value:String(n)})),capabilities["fixture.change"]({value:"first"}),capabilities["fixture.change"]({value:"second"})]);');
  assert.equal(report.reason,'completed');assert.equal(maximum,3);assert.deepEqual(order,['first','second']);assert.equal(report.actions.length,7);
});

test('Stop ordered before the start permit wins even after async scope validation',async t=>{
  let release,entered=false,dispatched=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>{dispatched=true;return input;},async()=>{entered=true;await gate;return scopeClaim(()=>undefined);})})});
  const running=execute(x,'return await capabilities["fixture.read"]({value:"x"});');
  await until(()=>entered);x.instance.requestResponseStop('code-test');x.controller.abort();release();
  const report=await running;assert.equal(report.reason,'stopped');assert.equal(dispatched,false);assert.equal(report.actions[0].state,'cancelled');
});

test('cached read release rechecks scope without calling the service again',async t=>{
  let allowed=true,invokes=0;
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>{invokes++;return input;},async()=>{if(!allowed)throw Error('revoked');return scopeClaim(()=>{if(!allowed)throw Error('revoked');return undefined;});})})});
  const first=await execute(x,'return await capabilities["fixture.read"]({value:"private"});');allowed=false;
  const second=await execute(x,`return await staf.reuse(${JSON.stringify(first.receipts[0].id)});`,'reuse');
  assert.equal(invokes,1);assert.deepEqual(second.outputs,[]);assert.equal(second.actions[0].state,'cancelled');
});

test('unawaited started change becomes uncertain, then late success amends that same action',async t=>{
  let release,started=false;
  const gate=new Promise(resolve=>{release=resolve;});
  const x=setup(t,{limits:{settleMs:40},makeCapabilities:({capability})=>({'fixture.change':capability('change',async(call,input)=>{started=true;await gate;return input;})})});
  const running=execute(x,'capabilities["fixture.change"]({value:"change"}); await staf.emit("marker"); return "done";');
  await until(()=>started);
  const report=await running;assert.equal(report.reason,'uncertain');assert.equal(report.actions[0].state,'uncertain');assert.deepEqual(report.outputs,['marker','done']);
  assert.throws(()=>execute(x,'return 1','retry'),/fenced/);
  release();await until(()=>x.store.inspect().actions[0].state==='succeeded');
  assert.equal(x.store.inspect().actions.length,1);assert.equal(x.store.inspect().actions[0].id,report.actions[0].id);
});

test('normal return settles an unawaited read and cancels calls not yet started',async t=>{
  let started=0;
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>{started++;await delay(30);return input;})})});
  const report=await execute(x,'for(let i=0;i<8;i++) capabilities["fixture.read"]({value:String(i)}); await staf.emit("marker"); return "done";');
  assert.equal(report.reason,'completed');assert.ok(started<=3);assert.ok(started>=1);
  assert.ok(report.actions.every(a=>['succeeded','cancelled'].includes(a.state)));
});

test('limits remain cumulative across fresh scripts and required output is never truncated',async t=>{
  const x=setup(t,{limits:{children:2}});
  await execute(x,'return await capabilities["fixture.read"]({value:"one"});','one');
  await execute(x,'return await capabilities["fixture.read"]({value:"two"});','two');
  assert.equal((await execute(x,'return await capabilities["fixture.read"]({value:"three"});','three')).reason,'limit');assert.equal(x.calls.length,2);
  const y=setup(t,{limits:{outputBytes:8}});
  const report=await execute(y,'return "too-large-to-keep";');
  assert.equal(report.reason,'limit');assert.deepEqual(report.outputs,[]);
});

test('the service validator sees a constructed URL and rejects unsafe arguments',async t=>{
  const {checkedOwnerWebUrl}=await import('../dist/web-reader.js');
  let dispatched=false;
  const checked=dataSchema(z.strictObject({value:z.string().superRefine((value,ctx)=>{try{checkedOwnerWebUrl(value);}catch{ctx.addIssue({code:'custom',message:'Unsupported URL'});}})}));
  const cap=applicationCapability({description:'Synthetic URL read',input:checked,output,effect:{kind:'read',resource:call=>resourceScope({family:'web',owner:call.context.botId,key:'public'})},checkScope:noop,invoke:async(call,value)=>{dispatched=true;return value;}});
  const x=setup(t,{capabilities:{'fixture.read':cap}});
  const report=await execute(x,'const suffix=String.fromCharCode(63)+"secret=value"; return await capabilities["fixture.read"]({value:"https://example.com/"+suffix});');
  assert.equal(dispatched,false);assert.deepEqual(report.outputs,[]);
});

test('guest execution time is bounded even when code catches interruption',async()=>{
  const guest=startNativeLabGuest({source:'for(;;){try{while(true){}}catch{}}',names:[],guestMs:50,request:async()=>({ok:false,error:'unused'}),phase:()=>{}});
  const report=await guest.finished;assert.notEqual(report.outcome,'return');
});

test('accepted context cannot be redirected by client selection or supplied extra IDs',async t=>{
  let selected='later-session';const observed=[];
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>{observed.push(call.context.sessionId);return input;})})});
  await execute(x,'return await capabilities["fixture.read"]({value:"ok"});');
  selected='another-session';
  await execute(x,'return await capabilities["fixture.read"]({value:"ok",sessionId:"forged"});','forged');
  assert.deepEqual(observed,[x.context.sessionId]);assert.notEqual(observed[0],selected);
});

test('prototype-named JSON cannot silently change at the bridge boundary',()=>{
  const value=JSON.parse('{"__proto__":{"secret":"value"}}');
  assert.throws(()=>json(value));
  assert.equal(workerMessage.safeParse({type:'emit',seq:1,value}).success,false);
});

test('a stalled scope check consumes active time and cannot retain a worker',async t=>{
  let entered=false;
  const x=setup(t,{limits:{activeMs:50,settleMs:20},makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>input,async()=>{entered=true;return new Promise(()=>{});})})});
  const running=execute(x,'return await capabilities["fixture.read"]({value:"stalled"});');
  await until(()=>entered);
  let timeout;
  const result=await Promise.race([running,new Promise(resolve=>{timeout=setTimeout(()=>{x.controller.abort();resolve(null);},250);})]);clearTimeout(timeout);
  assert.notEqual(result,null,'scope validation must end at the active deadline');assert.equal(result.reason,'limit');assert.equal(result.actions[0].state,'cancelled');
});

test('completed changes cannot repeat in a fresh recovery script',async t=>{
  let changes=0;
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.change':capability('change',async(call,input)=>{changes++;return input;})})});
  await execute(x,'await capabilities["fixture.change"]({value:"once"}); throw Error("later failure");','initial');
  const recovery=await execute(x,'return await capabilities["fixture.change"]({value:"once"});','recovery');
  assert.equal(changes,1);assert.equal(recovery.actions[0].state,'cancelled');
});

test('a final scope revision assertion fences caught errors and later invocations',async t=>{
  let assertions=0,dispatched=0;
  const x=setup(t,{makeCapabilities:({capability})=>({'fixture.read':capability('read',async(call,input)=>{dispatched++;return input;},async()=>scopeClaim(()=>{if(++assertions===3)throw Error('Scope revoked at permit');return undefined;}))})});
  const report=await execute(x,'try {await capabilities["fixture.read"]({value:"x"});}catch{} return await capabilities["fixture.read"]({value:"alternative"});');
  assert.equal(report.reason,'blocked');assert.equal(dispatched,0);assert.equal(report.actions.length,1);
  assert.throws(()=>execute(x,'return 1','after-revocation'),/fenced/);
});

test('policy blocked at the final permit durably fences the whole accepted request',async t=>{
  let checks=0;
  const x=setup(t,{policy:()=>++checks===2?'block':'allow'});
  const report=await execute(x,'try {await capabilities["fixture.read"]({value:"x"});}catch{} return await capabilities["fixture.read"]({value:"alternative"});');
  assert.equal(report.reason,'blocked');assert.equal(x.calls.length,0);assert.equal(report.actions.length,1);
  assert.equal(x.store.events().find(e=>e.kind==='fence').reason,'blocked');
  assert.throws(()=>execute(x,'return 1','after-policy'),/fenced/);
});

test('matching completed changes are normalized and do not ask for approval again',async t=>{
  let changes=0;
  const schema=dataSchema(z.object({value:z.string(),count:z.number().default(1)}));
  const cap=applicationCapability({description:'Synthetic normalized change',input:schema,output:schema,effect:{kind:'change',resource:call=>resourceScope({family:'synthetic',owner:call.context.botId,key:'same'})},checkScope:noop,invoke:async(call,input)=>{changes++;return input;}});
  const x=setup(t,{policy:()=> 'prompt',capabilities:{'fixture.change':cap}});
  const first=execute(x,'await capabilities["fixture.change"]({value:"once"}); throw Error("later failure");');
  const approval=await until(()=>x.approvals.list()[0]);x.approvals.decide(approval.id,'approve');await first;
  const next=await execute(x,'return await capabilities["fixture.change"]({count:1,value:"once",ignored:"not-a-new-effect"});','retry');
  assert.equal(changes,1);assert.equal(x.approvals.list().length,0);assert.equal(next.priorChanges.length,1);
});

test('invalid or throwing host policy fails closed for the whole request',async t=>{
  const x=setup(t,{policy:()=>undefined});
  const report=await execute(x,'try{await capabilities["fixture.read"]({value:"x"});}catch{} return 1;');
  assert.equal(report.reason,'blocked');assert.equal(x.calls.length,0);
  assert.throws(()=>execute(x,'return 1','later'),/fenced/);
});
