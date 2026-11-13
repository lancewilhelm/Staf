import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startInstance} from '../dist/instance-service.js';

test('paired owner connects Gmail with PKCE, manages agent access, and retains settings across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-plugin-')),path=join(dir,'db'),requests=[];let rejectRefresh=false;
 const gmailRequest=async(url,options)=>{
  const u=new URL(url);requests.push({u,options});
  if(u.hostname==='oauth2.googleapis.com'){if(rejectRefresh && new URLSearchParams(options.body).get('grant_type')==='refresh_token')return new Response('',{status:401});return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});}
  if(u.hostname==='gmail.googleapis.com')return Response.json({emailAddress:'owner@example.test',historyId:'100'});
  throw Error('unexpected host');
 };
 let app=startInstance(path,0,{env:{},gmailRequest}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const bot=(await call('/api/bots',token,{name:'Gmail agent',provider:'live',model:'fixture'}))[1];
  let gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,false);
  const [status,attempt]=await call('/api/plugins/gmail/start',token,{confirm:true,email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret'});assert.equal(status,200);
  const authorization=new URL(attempt.url);assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  const redirect=new URL(authorization.searchParams.get('redirect_uri'));redirect.searchParams.set('state',authorization.searchParams.get('state'));redirect.searchParams.set('code','synthetic-code');
  assert.equal((await fetch(redirect)).status,200);
  const exchange=new URLSearchParams(requests[0].options.body);assert.equal(createHash('sha256').update(exchange.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));assert.equal(exchange.get('client_secret'),'synthetic-secret');
  assert.equal(statSync(join(dir,'secrets','credentials.sqlite')).mode & 0o777,0o600);
  assert.equal((await call('/api/secret-grants',token))[1].filter(item=>item.integration.startsWith('gmail.')).length,2);
  gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,true);assert.equal(gmail.enabled,false);assert.equal(gmail.accountId,'owner@example.test');assert.deepEqual(gmail.agentAccessIds,[]);
  assert.doesNotMatch(JSON.stringify(gmail),/synthetic-secret|synthetic-refresh|synthetic-access/);
  assert.equal((await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:true}))[0],200);
  rejectRefresh=true;assert.equal((await call('/api/plugins/gmail/enable',token,{}))[0],400);gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.enabled,false);assert.equal(gmail.status,'Connection check failed');rejectRefresh=false;
  assert.equal((await call('/api/plugins/gmail/enable',token,{}))[0],200);
  await app.close();app=startInstance(path,0,{env:{},gmailRequest});port=await app.listen();
  gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.enabled,true);assert.deepEqual(gmail.agentAccessIds,[bot.id]);
  const beforeControls=requests.length;await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:false});gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.deepEqual(gmail.agentAccessIds,[]);await call('/api/plugins/gmail/access',token,{botId:bot.id,enabled:true});
  await call('/api/plugins/gmail/disable',token,{});gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,true);assert.equal(gmail.enabled,false);assert.deepEqual(gmail.agentAccessIds,[bot.id]);
  await call('/api/plugins/gmail/disconnect',token,{});gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,false);assert.equal(gmail.status,'Not connected');assert.equal(gmail.accountId,'owner@example.test');
  assert.equal(requests.length,beforeControls);
  assert.equal((await call('/api/plugins/gmail/enable',token,{}))[0],400);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid OAuth state and a different Gmail account cannot connect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-invalid-')),requests=[];
 const gmailRequest=async(url,options)=>{requests.push({url,options});return new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'access',refresh_token:'refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'}):Response.json({emailAddress:'other@example.test',historyId:'20'});};
 const app=startInstance(join(dir,'db'),0,{env:{},gmailRequest}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const attempt=(await call('/api/plugins/gmail/start',token,{confirm:true,email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1];
  const u=new URL(attempt.url),callback=new URL(u.searchParams.get('redirect_uri'));callback.searchParams.set('state','wrong');callback.searchParams.set('code','code');assert.equal((await fetch(callback)).status,400);assert.equal(requests.length,0);
  callback.searchParams.set('state',u.searchParams.get('state'));assert.equal((await fetch(callback)).status,400);
  const gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,false);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('disconnect while token exchange is pending fences the callback and profile request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-cancel-'));let release,started,profileCalls=0;
 const gate=new Promise(resolve=>{release=resolve}),waiting=new Promise(resolve=>{started=resolve});
 const gmailRequest=async(url)=>{if(new URL(url).hostname==='oauth2.googleapis.com'){started();await gate;return Response.json({access_token:'access',refresh_token:'refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});}profileCalls++;return Response.json({emailAddress:'owner@example.test',historyId:'20'});};
 const app=startInstance(join(dir,'db'),0,{env:{},gmailRequest}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [response.status,await response.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const attempt=(await call('/api/plugins/gmail/start',token,{confirm:true,email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1],u=new URL(attempt.url),callback=new URL(u.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',u.searchParams.get('state'));callback.searchParams.set('code','code');const pending=fetch(callback);await waiting;
  assert.equal((await call('/api/plugins/gmail/disconnect',token,{}))[0],200);release();assert.equal((await pending).status,400);assert.equal(profileCalls,0);
  assert.equal((await call('/api/plugins',token))[1].find(x=>x.id==='gmail').connected,false);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
