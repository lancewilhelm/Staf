import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startInstance } from './fixtures/controlled-instance.mjs';

const run=promisify(execFile);
test('another client can stop a pending response without admitting work until it settles',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-stop-')),credential=join(dir,'client.json');let release,signal;
 const gate=new Promise(resolve=>{release=resolve});
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:true},async *stream(_messages,_tools,options){signal=options.signal;yield {type:'text_delta',text:'Partial response. '};await gate;yield {type:'message',message:{role:'assistant',content:'Late answer'}};}});
 let app=startInstance(join(dir,'db'),0,{env:{},providerFactory:factory}),port=await app.listen();
 const url=()=>`http://127.0.0.1:${port}`,cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 const call=async(path,token,body)=>{const r=await fetch(url()+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 const wait=async fn=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out')};
 try{
  await cli('pair',url(),credential,app.code);const token=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const bot=(await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Ada'}))[1];
  assert.equal((await call('/api/commands',token,{id:'first',botId:bot.id,content:'first'}))[1].kind,'accepted');
  await wait(async()=>((await call('/api/commands/first',token))[1].responseProgress.text.includes('Partial response.')));
  assert.equal((await call('/api/commands/first/stop','',{}))[0],401);
  const stopped=JSON.parse(await cli('response-stop',url(),credential,'first'));assert.equal(stopped.state,'stopping');assert.equal(signal.aborted,true);
  assert.equal((await call('/api/commands/first/stop',token,{}))[1].state,'stopping');
  assert.equal((await call('/api/commands',token,{id:'next',botId:bot.id,content:'next draft'}))[1].kind,'busy');
  release();await wait(async()=>((await call('/api/commands/first',token))[1].state==='stopped'));
  const outcome=(await call('/api/commands/first',token))[1];assert.equal(outcome.responseProgress.state,'stopped');assert.match(outcome.responseProgress.text,/Partial response/);
  assert.equal((await call('/api/commands/first/stop',token,{}))[1].state,'stopped');
  assert.equal((await call('/api/commands',token,{id:'first',botId:bot.id,content:'first'}))[1].kind,'existing');
  assert.equal((await call('/api/commands',token,{id:'next',botId:bot.id,content:'next draft'}))[1].kind,'accepted');
  await wait(async()=>((await call('/api/commands/next',token))[1].state==='completed'));
  assert.equal((await call('/api/commands/next/stop',token,{}))[1].state,'completed');
  assert.equal((await call('/api/commands/first/stop',token,{}))[1].state,'stopped');
  assert.equal((await call('/api/commands/next',token))[1].state,'completed');
  const messages=(await call(`/api/bots/${bot.id}/messages`,token))[1];assert.ok(messages.some(m=>m.role==='assistant_stopped' && m.content.includes('Partial response')));assert.ok(!messages.some(m=>m.content==='Late answer' && m.role==='assistant' && messages.indexOf(m)<messages.findIndex(x=>x.content==='next draft')));
  await app.close();app=startInstance(join(dir,'db'),0,{env:{},providerFactory:factory});port=await app.listen();assert.equal((await call('/api/commands/first',token))[1].state,'stopped');
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart during stopping leaves an interrupted outcome without repeating the request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-stop-restart-')),path=join(dir,'db');let release,calls=0,entered;
 const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:false},async complete(){calls++;entered();await gate;throw Error('late failure');}});
 let app=startInstance(path,0,{env:{},providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try{
  const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Ada'});
  const input={id:'interrupted-stop',botId:bot.id,content:'Hold'};await call('/api/commands',token,input);await started;
  assert.equal((await call('/api/commands/interrupted-stop/stop',token,{})).state,'stopping');
  await app.close();release();app=startInstance(path,0,{env:{},providerFactory:factory});port=await app.listen();
  assert.equal((await call('/api/commands/interrupted-stop',token)).state,'interrupted');
  assert.equal((await call('/api/commands/interrupted-stop/stop',token,{})).state,'interrupted');
  assert.equal((await call('/api/commands',token,input)).kind,'existing');assert.equal(calls,1);
  const next=await call('/api/commands',token,{id:'after-restart',botId:bot.id,content:'Next'});assert.equal(next.kind,'accepted');
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
