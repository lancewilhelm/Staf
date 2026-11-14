import {dirname} from 'node:path';
import {startInstance} from '../../dist/instance-service.js';

const [path,stage]=process.argv.slice(2);let armed=false;
const gmailRequest=async url=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'}):Response.json({emailAddress:'owner@example.test',historyId:'100'});
const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'Done'}:{role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'guide_gmail_setup',arguments:'{}'}}]};}});
const app=startInstance(path,0,{dataDir:dirname(path),env:{},gmailRequest,providerFactory},{credentialTransition:(kind,point)=>{if(armed && kind==='gmail' && point===stage)process.exit(73);}});const port=await app.listen();let token;
const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(`Fixture failed: ${route}`);return value;};
const until=async fn=>{for(let i=0;i<500;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Fixture timed out');};
token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Agent',provider:'live',model:'fixture',toolMode:'direct'});
await call('/api/commands',{id:'setup',botId:bot.id,content:'Set up Gmail'});await until(async()=>(await call('/api/commands/setup')).state==='completed');const q=await until(async()=>(await call('/api/question-sets')).find(item=>item.workId==='setup'));
await call(`/api/question-sets/${q.id}/draft`,{answers:[{choices:[],writeIn:'owner@example.test'},{choices:[],writeIn:'synthetic-client-id'},null,null]});await call(`/api/question-sets/${q.id}/secret/2/save`,{value:'synthetic-client-secret'});
const preview=await call(`/api/question-sets/${q.id}/gmail-preview`),before=await call('/api/secret-grants'),start=await call(`/api/question-sets/${q.id}/gmail-start`,{...preview,confirm:true,confirmDisplacements:false});
const auth=new URL(start.url),callback=new URL(auth.searchParams.get('redirect_uri'));callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');process.send?.({token,before,preview,id:q.id});armed=true;await fetch(callback);process.exit(74);
