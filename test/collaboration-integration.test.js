import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

test('default synthetic providers exchange actual messages and requester uses the inbox result',async()=>{
 let helperId,rootCalls=0;const helperInputs=[];
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
  if(profile.chatId==='root') {
   if(rootCalls++===0) {assert.ok(tools.some(tool=>tool.function.name==='request_bot_help'));return {role:'assistant',content:null,tool_calls:[{id:'ask-helper',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check one fact',context:'Only explicit brief'})}}]};}
   assert.match(JSON.stringify(messages),/Verified fact/);return {role:'assistant',content:'Synthesized from verified fact'};
  }
  helperInputs.push(structuredClone(messages));assert.ok(!tools.some(tool=>tool.function.name==='request_bot_help'));return {role:'assistant',content:'Verified fact'};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory});const port=await app.listen();
 let approvalTimer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();if(route==='/api/pair' && value.token){const ownerToken=value.token;approvalTimer=setInterval(async()=>{try{const pending=await (await fetch(`http://127.0.0.1:${port}/api/disclosures`,{headers:{Authorization:`Bearer ${ownerToken}`}})).json();for(const item of pending.filter(x=>x.state==='pending'))await fetch(`http://127.0.0.1:${port}/api/disclosures/${item.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'},body:'{}'});}catch{}},5);}return [response.status,value];};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate',delegateClock:false});
  let result;for(let i=0;i<200;i++){result=(await call('/api/tasks/root',token))[1];if(['completed','failed'].includes(result.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result.state,'completed');assert.equal(result.outcome,'Synthesized from verified fact');
  assert.deepEqual(result.collaborations[0].messages.map(message=>message.kind),['request','result']);
  assert.equal(result.inbox.inputs.length,1);assert.equal(result.inbox.inputs[0].status,'applied');
  assert.match(JSON.stringify(helperInputs),/Only explicit brief/);assert.doesNotMatch(JSON.stringify(helperInputs),/Investigate/);
 } finally {clearInterval(approvalTimer);await app.close();}
});

test('gated helper clock is blocked when the owner omitted delegated clock scope',async()=>{
 let helperId,rootCalls=0,clockResult;
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  if(profile.chatId==='root') {if(rootCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Read clock',context:'Only this'})}}]};clockResult=JSON.stringify(messages);return {role:'assistant',content:'Observed helper outcome'};}
  return {role:'assistant',content:null,tool_calls:[{id:'clock',type:'function',function:{name:'clock',arguments:'{}'}}]};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 let approvalTimer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();if(route==='/api/pair' && value.token){const ownerToken=value.token;approvalTimer=setInterval(async()=>{try{const pending=await (await fetch(`http://127.0.0.1:${port}/api/disclosures`,{headers:{Authorization:`Bearer ${ownerToken}`}})).json();for(const item of pending.filter(x=>x.state==='pending'))await fetch(`http://127.0.0.1:${port}/api/disclosures/${item.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'},body:'{}'});}catch{}},5);}return [response.status,value];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});let root;for(let i=0;i<200;i++){root=(await call('/api/tasks/root',token))[1];if(['completed','failed'].includes(root.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(root.state,'completed');assert.match(clockResult,/Clock blocked/);assert.deepEqual(root.collaborations[0].messages.map(message=>message.kind),['request','failure']);
 } finally {clearInterval(approvalTimer);await app.close();}
});

test('gated parent stop aborts helper and never delivers a stale result',async()=>{
 let helperId,entered;const started=new Promise(resolve=>{entered=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,_tools,{signal}){
  if(profile.chatId==='root')return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check',context:'Only this'})}}]};
  entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('aborted');
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 let approvalTimer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();if(route==='/api/pair' && value.token){const ownerToken=value.token;approvalTimer=setInterval(async()=>{try{const pending=await (await fetch(`http://127.0.0.1:${port}/api/disclosures`,{headers:{Authorization:`Bearer ${ownerToken}`}})).json();for(const item of pending.filter(x=>x.state==='pending'))await fetch(`http://127.0.0.1:${port}/api/disclosures/${item.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'},body:'{}'});}catch{}},5);}return [response.status,value];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});await started;await call('/api/tasks/root/stop',token,{});
  let root;for(let i=0;i<200;i++){root=(await call('/api/tasks/root',token))[1];if(root.state==='stopped' && root.collaborations[0].assignment.state==='cancelled')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(root.state,'stopped');assert.equal(root.collaborations[0].assignment.state,'cancelled');assert.equal(root.collaborations[0].messages.length,1);assert.equal(root.inbox.inputs.length,0);
 } finally {clearInterval(approvalTimer);await app.close();}
});

test('gated helper rechecks requester permissions after approval is requested',async()=>{
 let helperId,rootCalls=0;
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){
  if(profile.chatId==='root'){if(rootCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Read clock',context:'Only this'})}}]};return {role:'assistant',content:'Observed helper failure'};}
  return {role:'assistant',content:null,tool_calls:[{id:'clock',type:'function',function:{name:'clock',arguments:'{}'}}]};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 let approvalTimer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();if(route==='/api/pair' && value.token){const ownerToken=value.token;approvalTimer=setInterval(async()=>{try{const pending=await (await fetch(`http://127.0.0.1:${port}/api/disclosures`,{headers:{Authorization:`Bearer ${ownerToken}`}})).json();for(const item of pending.filter(x=>x.state==='pending'))await fetch(`http://127.0.0.1:${port}/api/disclosures/${item.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'},body:'{}'});}catch{}},5);}return [response.status,value];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call(`/api/approval-settings/bot:${helperId}`,token,{mode:'ask-every-time',clockEnabled:true});
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate',delegateClock:true});
  let approval;for(let i=0;i<200;i++){approval=(await call('/api/approvals',token))[1].find(item=>item.state==='pending');if(approval)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(approval);
  await call(`/api/approval-settings/bot:${owner.id}`,token,{mode:null,clockEnabled:false});await call(`/api/approvals/${approval.id}/approve`,token,{});
  let root;for(let i=0;i<200;i++){root=(await call('/api/tasks/root',token))[1];if(['completed','failed'].includes(root.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(root.state,'completed');assert.deepEqual(root.collaborations[0].messages.map(message=>message.kind),['request','failure']);assert.match(root.collaborations[0].messages[1].body,/Clock blocked/);
 } finally {clearInterval(approvalTimer);await app.close();}
});

test('gated restart interrupts both attempts without replaying helper work',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'staf-helper-restart-')),path=join(dir,'db');let helperId,entered,calls=0;const started=new Promise(resolve=>{entered=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,_tools,{signal}){if(profile.chatId==='root')return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check',context:'Only this'})}}]};calls++;entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('aborted');}});
 let app=startInstance(path,0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 let approvalTimer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await response.json();if(route==='/api/pair' && value.token){const ownerToken=value.token;approvalTimer=setInterval(async()=>{try{const pending=await (await fetch(`http://127.0.0.1:${port}/api/disclosures`,{headers:{Authorization:`Bearer ${ownerToken}`}})).json();for(const item of pending.filter(x=>x.state==='pending'))await fetch(`http://127.0.0.1:${port}/api/disclosures/${item.id}/approve`,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'},body:'{}'});}catch{}},5);}return [response.status,value];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});await started;await app.close();app=startInstance(path,0,{env:{},providerFactory:factory,enableCollaboration:true});port=await app.listen();
  const root=(await call('/api/tasks/root',token))[1];assert.equal(root.state,'interrupted');assert.equal(root.collaborations[0].assignment.state,'cancelled');assert.equal(root.collaborations[0].messages.length,1);assert.equal(calls,1);
  const helperAttempt=(await call(`/api/tasks/${root.collaborations[0].assignment.helper_attempt_id}`,token))[1];assert.equal(helperAttempt.state,'interrupted');
 } finally {clearInterval(approvalTimer);await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('gated bots exchange approved and correlated question and answer messages',async()=>{
 let helperId,rootCalls=0,helperCalls=0,helperAnswer;
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  if(profile.chatId==='root'){
   if(rootCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check',context:'Only this'})}}]};
   if(rootCalls===2){const text=JSON.stringify(messages);const match=text.match(/Assignment ID: ([a-f0-9]+)\. Question ID: ([a-f0-9-]+)/);assert.ok(match);return {role:'assistant',content:null,tool_calls:[{id:'answer',type:'function',function:{name:'answer_bot',arguments:JSON.stringify({assignmentId:match[1],questionId:match[2],answer:'Use the primary source'})}}]};}
   assert.match(JSON.stringify(messages),/Verified fact/);return {role:'assistant',content:'Synthesized result'};
  }
  if(helperCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'question',type:'function',function:{name:'ask_owner',arguments:JSON.stringify({question:'Which source?'})}}]};
  helperAnswer=messages.at(-1).content;return {role:'assistant',content:'Verified fact'};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();let timer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  timer=setInterval(async()=>{try{for(const item of (await call('/api/disclosures',token))[1].filter(x=>x.state==='pending'))await call(`/api/disclosures/${item.id}/approve`,token,{});}catch{}},5);
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});let root;for(let i=0;i<300;i++){root=(await call('/api/tasks/root',token))[1];if(['completed','failed'].includes(root.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(root.state,'completed');assert.equal(helperAnswer,'Use the primary source');assert.deepEqual(root.collaborations[0].messages.map(message=>message.kind),['request','question','answer','result']);
  const disclosures=(await call('/api/disclosures',token))[1];assert.deepEqual(disclosures.map(item=>item.kind).sort(),['answer','question','request','result']);assert.ok(disclosures.every(item=>item.state==='consumed'));
 }finally{clearInterval(timer);await app.close();}
});

test('denied request cannot create a helper task or disclose a forged private brief',async()=>{
 let helperId,rootCalls=0,helperCalls=0;
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){
  if(profile.chatId==='root'){if(rootCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'private transcript secret',context:'private memory secret'})}}]};return {role:'assistant',content:'Request denied'};}
  helperCalls++;return {role:'assistant',content:'Should never run'};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});let disclosure;for(let i=0;i<200;i++){disclosure=(await call('/api/disclosures',token))[1].find(item=>item.state==='pending');if(disclosure)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.ok(disclosure);assert.match(disclosure.content,/private transcript secret/);assert.equal(helperCalls,0);assert.equal((await call(`/api/bots/${helperId}/tasks`,token))[1].length,0);assert.equal((await call('/api/tasks/root',token))[1].collaborations.length,0);
  await call(`/api/disclosures/${disclosure.id}/deny`,token,{});let root;for(let i=0;i<200;i++){root=(await call('/api/tasks/root',token))[1];if(root.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(root.state,'completed');assert.equal(helperCalls,0);assert.equal((await call(`/api/bots/${helperId}/tasks`,token))[1].length,0);
 }finally{await app.close();}
});

test('provider output observed after parent stop stays in helper activity only',async()=>{
 let helperId,entered;const started=new Promise(resolve=>{entered=resolve});
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(_messages,_tools,{signal}){
  if(profile.chatId==='root')return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check',context:'Only this'})}}]};
  entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});return {role:'assistant',content:'private late helper output'};
 }});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try {const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});let disclosure;for(let i=0;i<200;i++){disclosure=(await call('/api/disclosures',token))[1].find(item=>item.kind==='request' && item.state==='pending');if(disclosure)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(disclosure);await call(`/api/disclosures/${disclosure.id}/approve`,token,{});await started;
  const before=(await call('/api/tasks/root',token))[1],childId=before.collaborations[0].assignment.helper_attempt_id;await call('/api/tasks/root/stop',token,{});
  let child;for(let i=0;i<200;i++){child=(await call(`/api/tasks/${childId}`,token))[1];if(child.state==='stopped')break;await new Promise(resolve=>setTimeout(resolve,10));}
  const root=(await call('/api/tasks/root',token))[1];assert.equal(child.state,'stopped');assert.ok(child.activity.some(event=>event.type==='assistant_observed' && event.text==='private late helper output'));
  assert.doesNotMatch(JSON.stringify(root),/private late helper output/);assert.equal(root.collaborations[0].messages.length,1);assert.equal(root.inbox.inputs.length,0);
 }finally{await app.close();}
});

test('service settles a helper when owner input races both result and failure disclosure',async()=>{
 const {Instance}=await import('../dist/instance.js');const originalComplete=Instance.prototype.taskComplete,originalFinish=Instance.prototype.taskFinish;
 let helperId,rootCalls=0, injectedResult=false,injectedFailure=false;
 Instance.prototype.taskComplete=function(id,session,disclosureId){if(id!=='root' && disclosureId && !injectedResult){injectedResult=true;this.taskInput({attemptId:'root',commandId:'race-result',kind:'direction',text:'Do not share'},'Do not share');}return originalComplete.call(this,id,session,disclosureId);};
 Instance.prototype.taskFinish=function(id,state,outcome,disclosureId){if(id!=='root' && state==='failed' && disclosureId && !injectedFailure){injectedFailure=true;this.taskInput({attemptId:'root',commandId:'race-failure',kind:'direction',text:'Still do not share'},'Still do not share');}return originalFinish.call(this,id,state,outcome,disclosureId);};
 const factory=async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(){if(profile.chatId==='root'){if(rootCalls++===0)return {role:'assistant',content:null,tool_calls:[{id:'request',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId,objective:'Check',context:'Only this'})}}]};return {role:'assistant',content:'Stopped sharing'};}return {role:'assistant',content:'private result'};}});
 const app=startInstance(':memory:',0,{env:{},providerFactory:factory,enableCollaboration:true}),port=await app.listen();let timer;
 const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [response.status,await response.json()];};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token,owner=(await call('/api/bots',token,{name:'Owner'}))[1];helperId=(await call('/api/bots',token,{name:'Helper'}))[1].id;
  timer=setInterval(async()=>{try{for(const item of (await call('/api/disclosures',token))[1].filter(x=>x.state==='pending'))await call(`/api/disclosures/${item.id}/approve`,token,{});}catch{}},5);
  await call('/api/tasks',token,{id:'root',botId:owner.id,objective:'Investigate'});let root,child;for(let i=0;i<300;i++){root=(await call('/api/tasks/root',token))[1];if(root.collaborations.length){child=(await call(`/api/tasks/${root.collaborations[0].assignment.helper_attempt_id}`,token))[1];if(child.state==='stopped')break;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(injectedResult,true);assert.equal(injectedFailure,true);assert.equal(child.state,'stopped');assert.equal(root.collaborations[0].assignment.state,'cancelled');assert.doesNotMatch(JSON.stringify(root),/private result/);
  const disclosures=(await call('/api/disclosures',token))[1];assert.equal(disclosures.find(item=>item.kind==='result').state,'interrupted');assert.equal(disclosures.find(item=>item.kind==='failure').state,'interrupted');
 }finally{clearInterval(timer);Instance.prototype.taskComplete=originalComplete;Instance.prototype.taskFinish=originalFinish;await app.close();}
});
