import {dirname} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';

const [path,integration,selectedStage]=process.argv.slice(2);
const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,_receive,status)=>{status?.('connected');return ()=>{};},post:async()=>{}};
const gmailRequest=async(url)=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',token_type:'Bearer',scope:'https://www.googleapis.com/auth/gmail.readonly'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
const app=startInstance(path,0,{dataDir:dirname(path),env:{},slackTransport,gmailRequest},{credentialTransition:(kind,stage)=>{if(kind===integration && stage===selectedStage)process.exit(73);}});
const port=await app.listen();process.send?.({port});
process.on('SIGTERM',()=>{void app.close().then(()=>process.exit(0));});
