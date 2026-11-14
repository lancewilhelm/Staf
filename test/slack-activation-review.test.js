import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startInstance} from '../dist/instance-service.js';

test('Slack Settings refuses a DM that is not the approved user’s DM',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-dm-review-'));let checks=0,starts=0;
 const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),verifyDestination:async()=>{checks++;return {channelId:'DOTHER'};},start:async()=>{starts++;return ()=>{};},post:async()=>{throw Error('Unexpected send');}};
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{},slackTransport});
 try{
  const port=await app.listen();let token;const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  token=(await call('/api/pair',{code:app.code}))[1].token;const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'}))[1];
  const [status]=await call('/api/plugins/slack/connect',{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});
  assert.notEqual(status,200);assert.equal(checks,1);assert.equal(starts,0);assert.equal((await call('/api/plugins'))[1][0].connected,false);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a killed setup never auto-activates across any durable startup boundary',async()=>{
 for(const stage of ['intent','grants','bound','enabled','socket-open','committed']){
  const dir=mkdtempSync(join(tmpdir(),'staf-slack-crash-')),path=join(dir,'instance.sqlite');let app,child,port,token,starts=0;
  const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [response.status,await response.json()];};
  const until=async fn=>{for(let n=0;n<500;n++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  try {
   child=fork(fileURLToPath(new URL('./fixtures/slack-activation-crash.mjs',import.meta.url)),[path,stage],{stdio:['ignore','ignore','ignore','ipc']});
   const ready=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});port=ready.port;token=(await call('/api/pair',{code:ready.code}))[1].token;
   const bot=(await call('/api/bots',{name:'Agent',provider:'live',model:'fixture',toolMode:'direct'}))[1];await call('/api/commands',{id:'setup',botId:bot.id,content:'Setup Slack'});
   const first=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'));await call(`/api/secret-requests/${first.id}/save`,{value:'xapp-synthetic-crash'});
   const second=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='secret'&&item.id!==first.id));await call(`/api/secret-requests/${second.id}/save`,{value:'xoxb-synthetic-crash'});
   const request=await until(async()=>(await call('/api/inbox'))[1].find(item=>item.kind==='slack-setup'));
   const ended=new Promise(resolve=>child.once('exit',resolve));const pending=call(`/api/slack-setup/${request.id}/confirm`,{approval:request.approval}).catch(()=>null);await ended;await pending;child=undefined;
   const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),start:async(_tokens,_receive,status)=>{starts++;status?.('connected');return ()=>{};},post:async()=>{throw Error('Unexpected delivery');}};
   app=startInstance(path,0,{dataDir:dir,env:{},slackTransport});port=await app.listen();await new Promise(resolve=>setTimeout(resolve,100));assert.equal(starts,0,stage);
   const plugin=(await call('/api/plugins'))[1].find(item=>item.id==='slack');
   if(plugin.connected){if(plugin.enabled)assert.equal(plugin.status,'activation interrupted',stage);assert.equal((await call('/api/plugins/slack/enable',{}))[0],200,stage);assert.equal(starts,1,stage);}
   assert.ok(!readFileSync(path).includes(Buffer.from('xapp-synthetic-crash')));assert.ok(!readFileSync(path).includes(Buffer.from('xoxb-synthetic-crash')));
  } finally {child?.kill('SIGKILL');await app?.close();rmSync(dir,{recursive:true,force:true});}
 }
});
