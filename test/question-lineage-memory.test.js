import test from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from './fixtures/controlled-instance.mjs';

test('question continuation blocks an originating change and permits a distinct service-owned change',async()=>{
 const app=startInstance(':memory:',0,{providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,_offers,options){
  const results=messages.slice(messages.findLastIndex(message=>message.role==='user')+1).filter(message=>message.role==='tool');
  const invoke=(id,name,input)=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:profile.toolMode==='code'?{name:'code_mode',arguments:JSON.stringify({source:`return await capabilities.${name}(${JSON.stringify(input)});`})}:{name,arguments:JSON.stringify(input)}}]});
  const memory=text=>({scope:{kind:'agent'},text,classification:'ordinary'});
  if(options.currentUserInput==='Start'){if(!results.length)return invoke('original','memory_remember',memory('original preference'));if(results.length===1)return invoke('question','ask_questions',{questions:[{kind:'text',prompt:'Continue?'}]});}
  if(options.currentUserInput?.includes('Owner response to question set')){if(!results.length)return invoke('repeat','memory_remember',memory('original preference'));if(results.length===1)return invoke('new','memory_remember',memory('new preference'));}
  return {role:'assistant',content:'Done'};
 }})});
 const wait=async fn=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
 try {const port=await app.listen();let token;const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};token=(await call('/api/pair',{code:app.code})).token;
  for(const mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture-offline',toolMode:mode});const id='origin-'+mode;await call('/api/commands',{id,botId:bot.id,content:'Start'});await wait(async()=>(await call('/api/commands/'+id)).state==='completed');const question=(await call('/api/question-sets')).find(item=>item.workId===id);assert.ok(question);await call(`/api/question-sets/${question.id}/submit`,{});await wait(async()=>(await call('/api/question-sets')).find(item=>item.id===question.id).continuationState==='completed');const entries=await call(`/api/memories/bot/${bot.id}`);assert.deepEqual(entries.map(entry=>entry.text).sort(),['new preference','original preference']);const work=await call('/api/commands/'+question.continuationId);assert.equal(work.workActions.filter(action=>action.state==='succeeded').length,1);const chat=await call(`/api/bots/${bot.id}/chat-work`);assert.match(JSON.stringify(chat.requests.find(item=>item.id===question.continuationId).events),/originating work cannot be repeated/);}
 }finally{await app.close();}
});
