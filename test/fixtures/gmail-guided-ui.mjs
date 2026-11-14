import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';

// Disposable service, synthetic model and Google responses. Do not use real credentials.
const directory=mkdtempSync(join(tmpdir(),'staf-gmail-guided-ui-'));
const app=startInstance(join(directory,'instance.sqlite'),0,{
 dataDir:directory,env:{},gmailPollIntervalMs:3600000,
 gmailRequest:async url=>new URL(url).hostname==='oauth2.googleapis.com'
  ?Response.json({access_token:'synthetic-access-token-7415',refresh_token:'synthetic-refresh-token-71293',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'})
  :Response.json({emailAddress:'owner@example.test',historyId:'100'}),
 providerFactory:async()=>({name:'offline-fixture',capabilities:{toolCalls:true},async complete(messages,_tools,options){
  if(messages.at(-1)?.role==='tool' || options.currentUserInput?.includes('Owner response to question set'))return {role:'assistant',content:'The fixture response was received. Check the Gmail setup status.'};
  return {role:'assistant',content:null,tool_calls:[{id:'gmail-setup',type:'function',function:{name:'guide_gmail_setup',arguments:'{}'}}]};
 }}),
});
// Expose only a synthetic loopback callback for the disposable fixture. The
// production authorization URL is never opened by this fixture.
app.server.prependListener('request',(req,res)=>{
 if(req.method!=='POST' || !/^\/api\/question-sets\/[\w-]+\/gmail-start$/.test(req.url??''))return;
 const end=res.end;
 res.end=function(chunk,...args){
  try {const result=JSON.parse(String(chunk)),url=new URL(result.url),callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');console.log(`Synthetic callback: ${callback}`);}catch{/* Failed requests have no authorization URL. */}
  return end.call(this,chunk,...args);
 };
});
try {const port=await app.listen();console.log(`Offline workspace: http://127.0.0.1:${port}/\nPairing code: ${app.code}\nCreate an agent using provider live and model fixture-offline, then ask for Gmail setup. Use owner@example.test, synthetic-client, and synthetic-client-secret. Leave optional scopes unchecked. After confirming, open the synthetic callback printed here; do not open the Google link. Press Ctrl-C to remove the disposable workspace.`);}
catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;try{await app.close();}finally{rmSync(directory,{recursive:true,force:true});}}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
