import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,cpSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Instance} from '../dist/instance.js';
import {startInstance} from '../dist/instance-service.js';
import {saveSlackTokens} from '../dist/slack-credential.js';
import {saveGmailCredential} from '../dist/gmail-credential.js';

test('legacy plugin credentials stay untouched and cannot authorize a connection after upgrade',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-legacy-plugins-')),path=join(dir,'instance.sqlite');let app;
 try {
  const instance=new Instance(path),bot=instance.createBot({name:'Existing',provider:'live',model:'fixture',instructions:''});
  const config={teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};
  instance.plugins.connect(config);instance.plugins.setAccess(bot.id,true);instance.plugins.setEnabled(true);
  instance.plugins.gmailConnect({email:'owner@example.test',clientId:'synthetic-client'},'100');instance.plugins.gmailSetAccess(bot.id,true);instance.plugins.gmailSetEnabled(true);instance.close();
  saveSlackTokens({root:dir,appToken:'xapp-old-synthetic',botToken:'xoxb-old-synthetic'});
  saveGmailCredential(dir,{email:'owner@example.test',clientId:'synthetic-client',clientSecret:'old-client-secret',refreshToken:'old-refresh-token'});
  const oldSlack=readFileSync(join(dir,'auth','slack.json')),oldGmail=readFileSync(join(dir,'auth','gmail.json'));let network=0;
  const slackTransport={identify:async()=>{network++;return {teamId:'T123',botUserId:'B123'};},start:async()=>{network++;return ()=>{};},post:async()=>{network++;}};
  const gmailRequest=async()=>{network++;throw Error('Unexpected network');};
  app=startInstance(path,0,{dataDir:dir,env:{},slackTransport,gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;
  assert.deepEqual((await call('/api/secret-grants'))[1],[]);
  assert.equal((await call('/api/plugins/gmail/check',{}))[0],400);assert.equal(network,0);
  assert.equal((await call('/api/plugins',undefined))[1].find(item=>item.id==='gmail').status,'Credentials unavailable');
  await call('/api/plugins/slack/disconnect',{});await call('/api/plugins/gmail/disconnect',{});
  assert.deepEqual(readFileSync(join(dir,'auth','slack.json')),oldSlack);assert.deepEqual(readFileSync(join(dir,'auth','gmail.json')),oldGmail);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Slack use stops at grant revocation and only the current destination can be approved',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-managed-slack-')),path=join(dir,'instance.sqlite');let app,receiver,starts=0,stops=0;
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,receive)=>{starts++;receiver=receive;return ()=>{stops++;receiver=undefined;};},post:async()=>{}};
 try {
  app=startInstance(path,0,{dataDir:dir,env:{},slackTransport});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  assert.equal((await call('/api/plugins/slack/connect',{appToken:'xapp-new-synthetic',botToken:'xoxb-new-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],400);assert.equal(starts,0);
  assert.equal((await call('/api/plugins/slack/connect',{confirm:true,appToken:'xapp-new-synthetic',botToken:'xoxb-new-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);
  await call('/api/plugins/slack/access',{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',{});assert.equal(starts,1);assert.ok(receiver);
  const grants=(await call('/api/secret-grants'))[1],appGrant=grants.find(item=>item.integration==='slack.app');assert.ok(appGrant);
  assert.equal((await call('/api/secret-grants/revoke',{...appGrant,confirm:true}))[0],200);assert.equal(receiver,undefined);assert.ok(stops>=1);
  assert.equal((await call('/api/secret-grants/grant',{...appGrant,destination:'https://evil.example',confirm:true}))[0],400);assert.equal(starts,1);
  assert.equal((await call('/api/secret-grants/grant',{...appGrant,confirm:true}))[0],200);assert.equal(starts,2);
  await call('/api/plugins/slack/access',{botId:bot.id,enabled:false});assert.equal(receiver,undefined);
  const before=starts;await call('/api/secret-grants/revoke',{...appGrant,confirm:true});await call('/api/secret-grants/grant',{...appGrant,confirm:true});assert.equal(starts,before);
  assert.ok(!JSON.stringify((await call('/api/secret-grants'))[1]).includes('xapp-new-synthetic'));
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoking Gmail grant during refresh blocks the later profile request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-managed-gmail-')),path=join(dir,'instance.sqlite');let app,releaseRefresh,refreshStarted,hold=false,profileCalls=0;
 const started=new Promise(resolve=>{refreshStarted=resolve;}),gate=new Promise(resolve=>{releaseRefresh=resolve;});
 const gmailRequest=async(url,options)=>{
  if(new URL(url).hostname==='oauth2.googleapis.com') {const body=new URLSearchParams(options.body);if(hold && body.get('grant_type')==='refresh_token'){refreshStarted();await gate;}return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});}
  profileCalls++;return Response.json({emailAddress:'owner@example.test',historyId:'100'});
 };
 try {
  app=startInstance(path,0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;
  assert.equal((await call('/api/plugins/gmail/start',{email:'owner@example.test',clientId:'synthetic-client',clientSecret:'synthetic-client-secret'}))[0],400);assert.equal(profileCalls,0);
  const attempt=(await call('/api/plugins/gmail/start',{confirm:true,email:'owner@example.test',clientId:'synthetic-client',clientSecret:'synthetic-client-secret'}))[1],url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');assert.equal((await fetch(callback)).status,200);
  const refreshGrant=(await call('/api/secret-grants'))[1].find(item=>item.integration==='gmail.refresh');assert.ok(refreshGrant);
  hold=true;const check=call('/api/plugins/gmail/check',{});await started;assert.equal((await call('/api/secret-grants/revoke',{...refreshGrant,confirm:true}))[0],200);releaseRefresh();
  assert.equal((await check)[0],400);assert.equal(profileCalls,1);
  assert.equal((await call('/api/plugins/gmail/check',{}))[0],400);
 } finally {releaseRefresh?.();await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoking the paired client during Slack identification prevents saving and use',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-managed-slack-client-'));let app,started,release;
 const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const slackTransport={identify:async()=>{started();await gate;return {teamId:'T123',botUserId:'B123'};},start:async()=>{throw Error('Must not start');},post:async()=>{throw Error('Must not post');}};
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport});const port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  const first=(await call('/api/pair','',{code:app.code}))[1].token,second=(await call('/api/pair','',{code:app.issueCode()}))[1].token,bot=(await call('/api/bots',first,{name:'Agent',provider:'live',model:'fixture'}))[1];
  const connecting=call('/api/plugins/slack/connect',first,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await entered;
  const clients=(await call('/api/clients',second))[1],firstClient=clients.find(item=>!item.current);await call(`/api/clients/${firstClient.id}/revoke`,second,{});release();
  assert.equal((await connecting)[0],400);assert.deepEqual((await call('/api/secret-grants',second))[1],[]);assert.deepEqual((await call('/api/secrets',second))[1],[]);
 } finally {release?.();await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('stopped backup restores grants that were revoked after the backup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-grant-backup-')),backup=mkdtempSync(join(tmpdir(),'staf-grant-copy-'));let store;
 return import('../dist/secret-requests.js').then(({SecretRequests})=>{try{
  store=new SecretRequests(dir,false);store.add({name:'Token',purpose:'Slack',value:'xapp-backup-synthetic'});const revision=store.names()[0].revision;
  const grant={name:'Token',revision,integration:'slack.app',destination:'https://slack.com/api|T1|U1|D1'};store.grant(grant);store.close();store=undefined;
  cpSync(join(dir,'secrets'),join(backup,'secrets'),{recursive:true});chmodSync(join(backup,'secrets'),0o700);
  store=new SecretRequests(dir,false);store.revoke(grant);assert.equal(store.grants().length,0);store.close();store=undefined;
  rmSync(join(dir,'secrets'),{recursive:true});cpSync(join(backup,'secrets'),join(dir,'secrets'),{recursive:true});chmodSync(join(dir,'secrets'),0o700);
  store=new SecretRequests(dir,false);assert.equal(store.resolve(grant),'xapp-backup-synthetic');assert.equal(store.grants().length,1);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});rmSync(backup,{recursive:true,force:true});}});
});
