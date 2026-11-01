import {routerStream} from './openrouter-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {startInstance} from '../dist/instance-service.js';

test('paired OpenRouter connection survives restart, replaces and disconnects without readback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-router-')),path=join(dir,'db');let app=startInstance(path,0,{env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try{
  assert.equal((await call('/api/openrouter-connection','',{key:'secret-one'}))[0],401);
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  assert.deepEqual((await call('/api/openrouter-connection',token))[1],{saved:false});
  assert.deepEqual((await call('/api/openrouter-connection',token,{key:'secret-one'}))[1],{saved:true});
  assert.equal(statSync(join(dir,'auth','openrouter.json')).mode & 0o777,0o600);
  assert.equal((await call('/api/bots',token,{name:'secret-one'}))[0],400);
  assert.equal((await call('/api/openrouter-connection',token,{key:''}))[0],400);
  assert.equal((await call('/api/openrouter-connection',token,{key:'\\'.repeat(4096)}))[0],400);
  assert.deepEqual((await call('/api/openrouter-connection',token))[1],{saved:true});
  assert.deepEqual((await call('/api/openrouter-connection',token,{key:'secret-two'}))[1],{saved:true});
  assert.match(readFileSync(join(dir,'auth','openrouter.json'),'utf8'),/secret-two/);
  await app.close();app=startInstance(path,0,{env:{}});port=await app.listen();
  assert.deepEqual((await call('/api/openrouter-connection',token))[1],{saved:true});
  assert.deepEqual((await call('/api/openrouter-connection/disconnect',token,{}))[1],{saved:false});
  assert.deepEqual((await call('/api/openrouter-connection',token))[1],{saved:false});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});


test('actual CLI reads a key from stdin and does not print it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-router-cli-')),app=startInstance(join(dir,'db'),0,{env:{}}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
 const cli=(args,input='')=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['dist/cli.js','instance',...args]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(Error(err)));p.stdin.end(input);});
 try{await cli(['pair',url,credential,app.code]);assert.deepEqual(JSON.parse(await cli(['openrouter-status',url,credential])),{saved:false});
 for(const key of ['synthetic-cli-one','synthetic-cli-two']){const output=await cli(['openrouter-set',url,credential],key+'\n');assert.deepEqual(JSON.parse(output),{saved:true});assert.ok(!output.includes(key));}
 await assert.rejects(cli(['openrouter-set',url,credential],'\n'));assert.deepEqual(JSON.parse(await cli(['openrouter-status',url,credential])),{saved:true});
 assert.deepEqual(JSON.parse(await cli(['openrouter-disconnect',url,credential])),{saved:false});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('managed keys drive independent agents without fallback or secret persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-router-execution-')),requests=[],original=globalThis.fetch;
 globalThis.fetch=async(input,init)=>{if(String(input).startsWith('http://127.0.0.1:'))return original(input,init);assert.equal(String(input),'https://openrouter.ai/api/v1/chat/completions');requests.push({authorization:init.headers.Authorization,model:JSON.parse(init.body).model});return routerStream({message:{role:'assistant',content:'synthetic response'}});};
 const app=startInstance(join(dir,'db'),0,{env:{OPENROUTER_API_KEY:'environment-key'}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 const settle=async(id,token)=>{for(let i=0;i<100;i++){const result=(await call('/api/commands/'+id,token))[1];if(result.state!=='pending')return result;await new Promise(r=>setTimeout(r,5));}throw Error('Command timeout');};
 try{
  const token=(await call('/api/pair','',{code:app.code}))[1].token;
  const a=(await call('/api/bots',token,{name:'A'}))[1],b=(await call('/api/bots',token,{name:'B'}))[1];
  for(const [bot,model] of [[a,'first/model'],[b,'second/model']]) assert.equal((await call(`/api/bots/${bot.id}/profile`,token,{revision:bot.revision,name:bot.name,instructions:'',provider:'openrouter',model,reasoning:null}))[0],200);
  await call('/api/commands',token,{id:'missing',botId:a.id,content:'hello'});assert.equal((await settle('missing',token)).state,'failed');assert.equal(requests.length,0);
  await call('/api/openrouter-connection',token,{key:'synthetic-managed-one'});
  await call('/api/commands',token,{id:'one',botId:a.id,content:'synthetic-managed-one'});assert.equal((await settle('one',token)).state,'completed');
  await call('/api/openrouter-connection',token,{key:'synthetic-managed-two'});
  await call('/api/commands',token,{id:'two',botId:b.id,content:'hello'});assert.equal((await settle('two',token)).state,'completed');
  assert.deepEqual(requests,[{authorization:'Bearer synthetic-managed-one',model:'first/model'},{authorization:'Bearer synthetic-managed-two',model:'second/model'}]);
  assert.doesNotMatch(JSON.stringify((await call(`/api/bots/${a.id}/messages`,token))[1]),/synthetic-managed/);
  assert.doesNotMatch(readFileSync(join(a.configDir,'agent.toml'),'utf8')+readFileSync(join(a.configDir,'soul.md'),'utf8'),/synthetic-managed/);
  await call('/api/openrouter-connection/disconnect',token,{});await call('/api/commands',token,{id:'disconnected',botId:b.id,content:'again'});assert.equal((await settle('disconnected',token)).state,'failed');assert.equal(requests.length,2);
 }finally{await app.close();globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});}
});

test('damaged credentials can be repaired after restart and do not block agent creation',async()=>{
 const {mkdirSync,writeFileSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'staf-router-repair-'));mkdirSync(join(dir,'auth'));writeFileSync(join(dir,'auth','openrouter.json'),'invalid');
 const app=startInstance(join(dir,'db'),0,{env:{}}),port=await app.listen();
 const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return [r.status,await r.json()]};
 try{const token=(await call('/api/pair','',{code:app.code}))[1].token;assert.equal((await call('/api/openrouter-connection',token))[0],400);assert.equal((await call('/api/bots',token,{name:'XYZ'}))[0],201);
  assert.deepEqual((await call('/api/openrouter-connection',token,{key:'a'}))[1],{saved:true});assert.equal((await call('/api/bots',token,{name:'XYZ'}))[0],201);
  assert.deepEqual((await call('/api/openrouter-connection/disconnect',token,{}))[1],{saved:false});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('paired service and actual CLI use streaming OpenRouter tool calls, recover failures and continue history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-router-stream-')),original=globalThis.fetch,requests=[];let release, follower;
 const gate=new Promise(resolve=>{release=resolve});
 const frame=value=>`data: ${JSON.stringify(value)}\n\n`;
 globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('http://127.0.0.1:'))return original(input,init);
  assert.equal(String(input),'https://openrouter.ai/api/v1/chat/completions');const body=JSON.parse(init.body);requests.push(body);
  assert.equal(init.headers.Authorization,'Bearer synthetic-stream-key');assert.equal(body.stream,true);
  const last=body.messages.at(-1);
  if(last.content==='fail safely')return new Response(frame({choices:[{index:0,delta:{content:'Incomplete answer '},finish_reason:null}]})+frame({error:{message:'synthetic-stream-key'}}));
  if(last.content==='Use clock')return new Response(frame({choices:[{index:0,delta:{tool_calls:[{index:0,id:'clock-1',type:'function',function:{name:'clock',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+'data: [DONE]\n\n');
  if(last.role==='tool')assert.ok(body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='clock-1'));
  const stream=new ReadableStream({async start(controller){const write=value=>controller.enqueue(new TextEncoder().encode(value));write(frame({choices:[{index:0,delta:{content:'First chunk '},finish_reason:null}]}));if(last.role==='tool')await gate;write(frame({choices:[{index:0,delta:{content:'second chunk'},finish_reason:'stop'}]}));write(frame({choices:[],model:'fixture/model',usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}}));write('data: [DONE]\n\n');controller.close();}});
  return new Response(stream);
 };
 const app=startInstance(join(dir,'db'),0,{env:{}}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
 const cli=(...args)=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,['dist/cli.js','instance',...args]);let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(Error(err)));p.stdin.end();});
 const call=async(route,token,body)=>{const r=await original(url+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
 const until=async fn=>{for(let i=0;i<1500;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
 try{
  await cli('pair',url,credential,app.code);const token=JSON.parse(readFileSync(credential,'utf8')).token;
  const bot=JSON.parse(await cli('create',url,credential,'Router'));await call(`/api/bots/${bot.id}/profile`,token,{revision:bot.revision,name:bot.name,instructions:'Use tools',provider:'openrouter',model:'fixture/model',reasoning:null});
  await call('/api/approval-settings/instance',token,{mode:'never-ask',clockEnabled:true});
  assert.equal(requests.length,0);await call('/api/openrouter-connection',token,{key:'synthetic-stream-key'});assert.equal(requests.length,0);
  const send=await cli('send',url,credential,bot.id,'Use clock'),id=send.match(/Command ID: ([\w-]+)/)[1];
  const progress=await until(async()=>{const state=await call('/api/commands/'+id,token);return state.responseProgress?.text.includes('First chunk')&&state;});
  assert.equal(progress.state,'pending');assert.ok(progress.runtimeEvents.some(e=>e.type==='tool_result'&&e.name==='clock'&&e.success));assert.doesNotMatch(JSON.stringify(progress),/synthetic-stream-key/);
  follower=spawn(process.execPath,['dist/cli.js','instance','response-follow',url,credential,id]);let followed='';follower.stdout.on('data',chunk=>followed+=chunk);const followerExit=new Promise((resolve,reject)=>{follower.on('error',reject);follower.on('close',resolve)});
  await until(()=>followed.includes('First chunk'));release();assert.equal(await followerExit,0);assert.doesNotMatch(followed,/synthetic-stream-key/);
  await until(async()=>{const s=await call('/api/commands/'+id,token);return s.state==='completed'&&s;});
  const failed=await cli('send',url,credential,bot.id,'fail safely'),bad=failed.match(/Command ID: ([\w-]+)/)[1];
  const outcome=await until(async()=>{const s=await call('/api/commands/'+bad,token);return s.state==='failed'&&s;});assert.match(outcome.error,/incomplete|retry/i);assert.doesNotMatch(JSON.stringify(outcome),/synthetic-stream-key/);
  const next=await cli('send',url,credential,bot.id,'try again'),nextId=next.match(/Command ID: ([\w-]+)/)[1];await until(async()=>{const s=await call('/api/commands/'+nextId,token);return s.state==='completed'&&s;});
  const history=JSON.parse(await cli('read',url,credential,bot.id));assert.ok(history.some(m=>m.content==='First chunk second chunk'));assert.doesNotMatch(JSON.stringify(history),/synthetic-stream-key/);assert.ok(requests.at(-1).messages.some(m=>m.content==='Use clock'));assert.ok(!requests.at(-1).messages.some(m=>m.content==='Incomplete answer '));
  const usage=await call(`/api/bots/${bot.id}/usage`,token);assert.match(usage.text,/total: 5 reported/);
 }finally{release();follower?.kill();await app.close();globalThis.fetch=original;rmSync(dir,{recursive:true,force:true});}
});
