import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

function failSecretInsert(dir){const db=new DatabaseSync(join(dir,'secrets','credentials.sqlite'));try{db.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON secrets BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");}finally{db.close();}}

test('Slack reconnect storage failure preserves prior connection and grant versions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-reconnect-'));let app;
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  const config={confirm:true,appToken:'xapp-before-synthetic',botToken:'xoxb-before-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};assert.equal((await call('/api/plugins/slack/connect',config))[0],200);
  const before=(await call('/api/plugins'))[1].find(item=>item.id==='slack'),grants=(await call('/api/secret-grants'))[1],review=(await call('/api/secret-setup-review?integration=slack'))[1];
  failSecretInsert(dir);const failed=await call('/api/plugins/slack/connect',{...config,userId:'U999',channelId:'D999',appToken:'xapp-after-synthetic',botToken:'xoxb-after-synthetic',reviewedVersion:review.version,confirmDisplacements:true});assert.equal(failed[0],400);
  const after=(await call('/api/plugins'))[1].find(item=>item.id==='slack');assert.deepEqual(after.config,before.config);assert.equal(after.connected,before.connected);assert.deepEqual((await call('/api/secret-grants'))[1],grants);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gmail reconnect storage failure preserves prior connection and grant versions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-reconnect-'));let app;
 const gmailRequest=async(url)=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  async function authorize(input){const [status,attempt]=await call('/api/plugins/gmail/start',input);assert.equal(status,200);const url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');return (await fetch(callback)).status;}
  token=(await call('/api/pair',{code:app.code}))[1].token;const input={confirm:true,email:'owner@example.test',clientId:'synthetic-client-one',clientSecret:'synthetic-client-secret'};assert.equal(await authorize(input),200);
  const before=(await call('/api/plugins'))[1].find(item=>item.id==='gmail'),grants=(await call('/api/secret-grants'))[1],review=(await call('/api/secret-setup-review?integration=gmail'))[1];
  failSecretInsert(dir);assert.equal(await authorize({...input,clientId:'synthetic-client-two',reviewedVersion:review.version,confirmDisplacements:true}),400);
  const after=(await call('/api/plugins'))[1].find(item=>item.id==='gmail');assert.deepEqual(after.config,before.config);assert.equal(after.connected,before.connected);assert.deepEqual((await call('/api/secret-grants'))[1],grants);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

for(const kind of ['slack','gmail'])test(`${kind} reconnect rolls back each failed transaction boundary and fences an uncertain commit`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),`staf-${kind}-boundary-`)),path=join(dir,'instance.sqlite');let app,port,token,fault=null;const starts=[];
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async tokens=>{starts.push(tokens.appToken);return ()=>{};},post:async()=>{}};
 const gmailRequest=async(url)=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
 const start=async()=>{app=startInstance(path,0,{dataDir:dir,env:{},slackTransport,gmailRequest},{credentialTransition:(plugin,stage)=>{if(plugin===kind && stage===fault)throw Error('synthetic fault');}});port=await app.listen();};
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
 const gmailInput={confirm:true,email:'owner@example.test',clientId:'synthetic-client-old',clientSecret:'synthetic-client-secret'};
 async function authorize(input){const [status,result]=await call('/api/plugins/gmail/start',input);assert.equal(status,200);const url=new URL(result.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');const response=await fetch(callback);return [response.status,await response.text()];}
 try {
  await start();token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  const slackInput={confirm:true,appToken:'xapp-original-fixture',botToken:'xoxb-original-fixture',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};
  if(kind==='slack'){assert.equal((await call('/api/plugins/slack/connect',slackInput))[0],200);await call('/api/plugins/slack/access',{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',{});}else {assert.equal((await authorize(gmailInput))[0],200);await call('/api/plugins/gmail/access',{botId:bot.id,enabled:true});assert.equal((await call('/api/plugins/gmail/enable',{}))[0],200);}
  const before=(await call('/api/plugins'))[1].find(item=>item.id===kind),beforeGrants=(await call('/api/secret-grants'))[1],review=(await call(`/api/secret-setup-review?integration=${kind}`))[1];
  const changed=kind==='slack'?{...slackInput,userId:'U999',channelId:'D999',appToken:'xapp-new-fixture',botToken:'xoxb-new-fixture',reviewedVersion:review.version,confirmDisplacements:true}:{...gmailInput,clientId:'synthetic-client-new',reviewedVersion:review.version,confirmDisplacements:true};
  for(const stage of ['attached','begun','grants-revoked','secret-config-written','first-secret-written','credentials-written','plugin-config-written','before-commit']){
   fault=stage;const result=kind==='slack'?await call('/api/plugins/slack/connect',changed):await authorize(changed);assert.equal(result[0],400,stage);
   const current=(await call('/api/plugins'))[1].find(item=>item.id===kind);assert.deepEqual(current.config,before.config,stage);assert.equal(current.enabled,before.enabled,stage);assert.equal(current.reconnectUncertain,false,stage);assert.deepEqual((await call('/api/secret-grants'))[1],beforeGrants,stage);
   if(kind==='slack'){assert.match(result[1].error,/not changed/);assert.equal(starts.at(-1),'xapp-original-fixture');}else {assert.match(current.authorizationStatus,/not changed/);assert.equal((await call('/api/plugins/gmail/check',{}))[0],200);}
  }
  fault='after-commit';const result=kind==='slack'?await call('/api/plugins/slack/connect',changed):await authorize(changed);assert.equal(result[0],400);
  const uncertain=(await call('/api/plugins'))[1].find(item=>item.id===kind);assert.equal(uncertain.reconnectUncertain,true);assert.match(uncertain.status,/uncertain/i);assert.equal((await call(`/api/plugins/${kind}/enable`,{}))[0],503);
  assert.ok(!JSON.stringify([uncertain,result]).includes('xapp-new-fixture'));assert.ok(!JSON.stringify([uncertain,result]).includes('synthetic-client-secret'));
  fault=null;await app.close();app=undefined;await start();const restored=(await call('/api/plugins'))[1].find(item=>item.id===kind);assert.equal(restored.reconnectUncertain,false);assert.notDeepEqual(restored.config,before.config);assert.equal(restored.enabled,false);assert.notDeepEqual((await call('/api/secret-grants'))[1],beforeGrants);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('in-memory plugin connections use the same transactional credential store',async()=>{
 const app=startInstance(':memory:',0,{env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}});
 try {const port=await app.listen();let token;const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];assert.equal((await call('/api/plugins/slack/connect',{confirm:true,appToken:'xapp-memory-fixture',botToken:'xoxb-memory-fixture',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);assert.equal((await call('/api/secret-grants'))[1].length,2);}finally{await app.close();}
});

test('persistent reconnect rejects a database in WAL mode without changing connection or grants',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-reconnect-wal-')),path=join(dir,'instance.sqlite');let app,port,token;
 const options={dataDir:dir,env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}};
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
 try{
  app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  const input={confirm:true,appToken:'xapp-original-fixture',botToken:'xoxb-original-fixture',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};assert.equal((await call('/api/plugins/slack/connect',input))[0],200);const before=(await call('/api/plugins'))[1].find(item=>item.id==='slack'),grants=(await call('/api/secret-grants'))[1];await app.close();app=undefined;
  const db=new DatabaseSync(path);try{assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');}finally{db.close();}
  app=startInstance(path,0,options);port=await app.listen();const review=(await call('/api/secret-setup-review?integration=slack'))[1];const result=await call('/api/plugins/slack/connect',{...input,userId:'U999',reviewedVersion:review.version,confirmDisplacements:true});assert.equal(result[0],400);assert.match(result[1].error,/not changed/);assert.deepEqual((await call('/api/plugins'))[1].find(item=>item.id==='slack').config,before.config);assert.deepEqual((await call('/api/secret-grants'))[1],grants);
 }finally{await app?.close();rmSync(dir,{recursive:true,force:true});}
});

for(const kind of ['slack','gmail'])test(`${kind} restart recovers crashes at each reconnect boundary`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),`staf-${kind}-crash-`)),path=join(dir,'instance.sqlite');let app,port,token,child;
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}};
 const gmailRequest=async(url)=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
 const start=async()=>{app=startInstance(path,0,{dataDir:dir,env:{},slackTransport,gmailRequest});port=await app.listen();};
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
 const gmailInput={confirm:true,email:'owner@example.test',clientId:'synthetic-client-old',clientSecret:'synthetic-client-secret'};
 const authorize=async input=>{const [status,result]=await call('/api/plugins/gmail/start',input);assert.equal(status,200);const url=new URL(result.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');return fetch(callback);};
 try {
  await start();token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  const slackInput={confirm:true,appToken:'xapp-original-fixture',botToken:'xoxb-original-fixture',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};
  if(kind==='slack')assert.equal((await call('/api/plugins/slack/connect',slackInput))[0],200);else assert.equal((await authorize(gmailInput)).status,200);
  const before=(await call('/api/plugins'))[1].find(item=>item.id===kind),beforeGrants=(await call('/api/secret-grants'))[1];await app.close();app=undefined;
  for(const stage of ['attached','begun','grants-revoked','secret-config-written','first-secret-written','credentials-written','plugin-config-written','before-commit','after-commit']){
   child=fork('test/fixtures/plugin-transition-child.mjs',[path,kind,stage],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
   const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
   port=await new Promise((resolve,reject)=>{child.once('message',message=>resolve(message.port));child.once('error',reject);child.once('exit',code=>reject(Error(`Fixture exited before listening: ${code}`)));});
   const review=(await call(`/api/secret-setup-review?integration=${kind}`))[1];
   const changed=kind==='slack'?{...slackInput,userId:'U999',channelId:'D999',appToken:'xapp-new-fixture',botToken:'xoxb-new-fixture',reviewedVersion:review.version,confirmDisplacements:true}:{...gmailInput,clientId:'synthetic-client-new',reviewedVersion:review.version,confirmDisplacements:true};
   try {if(kind==='slack')await call('/api/plugins/slack/connect',changed);else await authorize(changed);assert.fail(`Fixture survived ${stage}`);}catch(error){if(error?.code==='ERR_ASSERTION')throw error;}
   assert.deepEqual(await exited,{code:73,signal:null},stage);child=undefined;await start();
   const restored=(await call('/api/plugins'))[1].find(item=>item.id===kind),grants=(await call('/api/secret-grants'))[1];assert.equal(restored.reconnectUncertain,false,stage);
   if(stage==='after-commit'){assert.notDeepEqual(restored.config,before.config);assert.notDeepEqual(grants,beforeGrants);assert.equal((await call('/api/secret-grants/revoke',{...beforeGrants.find(item=>item.integration===`${kind}.${kind==='gmail'?'client':'app'}`),confirm:true}))[0],400);}
   else {assert.deepEqual(restored.config,before.config,stage);assert.deepEqual(grants,beforeGrants,stage);}
   const main=readFileSync(path);for(const value of ['synthetic-client-secret','synthetic-refresh-token','xapp-original-fixture','xapp-new-fixture','xoxb-original-fixture','xoxb-new-fixture'])assert.equal(main.includes(Buffer.from(value)),false,stage);
   await app.close();app=undefined;
  }
 } finally {if(child){child.kill('SIGKILL');}await app?.close();rmSync(dir,{recursive:true,force:true});}
});
