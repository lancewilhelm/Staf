import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

const until=async fn=>{for(let i=0;i<500;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

test('Slack background request delivers an actual outcome without another message',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-work-'));let receive,release,entered,calls=0;const posts=[];
 const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{calls++;entered();await gate;return {role:'assistant',content:'Actual task result'}}});
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvWork',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'123.1',text:'work: Investigate'};
  await receive(event);await receive(event);await started;
  const receipt=await until(()=>posts.find(p=>/Task .* accepted/.test(p.text)));assert.equal(receipt.threadTs,'123.1');
  await receive({...event,eventId:'EvBusy',text:'work: Another request'});await until(()=>posts.find(p=>p.text.includes('new request was not accepted')));
  release();const result=await until(()=>posts.find(p=>p.text.includes('Actual task result')));assert.equal(result.threadTs,'123.1');assert.equal(calls,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('disabled delivery resumes after restart, rate limits retry, and stale controls stay bound',async()=>{
 const {SlackRateLimited}=await import('../dist/slack.js');
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-recovery-')),path=join(dir,'db');let receive,release,entered,calls=0,rateLimited=true;const posts=[];
 const gate=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{if(rateLimited){rateLimited=false;throw new SlackRateLimited(10);}posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{calls++;entered();await gate;return {role:'assistant',content:'Recovered result'}}});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvRecover',teamId:'T123',userId:'U123',channelId:'D123',messageTs:'456.7',text:'work: Investigate'};await receive(event);await started;
  const receipt=await until(()=>posts.find(p=>/ accepted/.test(p.text)));assert.equal(receipt.threadTs,'456.7');const id=receipt.text.match(/Task (\S+) accepted/)[1];
  await call('/api/plugins/slack/disable',token,{});release();await until(async()=>((await call(`/api/tasks/${id}`,token))[1]).state==='completed');assert.equal(posts.some(p=>p.text.includes('Recovered result')),false);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await call('/api/plugins/slack/enable',token,{});await until(()=>receive);
  await until(()=>posts.find(p=>p.text.includes('Recovered result')));assert.equal(calls,1);
  await receive({...event,eventId:'EvStale',text:`stop task ${id}`});await until(()=>posts.find(p=>p.text.includes('is not active')));assert.equal(((await call(`/api/tasks/${id}`,token))[1]).state,'completed');
  await receive(event);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(posts.filter(p=>p.text.includes('Recovered result')).length,1);assert.equal(calls,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Slack controls stop only the bound attempt and preserve a stopped outcome',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-stop-'));let receive,entered,release,enteredLater,releaseLater,calls=0;const posts=[];
 const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve}),laterStarted=new Promise(resolve=>{enteredLater=resolve}),laterGate=new Promise(resolve=>{releaseLater=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{calls++;if(calls===1){entered();await gate;return {role:'assistant',content:'Late observation'}}enteredLater();await laterGate;return {role:'assistant',content:'Later result'}}});
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvStopWork',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'1.2',text:'work: Wait'};await receive(event);await started;
  const receipt=await until(()=>posts.find(p=>/ accepted/.test(p.text))),id=receipt.text.match(/Task (\S+) accepted/)[1];
  await receive({...event,eventId:'EvBadStop',userId:'U999',text:`stop task ${id}`});assert.equal((await call(`/api/tasks/${id}`,token))[1].state,'running');
  const stop={...event,eventId:'EvStop',text:`stop task ${id}`};await receive(stop);await receive(stop);await until(()=>posts.find(p=>p.text.includes('Stop requested')));release();
  await until(()=>posts.find(p=>p.text.includes('stopped: Task stopped')));const task=(await call(`/api/tasks/${id}`,token))[1];assert.equal(task.state,'stopped');assert.ok(task.activity.some(e=>e.type==='assistant_observed' && e.text==='Late observation'));assert.equal(posts.filter(p=>p.text.includes('Stop requested')).length,1);
  await call('/api/tasks',token,{id:'later-attempt',botId:bot.id,objective:'Later work'});await laterStarted;await receive({...event,eventId:'EvOldStop',text:`stop task ${id}`});await until(()=>posts.find(p=>p.text.includes('is not active')));assert.equal((await call('/api/tasks/later-attempt',token))[1].state,'running');releaseLater();
 }finally{release();releaseLater();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Slack status and direction apply to the selected task and its real progress',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-direction-'));let receive,entered,release,calls=0;const posts=[],requests=[];
 const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},complete:async messages=>{calls++;requests.push(structuredClone(messages));if(calls===1){entered();await gate;return {role:'assistant',content:'Initial observation'};}if(calls===2)return {role:'assistant',content:null,tool_calls:[{id:'missing-tool',type:'function',function:{name:'not_a_tool',arguments:'{}'}}]};return {role:'assistant',content:'Directed result'};}});
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvDirectionWork',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'8.9',text:'work: Investigate'};await receive(event);await started;const receipt=await until(()=>posts.find(p=>/ accepted/.test(p.text))),id=receipt.text.match(/Task (\S+) accepted/)[1];
  await receive({...event,eventId:'EvStatus',text:`status task ${id}`});await until(()=>posts.find(p=>p.text===`Task ${id} running`));
  const direction={...event,eventId:'EvDirection',text:`direct task ${id}: Focus on the second file`};await receive(direction);await receive(direction);await until(()=>posts.find(p=>p.text.includes('Input accepted')));release();
  await until(()=>posts.find(p=>p.text.includes('Directed result')));assert.ok(requests.some(messages=>JSON.stringify(messages).includes('Focus on the second file')));assert.ok(posts.some(p=>p.text.includes('not_a_tool')));assert.equal(posts.filter(p=>p.text.includes('Input accepted')).length,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('an ambiguous result delivery is retained and never replayed after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-uncertain-')),path=join(dir,'db');let receive,outcomeCalls=0,modelCalls=0;const posts=[];
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{if(message.text.includes('Final answer')){outcomeCalls++;throw Error('connection lost after dispatch');}posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{modelCalls++;return {role:'assistant',content:'Final answer'}}});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvUncertainWork',teamId:'T123',userId:'U123',channelId:'D123',text:'work: Investigate'};await receive(event);
  const delivery=await until(async()=>((await call('/api/plugins',token))[1][0].deliveries.find(d=>d.id.endsWith(':outcome') && d.state==='uncertain')));assert.ok(delivery);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await until(()=>receive);await receive(event);await new Promise(resolve=>setTimeout(resolve,600));assert.equal(outcomeCalls,1);assert.equal(modelCalls,1);assert.equal((await call('/api/plugins',token))[1][0].deliveries.find(d=>d.id===delivery.id).state,'uncertain');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 41 upgrades Slack work without replacing configured core tools or plugin access',async()=>{
 const {Instance}=await import('../dist/instance.js'),{DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-slack-upgrade-')),path=join(dir,'db');let instance=new Instance(path);
 try{
  const bot=instance.createBot({name:'Agent',provider:'live',model:'fixture',instructions:''});instance.plugins.connect({teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});instance.plugins.setAccess(bot.id,true);instance.plugins.setEnabled(true);const connection=instance.plugins.connection();
  instance.setToolDefaults({revision:1,clock:false,memory:true,web:false,files:true});const settings=instance.toolDefaults();instance.close();instance=undefined;
  const db=new DatabaseSync(path);db.exec('DROP TABLE slack_deliveries; DROP TABLE slack_notices; DROP TABLE slack_work; PRAGMA user_version=41');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.deepEqual(instance.toolDefaults(),settings);assert.deepEqual(instance.plugins.connection(),connection);assert.deepEqual(instance.plugins.deliveries(),[]);
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart reports interrupted work without restarting its provider',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-interrupted-')),path=join(dir,'db');let receive,entered,calls=0;const posts=[];
 const started=new Promise(resolve=>{entered=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async(_messages,_tools,{signal})=>{calls++;entered();await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});throw Error('interrupted');}});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  await receive({eventId:'EvInterrupted',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'9.1',text:'work: Investigate'});await started;await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await until(()=>receive);
  const result=await until(()=>posts.find(p=>p.text.includes('interrupted: Instance restarted during execution')));assert.equal(result.threadTs,'9.1');assert.equal(calls,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('socket reconnect resumes pending task delivery without rerunning the task',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-reconnect-'));let receive,status,entered,release,calls=0;const posts=[];
 const started=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,onStatus)=>{receive=handler;status=onStatus;status('connected');return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{calls++;entered();await gate;return {role:'assistant',content:'Reconnect result'}}});
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Agent',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  await receive({eventId:'EvReconnect',teamId:'T123',userId:'U123',channelId:'D123',threadTs:'5.1',text:'work: Investigate'});await started;const receipt=await until(()=>posts.find(p=>/ accepted/.test(p.text))),id=receipt.text.match(/Task (\S+) accepted/)[1];status('reconnecting');release();await until(async()=>((await call(`/api/tasks/${id}`,token))[1]).state==='completed');await new Promise(resolve=>setTimeout(resolve,350));assert.equal(posts.some(p=>p.text.includes('Reconnect result')),false);
  status('connected');const result=await until(()=>posts.find(p=>p.text.includes('Reconnect result')));assert.equal(result.threadTs,'5.1');assert.equal(calls,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
