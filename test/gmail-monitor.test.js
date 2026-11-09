import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startInstance} from '../dist/instance-service.js';

const until=async fn=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

test('service baselines on connection, persists new candidates once, and reports an expired history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-monitor-')),path=join(dir,'db');let historyCalls=0,expired=false,offline=false;
 const gmailRequest=async url=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});
  if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'100'});
  if(u.pathname.endsWith('/history')){historyCalls++;if(expired)return new Response('',{status:404});if(offline)return new Response('',{status:503});return Response.json({historyId:'101',history:[{messagesAdded:[{message:{id:'candidate-a'}},{message:{id:'candidate-a'}}]}]});}
  throw Error('Unexpected Gmail request');
 };
 let app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const [code,attempt]=await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-secret'});assert.equal(code,200);
  const u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  let gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.monitor.cursor,'100');assert.deepEqual(gmail.arrivals,[]);
  assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],400);assert.equal(historyCalls,0);
  assert.equal((await call('/api/plugins/gmail/enable',token,{}))[0],200);
  assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],200);assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],200);
  gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.deepEqual(gmail.arrivals.map(x=>x.messageId),['candidate-a']);assert.equal(gmail.monitor.cursor,'101');assert.equal(gmail.arrivals[0].inbox,'unknown');assert.deepEqual(gmail.runs.map(run=>run.outcome),['completed','completed']);
  await app.close();app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000});port=await app.listen();
  gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.deepEqual(gmail.arrivals.map(x=>x.messageId),['candidate-a']);assert.equal(gmail.monitor.cursor,'101');
  offline=true;assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],400);assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],400);offline=false;assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],200);
  expired=true;assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],400);gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.monitor.state,'uncertain');assert.match(gmail.monitor.detail,/unknown/i);assert.deepEqual(gmail.runs.map(run=>run.outcome),['uncertain','completed','failed','failed','completed','completed']);
  await call('/api/plugins/gmail/disable',token,{});const before=historyCalls;assert.equal((await call('/api/plugins/gmail/poll',token,{}))[0],400);assert.equal(historyCalls,before);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('automatic polling fences a delayed event after disable and resumes it after re-enable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-delay-')),path=join(dir,'db');let release,started,hold=true,calls=0;
 const gate=new Promise(resolve=>{release=resolve}),waiting=new Promise(resolve=>{started=resolve});
 const gmailRequest=async url=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});if(u.pathname.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'10'});if(u.pathname.endsWith('/history')){calls++;if(hold){started();await gate;}return Response.json({historyId:'11',history:[{messagesAdded:[{message:{id:'late'}}]}]});}throw Error('Unexpected');};
 let app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:20}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token,attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  await call('/api/plugins/gmail/enable',token,{});await waiting;await call('/api/plugins/gmail/disable',token,{});hold=false;release();
  await new Promise(resolve=>setTimeout(resolve,50));let gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.deepEqual(gmail.arrivals,[]);assert.equal(gmail.monitor.cursor,'10');const before=calls;
  await new Promise(resolve=>setTimeout(resolve,60));assert.equal(calls,before);
  await call('/api/plugins/gmail/enable',token,{});gmail=await until(async()=>{const value=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');return value.arrivals.length&&value;});assert.equal(gmail.arrivals[0].messageId,'late');
  await app.close();app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000});port=await app.listen();gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.arrivals.length,1);assert.equal(gmail.monitor.cursor,'11');
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a schema 42 connection has an explicit gap when monitoring is started later',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-upgrade-')),path=join(dir,'db');
 const gmailRequest=async url=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
 let app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token,attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  await app.close();const db=new DatabaseSync(path);db.exec('DROP TABLE gmail_history; DROP TABLE gmail_arrivals; DROP TABLE gmail_history_gaps; DROP TABLE gmail_model_access; DROP TABLE gmail_private_commands; DROP TABLE gmail_private_messages; PRAGMA user_version=42');db.close();
  app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000});port=await app.listen();let gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.connected,true);assert.equal(gmail.monitor,null);
  assert.equal((await call('/api/plugins/gmail/rebaseline',token,{}))[0],400);assert.equal((await call('/api/plugins/gmail/rebaseline',token,{confirm:true}))[0],200);
  gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.monitor.cursor,'100');assert.match(gmail.gaps[0].reason,/after the account was connected/i);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 45 migration preserves history and marks an unfinished scan interrupted after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-run-migration-')),path=join(dir,'db');
 const gmailRequest=async url=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'access',refresh_token:'refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
 let app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token,attempt=(await call('/api/plugins/gmail/start',token,{email:'owner@example.test',clientId:'synthetic.apps.googleusercontent.com',clientSecret:'secret'}))[1],u=new URL(attempt.url),cb=new URL(u.searchParams.get('redirect_uri'));cb.searchParams.set('state',u.searchParams.get('state'));cb.searchParams.set('code','code');assert.equal((await fetch(cb)).status,200);
  await app.close();let db=new DatabaseSync(path);db.exec('DROP TABLE gmail_monitor_runs; PRAGMA user_version=45');db.close();
  app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000});port=await app.listen();let gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.monitor.cursor,'100');assert.deepEqual(gmail.runs,[]);
  await app.close();db=new DatabaseSync(path);db.prepare("INSERT INTO gmail_monitor_runs (account_id,started_at,outcome) VALUES (?,?,'running')").run('owner@example.test',123);db.close();
  app=startInstance(path,0,{env:{},gmailRequest,gmailPollIntervalMs:3600000});port=await app.listen();gmail=(await call('/api/plugins',token))[1].find(x=>x.id==='gmail');assert.equal(gmail.monitor.cursor,'100');assert.equal(gmail.runs[0].outcome,'interrupted');assert.equal(gmail.runs[0].startedAt,123);assert.equal(typeof gmail.runs[0].finishedAt,'number');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
