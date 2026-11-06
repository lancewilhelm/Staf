import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';
import { demoProvider } from './fixtures/echo-provider.mjs';

test('paired discovery reports ambiguous and busy bots without exposing private instructions', async () => {
 let release; const gate=new Promise(resolve=>{release=resolve});
 const providerFactory=async()=>({...demoProvider,async complete(...args){await gate;return demoProvider.complete(...args)}});
 const app=startInstance(':memory:',0,{env:{},providerFactory}); const port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {
  assert.equal((await call('/api/bot-discovery',null,{requesterId:'x',query:'x'}))[0],401);
  const token=(await call('/api/pair',null,{code:app.code}))[1].token;
  const requester=(await call('/api/bots',token,{provider:'demo',name:'Owner'}))[1];
  const first=(await call('/api/bots',token,{provider:'demo',name:'Researcher',instructions:'private secret'}))[1];
  const second=(await call('/api/bots',token,{provider:'demo',name:'Researcher'}))[1];
  const profile={revision:second.revision,name:second.name,description:'Historical archives',instructions:second.instructions,provider:second.provider,model:second.model,reasoning:second.reasoning};
  assert.equal((await call(`/api/bots/${second.id}/profile`,token,profile))[0],200);
  assert.equal((await call(`/api/bots/${second.id}/profile`,token,profile))[0],409);
  assert.equal((await call('/api/bot-discovery',token,{requesterId:requester.id,query:'archives'}))[1].candidates[0].id,second.id);
  await call('/api/commands',token,{id:'busy',botId:first.id,content:'work'});
  const [status,result]=await call('/api/bot-discovery',token,{requesterId:requester.id,query:'Researcher'});
  assert.equal(status,200); assert.equal(result.kind,'ambiguous'); assert.equal(result.total,2);
  assert.equal(result.candidates.find(bot=>bot.id===first.id).availability,'busy');
  assert.equal(result.candidates.find(bot=>bot.id===second.id).availability,'active');
  assert.doesNotMatch(JSON.stringify(result),/private secret/);
  assert.equal((await call('/api/bot-discovery',token,{requesterId:requester.id,query:'private'}))[1].kind,'no-match');
  assert.equal((await call('/api/bot-discovery',token,{requesterId:'missing',query:'Researcher'}))[0],404);
 } finally {release();await app.close();}
});

test('paired task acceptance records only an explicit boolean helper clock scope', async () => {
 const app=startInstance(':memory:',0,{env:{}}); const port=await app.listen();
 const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},body:JSON.stringify(body)});return [response.status,await response.json()];};
 try {
  const token=(await call('/api/pair',null,{code:app.code}))[1].token;
  const bot=(await call('/api/bots',token,{provider:'demo',name:'Owner'}))[1];
  const task={id:'bad',botId:bot.id,objective:'Task',delegateClock:'true'};
  assert.equal((await call('/api/tasks',token,task))[0],400);
  const [status,result]=await call('/api/tasks',token,{...task,id:'good',delegateClock:true});
  assert.equal(status,200);assert.equal(result.attempt.delegationClock,1);
 } finally {await app.close();}
});
