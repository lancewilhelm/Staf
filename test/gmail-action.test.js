import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

const until=async read=>{for(let i=0;i<500;i++){const result=await read();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
test('Gmail actions require explicit model permission and private results are not replayed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-action-')),path=join(dir,'db'),seen=[];let mailCalls=0;
 const gmailRequest=async url=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'100'});if(u.pathname.endsWith('/messages')){mailCalls++;return Response.json({messages:[{id:'mail1'}]});}if(u.pathname.endsWith('/messages/mail1')){mailCalls++;return Response.json({id:'mail1',snippet:'PRIVATE FIXTURE',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Synthetic message'}],body:{data:Buffer.from('PRIVATE FIXTURE BODY').toString('base64url')}}});}throw Error('Unexpected request');};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false},async complete(messages,tools,options){
  seen.push({messages:structuredClone(messages),tools:tools.map(t=>t.function.name),input:options.currentUserInput});
  if(options.currentUserInput!=='Find fixture')return {role:'assistant',content:'No Gmail request.'};
  const after=messages.slice(messages.findLastIndex(m=>m.role==='user')+1),results=after.filter(m=>m.role==='tool');
  if(results.length===0)return {role:'assistant',content:null,tool_calls:[{id:'search',type:'function',function:{name:'gmail_search',arguments:JSON.stringify({query:'older'})}}]};
  if(results.length===1)return {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'gmail_read',arguments:JSON.stringify({messageId:'mail1'})}}]};
  assert.match(results[1].content,/PRIVATE FIXTURE BODY/);return {role:'assistant',content:'Summary PRIVATE FIXTURE BODY'};
 }});
 const app=startInstance(path,0,{env:{},gmailRequest,providerFactory,gmailPollIntervalMs:3600000}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Reader',provider:'live',model:'fixture-model',toolMode:'direct'}))[1];
  const attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret'}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/gmail/enable',token,{});
  await call('/api/commands',token,{id:'before-grant',botId:bot.id,content:'No access'});await until(async()=>{const item=(await call('/api/commands/before-grant',token))[1];return item.state!=='pending'&&item;});assert.ok(!seen.at(-1).tools.includes('gmail_read'));assert.equal(mailCalls,0);
  assert.equal((await call('/api/plugins/gmail/model-access',token,{botId:bot.id,provider:'live',model:'other-model',enabled:true}))[0],400);
  assert.equal((await call('/api/plugins/gmail/model-access',token,{botId:bot.id,provider:'live',model:'fixture-model',enabled:true}))[0],200);
  await call('/api/commands',token,{id:'gmail-read',botId:bot.id,content:'Find fixture'});const work=await until(async()=>{const item=(await call('/api/commands/gmail-read',token))[1];return item.state!=='pending'&&item;});assert.equal(work.state,'completed',work.error);assert.equal(work.workActions.filter(x=>x.state==='succeeded').length,2);assert.equal(mailCalls,2);
  assert.ok(seen.some(item=>JSON.stringify(item.messages).includes('PRIVATE FIXTURE BODY')));
  const afterGmail=seen.filter(item=>item.input==='Find fixture' && item.messages.some(m=>m.role==='tool'));assert.ok(afterGmail.every(item=>item.tools.every(name=>['gmail_search','gmail_read'].includes(name))));
  await call('/api/plugins/gmail/model-access',token,{botId:bot.id,provider:'live',model:'fixture-model',enabled:false});
  await call('/api/commands',token,{id:'after-revoke',botId:bot.id,content:'No access'});const later=await until(async()=>{const item=(await call('/api/commands/after-revoke',token))[1];return item.state!=='pending'&&item;});assert.equal(later.state,'completed');assert.doesNotMatch(JSON.stringify(seen.at(-1).messages),/PRIVATE FIXTURE/);assert.ok(!seen.at(-1).tools.includes('gmail_read'));
  await call('/api/tasks',token,{id:'after-gmail-task',botId:bot.id,objective:'Other task'});const task=await until(async()=>{const item=(await call('/api/tasks/after-gmail-task',token))[1];return item.state!=='queued'&&item.state!=='running'&&item;});assert.equal(task.state,'completed');assert.doesNotMatch(JSON.stringify(seen.at(-1).messages),/PRIVATE FIXTURE/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoking agent access during a delayed Gmail search prevents release to the model',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-action-revoke-')),received=[];let release,started;
 const gate=new Promise(resolve=>{release=resolve}),waiting=new Promise(resolve=>{started=resolve});
 const gmailRequest=async url=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'10'});if(u.pathname.endsWith('/messages')){started();await gate;return Response.json({messages:[{id:'secret-mail'}]});}throw Error('Unexpected');};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false},async complete(messages){received.push(structuredClone(messages));return {role:'assistant',content:null,tool_calls:[{id:'search',type:'function',function:{name:'gmail_search',arguments:'{"query":"test"}'}}]};}});
 const app=startInstance(join(dir,'db'),0,{env:{},gmailRequest,providerFactory,gmailPollIntervalMs:3600000}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Reader',provider:'live',model:'fixture-model',toolMode:'direct'}))[1];
  const attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/gmail/enable',token,{});await call('/api/plugins/gmail/model-access',token,{botId:bot.id,provider:'live',model:'fixture-model',enabled:true});
  await call('/api/commands',token,{id:'revoke-during-read',botId:bot.id,content:'Search mail'});await waiting;await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:false});release();
  const work=await until(async()=>{const item=(await call('/api/commands/revoke-during-read',token))[1];return item.state!=='pending'&&item;});assert.notEqual(work.state,'completed');assert.doesNotMatch(JSON.stringify(received),/secret-mail/);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
