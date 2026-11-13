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
  let target=(await call('/api/secret-grant-targets'))[1].find(item=>item.integration==='slack.app');
  assert.equal((await call('/api/secret-grants/grant',{...appGrant,destination:'https://evil.example',version:target.version,previous:null,confirmDisplacement:false,confirm:true}))[0],400);assert.equal(starts,1);
  assert.equal((await call('/api/secret-grants/grant',{...appGrant,version:target.version,previous:null,confirmDisplacement:false,confirm:true}))[0],200);assert.equal(starts,2);
  await call('/api/plugins/slack/access',{botId:bot.id,enabled:false});assert.equal(receiver,undefined);
  const before=starts;const current=(await call('/api/secret-grants'))[1].find(item=>item.integration==='slack.app');await call('/api/secret-grants/revoke',{...current,confirm:true});target=(await call('/api/secret-grant-targets'))[1].find(item=>item.integration==='slack.app');await call('/api/secret-grants/grant',{...current,version:target.version,previous:null,confirmDisplacement:false,confirm:true});assert.equal(starts,before);
  assert.ok(!JSON.stringify((await call('/api/secret-grants'))[1]).includes('xapp-new-synthetic'));
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('a stale grant approval cannot restore access after another client revokes it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-grant-stale-'));let app;
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}});const port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  const first=(await call('/api/pair','',{code:app.code}))[1].token,second=(await call('/api/pair','',{code:app.issueCode()}))[1].token,bot=(await call('/api/bots',first,{name:'Agent',provider:'live',model:'fixture'}))[1];
  assert.equal((await call('/api/plugins/slack/connect',first,{confirm:true,appToken:'xapp-stale-synthetic',botToken:'xoxb-stale-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);
  const grant=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');
  assert.equal((await call('/api/secret-grants/revoke',second,{...grant,confirm:true}))[0],200);
  assert.equal((await call('/api/secret-grants/grant',first,{...grant,previous:{name:grant.name,revision:grant.revision},confirmDisplacement:false,confirm:true}))[0],400);
  assert.equal((await call('/api/secret-grants',first))[1].some(item=>item.integration==='slack.app'),false);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('grant decisions bind the reviewed secret and version across two clients and racing requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-grant-review-'));let app;
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}});const port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  const first=(await call('/api/pair','',{code:app.code}))[1].token,second=(await call('/api/pair','',{code:app.issueCode()}))[1].token,bot=(await call('/api/bots',first,{name:'Agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',first,{confirm:true,appToken:'xapp-original-synthetic',botToken:'xoxb-original-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});
  await call('/api/secrets/add',first,{name:'Replacement',purpose:'Slack app',value:'xapp-replacement-synthetic'});
  const replacement=(await call('/api/secrets',first))[1].find(item=>item.name==='Replacement'),old=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');
  let target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.equal(target.current.name,old.name);
  const decision={name:replacement.name,revision:replacement.revision,integration:target.integration,destination:target.destination,version:target.version,previous:target.current,confirm:true};
  assert.equal((await call('/api/secret-grants/grant',first,{...decision,confirmDisplacement:false}))[0],400);
  assert.equal((await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app').name,old.name);
  assert.equal((await call('/api/secret-grants/grant',first,{...decision,confirmDisplacement:true}))[0],200);
  assert.equal((await call('/api/secret-grants/revoke',second,{...old,confirm:true}))[0],400);
  assert.equal((await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app').name,'Replacement');
  const approved=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');
  assert.equal((await call('/api/secret-grants/revoke',first,{...approved,confirm:true}))[0],200);
  target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.equal(target.current,null);
  const newDecision={name:replacement.name,revision:replacement.revision,integration:target.integration,destination:target.destination,version:target.version,previous:null,confirmDisplacement:false,confirm:true};
  const outcomes=await Promise.all([call('/api/secret-grants/grant',first,newDecision),call('/api/secret-grants/grant',second,newDecision)]);assert.deepEqual(outcomes.map(item=>item[0]).sort(),[200,400]);
  assert.equal((await call('/api/secret-grants/revoke',second,{...approved,confirm:true}))[0],400);
  assert.equal((await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app').name,'Replacement');
  const newlyApproved=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');assert.equal((await call('/api/secret-grants/revoke',second,{...newlyApproved,confirm:true}))[0],200);
  assert.equal((await call('/api/secret-grants/grant',first,newDecision))[0],400);
  target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.notEqual(target.version,newDecision.version);
  assert.equal((await call('/api/secret-grants/grant',first,{...newDecision,version:target.version}))[0],200);
  const beforeReplace=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');
  assert.equal((await call('/api/secrets/replace',first,{name:replacement.name,revision:replacement.revision,value:'xapp-replaced-synthetic',confirm:true}))[0],200);
  target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.equal(target.current,null);assert.notEqual(target.version,beforeReplace.version);
  const replaced=(await call('/api/secrets',first))[1].find(item=>item.name==='Replacement');
  assert.equal((await call('/api/secret-grants/grant',first,{name:replaced.name,revision:replaced.revision,integration:target.integration,destination:target.destination,version:target.version,previous:null,confirmDisplacement:false,confirm:true}))[0],200);
  const beforeDelete=(await call('/api/secret-grants',first))[1].find(item=>item.integration==='slack.app');assert.equal((await call('/api/secrets/delete',first,{name:replaced.name,revision:replaced.revision,confirm:true}))[0],200);
  target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.equal(target.current,null);assert.notEqual(target.version,beforeDelete.version);
  assert.equal((await call('/api/secret-grants/revoke',second,{...beforeDelete,confirm:true}))[0],400);
  const absentBeforeDisconnect=target.version;await call('/api/plugins/slack/disconnect',first,{});
  const setup=(await call('/api/secret-setup-review?integration=slack',first))[1];assert.equal((await call('/api/plugins/slack/connect',first,{confirm:true,reviewedVersion:setup.version,confirmDisplacements:false,appToken:'xapp-reconnected-synthetic',botToken:'xoxb-reconnected-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);
  target=(await call('/api/secret-grant-targets',first))[1].find(item=>item.integration==='slack.app');assert.notEqual(target.version,absentBeforeDisconnect);assert.notEqual(target.current,null);
  assert.equal((await call('/api/secret-grants/revoke',second,{...beforeDelete,confirm:true}))[0],400);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('plugin reconnection names and fences displaced approvals',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-setup-review-'));let app,identifications=0;
 try {
  const slackTransport={identify:async()=>{identifications++;return {teamId:'T123',botUserId:'B123'};},start:async()=>()=>{},post:async()=>{}};
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport});const port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  const first=(await call('/api/pair','',{code:app.code}))[1].token,second=(await call('/api/pair','',{code:app.issueCode()}))[1].token,bot=(await call('/api/bots',first,{name:'Agent',provider:'live',model:'fixture'}))[1];
  const config={confirm:true,appToken:'xapp-first-synthetic',botToken:'xoxb-first-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};
  assert.equal((await call('/api/plugins/slack/connect',first,config))[0],200);
  const review=(await call('/api/secret-setup-review?integration=slack',first))[1];assert.equal(review.grants.length,2);assert.ok(review.grants.every(grant=>grant.name));
  assert.equal((await call('/api/plugins/slack/connect',first,{...config,reviewedVersion:review.version,confirmDisplacements:false}))[0],400);assert.equal(identifications,1);
  const old=review.grants.find(grant=>grant.integration==='slack.app');assert.equal((await call('/api/secret-grants/revoke',second,{...old,confirm:true}))[0],200);
  assert.equal((await call('/api/plugins/slack/connect',first,{...config,reviewedVersion:review.version,confirmDisplacements:true}))[0],400);assert.equal(identifications,1);
  const updated=(await call('/api/secret-setup-review?integration=slack',first))[1];assert.equal(updated.grants.length,1);
  assert.equal((await call('/api/plugins/slack/connect',first,{...config,reviewedVersion:updated.version,confirmDisplacements:true}))[0],200);assert.equal(identifications,2);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoked grant versions survive a service restart and stopped-data restore',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-grant-service-')),backup=mkdtempSync(join(tmpdir(),'staf-grant-service-backup-'));let app,port,token;
 const options={dataDir:dir,env:{},slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>{}}};
 const start=async()=>{app=startInstance(join(dir,'instance.sqlite'),0,options);port=await app.listen();};
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
 try {
  await start();token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',{confirm:true,appToken:'xapp-backup-service',botToken:'xoxb-backup-service',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});
  const old=(await call('/api/secret-grants'))[1].find(item=>item.integration==='slack.app');await call('/api/secret-grants/revoke',{...old,confirm:true});
  const revoked=(await call('/api/secret-grant-targets'))[1].find(item=>item.integration==='slack.app');assert.equal(revoked.current,null);assert.notEqual(revoked.version,old.version);
  await app.close();app=undefined;cpSync(dir,join(backup,'data'),{recursive:true});chmodSync(join(backup,'data','secrets'),0o700);
  await start();const afterRestart=(await call('/api/secret-grant-targets'))[1].find(item=>item.integration==='slack.app');assert.deepEqual(afterRestart,revoked);
  const approve={name:old.name,revision:old.revision,integration:old.integration,destination:old.destination,version:revoked.version,previous:null,confirmDisplacement:false,confirm:true};assert.equal((await call('/api/secret-grants/grant',approve))[0],200);
  await app.close();app=undefined;rmSync(dir,{recursive:true});cpSync(join(backup,'data'),dir,{recursive:true});chmodSync(join(dir,'secrets'),0o700);
  await start();const restored=(await call('/api/secret-grant-targets'))[1].find(item=>item.integration==='slack.app');assert.deepEqual(restored,revoked);
  assert.equal((await call('/api/secret-grants/revoke',{...old,confirm:true}))[0],400);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});rmSync(backup,{recursive:true,force:true});}
});

test('known credentials cannot be placed in Gmail OAuth account or client ID',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-nonsecret-'));let app;
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{}});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;
  assert.equal((await call('/api/secrets/add',{name:'Private',purpose:'Test',value:'synthetic-private-client-id'}))[0],200);
  const [status,result]=await call('/api/plugins/gmail/start',{confirm:true,email:'owner@example.test',clientId:'synthetic-private-client-id',clientSecret:'synthetic-oauth-secret'});
  assert.equal(status,400);assert.ok(!JSON.stringify(result).includes('synthetic-private-client-id'));
  assert.equal((await call('/api/secrets/add',{name:'Private account',purpose:'Test',value:'SENSITIVE-account@example.test'}))[0],200);
  const [accountStatus,accountResult]=await call('/api/plugins/gmail/start',{confirm:true,email:'SENSITIVE-account@example.test',clientId:'synthetic-client',clientSecret:'synthetic-oauth-secret'});
  assert.equal(accountStatus,400);assert.ok(!JSON.stringify(accountResult).includes('SENSITIVE-account@example.test'));
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gmail authorization rechecks newly saved credentials before storing account configuration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-nonsecret-race-')),path=join(dir,'instance.sqlite');let app,release,started;
 const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const gmailRequest=async(url)=>{if(new URL(url).hostname==='oauth2.googleapis.com'){started();await gate;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});}return Response.json({emailAddress:'owner@example.test',historyId:'100'});};
 try {
  app=startInstance(path,0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const clientId='synthetic-client-becomes-private';
  const attempt=(await call('/api/plugins/gmail/start',{confirm:true,email:'owner@example.test',clientId,clientSecret:'synthetic-oauth-secret'}))[1],url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');const exchange=fetch(callback);await entered;
  assert.equal((await call('/api/secrets/add',{name:'Later private',purpose:'Test',value:clientId}))[0],200);release();assert.equal((await exchange).status,400);
  const gmail=(await call('/api/plugins'))[1].find(item=>item.id==='gmail');assert.equal(gmail.connected,false);assert.ok(!JSON.stringify(gmail).includes(clientId));assert.ok(!readFileSync(path).includes(Buffer.from(clientId)));
 } finally {release?.();await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gmail authorization rechecks the original account spelling if it becomes a credential',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-account-race-')),path=join(dir,'instance.sqlite');let app,release,started;
 const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});let profiles=0;
 const gmailRequest=async(url)=>{if(new URL(url).hostname==='oauth2.googleapis.com'){started();await gate;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});}profiles++;return Response.json({emailAddress:'owner@example.test',historyId:'100'});};
 try {
  app=startInstance(path,0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const account='OWNER@example.test';
  const attempt=(await call('/api/plugins/gmail/start',{confirm:true,email:account,clientId:'synthetic-client',clientSecret:'synthetic-oauth-secret'}))[1],url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');const exchange=fetch(callback);await entered;
  assert.equal((await call('/api/secrets/add',{name:'Later account',purpose:'Test',value:account}))[0],200);release();assert.equal((await exchange).status,400);assert.equal(profiles,0);
  assert.ok(!readFileSync(path).includes(Buffer.from('owner@example.test')));
 } finally {release?.();await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gmail rejects an OAuth response credential matching its client ID',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-oauth-value-')),path=join(dir,'instance.sqlite');let app,profiles=0;
 const gmailRequest=async(url)=>{if(new URL(url).hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-client-becomes-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});profiles++;return Response.json({emailAddress:'owner@example.test',historyId:'100'});};
 try {
  app=startInstance(path,0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const clientId='synthetic-client-becomes-access';
  const attempt=(await call('/api/plugins/gmail/start',{confirm:true,email:'owner@example.test',clientId,clientSecret:'synthetic-oauth-secret'}))[1],url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');
  assert.equal((await fetch(callback)).status,400);assert.equal(profiles,0);assert.ok(!readFileSync(path).includes(Buffer.from(clientId)));
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Gmail reconnect rejects a reviewed approval that changed during OAuth',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-setup-review-'));let app,release,started,hold=false;
 const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const gmailRequest=async(url)=>{if(new URL(url).hostname==='oauth2.googleapis.com'){if(hold){started();await gate;}return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'});}return Response.json({emailAddress:'owner@example.test',historyId:'100'});};
 try {
  app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},gmailRequest});const port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()];};
  const first=(await call('/api/pair','',{code:app.code}))[1].token,second=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  const input={confirm:true,email:'owner@example.test',clientId:'synthetic-client',clientSecret:'synthetic-oauth-secret'};
  let attempt=(await call('/api/plugins/gmail/start',first,input))[1];let url=new URL(attempt.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');assert.equal((await fetch(callback)).status,200);
  const review=(await call('/api/secret-setup-review?integration=gmail',first))[1];assert.equal(review.grants.length,2);
  assert.equal((await call('/api/plugins/gmail/start',first,{...input,reviewedVersion:review.version,confirmDisplacements:false}))[0],400);
  attempt=(await call('/api/plugins/gmail/start',first,{...input,reviewedVersion:review.version,confirmDisplacements:true}))[1];url=new URL(attempt.url);callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic');hold=true;const exchange=fetch(callback);await entered;
  const grant=review.grants.find(item=>item.integration==='gmail.refresh');assert.equal((await call('/api/secret-grants/revoke',second,{...grant,confirm:true}))[0],200);release();assert.equal((await exchange).status,400);
  const current=(await call('/api/secret-grants',first))[1];assert.equal(current.some(item=>item.integration==='gmail.refresh'),false);assert.equal(current.find(item=>item.integration==='gmail.client').name,review.grants.find(item=>item.integration==='gmail.client').name);
 } finally {release?.();await app?.close();rmSync(dir,{recursive:true,force:true});}
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
  const target=store.target('slack.app','https://slack.com/api|T1|U1|D1');const grant={name:'Token',revision,integration:'slack.app',destination:target.destination,version:target.version};store.grant({...grant,previous:null,confirmDisplacement:false});const approved=store.grants()[0];store.close();store=undefined;
  cpSync(join(dir,'secrets'),join(backup,'secrets'),{recursive:true});chmodSync(join(backup,'secrets'),0o700);
  store=new SecretRequests(dir,false);store.revoke(approved);assert.equal(store.grants().length,0);store.close();store=undefined;
  rmSync(join(dir,'secrets'),{recursive:true});cpSync(join(backup,'secrets'),join(dir,'secrets'),{recursive:true});chmodSync(join(dir,'secrets'),0o700);
  store=new SecretRequests(dir,false);assert.equal(store.resolve(grant),'xapp-backup-synthetic');assert.equal(store.grants().length,1);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});rmSync(backup,{recursive:true,force:true});}});
});
