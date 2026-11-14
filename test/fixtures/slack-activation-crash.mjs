import {startInstance} from '../../dist/instance-service.js';
import {dirname} from 'node:path';

const [path,stage]=process.argv.slice(2);
const app=startInstance(path,0,{
 dataDir:dirname(path),env:{},
 slackTransport:{identify:async()=>({teamId:'T123',botUserId:'B123'}),verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),start:async(_tokens,_receive,status)=>{status?.('connected');return ()=>{};},post:async()=>{}},
 providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1)?.role==='tool'?{role:'assistant',content:'Done'}:{role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};}}),
},{slackActivation:current=>{if(current===stage)process.kill(process.pid,'SIGKILL');}});
const port=await app.listen();process.send?.({port,code:app.code});
