import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';
import {SecretRequests} from '../dist/secret-requests.js';

test('saved secret echoed by a chunked tool response is filtered in every mode',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-output-filter-')),path=join(dir,'instance.sqlite');
 const secret='fixture-stored-secret-74283',seen=[];
 const store=new SecretRequests(dir,false);store.create('seed','fixture',{kind:'command',id:'seed'},{name:'Fixture',purpose:'Test'});store.decide('seed','saved',secret);store.close();
 const webDependencies={resolve:async()=>[{address:'8.8.8.8',family:4}],request:async()=>({status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('ordinary '+secret.slice(0,12));yield Buffer.from(secret.slice(12)+' after');})(),close(){}})};
 const app=startInstance(path,0,{dataDir:dir,env:{},webDependencies,providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'Done'};const fn=profile.instructions==='direct'?{name:'read_web',arguments:JSON.stringify({url:'https://example.com/'})}:{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.read_web({url:"https://example.com/"});'})};return {role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:fn}]};}})});
 let closed=false;
 try {
  const port=await app.listen();let token;const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,`${route}: ${response.status}`);return response.json();};
  const until=async fn=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
  token=(await call('/api/pair',{code:app.code})).token;await call('/api/web-permissions/instance',{enabled:true});
  for(const mode of ['direct','hybrid','code']){
   const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture',toolMode:mode,instructions:mode});await call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});await call('/api/commands',{id:mode,botId:bot.id,content:'Read the fixture'});
   const approval=await until(async()=>(await call('/api/web-approvals')).find(item=>item.work.id===mode));await call(`/api/web-approvals/${approval.id}/approve`,{});
   const command=await until(async()=>{const c=await call('/api/commands/'+mode);return c.state!=='pending'&&c;});assert.equal(command.state,'completed');assert.equal(JSON.stringify(command).includes(secret),false);
   const chat=await call(`/api/bots/${bot.id}/chat-work`);assert.equal(JSON.stringify(chat).includes(secret),false);
  }
  assert.equal(JSON.stringify(seen).includes(secret),false);assert.ok(seen.some(value=>value.includes('[REDACTED]')&&value.includes('ordinary')));
  await app.close();closed=true;assert.equal(readFileSync(path).includes(Buffer.from(secret)),false);
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});
