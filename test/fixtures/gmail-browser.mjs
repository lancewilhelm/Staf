import {startInstance} from '../../dist/instance-service.js';
import {Instance} from '../../dist/instance.js';
import {ActionJournal} from '../../dist/action-journal.js';
const [path,port]=process.argv.slice(2);
{
 const instance=new Instance(path),bot=instance.createBot({name:'Review fixture',instructions:'',provider:'live',model:'fixture'}),work={kind:'command',id:'browser-uncertain'};
 instance.claim({id:work.id,botId:bot.id,content:'Prepare synthetic reply'});
 const actionId='11111111-1111-4111-8111-111111111111',fingerprint='a'.repeat(64);
 new ActionJournal(instance.db).prepare({id:actionId,fingerprint,work,summary:'Send synthetic reply'});
 instance.createGmailReply({actionId,fingerprint,work,botId:bot.id,accountId:'owner@example.test',gmailRevision:1,slackRevision:1,teamId:'T123',userId:'U123',channelId:'D123',messageId:'fixture1',effect:JSON.stringify({messageId:'fixture1',to:'friend@example.test',subject:'Synthetic subject',body:'Synthetic uncertain body',threadId:'t1',inReplyTo:'<synthetic@example.test>'})});
 instance.db.prepare("UPDATE gmail_reply_proposals SET state='uncertain',detail='Outcome unknown' WHERE action_id=?").run(actionId);instance.close();
}
const gmailRequest=async(url)=>{
 const host=new URL(url).hostname;
 if(host==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'});
 if(host==='gmail.googleapis.com'){
  const path=new URL(url).pathname;
  if(path.endsWith('/profile'))return Response.json({emailAddress:'owner@example.test',historyId:'100'});
  if(path.endsWith('/history'))return Response.json({historyId:'101',history:[{messagesAdded:[{message:{id:'candidate-1'}}]}]});
  if(path.endsWith('/messages/candidate-1'))return Response.json({id:'candidate-1',snippet:'Browser fixture',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Synthetic arrival'}],body:{data:Buffer.from('Browser private fixture').toString('base64url')}}});
 }
 throw Error('Unexpected provider request');
};
const slackTransport={identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async()=>()=>{},post:async()=>({messageTs:'1.1'})};
const app=startInstance(path,Number(port),{env:{},gmailRequest,slackTransport});await app.listen();process.stdout.write('Pairing code: '+app.code+'\n');
process.on('SIGTERM',()=>{void app.close().then(()=>process.exit(0));});
