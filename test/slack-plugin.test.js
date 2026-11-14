import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

const until=async fn=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};

test('credential-like Slack messages are not sent to the model or stored in ordinary records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-credential-')),path=join(dir,'db'),seen=[],posts=[];let receive;
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{};},post:async(_tokens,message)=>{posts.push(message);}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false},complete:async messages=>{seen.push(JSON.stringify(messages));return {role:'assistant',content:'reply'};}});
 const app=startInstance(path,0,{env:{},slackTransport,providerFactory});
 try {
  const port=await app.listen();let token;
  const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return r.json();};
  token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'Agent',provider:'live',model:'fixture'});
  await call('/api/plugins/slack/connect',{confirm:true,appToken:'xapp-connection',botToken:'xoxb-connection',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',{});
  const secrets=['xapp-synthetic-secret-12345','xoxb-synthetic-secret-12345'];
  for(const [i,secret] of secrets.entries())await receive({eventId:`secret${i}`,teamId:'T123',userId:'U123',channelId:'D123',text:`Please use ${secret}`,threadTs:'123.1'});
  await until(()=>posts.length===2);assert.equal(seen.length,0);assert.ok(posts.every(post=>post.text.includes('protected secret entry')));
  for(const secret of secrets){assert.ok(!JSON.stringify(posts).includes(secret));assert.ok(!readFileSync(path).includes(Buffer.from(secret)));}
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('Slack DM is approved, durable and delivered once, while plugin controls retain configuration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-')),path=join(dir,'db'),modelInputs=[];let receive,connections=0,posts=[];
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');connections++;receive=handler;return ()=>{receive=undefined}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async messages=>{modelInputs.push(JSON.stringify(messages));return {role:'assistant',content:'Fixture reply'};}});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  assert.equal((await call('/api/plugins',token))[1][0].id,'slack');
  const bot=(await call('/api/bots',token,{name:'Slack agent',provider:'live',model:'fixture'}))[1];
  assert.equal((await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id}))[0],200);
  assert.equal(connections,0);
  assert.equal(statSync(join(dir,'secrets','credentials.sqlite')).mode & 0o777,0o600);
  assert.equal((await call('/api/secret-grants',token))[1].filter(item=>item.integration.startsWith('slack.')).length,2);
  assert.doesNotMatch(JSON.stringify((await call('/api/plugins',token))[1]),/xapp-synthetic|xoxb-synthetic/);
  await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});
  await call('/api/plugins/slack/enable',token,{});assert.equal(connections,1);
  const event={eventId:'Ev1',teamId:'T123',userId:'U123',channelId:'D123',text:'hello',threadTs:'123.1'};
  await receive({...event,userId:'U999'});await receive({...event,teamId:'T999'});await receive({...event,channelId:'D999'});assert.equal(posts.length,0);
  await receive(event);await receive(event);
  await until(()=>posts.length===1);assert.deepEqual(posts[0],{channel:'D123',threadTs:'123.1',text:'Fixture reply'});
  assert.doesNotMatch(JSON.stringify(modelInputs),/xapp-synthetic|xoxb-synthetic/);assert.ok(!readFileSync(path).includes(Buffer.from('xapp-synthetic')));assert.ok(!readFileSync(path).includes(Buffer.from('xoxb-synthetic')));
  await call('/api/plugins/slack/disable',token,{});assert.equal(receive,undefined);
  let status=(await call('/api/plugins',token))[1][0];assert.equal(status.enabled,false);assert.equal(status.connected,true);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();
  await call('/api/plugins/slack/enable',token,{});await receive(event);await new Promise(resolve=>setTimeout(resolve,40));assert.equal(posts.length,1);
  await call('/api/plugins/slack/disconnect',token,{});status=(await call('/api/plugins',token))[1][0];assert.equal(status.connected,false);assert.equal(status.config.userId,'U123');
  await call('/api/plugins/slack/delete-config',token,{});assert.equal((await call('/api/plugins',token))[1][0].config,null);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('revoking agent access cancels pending work and an uncertain send is never replayed',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-revoke-')),path=join(dir,'db');let receive,release,started,posts=0;
 const waitForModel=new Promise(resolve=>{started=resolve});
 const gate=new Promise(resolve=>{release=resolve});let hold=true;
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>{started();if(hold)await gate;return {role:'assistant',content:'private reply'}}});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async()=>{posts++;throw Error('ambiguous network result')}};
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Test agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});
  await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvRevoke',teamId:'T123',userId:'U123',channelId:'D123',text:'first'};
  await receive(event);await waitForModel;await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:false});release();
  await until(async()=>{const events=(await call('/api/plugins',token))[1][0].events;return events.find(e=>e.eventId==='EvRevoke' && e.state==='failed');});assert.equal(posts,0);
  hold=false;await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});
  const uncertain={...event,eventId:'EvUncertain',text:'second'};await receive(uncertain);
  await until(async()=>{const events=(await call('/api/plugins',token))[1][0].events;return events.find(e=>e.eventId==='EvUncertain' && e.state==='uncertain');});assert.equal(posts,1);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await until(()=>receive);await receive(uncertain);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(posts,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart fences a reply whose Slack dispatch was still in flight',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-flight-')),path=join(dir,'db');let receive,posts=0,release;
 const pending=new Promise(resolve=>{release=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{receive=undefined}},post:async()=>{posts++;await pending;}};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:false,incrementalText:false},complete:async()=>({role:'assistant',content:'reply'})});
 let app=startInstance(path,0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try {
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Test agent',provider:'live',model:'fixture'}))[1];
  await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});
  const event={eventId:'EvInFlight',teamId:'T123',userId:'U123',channelId:'D123',text:'hello'};await receive(event);await until(()=>posts===1);
  await app.close();app=startInstance(path,0,{env:{},slackTransport,providerFactory});port=await app.listen();await until(()=>receive);
  const result=(await call('/api/plugins',token))[1][0].events.find(event=>event.eventId==='EvInFlight');assert.equal(result.state,'uncertain');
  await receive(event);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(posts,1);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('an in-flight reconnect cannot undo a later owner disconnect',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-connect-race-'));let release,started,hold=false;
 const waiting=new Promise(resolve=>{started=resolve}),gate=new Promise(resolve=>{release=resolve});
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>{if(hold){started();await gate;}return {teamId:'T123',botUserId:'B123'}},start:async(_tokens,_receive,status)=>{status?.('connected');return ()=>{};},post:async()=>{}};
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});return [r.status,await r.json()]};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Test agent',provider:'live',model:'fixture'}))[1];
  const config={confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};
  await call('/api/plugins/slack/connect',token,config);hold=true;
  const review=(await call('/api/secret-setup-review?integration=slack',token))[1];const connecting=call('/api/plugins/slack/connect',token,{...config,reviewedVersion:review.version,confirmDisplacements:true});await waiting;
  await call('/api/plugins/slack/disconnect',token,{});release();assert.equal((await connecting)[0],400);
  assert.equal((await call('/api/plugins',token))[1][0].connected,false);
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('ordinary Slack conversation can ask and answer in the same thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-slack-questions-'));let receive;const posts=[];const requests=[];
 const slackTransport={verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,handler,status)=>{status?.('connected');receive=handler;return ()=>{}},post:async(_tokens,message)=>{posts.push(message)}};
 const providerFactory=async()=>({name:'synthetic',capabilities:{toolCalls:true},async complete(messages,offers,opts){requests.push({messages,offers,input:opts.currentUserInput});return {role:'assistant',content:opts.currentUserInput==='Start'?'Which color do you prefer?':'I will use blue.'};}});
 const app=startInstance(join(dir,'db'),0,{env:{},slackTransport,providerFactory}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return [r.status,await r.json()]};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token,bot=(await call('/api/bots',token,{name:'Slack question',provider:'live',model:'fixture'}))[1];await call('/api/plugins/slack/connect',token,{confirm:true,appToken:'xapp-synthetic',botToken:'xoxb-synthetic',teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});await call('/api/plugins/slack/access',token,{botId:bot.id,enabled:true});await call('/api/plugins/slack/enable',token,{});const event={teamId:'T123',userId:'U123',channelId:'D123',threadTs:'123.1'};await receive({...event,eventId:'question',text:'Start'});await until(()=>posts.some(p=>p.text==='Which color do you prefer?'));await receive({...event,eventId:'answer',text:'Blue'});await until(()=>posts.some(p=>p.text==='I will use blue.'));assert.ok(posts.every(p=>p.threadTs==='123.1'));assert.ok(requests.some(r=>r.messages.some(m=>m.content==='Blue')));assert.deepEqual((await call('/api/question-sets',token))[1],[]);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
