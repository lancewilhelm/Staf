import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Instance} from '../dist/instance.js';
import {startInstance} from '../dist/instance-service.js';

async function fixture({identity={teamId:'T123',botUserId:'B123'},identify,verifyDestination,prepare,slackSetupBinding,slackStartTimeoutMs,startError=false,startHook,startStatus='connected',appValue='xapp-synthetic-journey'}={}){
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-journey-')),path=join(dir,'instance.sqlite'),model=[],starts=[],posts=[];
 const slackTransport={verifyDestination:verifyDestination??(async(_tokens,config)=>({channelId:config.channelId})),identify:identify??(async()=>identity),start:async(tokens,receive,status,_interact,assertAuthority)=>{assertAuthority();starts.push({...tokens});await startHook?.(receive);assertAuthority();if(startError)throw Error('Synthetic socket failure');if(startStatus)status?.(startStatus);return ()=>{};},post:async(_tokens,message)=>{posts.push(message);}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){model.push(JSON.stringify(messages));return messages.at(-1).role==='tool'?{role:'assistant',content:'Finished'}:{role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};}});
 const options={dataDir:dir,env:{},slackTransport,providerFactory},dependencies={slackSetupBinding,slackStartTimeoutMs};let app=startInstance(path,0,options,dependencies),port=await app.listen(),token;
 const call=async(route,body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
 const until=async fn=>{for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
 token=(await call('/api/pair',{code:app.code},''))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture-offline',toolMode:'direct'}))[1];
 await prepare?.(call,bot);
 await call('/api/commands',{id:'setup',botId:bot.id,content:'Help set up Slack'});
 const appRequest=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'));await call(`/api/secret-requests/${appRequest.id}/save`,{value:appValue});
 const botRequest=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'&&item.id!==appRequest.id));await call(`/api/secret-requests/${botRequest.id}/save`,{value:'xoxb-synthetic-journey'});
 const request=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='slack-setup'));
 return {get app(){return app;},bot,call,dir,model,path,request,starts,posts,token,until,restart:async(beforeStart)=>{await app.close();await beforeStart?.();app=startInstance(path,0,options,dependencies);port=await app.listen();},close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
}

test('owner confirmation connects the exact Slack binding using two scoped managed secrets',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.status,'connected');assert.equal(plugin.enabled,true);assert.equal(plugin.agentAccess,true);assert.deepEqual(plugin.config,{teamId:'T123',userId:'U123',channelId:'D123',botId:f.bot.id});
  const grants=(await f.call('/api/secret-grants'))[1].filter(item=>item.integration.startsWith('slack.'));assert.equal(grants.length,2);assert.equal(f.starts.length,1);
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.state,'completed');
  for(const secret of ['xapp-synthetic-journey','xoxb-synthetic-journey']){assert.ok(!JSON.stringify(f.model).includes(secret));assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(f.path).includes(Buffer.from(secret)));assert.ok(!JSON.stringify(grants).includes(secret));}
  await f.restart();await f.until(()=>f.starts.length===2);const restored=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(restored.status,'connected');assert.equal(restored.agentAccess,true);
 }finally{await f.close();}
});

async function existingSlack(call,bot){const review=(await call('/api/secret-setup-review?integration=slack'))[1];const response=await call('/api/plugins/slack/connect',{confirm:true,reviewedVersion:review.version,appToken:'xapp-old-synthetic',botToken:'xoxb-old-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});assert.equal(response[0],200);}

test('existing Slack grants require explicit review and displacement confirmation',async()=>{
 const f=await fixture({prepare:existingSlack});try{
  assert.equal(f.request.approval.grantReview.grants.length,2);
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  const before=(await f.call('/api/secret-grants'))[1];assert.deepEqual(before,f.request.approval.grantReview.grants);
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);
  const after=(await f.call('/api/secret-grants'))[1];assert.equal(after.length,2);assert.ok(after.every(grant=>!before.some(old=>old.name===grant.name)));
 }finally{await f.close();}
});

test('an invalid selected app token cannot displace grants or dispatch Slack identification',async()=>{
 let identifications=0;const f=await fixture({prepare:existingSlack,appValue:'not-a-slack-app-token',verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>{identifications++;return {teamId:'T123',botUserId:'B123'};}});try{
  const before=(await f.call('/api/secret-grants'))[1];assert.equal(identifications,1);
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);
  assert.equal(identifications,1);assert.deepEqual((await f.call('/api/secret-grants'))[1],before);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('approving one agent preserves another agent’s Slack access',async()=>{
 let other;
 const f=await fixture({prepare:async(call,bot)=>{await existingSlack(call,bot);other=(await call('/api/bots',{name:'Other agent',provider:'live',model:'fixture-offline'}))[1];await call('/api/plugins/slack/access',{botId:other.id,enabled:true});}});try{
  assert.equal(f.request.approval.authority.agentAccess,false);
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);
  assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').agentAccess,true);
  const review=(await f.call('/api/secret-setup-review?integration=slack'))[1];
  assert.equal((await f.call('/api/plugins/slack/connect',{confirm:true,reviewedVersion:review.version,confirmDisplacements:true,appToken:'xapp-next-synthetic',botToken:'xoxb-next-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:other.id}))[0],200);
  assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').agentAccess,true);
 }finally{await f.close();}
});

test('revocation after review makes the old confirmation stale',async()=>{
 const f=await fixture({prepare:existingSlack});try{
  const grant=f.request.approval.grantReview.grants[0];assert.equal((await f.call('/api/secret-grants/revoke',{...grant,confirm:true}))[0],200);
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);
  const after=(await f.call('/api/secret-grants'))[1];assert.equal(after.length,1);assert.ok(!after.some(item=>item.name===grant.name));assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('revocation followed by restoring the same grant does not revive a stale setup review',async()=>{
 const f=await fixture({prepare:existingSlack});try{
  const grant=f.request.approval.grantReview.grants.find(item=>item.integration==='slack.app');assert.equal((await f.call('/api/secret-grants/revoke',{...grant,confirm:true}))[0],200);
  const target=(await f.call('/api/secret-grant-targets'))[1].find(item=>item.integration===grant.integration);
  assert.equal((await f.call('/api/secret-grants/grant',{name:grant.name,revision:grant.revision,integration:target.integration,destination:target.destination,version:target.version,previous:null,confirmDisplacement:false,confirm:true}))[0],200);
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('an agent access change or selected secret replacement invalidates the reviewed setup',async()=>{
 for(const change of ['access','replace']){
  const f=await fixture({prepare:existingSlack});try{
   if(change==='access')await f.call('/api/plugins/slack/access',{botId:f.bot.id,enabled:false});
   else await f.call('/api/secrets/replace',{...f.request.approval.app,value:'xapp-replacement-synthetic',confirm:true});
   assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);assert.equal(f.starts.length,0);
  }finally{await f.close();}
 }
});

test('revocation during Slack identification prevents grant replacement and binding',async()=>{
 let hold=false,entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({prepare:existingSlack,verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>{if(hold){entered();await gate;}return {teamId:'T123',botUserId:'B123'};}});try{
  hold=true;const pending=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true});await started;
  const grant=f.request.approval.grantReview.grants[0];assert.equal((await f.call('/api/secret-grants/revoke',{...grant,confirm:true}))[0],200);release();assert.notEqual((await pending)[0],200);
  const after=(await f.call('/api/secret-grants'))[1];assert.equal(after.length,1);assert.ok(!after.some(item=>item.name===grant.name));assert.equal(f.starts.length,0);
 }finally{release?.();await f.close();}
});

test('a workspace mismatch fails without binding or starting Slack',async()=>{
 const f=await fixture({identity:{teamId:'T999',botUserId:'B123'}});try{
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.connected,false);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('guided setup rejects a DM belonging to a different user',async()=>{
 const f=await fixture({verifyDestination:async()=>({channelId:'DOTHER'})});try{
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);assert.equal(f.starts.length,0);assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').connected,false);assert.deepEqual(f.posts,[]);
 }finally{await f.close();}
});

test('a preexisting enabled binding cannot deliver if DM verification fails on restart',async()=>{
 let wrong=false;const f=await fixture({verifyDestination:async(_tokens,config)=>({channelId:wrong?'DOTHER':config.channelId})});try{
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);wrong=true;
  await f.restart(()=>{const instance=new Instance(f.path);try{instance.plugins.queueNotice({id:'pending-notice',config:{teamId:'T123',userId:'U123',channelId:'D123',botId:f.bot.id},text:'Synthetic confidential summary'});}finally{instance.close();}});
  await f.until(async()=>(await f.call('/api/plugins'))[1].find(item=>item.id==='slack').status==='connection failed');await new Promise(resolve=>setTimeout(resolve,350));assert.deepEqual(f.posts,[]);assert.equal(f.starts.length,1);
 }finally{await f.close();}
});

test('a held setup cannot report a later Settings connection as its own success',async()=>{
 let held=true,entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({startHook:async()=>{if(held){entered();await gate;}}});try{
  const original=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});await started;
  assert.equal((await f.call('/api/commands/setup'))[1].state,'pending');
  const review=(await f.call('/api/secret-setup-review?integration=slack'))[1];held=false;
  assert.equal((await f.call('/api/plugins/slack/connect',{confirm:true,reviewedVersion:review.version,confirmDisplacements:true,appToken:'xapp-other-synthetic',botToken:'xoxb-other-synthetic',teamId:'T123',userId:'U456',channelId:'D456',botId:f.bot.id}))[0],200);
  assert.equal((await f.call('/api/plugins/slack/enable',{}))[0],200);release();assert.notEqual((await original)[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.config.userId,'U456');assert.equal(plugin.config.channelId,'D456');assert.equal(plugin.status,'connected');
  const work=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(work.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');
 }finally{release?.();await f.close();}
});

test('a socket failure is reported as failure rather than a verified connection',async()=>{
 const f=await fixture({startError:true});try{
  const response=await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});assert.notEqual(response[0],200);
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');
  assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').status,'connection failed');
  await f.restart();await f.until(async()=>(await f.call('/api/plugins'))[1].find(item=>item.id==='slack').status==='activation interrupted');assert.equal(f.starts.length,1);
 }finally{await f.close();}
});

test('a returned transport without an open socket cannot report setup success',async()=>{
 for(const startStatus of [null,'reconnecting']){const f=await fixture({startStatus});try{
  const response=await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});assert.notEqual(response[0],200);const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');assert.deepEqual(f.posts,[]);
 }finally{await f.close();}}
});

test('an event arriving before activation completes is not acknowledged as handled',async()=>{
 let rejected=false;const f=await fixture({startHook:async receive=>{try{await receive({eventId:'early',teamId:'T123',userId:'U123',channelId:'D123',text:'hello'});}catch{rejected=true;}}});try{
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);assert.equal(rejected,true);assert.deepEqual(f.posts,[]);
 }finally{await f.close();}
});

test('a socket that never opens times out without reporting success or auto-retrying',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const f=await fixture({slackStartTimeoutMs:50,startHook:async()=>gate});try{
  const result=await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});assert.notEqual(result[0],200);release();
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');
  await f.restart();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(f.starts.length,1);assert.deepEqual(f.posts,[]);
 }finally{release?.();await f.close();}
});

test('a changed destination and an interrupted work item cannot approve setup',async()=>{
 let identifies=0;const f=await fixture({verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>{identifies++;return {teamId:'T123',botUserId:'B123'};}});try{
  const changed={...f.request.approval,config:{...f.request.approval.config,channelId:'D456'}};
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:changed}))[0],200);assert.equal(identifies,0);
  await f.call('/api/commands/setup/stop',{});await f.until(async()=>{const inbox=(await f.call('/api/inbox'))[1];return inbox.find(item=>item.id===f.request.id&&item.state==='interrupted');});
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);assert.equal(identifies,0);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('revoking the approving browser during Slack identification prevents binding',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>{entered();await gate;return {teamId:'T123',botUserId:'B123'};}});try{
  const second=(await f.call('/api/pair',{code:f.app.issueCode()},''))[1].token;
  const pending=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});await started;
  const clients=(await f.call('/api/clients',undefined,second))[1],first=clients.find(item=>!item.current);
  await f.call(`/api/clients/${first.id}/revoke`,{},second);release();assert.notEqual((await pending)[0],200);
  const plugin=(await f.call('/api/plugins',undefined,second))[1].find(item=>item.id==='slack');assert.equal(plugin.connected,false);assert.equal(f.starts.length,0);
  await f.restart();const restored=(await f.call('/api/plugins',undefined,second))[1].find(item=>item.id==='slack');assert.equal(restored.connected,false);assert.equal(f.starts.length,0);
 }finally{release?.();await f.close();}
});

test('revoking the approving browser while the socket is starting disconnects the pending setup',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({startHook:async()=>{entered();await gate;}});try{
  const second=(await f.call('/api/pair',{code:f.app.issueCode()},''))[1].token;
  const pending=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});await started;
  const clients=(await f.call('/api/clients',undefined,second))[1],first=clients.find(item=>!item.current);await f.call(`/api/clients/${first.id}/revoke`,{},second);
  release();assert.notEqual((await pending)[0],200);
  const plugin=(await f.call('/api/plugins',undefined,second))[1].find(item=>item.id==='slack');assert.equal(plugin.connected,false);assert.deepEqual((await f.call('/api/secret-grants',undefined,second))[1],[]);
  await f.restart();assert.equal((await f.call('/api/plugins',undefined,second))[1].find(item=>item.id==='slack').enabled,false);assert.equal(f.starts.length,1);
 }finally{release?.();await f.close();}
});

test('revoking a grant while the socket is opening prevents activation and delivery',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({startHook:async()=>{entered();await gate;}});try{
  const pending=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});await started;
  const grant=(await f.call('/api/secret-grants'))[1].find(item=>item.integration==='slack.app');assert.equal((await f.call('/api/secret-grants/revoke',{...grant,confirm:true}))[0],200);release();assert.notEqual((await pending)[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.notEqual(plugin.status,'connected');assert.deepEqual(f.posts,[]);
  await f.restart();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(f.starts.length,1);assert.deepEqual(f.posts,[]);
 }finally{release?.();await f.close();}
});

test('a managed grant transaction failure rolls back both grants and does not connect on restart',async()=>{
 const f=await fixture();try{
  const db=new DatabaseSync(join(f.dir,'secrets','credentials.sqlite'));
  try {db.exec("CREATE TRIGGER fail_slack_bot_grant BEFORE INSERT ON secret_grants WHEN NEW.integration='slack.bot' BEGIN SELECT RAISE(ABORT,'synthetic grant failure'); END");}finally{db.close();}
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  assert.deepEqual((await f.call('/api/secret-grants'))[1],[]);assert.equal(f.starts.length,0);
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.state,'completed');assert.ok(f.model.some(item=>item.includes('Slack setup failed')));assert.equal(command.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');
  assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').connected,false);
  await f.restart();assert.equal((await f.call('/api/plugins'))[1].find(item=>item.id==='slack').connected,false);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('an injected plugin binding failure leaves Slack disabled and is reported as failed across restart',async()=>{
 const f=await fixture({prepare:existingSlack,slackSetupBinding:()=>{throw Error('Synthetic plugin binding failure');}});try{
  const old=f.request.approval.grantReview.grants;
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval,confirmDisplacements:true}))[0],200);
  const after=(await f.call('/api/secret-grants'))[1];assert.equal(after.length,2);assert.ok(after.every(grant=>!old.some(item=>item.name===grant.name)));
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.workActions.find(item=>item.summary==='Set up Slack with owner confirmation')?.state,'failed');
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.enabled,false);assert.equal(f.starts.length,0);
  await f.restart();const restored=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(restored.enabled,false);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});
