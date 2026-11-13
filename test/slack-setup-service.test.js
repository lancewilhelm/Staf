import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startInstance} from './fixtures/controlled-instance.mjs';

test('real service requests Slack tokens in protected steps and retains an interrupted approval without replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-guided-slack-')),path=join(dir,'instance.sqlite'),model=[];let app,port,token,identifyCalls=0;
 const options={dataDir:dir,env:{},slackTransport:{identify:async()=>{identifyCalls++;return {teamId:'T123',botUserId:'B123'};},start:async()=>()=>{},post:async()=>{}},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){model.push(JSON.stringify(messages));return messages.at(-1).role==='tool'?{role:'assistant',content:'Setup finished'}:{role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};}})};
 const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
 const until=async(fn)=>{for(let n=0;n<500;n++){const item=await fn();if(item)return item;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out waiting for service');};
 try {
  app=startInstance(path,0,options);port=await app.listen();token=(await call('/api/pair',{code:app.code}))[1].token;
  const bot=(await call('/api/bots',{name:'Setup agent',provider:'live',model:'fixture-offline',toolMode:'direct'}))[1];
  await call('/api/commands',{id:'setup',botId:bot.id,content:'Help set up Slack'});
  const appRequest=await until(async()=>((await call('/api/inbox'))[1]).find(item=>item.kind==='secret'));
  assert.match(appRequest.purpose,/Socket Mode/);assert.equal((await call(`/api/secret-requests/${appRequest.id}/save`,{value:'xapp-synthetic-secret'}))[0],200);
  const botRequest=await until(async()=>((await call('/api/inbox'))[1]).find(item=>item.kind==='secret' && item.id!==appRequest.id));
  assert.equal((await call(`/api/secret-requests/${botRequest.id}/save`,{value:'xoxb-synthetic-secret'}))[0],200);
  const pending=await until(async()=>((await call('/api/inbox'))[1]).find(item=>item.kind==='slack-setup'));
  assert.equal(pending.approval.config.botId,bot.id);assert.equal(pending.approval.config.teamId,'T123');
  assert.equal(identifyCalls,0);
  for(const secret of ['xapp-synthetic-secret','xoxb-synthetic-secret']){assert.ok(!JSON.stringify(model).includes(secret));assert.ok(!readFileSync(path).includes(Buffer.from(secret)));assert.ok(!JSON.stringify(pending).includes(secret));}
  await app.close();app=startInstance(path,0,options);port=await app.listen();
  const retained=((await call('/api/inbox'))[1]).find(item=>item.id===pending.id);assert.equal(retained.state,'interrupted');
  assert.equal((await call(`/api/slack-setup/${pending.id}/confirm`,{approval:pending.approval}))[0],400);assert.equal(identifyCalls,0);
 } finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid Slack setup arguments cannot put a token into the normal work record',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-guided-slack-invalid-')),path=join(dir,'instance.sqlite'),secret='xapp-synthetic-injected-secret';
 const app=startInstance(path,0,{dataDir:dir,env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){return {role:'assistant',content:null,tool_calls:[{id:'bad',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123',appToken:secret})}}]};}})});
 try {
  const port=await app.listen();let token;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return response.json();};
  token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Agent',provider:'live',model:'fixture-offline',toolMode:'direct'});
  await call('/api/commands',{id:'invalid',botId:bot.id,content:'Set up Slack'});let command;
  for(let n=0;n<500;n++){command=await call('/api/commands/invalid');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.notEqual(command.state,'pending');assert.ok(!JSON.stringify(command).includes(secret));assert.ok(!readFileSync(path).includes(Buffer.from(secret)));assert.equal((await call('/api/inbox')).length,0);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('protected Slack requests and dismissal work in all tool modes and background work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-guided-slack-modes-')),path=join(dir,'instance.sqlite'),model=[];let mode='direct';
 const app=startInstance(path,0,{dataDir:dir,env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){model.push(JSON.stringify(messages));if(messages.at(-1).role==='tool')return {role:'assistant',content:'Done'};const input={teamId:'T123',userId:'U123',channelId:'D123'};return {role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:mode==='direct'?{name:'setup_slack',arguments:JSON.stringify(input)}:{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.setup_slack(${JSON.stringify(input)});`})}}]};}})});
 try {
  const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  const until=async(fn)=>{for(let n=0;n<500;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  token=(await call('/api/pair',{code:app.code})).token;
  for(mode of ['direct','hybrid','code'])for(const kind of ['command','task']){
   const bot=await call('/api/bots',{name:`${mode} ${kind}`,provider:'live',model:'fixture',toolMode:mode}),id=`${mode}-${kind}`;
   if(mode==='hybrid')for(const role of ['app','bot'])await call('/api/secrets/add',{name:`${id}-${role}`,purpose:'Synthetic Slack token',value:`${role==='app'?'xapp':'xoxb'}-synthetic-${id}`});
   await call(kind==='command'?'/api/commands':'/api/tasks',kind==='command'?{id,botId:bot.id,content:'Set up Slack'}:{id,botId:bot.id,objective:'Set up Slack'});
   const appRequest=await until(async()=>(await call('/api/inbox')).find(item=>item.kind==='secret'&&item.work.id===id));
   if(mode==='hybrid'){const saved=(await call('/api/secrets')).find(item=>item.name===`${id}-app`);await call(`/api/secret-requests/${appRequest.id}/select`,{name:saved.name,revision:saved.revision});}else await call(`/api/secret-requests/${appRequest.id}/save`,{value:`xapp-synthetic-${id}`});
   const botRequest=await until(async()=>(await call('/api/inbox')).find(item=>item.kind==='secret'&&item.work.id===id&&item.id!==appRequest.id));
   if(mode==='hybrid'){const saved=(await call('/api/secrets')).find(item=>item.name===`${id}-bot`);await call(`/api/secret-requests/${botRequest.id}/select`,{name:saved.name,revision:saved.revision});}else await call(`/api/secret-requests/${botRequest.id}/save`,{value:`xoxb-synthetic-${id}`});
   const approval=await until(async()=>(await call('/api/inbox')).find(item=>item.kind==='slack-setup'&&item.work.id===id));
   await call(`/api/slack-setup/${approval.id}/dismiss`,{approval:approval.approval});
   const completed=await until(async()=>{const item=await call((kind==='command'?'/api/commands/':'/api/tasks/')+id);return !['pending','queued','running','waiting'].includes(item.state)&&item;});
   assert.equal(completed.state,'completed');assert.ok(!JSON.stringify(completed).includes(`synthetic-${id}`));
  }
  assert.ok(!JSON.stringify(model).includes('xapp-synthetic-'));assert.ok(!JSON.stringify(model).includes('xoxb-synthetic-'));assert.ok(!readFileSync(path).includes(Buffer.from('synthetic-')));
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
