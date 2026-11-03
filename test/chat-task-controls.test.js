import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

test('main chat never offers or executes unsolicited background creation; explicit tasks remain available',async()=>{
 let offered;
 const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){offered=tools.map(t=>t.function.name);if(messages.at(-1).role==='tool')return {role:'assistant',content:'I started the background task'};return {role:'assistant',content:null,tool_calls:[{id:'unsolicited',type:'function',function:{name:'start_background_task',arguments:'{"objective":"Work"}'}}]};}})}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return r.json()};
 try{const token=(await call('/api/pair','',{code:app.code})).token,bot=await call('/api/bots',token,{name:'A'});
 await call('/api/commands',token,{id:'deferred',botId:bot.id,content:'Start background work'});
 let command;for(let i=0;i<200;i++){command=await call('/api/commands/deferred',token);if(command.state!=='pending')break;await new Promise(r=>setTimeout(r,5));}
 assert.ok(!offered.includes('start_background_task'));
 assert.equal(command.state,'completed');assert.equal((await call(`/api/bots/${bot.id}/tasks`,token)).length,0);
 assert.match((await call(`/api/bots/${bot.id}/messages`,token)).at(-1).content,/deferred|unavailable/i);
 }finally{await app.close()}
});

test('explicit background task remains controllable by chat ID',async()=>{
 let chatId,entered,taskCalls=0;const started=new Promise(resolve=>{entered=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,tools,{signal}){
  if(profile.chatId===chatId)return {role:'assistant',content:'No new task was started.'};
  taskCalls++;entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('stopped');
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 const wait=async(route,token,predicate)=>{for(let i=0;i<300;i++){const item=(await call(route,token))[1];if(predicate(item))return item;await new Promise(resolve=>setTimeout(resolve,5));}throw Error('timed out');};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Owner'}))[1];chatId=bot.chatId;
  const request={id:'chat-one',botId:bot.id,content:'Investigate in background'};assert.equal((await call('/api/commands',token,request))[1].kind,'accepted');await call('/api/tasks',token,{id:'explicit-task',botId:bot.id,objective:'Investigate evidence'});await started;await wait('/api/commands/chat-one',token,item=>item.state==='completed');
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
