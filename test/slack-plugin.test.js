import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

const until=async fn=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

test('Slack DM is approved, durable and delivered once, while plugin controls retain configuration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-')),path=join(dir,'db');let receive,connections=0,posts=[];
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler)=>{connections++;receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>({role:'assistant',content:'Fixture reply'})});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  assert.equal((await call('/api/plugins',token))[1][0].id,'slack');
  const bot=(await call('/api/bots',token,{name:'Slack agent',provider:'live',model:'fixture'}))[1];
  assert.equal((await call('/api/plugins/slack/connect',token,{appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);
  assert.equal(connections,0);
  await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});
  await call('/api/plugins/slack/enable',token,{});assert.equal(connections,1);
  const event={eventId:'Ev1',teamId:'T123',userId:'U123',channelId:'D123',text:'hello',threadTs:'123.1'};
  await receive({...event,userId:'U999'});assert.equal(posts.length,0);
  await receive(event);await receive(event);
  await until(()=>posts.length===1);assert.deepEqual(posts[0],{channel:'D123',threadTs:'123.1',text:'Fixture reply'});
  await call('/api/plugins/slack/disable',token,{});assert.equal(receive,undefined);
  let status=(await call('/api/plugins',token))[1][0];assert.equal(status.enabled,false);assert.equal(status.connected,true);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();
  await call('/api/plugins/slack/enable',token,{});await receive(event);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(posts.length,1);
  await call('/api/plugins/slack/disconnect',token,{});status=(await call('/api/plugins',token))[1][0];assert.equal(status.connected,false);assert.equal(status.config.userId,'U123');
  await call('/api/plugins/slack/delete-config',token,{});assert.equal((await call('/api/plugins',token))[1][0].config,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoking agent access cancels pending work and an uncertain send is never replayed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-revoke-')),path=join(dir,'db');let receive,release,started,posts=0;
 const waitForModel=new Promise(resolve=>{started=resolve});
 const gate=new Promise(resolve=>{release=resolve});let hold=true;
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{started();if(hold)await gate;return {role:'assistant',content:'private reply'}}});
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler)=>{receive=handler;return ()=>{receive=undefined}},post:async()=>{posts++;throw Error('ambiguous network result')}};
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Test agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',token,{appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});
  await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvRevoke',teamId:'T123',userId:'U123',channelId:'D123',text:'first'};
  await receive(event);await waitForModel;await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:false});release();
  await until(async()=>{const events=(await call('/api/plugins',token))[1][0].events;return events.find(e=>e.eventId==='EvRevoke' && e.state==='failed');});assert.equal(posts,0);
  hold=false;await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});
  const uncertain={...event,eventId:'EvUncertain',text:'second'};await receive(uncertain);
  await until(async()=>{const events=(await call('/api/plugins',token))[1][0].events;return events.find(e=>e.eventId==='EvUncertain' && e.state==='uncertain');});assert.equal(posts,1);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await until(()=>receive);await receive(uncertain);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(posts,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
