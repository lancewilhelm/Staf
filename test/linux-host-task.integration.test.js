import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {startInstance} from './fixtures/controlled-instance.mjs';
import {selectLinuxHostBoundary} from '../dist/linux-host-boundary.js';

const linuxOptedIn=process.platform==='linux' && process.env.STAF_TEST_LINUX_SERVICE==='1';
const linuxEnabled=linuxOptedIn && !!selectLinuxHostBoundary({enabled:true,dataDir:tmpdir(),secretDir:tmpdir()});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async fn=>{for(let i=0;i<1000;i++){const value=await fn();if(value)return value;await delay(20);}throw Error('Timed out waiting for service');};
const tool=(name,input,id='action')=>({id,type:'function',function:{name,arguments:JSON.stringify(input)}});
const response=calls=>({role:'assistant',content:null,tool_calls:calls});

// No hostWork injection: these calls reach the configured production boundary.
test('background tasks use the configured Linux boundary across tool modes and restart',{
 skip:linuxEnabled?false:'Requires Linux, STAF_TEST_LINUX_SERVICE=1, and a prepared service account and boundary policy; no isolation was tested',timeout:180000,
},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-task-boundary-')),db=join(dir,'instance.sqlite');
 const secret='synthetic-managed-task-credential-482913',envSecret='synthetic-env-task-credential-771351';
 const prefix='staf-task-'+randomUUID(),outside=join(dir,'secrets','credentials.sqlite'),seen=[];
 const previousEnv=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY=envSecret;
 let app,port,token,plan,lastBot;
 const options={dataDir:dir,env:{STAF_LINUX_HOST_EXECUTION:'1',OPENROUTER_API_KEY:envSecret},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  seen.push(JSON.stringify(messages));if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'done'};
  const call=profile.toolMode==='code'?tool('code_mode',{source:`return await capabilities.${plan.name}(${JSON.stringify(plan.input)});`}):tool(plan.name,plan.input);
  return response([call]);
 }})};
 const start=async()=>{app=startInstance(db,0,options);port=await app.listen();};
 const call=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));return value;};
 let seq=0;
 const run=async(bot,name,input,success=true)=>{
  plan={name,input};const id=`task-${++seq}`;await call('/api/tasks',{id,botId:bot.id,objective:'Run the controlled operation'});
  const task=await until(async()=>{const value=await call('/api/tasks/'+id);return !['queued','running','waiting'].includes(value.state)&&value;});
  assert.equal(task.state,'completed',JSON.stringify(task));
  assert.ok(!JSON.stringify(task).includes(secret) && !JSON.stringify(task).includes(envSecret),'task records exposed synthetic credential');
  if(success){assert.equal(task.workActions.length,1,JSON.stringify(task));assert.equal(task.workActions[0].state,'succeeded',JSON.stringify(task));}
  else {assert.ok(task.workActions.every(action=>action.state!=='succeeded'),JSON.stringify(task));assert.ok(task.activity.some(event=>event.type==='tool_result' && event.success===false),JSON.stringify(task));}
  return {id,task};
 };
 const terminal=async(bot,command,mode='pipe')=>{
  const {id}=await run(bot,'terminal_run',{command,mode,retain:true});
  const process=await until(async()=>(await call('/api/processes')).find(p=>p.work.id===id && p.outputComplete));
  const output=await call(`/api/processes/${process.id}/output`);return {process,text:output.chunks.map(chunk=>chunk.text??'').join('')};
 };
 try{
  await start();token=(await call('/api/pair',{code:app.code})).token;
  await call('/api/secrets/add',{name:'Task fixture',purpose:'Controlled boundary test',value:secret});
  assert.ok(readFileSync(outside).includes(Buffer.from(secret)),'fixture must contain a real synthetic managed credential');
  for(const mode of ['direct','hybrid','code']){
   const bot=await call('/api/bots',{name:'Task '+mode,provider:'live',model:'fixture-offline',toolMode:mode});lastBot=bot;
   const file=prefix+'-'+mode,link=file+'-link';
   await run(bot,'file_write',{path:file,content:'ordinary fixture'});
   await run(bot,'file_read',{path:file,offset:0,limit:64});
   await run(bot,'file_search',{path:file,query:'fixture'});
   await run(bot,'file_edit',{path:file,expectedHash:createHash('sha256').update('ordinary fixture').digest('hex'),oldText:'fixture',newText:'edited'});
   const check=await terminal(bot,`test "$(cat '${file}')" = 'ordinary edited' && ln -s '${outside}' '${link}' && printf 'ordinary-ok'`);
   assert.equal(check.process.exitCode,0,check.text);assert.match(check.text,/ordinary-ok/);
   for(const path of [outside,link]){
    await run(bot,'file_read',{path,offset:0,limit:64},false);
    await run(bot,'file_search',{path,query:'synthetic'},false);
    await run(bot,'file_write',{path,content:'forbidden'},false);
    await run(bot,'file_edit',{path,expectedHash:'0'.repeat(64),oldText:'synthetic',newText:'forbidden'},false);
   }
   assert.ok(readFileSync(outside).includes(Buffer.from(secret)),'failed file actions must leave the managed credential intact');
   for(const terminalMode of ['pipe','pty']){
    const cmd=`test "\${OPENROUTER_API_KEY-unset}" = unset && test "$(id -u)" = 65534 && ! base64 '${outside}' >/dev/null 2>&1 && ! base64 '${link}' >/dev/null 2>&1 && ! sudo -n true >/dev/null 2>&1 && printf boundary-ok`;
    const result=await terminal(bot,cmd,terminalMode);assert.equal(result.process.exitCode,0,result.text);assert.match(result.text,/boundary-ok/);
   }
   const cleanup=await terminal(bot,`rm -f '${file}' '${link}'`);assert.equal(cleanup.process.exitCode,0,cleanup.text);
  }
  // A retained orphan must remain supervised and must not write after shutdown/restart.
  const marker=prefix+'-late';const {id}=await run(lastBot,'terminal_run',{command:`(sleep 4; printf late > '${marker}') >/dev/null 2>&1 & printf descendant-ready`,retain:true});
  const running=await until(async()=>{const p=(await call('/api/processes')).find(item=>item.work.id===id);if(!p)return;const out=await call(`/api/processes/${p.id}/output`);return out.chunks.some(c=>(c.text??'').includes('descendant-ready'))&&p;});
  assert.equal(running.outputComplete,false,'launcher must still supervise its orphan');
  await app.close();app=undefined;await start();await delay(4500);
  const after=await terminal(lastBot,`test ! -e '${marker}' && printf restart-ok`);assert.equal(after.process.exitCode,0,after.text);assert.match(after.text,/restart-ok/);
  assert.ok(seen.every(value=>!value.includes(secret)&&!value.includes(envSecret)));
  const records=await call('/api/tasks/task-'+seq);assert.ok(!JSON.stringify(records).includes(secret));assert.ok(!JSON.stringify(records).includes(envSecret));
 } finally {
  if(app && lastBot){try{await terminal(lastBot,`rm -f '${prefix}'-*`);}catch{/* Report the original failure; disposable files may require operator cleanup. */}}
  if(app)await app.close();
  if(previousEnv===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previousEnv;
  rmSync(dir,{recursive:true,force:true});
 }
});

test('delegated helpers cannot request any host file or terminal capability', {timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-helper-boundary-')),marker=join(dir,'marker'),seen=[];
 const names=['file_read','file_write','file_edit','file_search','terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize'];
 const processId=randomUUID();const inputs=[{path:marker},{path:marker,content:'forbidden'},{path:marker,expectedHash:'0'.repeat(64),oldText:'a',newText:'b'},{path:marker,query:'a'},{command:`touch '${marker}'`},{processId},{processId},{processId,data:'x'},{processId},{processId,cols:80,rows:24}];
 let helperId,rootCalls=0,helperCalls=0,offers=[],timer;
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{STAF_LINUX_HOST_EXECUTION:'1'},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
  seen.push(JSON.stringify(messages));if(profile.chatId==='root')return rootCalls++===0?response([tool('request_bot_help',{helperId,objective:'Check isolation',context:'Controlled helper test'})]):{role:'assistant',content:'done'};
  offers=tools.map(item=>item.function.name);const batch=helperCalls++;return batch<2?response(names.slice(batch*5,batch*5+5).map((name,index)=>tool(name,inputs[batch*5+index],`attempt-${batch*5+index}`))):{role:'assistant',content:'Helper completed'};
 }})});
 let port,token;
 const call=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));return value;};
 try{
  port=await app.listen();token=(await call('/api/pair',{code:app.code})).token;
  const root=await call('/api/bots',{name:'Requester',provider:'live',model:'fixture-offline',toolMode:'direct'});
  helperId=(await call('/api/bots',{name:'Helper',provider:'live',model:'fixture-offline',toolMode:'direct'})).id;
  timer=setInterval(async()=>{try{for(const d of (await call('/api/disclosures')).filter(d=>d.state==='pending'))await call(`/api/disclosures/${d.id}/approve`,{});}catch{}},20);
  await call('/api/tasks',{id:'root',botId:root.id,objective:'Delegate controlled work'});
  const parent=await until(async()=>{const value=await call('/api/tasks/root');return !['queued','running','waiting'].includes(value.state)&&value;});assert.equal(parent.state,'completed',JSON.stringify(parent));
  const tasks=await call(`/api/bots/${helperId}/tasks`);assert.equal(tasks.length,1);const helper=await call('/api/tasks/'+tasks[0].id);
  assert.equal(helper.state,'completed',JSON.stringify(helper));assert.ok(names.every(name=>!offers.includes(name)),JSON.stringify(offers));
  for(const name of names){const event=helper.activity.find(item=>item.type==='tool_result'&&item.name===name);assert.ok(event,`missing ${name} result`);assert.equal(event.success,false);assert.match(event.content,/not offered/);}
  assert.equal(helper.workActions.length,0);assert.equal(existsSync(marker),false);assert.ok(seen.some(value=>value.includes('not offered')));
 }finally{clearInterval(timer);await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('delegated Code Mode cannot invoke host capabilities omitted from its guest', {timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-helper-guest-')),marker=join(dir,'marker');
 const names=['file_read','file_write','file_edit','file_search','terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize'];
 let helperId,rootCalls=0,helperCalls=0,result,timer;
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{STAF_LINUX_HOST_EXECUTION:'1'},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  if(profile.chatId==='guest-root')return rootCalls++===0?response([tool('request_bot_help',{helperId,objective:'Check guest isolation',context:'Controlled helper test'})]):{role:'assistant',content:'done'};
  if(helperCalls++===0){const source=`const names=${JSON.stringify(names)}; const denied=[]; for (const name of names) { try { await capabilities[name]({path:${JSON.stringify(marker)},command:${JSON.stringify(`touch '${marker}'`)}}); denied.push(false); } catch { denied.push(typeof capabilities[name] === 'undefined'); } } return denied;`;return response([tool('code_mode',{source})]);}
  result=JSON.parse(messages.at(-1).content);return {role:'assistant',content:'Helper completed'};
 }})});
 let port,token;
 const call=async(path,body)=>{const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();assert.ok(res.ok,JSON.stringify(value));return value;};
 try{
  port=await app.listen();token=(await call('/api/pair',{code:app.code})).token;
  const root=await call('/api/bots',{name:'Guest requester',provider:'live',model:'fixture-offline',toolMode:'direct'});
  helperId=(await call('/api/bots',{name:'Guest helper',provider:'live',model:'fixture-offline',toolMode:'code'})).id;
  timer=setInterval(async()=>{try{for(const d of (await call('/api/disclosures')).filter(d=>d.state==='pending'))await call(`/api/disclosures/${d.id}/approve`,{});}catch{}},20);
  await call('/api/tasks',{id:'guest-root',botId:root.id,objective:'Delegate controlled work'});
  const parent=await until(async()=>{const value=await call('/api/tasks/guest-root');return !['queued','running','waiting'].includes(value.state)&&value;});assert.equal(parent.state,'completed',JSON.stringify(parent));
  const tasks=await call(`/api/bots/${helperId}/tasks`);assert.equal(tasks.length,1);const helper=await call('/api/tasks/'+tasks[0].id);
  assert.equal(helper.state,'completed',JSON.stringify(helper));assert.equal(helper.workActions.length,0);assert.equal(helper.codeExecutions[0].outcome,'return');
  assert.deepEqual(result.value,names.map(()=>true));assert.equal(existsSync(marker),false);
 }finally{clearInterval(timer);await app.close();rmSync(dir,{recursive:true,force:true});}
});
