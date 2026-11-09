import {startInstance} from '../../dist/instance-service.js';
const [path,port]=process.argv.slice(2);
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
const app=startInstance(path,Number(port),{env:{},gmailRequest});await app.listen();process.stdout.write('Pairing code: '+app.code+'\n');
process.on('SIGTERM',()=>{void app.close().then(()=>process.exit(0));});
