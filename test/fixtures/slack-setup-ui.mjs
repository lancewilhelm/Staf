import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';

// Disposable service, model, and Slack transport; no live accounts or network calls.
const directory=mkdtempSync(join(tmpdir(),'staf-slack-setup-ui-'));
const app=startInstance(join(directory,'instance.sqlite'),0,{
 dataDir:directory,env:{},
 slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,_receive,status,_interact,assertAuthority)=>{assertAuthority();status?.('connected');return ()=>{};},post:async()=>{}},
 providerFactory:async()=>({name:'offline-fixture',capabilities:{toolCalls:true},async complete(messages){
  if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'The fixture action finished. Check its status in the work item and Slack settings.'};
  return {role:'assistant',content:null,tool_calls:[{id:'slack-setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};
 }}),
});
try {const port=await app.listen();console.log(`Offline workspace: http://127.0.0.1:${port}/\nPairing code: ${app.code}\nCreate an agent using provider live and model fixture-offline, then send any message. Use xapp-synthetic-app and xoxb-synthetic-bot in the protected requests. Press Ctrl-C to remove this disposable workspace.`);}
catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await app.close();}finally{rmSync(directory,{recursive:true,force:true});}}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
