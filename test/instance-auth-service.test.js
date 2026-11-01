import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

test('paired initiator owns sign-in and callback is bound to the active loopback attempt',async()=>{
 let completed=0;const authHooks={prepare:async()=>({hostId:'urn:uuid:test',clientId:'synthetic-client'}),complete:async(_root,attempt,callback,_fetch,signal,beforeCommit)=>{assert.equal(callback.searchParams.get('state'),attempt.state);signal.throwIfAborted();await beforeCommit();completed++;}};
 const app=startInstance(':memory:',0,{env:{},authHooks}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{
  assert.equal((await call('/api/codex-auth/start','',{}))[0],401);
  const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  assert.deepEqual((await call('/api/codex-auth/current',a))[1],{attempt:null});
  const attempt=(await call('/api/codex-auth/start',a,{}))[1],url=new URL(attempt.url);
  const recovered=(await call('/api/codex-auth/current',a))[1];assert.equal(recovered.attempt.id,attempt.id);assert.equal(recovered.attempt.phase,'waiting');assert.equal('url' in recovered.attempt,false);assert.deepEqual((await call('/api/codex-auth/current',b))[1],{attempt:null});
  assert.equal(url.searchParams.get('redirect_uri'),`http://127.0.0.1:${port}/auth/callback`);assert.equal((await call(`/api/codex-auth/${attempt.id}`,b))[0],404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=secret&state=wrong`)).status,400);assert.equal(completed,0);
  const state=url.searchParams.get('state');const response=await fetch(`http://127.0.0.1:${port}/auth/callback?code=secret&state=${state}`);assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/secret|state/);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(completed,1);
  assert.equal((await call(`/api/codex-auth/${attempt.id}`,a))[1].phase,'succeeded');assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=secret&state=${state}`)).status,400);assert.equal(completed,1);
  const second=(await call('/api/codex-auth/start',a,{}))[1];const afterReload=(await call('/api/codex-auth/current',a))[1].attempt;assert.equal(afterReload.id,second.id);assert.deepEqual((await call('/api/codex-auth/current',b))[1],{attempt:null});assert.equal((await call(`/api/codex-auth/${second.id}/cancel`,b,{}))[0],404);assert.equal((await call(`/api/codex-auth/${second.id}/cancel`,a,{}))[1].phase,'cancelled');const secondState=new URL(second.url).searchParams.get('state');assert.equal((await fetch(`http://127.0.0.1:${port}/auth/callback?code=secret&state=${secondState}`)).status,400);assert.equal(completed,1);
 }finally{await app.close();}
});

test('revoking the initiating client interrupts sign-in before credential commit',async()=>{
 let release,entered,commits=0;const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const authHooks={prepare:async()=>({hostId:'urn:uuid:test',clientId:'synthetic-client'}),complete:async(_root,_attempt,_callback,_fetch,signal,beforeCommit)=>{entered();await gate;signal.throwIfAborted();await beforeCommit();commits++;}};
 const app=startInstance(':memory:',0,{env:{},authHooks}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;const attempt=(await call('/api/codex-auth/start',a,{}))[1],state=new URL(attempt.url).searchParams.get('state');const callback=fetch(`http://127.0.0.1:${port}/auth/callback?code=secret&state=${state}`);await started;
  const clients=(await call('/api/clients',a))[1],id=clients.find(client=>client.current).id;assert.equal((await call(`/api/clients/${id}/revoke`,b,{}))[0],200);release();assert.equal((await callback).status,400);assert.equal(commits,0);assert.equal((await call(`/api/codex-auth/${attempt.id}`,a))[0],401);
 }finally{release();await app.close();}
});

test('owner recovers a sign-in even when refresh occurs during preparation',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const authHooks={prepare:async()=>{entered();await gate;return {hostId:'urn:uuid:test',clientId:'synthetic-client'};},complete:async()=>{throw Error('Not used');}};
 const app=startInstance(':memory:',0,{env:{},authHooks}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const starting=call('/api/codex-auth/start',a,{});await started;const recovery=call('/api/codex-auth/current',a);assert.deepEqual((await call('/api/codex-auth/current',b))[1],{attempt:null});release();const attempt=(await starting)[1];assert.equal((await recovery)[1].attempt.id,attempt.id);assert.equal((await call(`/api/codex-auth/${attempt.id}/cancel`,a,{}))[1].phase,'cancelled');
 }finally{release();await app.close();}
});

test('expired unresolved preparation cannot hide a newer attempt from its owner',async()=>{
 let release,entered,now=0,calls=0;const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const authHooks={prepare:async()=>{if(++calls===1){entered();await gate;}return {hostId:'urn:uuid:test',clientId:'synthetic-client'};},complete:async()=>{throw Error('Not used');}};
 const app=startInstance(':memory:',0,{env:{},authHooks,authNow:()=>now,authLifetimeMs:100}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const first=call('/api/codex-auth/start',a,{});await started;const old=(await call('/api/codex-auth/current',a))[1].attempt;assert.equal(old.phase,'waiting');now=101;
  const second=(await call('/api/codex-auth/start',a,{}))[1];assert.notEqual(second.id,old.id);const current=(await call('/api/codex-auth/current',a))[1].attempt;assert.equal(current.id,second.id);assert.equal(current.phase,'waiting');assert.deepEqual((await call('/api/codex-auth/current',b))[1],{attempt:null});
  assert.equal((await call(`/api/codex-auth/${second.id}/cancel`,a,{}))[1].phase,'cancelled');release();assert.equal((await first)[0],400);assert.equal((await call('/api/codex-auth/current',a))[1].attempt.id,second.id);
 }finally{release();await app.close();}
});

test('paired sign-out removes only the instance-owned credential and returns no token', async () => {
 const {mkdirSync,writeFileSync,existsSync,mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'staf-logout-'));mkdirSync(join(dir,'auth'));const path=join(dir,'auth','codex-direct.json');
 writeFileSync(path,JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'dummy',clientId:'dummy',hostId:'dummy',accessToken:'dummy-secret',refreshToken:'dummy-refresh',idToken:'dummy-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}),{mode:0o600});
 const app=startInstance(join(dir,'db'),0,{dataDir:dir,env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 try{const token=(await call('/api/pair',null,{code:app.code}))[1].token;assert.equal((await call('/api/codex-auth/credential',token))[1].signedIn,true);assert.equal((await call('/api/codex-auth/logout',null,{}))[0],401);const [status,result]=await call('/api/codex-auth/logout',token,{});assert.equal(status,200);assert.deepEqual(result,{signedIn:false});assert.equal(existsSync(path),false);assert.equal((await call('/api/codex-auth/credential',token))[1].signedIn,false);assert.ok(!JSON.stringify(result).includes('dummy'));}
 finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('another paired client cannot sign out during waiting or committing sign-in', async () => {
 let release,entered;const gate=new Promise(resolve=>{release=resolve}),committing=new Promise(resolve=>{entered=resolve});
 const authHooks={prepare:async()=>({hostId:'urn:uuid:test',clientId:'test'}),complete:async(_root,_attempt,_callback,_fetch,_signal,beforeCommit)=>{await beforeCommit();entered();await gate;}};
 const app=startInstance(':memory:',0,{env:{},authHooks}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 try{const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;const attempt=(await call('/api/codex-auth/start',a,{}))[1];assert.equal((await call('/api/codex-auth/logout',b,{}))[0],409);
  const state=new URL(attempt.url).searchParams.get('state'),callback=fetch(`http://127.0.0.1:${port}/auth/callback?code=synthetic&state=${state}`);await committing;
  assert.equal((await call(`/api/codex-auth/${attempt.id}`,a))[1].phase,'committing');assert.equal((await call('/api/codex-auth/logout',b,{}))[0],409);release();assert.equal((await callback).status,200);
 }finally{release();await app.close();}
});

test('sign-out cannot race an in-flight synthetic model-discovery token refresh', async () => {
 const {mkdtempSync,rmSync,mkdirSync,writeFileSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'staf-refresh-logout-'));mkdirSync(join(dir,'auth'));const path=join(dir,'auth','codex-direct.json');
 writeFileSync(path,JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'dummy',clientId:'dummy',hostId:'dummy',accessToken:'old-token',refreshToken:'old-refresh',idToken:'dummy-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()-1000}),{mode:0o600});
 let release,entered;const gate=new Promise(resolve=>{release=resolve}),refreshing=new Promise(resolve=>{entered=resolve});const original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('http://127.0.0.1:'))return original(input,init);if(url==='https://auth.openai.com/api/accounts/oauth/token'){entered();await gate;return Response.json({access_token:'new-token',refresh_token:'new-refresh',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});}if(url==='https://api.openai.com/v1/models')return Response.json({models:[{slug:'fixture'}]});throw Error('Unexpected network');};
 const app=startInstance(join(dir,'db'),0,{dataDir:dir,env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 try{const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token,bot=(await call('/api/bots',a,{name:'A'}))[1];await call(`/api/bots/${bot.id}/profile`,a,{revision:bot.revision,name:'A',instructions:'',provider:'codex',model:'fixture',reasoning:null});
  const discovery=call(`/api/bots/${bot.id}/models`,a,{});await refreshing;assert.equal((await call('/api/codex-auth/logout',b,{}))[0],409);release();assert.equal((await discovery)[0],200);assert.equal((await call('/api/codex-auth/logout',b,{}))[0],200);assert.equal(existsSync(path),false);
 }finally{release();await app.close();globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});}
});
