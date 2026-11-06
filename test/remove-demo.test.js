import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {providerRegistry,selectProvider} from '../dist/registry.js';
import {startInstance} from '../dist/instance-service.js';
import {Instance} from '../dist/instance.js';
const run=promisify(execFile);

test('registry and provider selection do not expose Demo',async()=>{
 assert.equal(Object.hasOwn(providerRegistry,'demo'),false);
 await assert.rejects(selectProvider('demo',{env:{}}),/provider/i);
});

test('paired API rejects Demo and fresh setup makes no inference',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-no-demo-')),path=join(root,'db'),credential=join(root,'client.json');let calls=0;
 const app=startInstance(path,0,{env:{},providerFactory:async()=>{calls++;throw Error('unexpected inference')}});const port=await app.listen(),url=`http://127.0.0.1:${port}`;
 const post=async(route,body,token)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 try {
  const token=(await(await post('/api/pair',{code:app.code})).json()).token;writeFileSync(credential,JSON.stringify({token}));
  assert.equal((await post('/api/bots',{name:'No selection'},token)).status,400);
  for(const [route,body] of [['/api/bots',{name:'Demo',provider:'demo'}],['/api/models',{provider:'demo'}],['/api/provider-defaults',{revision:'invalid',provider:'demo',model:null,reasoning:null}]])assert.equal((await post(route,body,token)).status,400,route);
  assert.equal(calls,0);
 } finally {await app.close();rmSync(root,{recursive:true,force:true});}
});

test('paired CLI rejects Demo selection',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-cli-no-demo-')),credential=join(root,'client.json');
 const app=startInstance(join(root,'db'),0,{env:{}});const port=await app.listen(),url=`http://127.0.0.1:${port}`;
 try {const response=await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})});writeFileSync(credential,JSON.stringify(await response.json()));
  await assert.rejects(run(process.execPath,['dist/cli.js','instance','create',url,credential,'Demo','--provider','demo']),/Invalid creation operation/);
  await assert.rejects(run(process.execPath,['dist/cli.js','instance','defaults-set',url,credential,'1','demo','model','-']));
 } finally {await app.close();rmSync(root,{recursive:true,force:true});}
});

test('legacy Demo history stays readable and cannot execute before setup, then migrates across restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-old-demo-')),path=join(root,'db');let instance=new Instance(path);
 let id,chatId;
 try {
  const bot=instance.createBot({name:'Old',instructions:'Keep soul',provider:'lmstudio',model:'local'});id=bot.id;chatId=bot.chatId;
  const file=join(bot.configDir,'agent.toml');writeFileSync(file,readFileSync(file,'utf8').replace('provider = "lmstudio"','provider = "demo"'));
  instance.claim({id:'history',botId:id,content:'Preserved'});instance.complete('history','Answer');instance.close();
  let calls=0;const app=startInstance(path,0,{env:{},providerFactory:async()=>{calls++;throw Error('unexpected inference')}});const port=await app.listen(),url=`http://127.0.0.1:${port}`;
  const post=async(route,body,token)=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  try {const token=(await(await post('/api/pair',{code:app.code})).json()).token;await post('/api/commands',{id:'blocked',botId:id,content:'Do not infer'},token);await new Promise(resolve=>setTimeout(resolve,50));assert.equal(calls,0);const defaults=await(await fetch(url+'/api/creation-defaults',{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(defaults.provider,'');assert.equal((await post('/api/creation-defaults',{...defaults,provider:'codex',model:'fixture'},token)).status,200);}finally{await app.close();}
  instance=new Instance(path);assert.equal(instance.bot(id).provider,'codex');assert.equal(instance.bot(id).chatId,chatId);assert.equal(instance.bot(id).instructions,'Keep soul');assert.deepEqual(instance.messages(id).slice(0,2).map(m=>m.content),['Preserved','Answer']);
 } finally {try{instance.close()}catch{}rmSync(root,{recursive:true,force:true});}
});
