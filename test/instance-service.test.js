import {routerStream} from './openrouter-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startInstance } from '../dist/instance-service.js';
import { Instance } from '../dist/instance.js';

test('creation operation retries across restart with copied defaults and optional provider', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-create-retry-')),path=join(dir,'db');let app=startInstance(path,0,{env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const [status,bot]=await call('/api/bots',token,{provider:'demo',operationId:'retry-name',name:'Ada'});assert.equal(status,201);
  const defaults=(await call('/api/creation-defaults',token))[1];await call('/api/creation-defaults',token,{revision:defaults.revision,provider:'openrouter',model:'new/model',reasoning:'high'});
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  const retry=await call('/api/bots',token,{provider:'demo',operationId:'retry-name',name:'Ada'});assert.equal(retry[1].id,bot.id);assert.equal(retry[1].provider,'openrouter');
  assert.equal((await call('/api/bots',token,{provider:'demo',operationId:'retry-name',name:'Changed'}))[0],409);
  const custom=await call('/api/bots',token,{operationId:'custom',name:'Ada',provider:'lmstudio',model:'local',instructions:'Help'});assert.equal(custom[0],201);assert.equal(custom[1].provider,'lmstudio');assert.equal(custom[1].model,'local');assert.equal(custom[1].reasoning,null);assert.notEqual(custom[1].id,bot.id);
  const unkeyed=await call('/api/bots',token,{name:'Ada',provider:'lmstudio',model:'local',instructions:'Help'});assert.equal(unkeyed[1].reasoning,custom[1].reasoning);
  assert.equal((await call('/api/bots',token))[1].length,3);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('archive and concurrent chat or task acceptance cannot both win',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});
 const app=startInstance(':memory:',0,{providerFactory:async()=>({name:'held',capabilities:{toolCalls:false},async complete(){await gate;return {role:'assistant',content:'done'}}})});const port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try{
  const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  for(const kind of ['commands','tasks'])for(let n=0;n<4;n++){
   const bot=(await call('/api/bots',a,{provider:'demo',name:`${kind}-${n}`}))[1];
   const work=kind==='commands'?{id:`chat-${n}`,botId:bot.id,content:'Hello'}:{id:`task-${n}`,botId:bot.id,objective:'Work'};
   const archive=()=>call(`/api/bots/${bot.id}/archive`,a,{revision:bot.revision}),submit=()=>call('/api/'+kind,b,work);
   const results=await Promise.all(n%2?[submit(),archive()]:[archive(),submit()]);const [archived,accepted]=n%2?[results[1],results[0]]:results;
   assert.notEqual(archived[0]===200,accepted[1].kind==='accepted');
   if(archived[0]===200){assert.equal(accepted[0],409);assert.equal((await call(`/api/bots/${bot.id}`,a))[1].archived,true)}else assert.equal(archived[0],409);
  }
 }finally{release();await app.close();}
});

test('instance workspace stylesheet is served from the same origin under its CSP', async () => {
 const app=startInstance(':memory:'); const port=await app.listen();
 try {
  const page=await fetch(`http://127.0.0.1:${port}/`); const html=await page.text();
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /style-src[^;]*'unsafe-inline'/);
  const cssPath=html.match(/href="(\/assets\/[^" ]+\.css)"/)?.[1]; assert.ok(cssPath);
  const css=await fetch(`http://127.0.0.1:${port}${cssPath}`);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  assert.match(await css.text(), /\.workspace/);
 } finally { await app.close(); }
});

test('paired clients share records and credentials survive restart', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-http-')), path=join(dir,'db'); let app=startInstance(path); let port=await app.listen();
 const call=async (route,token,body,origin)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try {
  assert.equal((await call('/api/bots'))[0],401);
  assert.equal((await call('/api/pair',null,{code:app.code},'http://evil.example'))[0],403);
  assert.throws(()=>new Instance(path));
  const code=app.code; const a=(await call('/api/pair',null,{code}))[1].token;
  assert.equal((await call('/api/pair',null,{code}))[0],403);
  const b=(await call('/api/pair',null,{code:app.issueCode()}))[1].token;
  const bot=(await call('/api/bots',a,{provider:'demo',name:'Ada',instructions:'Be concise'}))[1];
  assert.equal((await call('/api/bots',b))[1][0].id,bot.id);
  assert.equal((await call('/api/commands',a,{id:'one',botId:bot.id,content:'hello'}))[1].kind,'accepted');
  const state=(await call('/api/commands/one',b))[1]; assert.equal(state.state,'completed');
  assert.equal((await call('/api/commands',b,{id:'one',botId:bot.id,content:'different'}))[0],400);
  await app.close(); app=startInstance(path); port=await app.listen();
  assert.equal((await call('/api/bots',a))[1][0].name,'Ada');
  assert.equal((await call('/api/bots',a))[1][0].instructions,'Be concise');
  assert.deepEqual((await call(`/api/bots/${bot.id}/messages`,b))[1].map(x=>x.role),['user','assistant']);
  assert.equal((await call('/api/commands/one',b))[1].state,'completed');
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('competing client keeps its unsent message while the bot is busy', async () => {
 const {demoProvider}=await import('./fixtures/echo-provider.mjs');
 let release; const gate=new Promise(resolve=>{release=resolve});
 const providerFactory=async()=>({...demoProvider,async complete(...args){await gate;return demoProvider.complete(...args)}});
 const dir=mkdtempSync(join(tmpdir(),'staf-busy-')); const app=startInstance(join(dir,'db'),0,{providerFactory}); const port=await app.listen();
 const call=async (path, token, body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try {
  const a=(await call('/api/pair',null,{code:app.code})).token;
  const b=(await call('/api/pair',null,{code:app.issueCode()})).token;
  const bot=await call('/api/bots',a,{provider:'demo',name:'Ada'});
  assert.equal((await call('/api/commands',a,{id:'first',botId:bot.id,content:'hello'})).kind,'accepted');
  assert.equal((await call('/api/commands',b,{id:'second',botId:bot.id,content:'my draft'})).kind,'busy');
  assert.equal((await call('/api/commands/first',b)).state,'pending');
  assert.match((await call(`/api/bots/${bot.id}/archive`,b,{revision:bot.revision})).error,/busy/i);
  assert.equal((await call(`/api/bots/${bot.id}/messages`,b)).length,1);
  release();
  for (let i=0;i<20;i++) {if ((await call('/api/commands/first',b)).state==='completed') break;}
  assert.equal((await call('/api/commands/first',b)).state,'completed');
 } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('bot profiles detect stale edits and archive preserves shared chat across restart', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-profile-')), path=join(dir,'db'); let app=startInstance(path,0,{env:{}}); let port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}); return [r.status,await r.json()]};
 try {
  const a=(await call('/api/pair','',{code:app.code}))[1].token;
  const b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  assert.deepEqual(await call('/api/bots/missing',a),[404,{error:'Agent not found'}]);
  const bot=(await call('/api/bots',a,{provider:'demo',name:'Ada',instructions:'Help'}))[1];
  const initial=(await call(`/api/bots/${bot.id}`,b))[1];
  const edit={revision:initial.revision,name:'Renamed',instructions:'Be candid\nExplain',provider:'demo',model:null,reasoning:null};
  assert.equal((await call(`/api/bots/${bot.id}/profile`,a,edit))[0],200);
  assert.equal((await call(`/api/bots/${bot.id}/profile`,b,edit))[0],409);
  const updated=(await call(`/api/bots/${bot.id}`,b))[1]; assert.equal(updated.name,'Renamed'); assert.equal(updated.chatId,bot.chatId);
  const configured=(await call(`/api/bots/${bot.id}/profile`,a,{...edit,revision:updated.revision,provider:'openrouter',model:'test/model'}))[1];
  assert.equal((await call('/api/commands',b,{id:'missing-provider',botId:bot.id,content:'Must not fall back'}))[1].kind,'accepted');
  for (let i=0;i<20;i++) { if ((await call('/api/commands/missing-provider',b))[1].state==='failed') break; }
  assert.equal((await call('/api/commands/missing-provider',b))[1].state,'failed');
  const demo=(await call(`/api/bots/${bot.id}/profile`,a,{...edit,revision:configured.revision}))[1];
  assert.equal((await call('/api/commands',b,{id:'hello',botId:bot.id,content:'Hello'}))[1].kind,'accepted');
  assert.equal((await call(`/api/bots/${bot.id}/archive`,a,{revision:demo.revision}))[0],200);
  assert.deepEqual(await call('/api/commands',b,{id:'archived',botId:bot.id,content:'No'}),[409,{error:'Agent is archived'}]);
  await app.close(); app=startInstance(path,0,{env:{}}); port=await app.listen();
  const archived=(await call(`/api/bots/${bot.id}`,a))[1]; assert.equal(archived.archived,true);
  assert.equal((await call(`/api/bots/${bot.id}/restore`,b,{revision:archived.revision}))[0],200);
  assert.equal((await call(`/api/bots/${bot.id}/messages`,b))[1].length,3);
 } finally { await app.close();rmSync(dir,{recursive:true,force:true}); }
});

test('clients can inspect and revoke another client across restart', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-clients-')), path=join(dir,'db'); let app=startInstance(path); let port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try {
  const a=(await call('/api/pair','',{code:app.code}))[1].token;
  const b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const clients=(await call('/api/clients',a))[1]; assert.equal(clients.length,2);
  const other=clients.find(client=>!client.current); assert.ok(other); assert.ok(!JSON.stringify(clients).includes(b));
  assert.equal((await call(`/api/clients/${other.id}/revoke`,a,{}))[0],200);
  assert.equal((await call('/api/bots',b))[0],401);
  await app.close(); app=startInstance(path); port=await app.listen();
  assert.equal((await call('/api/bots',b))[0],401);
  assert.equal((await call('/api/clients',a))[1].length,1);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('captured profile and private replay survive restart without exposing provider internals', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-execution-')), path=join(dir,'db'); let seen=[], release;
 const gate=new Promise(resolve=>{release=resolve}); let block=true;
 const factory=async profile=>({name:`fixture:${profile.provider}:${profile.model}`,capabilities:{toolCalls:true,incrementalText:false,transport:'responses'},async complete(messages){seen.push({profile:structuredClone(profile),messages:structuredClone(messages)}); if(block){block=false;await gate;} return {role:'assistant',content:'answer',responseReplay:{provider:'codex-direct',model:profile.model,items:[{type:'reasoning',encrypted_content:'opaque+/= exact'},{type:'message',role:'assistant',content:[{type:'output_text',text:'answer'}]}]}};}});
 let app=startInstance(path,0,{providerFactory:factory}), port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 const wait=async id=>{for(let i=0;i<100;i++){const c=await call('/api/commands/'+id,token);if(c.state!=='pending')return c;await new Promise(r=>setTimeout(r,5));}throw Error('timed out')};
 let token;
 try {
  token=(await call('/api/pair','',{code:app.code})).token;
  const bot=await call('/api/bots',token,{provider:'demo',name:'A'});
  const edit={revision:bot.revision,name:'A',instructions:'old soul\nold instructions',provider:'codex',model:'model-one',reasoning:null};
  const first=await call(`/api/bots/${bot.id}/profile`,token,edit);
  assert.equal((await call('/api/commands',token,{id:'first-replay',botId:bot.id,content:'first'})).kind,'accepted');
  await call(`/api/bots/${bot.id}/profile`,token,{...edit,revision:first.revision,instructions:'new soul\nnew instructions'});
  release(); assert.equal((await wait('first-replay')).state,'completed');
  assert.equal(seen[0].profile.instructions,'old soul\nold instructions');
  assert.equal('soul' in seen[0].profile,false);
  await app.close(); app=startInstance(path,0,{providerFactory:factory});port=await app.listen();
  assert.equal((await call('/api/commands',token,{id:'second-replay',botId:bot.id,content:'second'})).kind,'accepted');
  assert.equal((await wait('second-replay')).state,'completed');
  assert.equal(seen[1].profile.instructions,'new soul\nnew instructions');
  assert.equal(seen[1].messages[1].responseReplay.items[0].encrypted_content,'opaque+/= exact');
  const visible=await call(`/api/bots/${bot.id}/messages`,token);assert.ok(!JSON.stringify(visible).includes('opaque+/= exact'));
  assert.equal((await call('/api/commands',token,{id:'second-replay',botId:bot.id,content:'second'})).kind,'existing');assert.equal(seen.length,2);
 } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('named adapters send captured prompts and model using offline transports', async () => {
 const {openRouterProvider}=await import('../dist/providers.js'); const {directCodexProvider}=await import('../dist/codex-direct.js');
 const dir=mkdtempSync(join(tmpdir(),'staf-adapters-'));let requests=[];
 const request=async (_url,init)=>{let body=JSON.parse(init.body);requests.push(body);if(body.input){const output=[{type:'reasoning',id:'r',encrypted_content:'opaque bytes'},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'codex answer'}]}];return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',model:body.model,output}})}\n\n`,{status:200});}return routerStream({message:{role:'assistant',content:'router answer'}});};
 const factory=async (profile,instructions)=>profile.provider==='codex'?directCodexProvider({model:profile.model,sessionId:profile.chatId,dataDir:dir,instructions,token:async()=>'synthetic-token',request}):openRouterProvider({OPENROUTER_API_KEY:'synthetic-key'},profile.model,request,undefined,instructions);
 const app=startInstance(join(dir,'db'),0,{providerFactory:factory});const port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try {const token=(await call('/api/pair','',{code:app.code})).token;const bot=await call('/api/bots',token,{provider:'demo',name:'A'});let revision=bot.revision;
  for(const [provider,model,id] of [['openrouter','vendor/model','router'],['codex','model-one','codex'],['codex','model-one','codex-again']]){
   const profile=await call(`/api/bots/${bot.id}/profile`,token,{revision,name:'A',instructions:'individual soul\nindividual instruction',provider,model,reasoning:null});revision=profile.revision;
   await call('/api/commands',token,{id,botId:bot.id,content:id});let state;for(let i=0;i<100;i++){state=await call('/api/commands/'+id,token);if(state.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}assert.equal(state.state,'completed',state.error);
  }
  assert.equal(requests[0].model,'vendor/model');assert.match(requests[0].messages[0].content,/individual soul[\s\S]*individual instruction/);
  assert.equal(requests[1].model,'model-one');assert.match(requests[1].instructions,/individual soul[\s\S]*individual instruction/);assert.ok(requests[2].input.some(x=>x.encrypted_content==='opaque bytes'));
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('failed tool turn retains observed accounting privately and does not replay unfinished exchange', async () => {
 const {DatabaseSync}=await import('node:sqlite'); const dir=mkdtempSync(join(tmpdir(),'staf-tool-fail-')),path=join(dir,'db');let calls=0, later;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(messages){calls++;if(calls===1)return {role:'assistant',content:null,tool_calls:[{id:'c',type:'function',function:{name:'clock',arguments:'{}'}}],usage:{scope:'request',status:'reported',source:'fixture',metrics:{input:7}}};if(calls===2)throw Error('secret details');later=messages;return {role:'assistant',content:'ok'};}});
 const app=startInstance(path,0,{providerFactory:factory,env:{OPENROUTER_API_KEY:'synthetic-secret'}});const port=await app.listen();let closed=false;
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 const wait=async(id,token)=>{for(let i=0;i<100;i++){let c=await call('/api/commands/'+id,token);if(c.state!=='pending')return c;await new Promise(r=>setTimeout(r,5));}throw Error('timeout')};
 try{const token=(await call('/api/pair','',{code:app.code})).token;const bot=await call('/api/bots',token,{provider:'demo',name:'A'});await call('/api/commands',token,{id:'failure',botId:bot.id,content:'synthetic-secret'});const failure=await wait('failure',token);assert.equal(failure.state,'failed');assert.ok(!JSON.stringify(failure).includes('secret'));assert.equal((await call(`/api/bots/${bot.id}/messages`,token))[0].content,'[REDACTED]');
  const chat=await call(`/api/bots/${bot.id}/chat-work`,token);assert.equal(chat.requests[0].progress.state,'failed');assert.equal(chat.requests[0].events.at(-1).success,1);assert.match(chat.requests[0].events.at(-1).detail,/UTC|T/);assert.ok(!JSON.stringify(chat).includes('synthetic-secret'));
  await call('/api/commands',token,{id:'next',botId:bot.id,content:'next'});assert.equal((await wait('next',token)).state,'completed');assert.deepEqual(later.map(m=>m.role),['user']);
  await app.close();closed=true;const db=new DatabaseSync(path);const raw=db.prepare('SELECT session FROM sessions').get().session;const session=JSON.parse(raw);db.close();assert.ok(session.events.some(e=>e.type==='tool_result'));assert.ok(session.usage.some(u=>u.metrics.input===7));assert.ok(!raw.includes('synthetic-secret'));
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('shutdown cancels active work and restart marks it interrupted without a duplicate call', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-shutdown-')),path=join(dir,'db');let calls=0, observed;
 const factory=async()=>({name:'slow',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(_messages,_tools,{signal}){calls++;await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true})});observed=signal.aborted;throw Error('cancelled');}});
 let app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try{const token=(await call('/api/pair','',{code:app.code})).token;const bot=await call('/api/bots',token,{provider:'demo',name:'A'});await call('/api/commands',token,{id:'shutdown',botId:bot.id,content:'hi'});while(!calls)await new Promise(r=>setTimeout(r,1));await app.close();assert.equal(observed,true);app=startInstance(path,0,{providerFactory:factory});port=await app.listen();assert.equal((await call('/api/commands/shutdown',token)).state,'interrupted');assert.equal((await call('/api/commands',token,{id:'shutdown',botId:bot.id,content:'hi'})).kind,'existing');assert.equal(calls,1);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('production provider selection uses managed OpenRouter and Codex credentials', async () => {
 const {mkdirSync,writeFileSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'staf-prod-adapters-'));mkdirSync(join(dir,'auth'));
 writeFileSync(join(dir,'auth','codex-direct.json'),JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'dummy',clientId:'dummy',hostId:'dummy',accessToken:'dummy-token',refreshToken:'dummy-refresh',idToken:'dummy-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000}),{mode:0o600});
 const original=globalThis.fetch,requests=[];globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('http://127.0.0.1:'))return original(input,init);if(!['https://openrouter.ai/api/v1/chat/completions','https://api.openai.com/v1/responses'].includes(url))throw Error('Unexpected network access');const body=JSON.parse(init.body);requests.push({url,body,authorization:init.headers.Authorization});if(url.includes('openrouter'))return routerStream({message:{role:'assistant',content:'router'}});return new Response(`data: ${JSON.stringify({type:'response.completed',response:{status:'completed',model:body.model,output:[{type:'reasoning',encrypted_content:'opaque'},{type:'message',role:'assistant',content:[{type:'output_text',text:'codex'}]}]}})}\n\n`);};
 const app=startInstance(join(dir,'db'),0,{dataDir:dir,env:{OPENROUTER_API_KEY:'dummy-router',STAF_MODEL:'must-not-be-used'}});const port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try{const token=(await call('/api/pair','',{code:app.code})).token;await call('/api/openrouter-connection',token,{key:'dummy-router'});const bot=await call('/api/bots',token,{provider:'demo',name:'A'});let revision=bot.revision;
  for(const [provider,model,id] of [['openrouter',null,'missing'],['openrouter','vendor/model','router-prod'],['codex','codex-model','codex-prod']]){const profile=await call(`/api/bots/${bot.id}/profile`,token,{revision,name:'A',instructions:'profile soul\nprofile instruction',provider,model,reasoning:null});revision=profile.revision;await call('/api/commands',token,{id,botId:bot.id,content:'hello'});let state;for(let i=0;i<100;i++){state=await call('/api/commands/'+id,token);if(state.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}assert.equal(state.state,id==='missing'?'failed':'completed',state.error);}
  assert.equal(requests.length,2);assert.equal(requests[0].body.model,'vendor/model');assert.equal(requests[0].authorization,'Bearer dummy-router');assert.match(requests[0].body.messages[0].content,/profile soul[\s\S]*profile instruction/);assert.equal(requests[1].body.model,'codex-model');assert.equal(requests[1].authorization,'Bearer dummy-token');assert.match(requests[1].body.instructions,/profile soul[\s\S]*profile instruction/);
 }finally{await app.close();globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});}
});

test('redacted submissions deduplicate only the exact original text across restart', async () => {
 const {DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-command-digest-')),path=join(dir,'db');let calls=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false,transport:'demo'},async complete(){calls++;return {role:'assistant',content:'safe'};}});
 let app=startInstance(path,0,{env:{OPENROUTER_API_KEY:'secret-one',STAF_API_KEY:'secret-two'},providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token;const bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];const submit=text=>call('/api/commands',token,{id:'same',botId:bot.id,content:text});
  assert.equal((await submit('secret-one'))[1].kind,'accepted');for(let i=0;i<100;i++){if((await call('/api/commands/same',token))[1].state==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await submit('secret-one'))[1].kind,'existing');assert.equal((await submit('secret-two'))[0],400);assert.equal((await submit('[REDACTED]'))[0],400);
  const visible=JSON.stringify([await call('/api/commands/same',token),await call(`/api/bots/${bot.id}/messages`,token)]);assert.ok(!visible.includes('secret-one'));assert.ok(!visible.includes('digest'));
  await app.close();app=startInstance(path,0,{env:{OPENROUTER_API_KEY:'secret-one',STAF_API_KEY:'secret-two'},providerFactory:factory});port=await app.listen();
  assert.equal((await submit('secret-one'))[1].kind,'existing');assert.equal((await submit('secret-two'))[0],400);assert.equal(calls,1);
  await app.close();const db=new DatabaseSync(path,{readOnly:true});try{const rows=JSON.stringify(db.prepare('SELECT * FROM commands').all());assert.ok(!rows.includes('secret-one'));assert.ok(!rows.includes('secret-two'));}finally{db.close();}app=undefined;
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('OpenRouter credit and rate-limit errors are useful without exposing response bodies', async () => {
 const {openRouterProvider}=await import('../dist/providers.js');const dir=mkdtempSync(join(tmpdir(),'staf-http-errors-'));let status=402;
 const factory=async(profile,instructions)=>openRouterProvider({OPENROUTER_API_KEY:'dummy-key'},profile.model,async()=>new Response('secret provider body',{status}),undefined,instructions);
 const app=startInstance(join(dir,'db'),0,{providerFactory:factory}),port=await app.listen();const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try{const token=(await call('/api/pair','',{code:app.code})).token;const bot=await call('/api/bots',token,{provider:'demo',name:'A'});await call(`/api/bots/${bot.id}/profile`,token,{revision:bot.revision,name:'A',instructions:'',provider:'openrouter',model:'fixture/model',reasoning:null});
  for(const [code,message] of [[401,'Configure the selected provider credentials on the instance host'],[402,'Provider credits are required'],[403,'Check the selected OpenRouter model, access and supported capabilities'],[404,'Check the selected OpenRouter model, access and supported capabilities'],[429,'Provider rate limit reached; retry later']]){status=code;await call('/api/commands',token,{id:'http-'+code,botId:bot.id,content:'hello'});let state;for(let i=0;i<100;i++){state=await call('/api/commands/http-'+code,token);if(state.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}assert.equal(state.state,'failed');assert.equal(state.error,message);assert.ok(!JSON.stringify(state).includes('secret provider body'));}
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('schedule creation rejects lateness below one minute',async()=>{
 const app=startInstance(':memory:'),port=await app.listen();const call=async(path,token,body)=>fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 try{const token=(await (await call('/api/pair',null,{code:app.code})).json()).token;const bot=await (await call('/api/bots',token,{provider:'demo',name:'A'})).json();const schedule={botId:bot.id,objective:'Read time',recurrence:{kind:'daily',timeZone:'UTC',hour:9,minute:0},maxLatenessMs:59999,authorization:{action:'clock.read',resource:'utc',limits:{reads:'permitted'}}};assert.equal((await call('/api/schedules',token,schedule)).status,400);assert.equal((await call('/api/schedules',token,{...schedule,maxLatenessMs:60000})).status,201);}finally{await app.close()}
});

test('paired clients see safe live tool progress and reported usage without provider history', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-terminal-service-'));const path=join(dir,'db');let app=startInstance(path,0,{env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 const until=async(fn)=>{for(let i=0;i<200;i++){const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 try {
  const token=(await call('/api/pair',null,{code:app.code}))[1].token,bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];
  assert.equal((await call(`/api/bots/${bot.id}/usage`))[0],401);
  await call('/api/approval-settings/instance',token,{mode:'ask-every-time',clockEnabled:true});
  await call('/api/commands',token,{id:'clock-indicator',botId:bot.id,content:'what time is it?'});
  const approval=await until(async()=>(await call('/api/approvals',token))[1].find(x=>x.state==='pending'));
  const pending=(await call('/api/commands/clock-indicator',token))[1];
  assert.deepEqual(pending.runtimeEvents,[{type:'tool_start',name:'clock'}]);
  const chatPending=(await call(`/api/bots/${bot.id}/chat-work`,token))[1];assert.equal(chatPending.requests[0].id,'clock-indicator');assert.equal(chatPending.requests[0].events[0].name,'clock');
  assert.equal(typeof chatPending.requests[0].events[0].callId,'string');assert.equal(chatPending.requests[0].events[0].arguments,'{}');
  const other=(await call('/api/bots',token,{provider:'demo',name:'Other'}))[1];assert.deepEqual((await call(`/api/bots/${other.id}/chat-work`,token))[1].requests,[]);

  assert.equal((await call('/api/codex-auth/logout',token,{}))[0],409);
  await call(`/api/approvals/${approval.id}/approve`,token,{});
  const completed=await until(async()=>{const result=(await call('/api/commands/clock-indicator',token))[1];return result.state==='completed'&&result;});
  assert.deepEqual(completed.runtimeEvents,[{type:'tool_start',name:'clock'},{type:'tool_result',name:'clock',success:true}]);
  const usage=(await call(`/api/bots/${bot.id}/usage`,token))[1],context=(await call(`/api/bots/${bot.id}/context`,token))[1];
  assert.match(usage.text,/Staf-observed session/);assert.match(context.text,/token count and context occupancy are unavailable/);
  assert.doesNotMatch(JSON.stringify({usage,context}),/what time is it|Demo tool result/);
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  assert.deepEqual((await call('/api/commands/clock-indicator',token))[1].runtimeEvents,completed.runtimeEvents);
  const recovered=(await call(`/api/bots/${bot.id}/chat-work`,token))[1];assert.equal(recovered.requests[0].events.length,2);assert.equal(recovered.requests[0].events.at(-1).success,1);assert.equal(recovered.requests[0].events[0].callId,recovered.requests[0].events[1].callId);assert.deepEqual((await call(`/api/bots/${bot.id}/chat-work`,token))[1],recovered);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('chat work keeps repeated tool calls distinct even when a provider reuses an ID in a later step', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-call-identity-')),path=join(dir,'db');let step=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(){
  if(step++===0)return {role:'assistant',content:null,tool_calls:['same','other'].map(id=>({id,type:'function',function:{name:'clock',arguments:'{}'}}))};
  if(step===2)return {role:'assistant',content:null,tool_calls:[{id:'same',type:'function',function:{name:'clock',arguments:'{}'}}]};
  return {role:'assistant',content:'finished'};
 }});
 let app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try {
  const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'demo',name:'Calls',toolMode:'direct'});
  await call('/api/approval-settings/instance',token,{mode:'never-ask',clockEnabled:true});
  await call('/api/commands',token,{id:'repeated',botId:bot.id,content:'Use clock'});
  let work;for(let i=0;i<200;i++){work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];if(work?.progress.state!=='pending' && work?.progress.state!=='accepted' && work?.progress.state!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(work.progress.state,'completed');assert.equal(work.events.length,6);
  const starts=work.events.filter(event=>event.type==='tool_start'),results=work.events.filter(event=>event.type==='tool_result');
  assert.equal(new Set(starts.map(event=>event.callId)).size,3);
  assert.deepEqual(results.map(event=>event.callId),starts.map(event=>event.callId));
  assert.ok(starts.every(event=>event.arguments==='{}'));assert.ok(results.every(event=>event.success===1));
  await app.close();app=startInstance(path,0,{providerFactory:factory});port=await app.listen();
  assert.deepEqual((await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0].events,work.events);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('concurrent guest calls keep their own durable tool outcomes', async () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-concurrent-calls-')),path=join(dir,'db');let step=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(){return step++ ? {role:'assistant',content:'finished'} : {role:'assistant',content:null,tool_calls:[{id:'program',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'return await Promise.all([capabilities.clock({}), capabilities.clock({})]);'})}}]};}});
 const app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json()};
 try {const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'demo',name:'Concurrent',toolMode:'code'});await call('/api/approval-settings/instance',token,{mode:'never-ask',clockEnabled:true});await call('/api/commands',token,{id:'concurrent',botId:bot.id,content:'Use clocks'});let work;for(let i=0;i<400;i++){work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];if(work && ['completed','failed'].includes(work.progress.state))break;await new Promise(r=>setTimeout(r,10));}assert.equal(work.progress.state,'completed',JSON.stringify(work));const clocks=work.events.filter(event=>event.name==='clock');assert.equal(clocks.length,4);const starts=clocks.filter(event=>event.type==='tool_start'),results=clocks.filter(event=>event.type==='tool_result');assert.equal(new Set(starts.map(event=>event.callId)).size,2);assert.deepEqual(new Set(results.map(event=>event.callId)),new Set(starts.map(event=>event.callId)));assert.ok(results.every(event=>event.success===1));}
 finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('pre-identity tool events survive migration without invented call IDs', async () => {
 const {DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-legacy-calls-')),path=join(dir,'db');
 let instance=new Instance(path);const bot=instance.createBot({name:'Legacy',instructions:'',provider:'demo'});instance.claim({id:'old',botId:bot.id,content:'hello'});instance.close();
 let db=new DatabaseSync(path);db.exec("INSERT INTO command_runtime_events (command_id,type,name,success,detail) VALUES ('old','tool_start','clock',NULL,NULL),('old','tool_result','clock',1,'old result')");db.exec('ALTER TABLE command_runtime_events DROP COLUMN call_id');db.exec('PRAGMA user_version=37');db.close();
 try {instance=new Instance(path);assert.ok(instance.migrationBackup);const events=instance.chatWork(bot.id).requests[0].events;assert.deepEqual(events.map(event=>event.callId),[null,null]);assert.equal(events[1].detail,'old result');instance.close();}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('retained tool arguments redact credentials and escaped unsafe URLs before storage', async () => {
 const {DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-call-redaction-')),path=join(dir,'db');let step=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(){return step++ ? {role:'assistant',content:'done'} : {role:'assistant',content:null,tool_calls:[{id:'sensitive',type:'function',function:{name:'unknown',arguments:'{"secret":"synthetic-secret","url":"https://example.com/path\\u003ftoken=private"}'}}]};}});
 const app=startInstance(path,0,{providerFactory:factory,env:{OPENROUTER_API_KEY:'synthetic-secret'}}),port=await app.listen();let closed=false;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return response.json()};
 try {const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{provider:'demo',name:'Safe'});await call('/api/commands',token,{id:'safe',botId:bot.id,content:'check'});let work;for(let i=0;i<200;i++){work=(await call(`/api/bots/${bot.id}/chat-work`,token)).requests[0];if(work?.events.length>=2)break;await new Promise(r=>setTimeout(r,10));}const args=work.events[0].arguments;assert.match(args,/\[REDACTED\]/);assert.match(args,/\[redacted URL\]/);assert.doesNotMatch(args,/synthetic-secret|token=private/);await app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});const saved=db.prepare('SELECT detail FROM command_runtime_events WHERE type=?').get('tool_start').detail;db.close();assert.equal(saved,args);}
 finally {if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('compatible providers use host endpoints and profile prompts; discovery is explicit', async () => {
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.startsWith('http://127.0.0.1:'))return original(input,init);seen.push({url,init});if(url.endsWith('/models'))return Response.json({data:[{id:'fixture-model',name:'Fixture lm-key'}]});if(url.endsWith('/chat/completions'))return Response.json({model:'fixture-model',choices:[{message:{role:'assistant',content:'fixture reply'}}]});throw Error('Unexpected network access');};
 const app=startInstance(':memory:',0,{env:{LMSTUDIO_BASE_URL:'https://lm.fixture/v1/',LMSTUDIO_API_KEY:'lm-key',STAF_BASE_URL:'https://live.fixture/v1/',STAF_API_KEY:'live-key'}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()];};
 try {const token=(await call('/api/pair',null,{code:app.code}))[1].token,bot=(await call('/api/bots',token,{provider:'demo',name:'A'}))[1];let revision=bot.revision;
  for(const provider of ['lmstudio','live']){
   const [status,profile]=await call(`/api/bots/${bot.id}/profile`,token,{revision,name:'A',instructions:'custom soul\ncustom instruction',provider,model:'fixture-model',reasoning:null});assert.equal(status,200);revision=profile.revision;
   assert.equal(seen.filter(x=>x.url.endsWith('/models')).length,provider==='lmstudio'?0:1);
   const [discoveryStatus,catalog]=await call(`/api/bots/${bot.id}/models`,token,{});assert.equal(discoveryStatus,200);assert.equal(catalog.models[0].id,'fixture-model');assert.ok(!JSON.stringify(catalog).includes('lm-key'));
   await call('/api/commands',token,{id:provider,botId:bot.id,content:'hello'});let state;for(let i=0;i<100;i++){state=(await call(`/api/commands/${provider}`,token))[1];if(state.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}assert.equal(state.state,'completed',state.error);
  }
  const chats=seen.filter(x=>x.url.endsWith('/chat/completions'));assert.equal(chats.length,2);
  assert.equal(chats[0].url,'https://lm.fixture/v1/chat/completions');assert.equal(chats[0].init.headers.Authorization,'Bearer lm-key');
  assert.equal(chats[1].url,'https://live.fixture/v1/chat/completions');assert.equal(chats[1].init.headers.Authorization,'Bearer live-key');
  for(const chat of chats){const body=JSON.parse(chat.init.body);assert.equal(body.model,'fixture-model');assert.match(body.messages[0].content,/custom soul[\s\S]*custom instruction/);}
 }finally{await app.close();globalThis.fetch=original;}
});


test('concurrent command recovery is idempotent across clients and restart', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-command-recovery-')),path=join(dir,'db');let release,calls=0;const gate=new Promise(resolve=>{release=resolve});
 const factory=async()=>({name:'held',capabilities:{toolCalls:false},async complete(){calls++;await gate;return {role:'assistant',content:'done'}}});
 let app=startInstance(path,0,{providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()]};
 try{
  const a=(await call('/api/pair','',{code:app.code}))[1].token,b=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const bot=(await call('/api/bots',a,{provider:'demo',name:'Recovery'}))[1],command={id:'recovered',botId:bot.id,content:'One message'};
  const results=await Promise.all(Array.from({length:8},(_,i)=>call('/api/commands',i%2?a:b,command)));
  assert.equal(results.filter(([,v])=>v.kind==='accepted').length,1);assert.equal(results.filter(([,v])=>v.kind==='existing').length,7);
  assert.equal((await call('/api/commands',b,{id:'competing',botId:bot.id,content:'Keep this'}))[1].kind,'busy');
  release();for(let i=0;i<100;i++){if((await call('/api/commands/recovered',b))[1].state==='completed')break;await new Promise(r=>setTimeout(r,5));}
  assert.equal((await call('/api/commands/recovered',b))[1].state,'completed');await app.close();app=startInstance(path,0,{providerFactory:factory});port=await app.listen();
  assert.equal((await call('/api/commands',b,command))[1].kind,'existing');assert.equal(calls,1);
  assert.equal((await call(`/api/bots/${bot.id}/messages`,a))[1].filter(m=>m.content==='One message').length,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
