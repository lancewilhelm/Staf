import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';
import {Instance} from '../dist/instance.js';
import {applicationCapability,dataSchema,resourceScope} from '../dist/code-mode/contract.js';
import {z} from 'zod';

async function eventually(read,accept=value=>!!value){for(let i=0;i<300;i++){const value=await read();if(accept(value))return value;await delay(10);}throw Error('Expected service state did not arrive');}
const echo=dataSchema(z.strictObject({value:z.string()}));
const scope=call=>resourceScope({family:'synthetic',owner:call.context.botId,key:call.context.sessionId});
async function fixture(t,{policy=()=> 'prompt',providerFail=false}={}) {
  let calls=0,offers=[];
  const capability=applicationCapability({description:'Echo synthetic data',input:echo,output:echo,effect:{kind:'read',resource:scope},checkScope:async()=>{},invoke:async(call,input)=>{calls++;return {value:input.value.toUpperCase()};}});
  const app=startInstance(':memory:',0,{env:{},codeModeLab:{capabilities:{'fixture.read':capability},policy},providerFactory:async()=>({name:'synthetic-code-mode',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages,tools){
    offers.push(tools.map(tool=>tool.function.name));
    const last=messages.at(-1);
    if(last.role==='tool'){
      if(providerFail)throw Error('Synthetic provider failure');
      const report=JSON.parse(last.content);return {role:'assistant',content:JSON.stringify({reason:report.reason,outputs:report.outputs})};
    }
    if(last.content==='ordinary')return {role:'assistant',content:'Ordinary synthetic chat'};
    return {role:'assistant',content:null,tool_calls:[{id:'code-call',type:'function',function:{name:'execute_code',arguments:JSON.stringify({source:'const read=await capabilities["fixture.read"]({value:"hello"}); await staf.emit({partial:read.value}); return {answer:read.value+"!"};'})}}]};
  }})});
  const port=await app.listen();
  t.after(()=>app.close());
  const call=async(route,token,body)=>{
    const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  const a=(await call('/api/pair','',{code:app.code})).body.token;
  const b=(await call('/api/pair','',{code:app.issueCode()})).body.token;
  const bot=(await call('/api/bots',a,{name:'Code lab'})).body;
  return {app,call,a,b,bot,get calls(){return calls;},offers};
}

test('synthetic provider uses only code, exact paired-client approval and actual retained results',async t=>{
  const x=await fixture(t);
  assert.equal((await x.call('/api/commands',x.a,{id:'approved',botId:x.bot.id,content:'tool'})).body.kind,'accepted');
  const approval=await eventually(async()=>(await x.call('/api/code-approvals',x.b)).body[0]);
  assert.deepEqual(approval.input,{value:'hello'});assert.equal(approval.commandId,'approved');assert.equal(x.calls,0);
  await x.call(`/api/code-approvals/${approval.id}/approve`,x.b,{});
  const command=await eventually(async()=>(await x.call('/api/commands/approved',x.a)).body,c=>c.state!=='pending');
  assert.equal(command.state,'completed');assert.equal(x.calls,1);
  const history=(await x.call('/api/commands/approved/code-mode',x.b)).body;
  assert.equal(history.actions[0].state,'succeeded');assert.deepEqual(history.events.filter(e=>e.kind==='output').map(e=>e.value),[{partial:'HELLO'},{answer:'HELLO!'}]);
  assert.ok(x.offers.every(names=>names.length===1&&names[0]==='execute_code'));
  const messages=(await x.call(`/api/bots/${x.bot.id}/messages`,x.b)).body;
  assert.match(messages.at(-1).content,/HELLO!/);
});

test('ordinary chat starts no guest and a second paired client stops approval-blocked code',async t=>{
  const x=await fixture(t);
  await x.call('/api/commands',x.a,{id:'plain',botId:x.bot.id,content:'ordinary'});
  await eventually(async()=>(await x.call('/api/commands/plain',x.a)).body,c=>c.state==='completed');
  assert.deepEqual((await x.call('/api/commands/plain/code-mode',x.a)).body.events,[]);
  await x.call('/api/commands',x.a,{id:'stopped',botId:x.bot.id,content:'tool'});
  const approval=await eventually(async()=>(await x.call('/api/code-approvals',x.b)).body[0]);
  assert.equal((await x.call('/api/commands/stopped/stop',x.b,{})).body.state,'stopping');
  await eventually(async()=>(await x.call('/api/commands/stopped',x.a)).body,c=>c.state==='stopped');
  assert.equal(x.calls,0);assert.equal((await x.call(`/api/code-approvals/${approval.id}/approve`,x.a,{})).status,404);
  const history=(await x.call('/api/commands/stopped/code-mode',x.b)).body;
  assert.equal(history.actions[0].state,'cancelled');assert.equal(history.events.find(e=>e.kind==='end').reason,'stopped');
});

test('denial disables all tools on the final provider request and keeps the denied action',async t=>{
  const x=await fixture(t);
  await x.call('/api/commands',x.a,{id:'denied',botId:x.bot.id,content:'tool'});
  const approval=await eventually(async()=>(await x.call('/api/code-approvals',x.b)).body[0]);
  await x.call(`/api/code-approvals/${approval.id}/deny`,x.b,{});
  const command=await eventually(async()=>(await x.call('/api/commands/denied',x.a)).body,c=>c.state!=='pending');
  assert.equal(command.state,'completed');assert.deepEqual(x.offers,[['execute_code'],[]]);assert.equal(x.calls,0);
});

test('selected source, child outcomes and actual values survive a later provider failure',async t=>{
  const x=await fixture(t,{policy:()=> 'allow',providerFail:true});
  await x.call('/api/commands',x.a,{id:'failed',botId:x.bot.id,content:'tool'});
  const command=await eventually(async()=>(await x.call('/api/commands/failed',x.a)).body,c=>c.state!=='pending');
  assert.equal(command.state,'failed');
  const history=(await x.call('/api/commands/failed/code-mode',x.b)).body;
  assert.equal(history.actions[0].state,'succeeded');assert.equal(history.events.find(e=>e.kind==='execution').source.includes('capabilities'),true);
  assert.deepEqual(history.events.filter(e=>e.kind==='output').map(e=>e.value),[{partial:'HELLO'},{answer:'HELLO!'}]);
});

test('killed service restarts interrupted with uncertain change and no program replay',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'staf-code-restart-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'instance.sqlite');
  const child=spawn(process.execPath,['test/fixtures/code-mode-crash.mjs',path],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill('SIGKILL'));
  const ready=new Promise((resolve,reject)=>{let out='';child.stdout.on('data',chunk=>{out+=chunk;if(out.includes('effect-started'))resolve();});child.once('error',reject);child.once('exit',code=>reject(Error(`Crash fixture exited early: ${code}`)));});
  let timeout;try{await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Crash fixture timed out')),5000);})]);}finally{clearTimeout(timeout);}
  const closed=once(child,'close');child.kill('SIGKILL');await closed;
  const instance=new Instance(path);t.after(()=>instance.close());
  assert.equal(instance.command('crash-command').state,'interrupted');
  const history=instance.codeModeHistory('crash-command');assert.equal(history.interrupted,true);
  assert.equal(history.actions[0].state,'uncertain');assert.deepEqual(history.events.filter(e=>e.kind==='output').map(e=>e.value),[{partial:'kept'}]);
  assert.throws(()=>instance.execution('crash-command'),/not pending/);
});
