import {createInterface} from 'node:readline';
import {startInstance} from '../../dist/instance-service.js';
const [path,port]=process.argv.slice(2);let receive;
const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{receive=handler;status?.('connected');return ()=>{receive=undefined}},post:async(_tokens,message)=>{process.stdout.write('POST '+JSON.stringify(message)+'\n');}};
const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>({role:'assistant',content:'Browser fixture reply'})});
const app=startInstance(path,Number(port),{env:{},slackTransport,providerFactory});await app.listen();
process.stdout.write('Pairing code: '+app.code+'\n');
createInterface({input:process.stdin}).on('line',line=>{if(line==='event' && receive)void receive({eventId:'EvBrowser',teamId:'T123',userId:'U123',channelId:'D123',text:'Hello from browser fixture'});});
process.on('SIGTERM',()=>{void app.close().then(()=>process.exit(0));});
