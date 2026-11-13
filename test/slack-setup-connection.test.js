import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from './fixtures/controlled-instance.mjs';

async function fixture({identity={teamId:'T123',botUserId:'B123'},identify}={}){
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-journey-')),path=join(dir,'instance.sqlite'),model=[],starts=[];
 const slackTransport={identify:identify??(async()=>identity),start:async(tokens,_receive,status,_interact,assertAuthority)=>{assertAuthority();starts.push({...tokens});status?.('connected');return ()=>{};},post:async()=>{}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){model.push(JSON.stringify(messages));return messages.at(-1).role==='tool'?{role:'assistant',content:'Finished'}:{role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};}});
 const app=startInstance(path,0,{dataDir:dir,env:{},slackTransport,providerFactory}),port=await app.listen();let token;
 const call=async(route,body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
 const until=async fn=>{for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
 token=(await call('/api/pair',{code:app.code},''))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture-offline',toolMode:'direct'}))[1];
 await call('/api/commands',{id:'setup',botId:bot.id,content:'Help set up Slack'});
 const appRequest=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'));await call(`/api/secret-requests/${appRequest.id}/save`,{value:'xapp-synthetic-journey'});
 const botRequest=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'&&item.id!==appRequest.id));await call(`/api/secret-requests/${botRequest.id}/save`,{value:'xoxb-synthetic-journey'});
 const request=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='slack-setup'));
 return {app,bot,call,dir,model,path,request,starts,token,until,close:async()=>{await app.close();rmSync(dir,{recursive:true,force:true});}};
}

test('owner confirmation connects the exact Slack binding using two scoped managed secrets',async()=>{
 const f=await fixture();try{
  assert.equal((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.status,'connected');assert.equal(plugin.enabled,true);assert.equal(plugin.agentAccess,true);assert.deepEqual(plugin.config,{teamId:'T123',userId:'U123',channelId:'D123',botId:f.bot.id});
  const grants=(await f.call('/api/secret-grants'))[1].filter(item=>item.integration.startsWith('slack.'));assert.equal(grants.length,2);assert.equal(f.starts.length,1);
  const command=await f.until(async()=>{const item=(await f.call('/api/commands/setup'))[1];return item.state!=='pending'&&item;});assert.equal(command.state,'completed');
  for(const secret of ['xapp-synthetic-journey','xoxb-synthetic-journey']){assert.ok(!JSON.stringify(f.model).includes(secret));assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(f.path).includes(Buffer.from(secret)));assert.ok(!JSON.stringify(grants).includes(secret));}
 }finally{await f.close();}
});

test('a workspace mismatch fails without binding or starting Slack',async()=>{
 const f=await fixture({identity:{teamId:'T999',botUserId:'B123'}});try{
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);
  const plugin=(await f.call('/api/plugins'))[1].find(item=>item.id==='slack');assert.equal(plugin.connected,false);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('a changed destination and an interrupted work item cannot approve setup',async()=>{
 let identifies=0;const f=await fixture({identify:async()=>{identifies++;return {teamId:'T123',botUserId:'B123'};}});try{
  const changed={...f.request.approval,config:{...f.request.approval.config,channelId:'D456'}};
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:changed}))[0],200);assert.equal(identifies,0);
  await f.call('/api/commands/setup/stop',{});await f.until(async()=>{const inbox=(await f.call('/api/inbox'))[1];return inbox.find(item=>item.id===f.request.id&&item.state==='interrupted');});
  assert.notEqual((await f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval}))[0],200);assert.equal(identifies,0);assert.equal(f.starts.length,0);
 }finally{await f.close();}
});

test('revoking the approving browser during Slack identification prevents binding',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture({identify:async()=>{entered();await gate;return {teamId:'T123',botUserId:'B123'};}});try{
  const second=(await f.call('/api/pair',{code:f.app.issueCode()},''))[1].token;
  const pending=f.call(`/api/slack-setup/${f.request.id}/confirm`,{approval:f.request.approval});await started;
  const clients=(await f.call('/api/clients',undefined,second))[1],first=clients.find(item=>!item.current);
  await f.call(`/api/clients/${first.id}/revoke`,{},second);release();assert.notEqual((await pending)[0],200);
  const plugin=(await f.call('/api/plugins',undefined,second))[1].find(item=>item.id==='slack');assert.equal(plugin.connected,false);assert.equal(f.starts.length,0);
 }finally{release?.();await f.close();}
});
