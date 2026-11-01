import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

test('main chat starts one background task and controls it by explicit ID',async()=>{
 let chatId,entered,taskCalls=0;const started=new Promise(resolve=>{entered=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,tools,{signal}){
  if(profile.chatId===chatId){assert.ok(tools.some(tool=>tool.function.name==='start_background_task'));return {role:'assistant',content:null,tool_calls:[{id:'start',type:'function',function:{name:'start_background_task',arguments:JSON.stringify({objective:'Investigate evidence'})}}]};}
  taskCalls++;entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('stopped');
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 const wait=async(route,token,predicate)=>{for(let i=0;i<300;i++){const item=(await call(route,token))[1];if(predicate(item))return item;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('timed out');};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Owner'}))[1];chatId=bot.chatId;
  const request={id:'chat-one',botId:bot.id,content:'Investigate in background'};assert.equal((await call('/api/commands',token,request))[1].kind,'accepted');await started;await wait('/api/commands/chat-one',token,item=>item.state==='completed');
  const tasks=(await call(`/api/bots/${bot.id}/tasks`,token))[1];assert.equal(tasks.length,1);const id=tasks[0].id;assert.equal(tasks[0].delegationClock,0);
  assert.equal((await call('/api/commands',token,request))[1].kind,'existing');assert.equal(taskCalls,1);
  await call('/api/commands',token,{id:'chat-two',botId:bot.id,content:'Start another'});await wait('/api/commands/chat-two',token,item=>item.state==='completed');
  let messages=(await call(`/api/bots/${bot.id}/messages`,token))[1];assert.ok(messages.some(item=>item.role==='assistant' && /No new task was started/.test(item.content)));assert.equal((await call(`/api/bots/${bot.id}/tasks`,token))[1].length,1);
  await call('/api/commands',token,{id:'ambiguous',botId:bot.id,content:'stop the task'});await wait('/api/commands/ambiguous',token,item=>item.state==='completed');assert.equal((await call(`/api/tasks/${id}`,token))[1].state,'running');
  const other=(await call('/api/bots',token,{name:'Other'}))[1];
  await call('/api/commands',token,{id:'wrong-stop',botId:other.id,content:`stop task ${id}`});await wait('/api/commands/wrong-stop',token,item=>item.state==='completed');
  await call('/api/commands',token,{id:'wrong-direction',botId:other.id,content:`direct task ${id}: Alter work`});await wait('/api/commands/wrong-direction',token,item=>item.state==='completed');
  assert.equal((await call(`/api/tasks/${id}`,token))[1].state,'running');assert.equal((await call(`/api/tasks/${id}`,token))[1].inbox.inputs.length,0);
  const otherMessages=(await call(`/api/bots/${other.id}/messages`,token))[1];assert.equal(otherMessages.filter(item=>item.role==='assistant' && /No matching task/.test(item.content)).length,2);
  await call('/api/commands',token,{id:'direction',botId:bot.id,content:`direct task ${id}: Use the primary source`});await wait('/api/commands/direction',token,item=>item.state==='completed');assert.equal((await call(`/api/tasks/${id}`,token))[1].inbox.inputs[0].text,'Use the primary source');
  await call('/api/commands',token,{id:'stop',botId:bot.id,content:`stop task ${id}`});await wait('/api/commands/stop',token,item=>item.state==='completed');await wait(`/api/tasks/${id}`,token,item=>item.state==='stopped');
  messages=(await call(`/api/bots/${bot.id}/messages`,token))[1];assert.ok(messages.some(item=>item.role==='user' && item.content===`stop task ${id}`));assert.ok(messages.some(item=>item.role==='assistant' && item.content===`Stop requested for task ${id}.`));
 }finally{await app.close();}
});

test('two task tool calls in one provider response create only one task and report its acceptance',async()=>{
 let chatId,started;const taskStarted=new Promise(resolve=>{started=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,_tools,{signal}){
  if(profile.chatId===chatId)return {role:'assistant',content:null,tool_calls:['one','two'].map(id=>({id,type:'function',function:{name:'start_background_task',arguments:JSON.stringify({objective:'Investigate'})}}))};
  started();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('stopped');
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Owner'}))[1];chatId=bot.chatId;await call('/api/commands',token,{id:'chat',botId:bot.id,content:'Investigate'});await taskStarted;
  for(let i=0;i<100;i++){if((await call('/api/commands/chat',token))[1].state==='completed')break;await new Promise(resolve=>setTimeout(resolve,5));}
  const tasks=(await call(`/api/bots/${bot.id}/tasks`,token))[1],messages=(await call(`/api/bots/${bot.id}/messages`,token))[1];assert.equal(tasks.length,1);assert.ok(messages.some(message=>message.role==='assistant' && message.content.includes(`Background task ${tasks[0].id} accepted`)));
 }finally{await app.close();}
});
