import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startInstance } from './fixtures/controlled-instance.mjs';

const run=promisify(execFile);
test('CLI creation operation is retryable across restart and shared with the service',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-create-')),path=join(dir,'db'),credential=join(dir,'client.json');let app=startInstance(path),port=await app.listen();
 const cli=async (...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;const url=()=>`http://127.0.0.1:${port}`;
 try{
  await cli('pair',url(),credential,app.code);
  const created=JSON.parse(await cli('create',url(),credential,'Ada','--operation-id','same-create','--provider','lmstudio','--model','local','--instructions','Help'));
  await app.close();app=startInstance(path);port=await app.listen();
  const retry=JSON.parse(await cli('create',url(),credential,'Ada','--operation-id','same-create','--provider','lmstudio','--model','local','--instructions','Help'));assert.equal(retry.id,created.id);
  const {token}=JSON.parse(await (await import('node:fs/promises')).readFile(credential,'utf8'));const response=await fetch(`${url()}/api/bot-creations/same-create`,{headers:{Authorization:`Bearer ${token}`}});assert.equal((await response.json()).id,created.id);
  await assert.rejects(cli('create',url(),credential,'Other','--operation-id','same-create','--provider','live','--model','fixture-offline'));
  assert.equal(JSON.parse(await cli('bots',url(),credential)).length,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('CLI archive races task acceptance from another paired client',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-race-')),credential=join(dir,'client.json');let release;const gate=new Promise(resolve=>{release=resolve});
 const app=startInstance(join(dir,'db'),0,{providerFactory:async()=>({name:'held',capabilities:{toolCalls:false},async complete(){await gate;return {role:'assistant',content:'done'}}})});const port=await app.listen(),url=`http://127.0.0.1:${port}`;
 const cli=async (...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 const call=async(route,token,body)=>{const r=await fetch(url+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});return [r.status,await r.json()]};
 try{
  await cli('pair',url,credential,app.code);const token=(await call('/api/pair','',{code:app.issueCode()}))[1].token;
  for(let n=0;n<3;n++){
   const bot=JSON.parse(await cli('create',url,credential,`Race ${n}`,'--provider','live','--model','fixture-offline'));
   const [archived,work]=await Promise.all([cli('archive',url,credential,bot.id,bot.revision).then(stdout=>({ok:true,body:JSON.parse(stdout)}),error=>({ok:false,error:String(error.stderr)})),call('/api/tasks',token,{id:`race-${n}`,botId:bot.id,objective:'Hold'})]);
   assert.notEqual(archived.ok,work[1].kind==='accepted');if(archived.ok){assert.equal(archived.body.archived,true);assert.equal(work[0],409)}else {assert.match(archived.error,/409.*busy/i);assert.equal(work[1].kind,'accepted')}
  }
 }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('CLI edits, archives, and restores the shared bot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-profile-')); const app=startInstance(join(dir,'db')); const port=await app.listen();
 const url=`http://127.0.0.1:${port}`, credential=join(dir,'client.json');
 const cli=async (...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try {
  await cli('pair',url,credential,app.code);
  const clients=JSON.parse(await cli('clients',url,credential)); assert.equal(clients.length,1); assert.equal(clients[0].current,true);
  const created=JSON.parse(await cli('create',url,credential,'Ada','--provider','live','--model','fixture-offline'));
  const profile=JSON.parse(await cli('inspect',url,credential,created.id));
  const file=join(dir,'profile.json'); writeFileSync(file,JSON.stringify({...profile,name:'Ada updated',description:'research archives'}));
  const updated=JSON.parse(await cli('edit',url,credential,created.id,file));
  assert.equal(updated.name,'Ada updated'); assert.equal(updated.description,'research archives'); assert.equal(updated.chatId,created.chatId);
  const requester=JSON.parse(await cli('create',url,credential,'Owner','--provider','live','--model','fixture-offline'));
  const discovery=JSON.parse(await cli('discover',url,credential,requester.id,'archives')); assert.equal(discovery.kind,'match'); assert.equal(discovery.candidates[0].id,created.id);
  const archived=JSON.parse(await cli('archive',url,credential,created.id,String(updated.revision))); assert.equal(archived.archived,true);
  const restored=JSON.parse(await cli('restore',url,credential,created.id,String(archived.revision))); assert.equal(restored.archived,false);
  assert.equal(JSON.parse(await cli('inspect',url,credential,created.id)).name,'Ada updated');
  await cli('revoke',url,credential,clients[0].id);
  await assert.rejects(cli('bots',url,credential));
 } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('CLI clients share bot instructions and conversation across service restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-shared-')), path=join(dir,'db');
 let app=startInstance(path), port=await app.listen();
 const a=join(dir,'a.json'), b=join(dir,'b.json');
 const cli=async (...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 const url=()=>`http://127.0.0.1:${port}`;
 try {
  await cli('pair',url(),a,app.code);
  await cli('pair',url(),b,app.issueCode());
  const bot=JSON.parse(await cli('create',url(),a,'Ada','Lovelace','--instructions','Be concise','--provider','live','--model','fixture-offline'));
  const profile=JSON.parse(await cli('inspect',url(),b,bot.id));
  assert.equal(profile.name,'Ada Lovelace');
  assert.equal(profile.instructions,'Be concise');
  const legacy=JSON.parse(await cli('create',url(),a,'Ada','Lovelace','--provider','live','--model','fixture-offline'));
  assert.equal(legacy.name,'Ada Lovelace');
  assert.equal(legacy.instructions,'');
  for (const [args,pattern] of [
   [['Ada','--instructions'],/requires TEXT/],
   [['Ada','--instructions','text','--instructions','other'],/must appear once/],
   [['Ada','--instructions','text','extra'],/Unknown create option/],
   [['Ada','--unknown','text'],/Unknown create option/],
   [['--instructions','text'],/Agent name required/],
  ]) await assert.rejects(cli('create',url(),a,...args),error=>{assert.match(error.stderr,pattern);return true});
  assert.equal(JSON.parse(await cli('bots',url(),a)).length,2);
  const sent=await cli('send',url(),a,bot.id,'Hello from first client');
  const id=sent.match(/Command ID: ([\w-]+)/)?.[1]; assert.ok(id);
  assert.equal(JSON.parse(await cli('status',url(),b,id)).state,'completed');
  const messages=JSON.parse(await cli('read',url(),b,bot.id));
  assert.deepEqual(messages.map(message=>message.role),['user','assistant']);
  assert.equal(messages[0].content,'Hello from first client');
  assert.equal(messages[1].content,'Demo (offline): Hello from first client. User turns saved: 1. Ask "what time is it?" to see a tool call.');
  const reply=await cli('send',url(),b,bot.id,'Hello from second client');
  const secondId=reply.match(/Command ID: ([\w-]+)/)?.[1]; assert.ok(secondId);
  assert.equal(JSON.parse(await cli('status',url(),a,secondId)).state,'completed');
  const history=JSON.parse(await cli('read',url(),a,bot.id));
  assert.deepEqual(history.map(({role,content})=>({role,content})),[
   {role:'user',content:'Hello from first client'},
   {role:'assistant',content:'Demo (offline): Hello from first client. User turns saved: 1. Ask "what time is it?" to see a tool call.'},
   {role:'user',content:'Hello from second client'},
   {role:'assistant',content:'Demo (offline): Hello from second client. User turns saved: 2. Ask "what time is it?" to see a tool call.'},
  ]);
  await app.close(); app=startInstance(path); port=await app.listen();
  assert.equal(JSON.parse(await cli('inspect',url(),b,bot.id)).instructions,'Be concise');
  assert.deepEqual(JSON.parse(await cli('read',url(),b,bot.id)),history);
  assert.equal(JSON.parse(await cli('status',url(),b,id)).state,'completed');
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI reads and sets instance, bot and task approval scopes and decides a clock request', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-approval-')); const app=startInstance(join(dir,'db')); const port=await app.listen();
 const url=`http://127.0.0.1:${port}`, credential=join(dir,'client.json');
 const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try {
  await cli('pair',url,credential,app.code);
  const bot=JSON.parse(await cli('create',url,credential,'Ada','--provider','live','--model','fixture-offline'));
  assert.deepEqual(JSON.parse(await cli('set-approval-settings',url,credential,'instance','ask-every-time','true')),{mode:'ask-every-time',clockEnabled:true});
  assert.deepEqual(JSON.parse(await cli('set-approval-settings',url,credential,`bot:${bot.id}`,'inherit','true')),{mode:null,clockEnabled:true});
  assert.deepEqual(JSON.parse(await cli('approval-settings',url,credential,`bot:${bot.id}`)),{mode:null,clockEnabled:true});
  const start=await cli('task-start',url,credential,bot.id,'what time is it?'); const id=start.match(/Task attempt ID: ([\w-]+)/)?.[1]; assert.ok(id);
  const requests=JSON.parse(await cli('approvals',url,credential)); const pending=requests.find(x=>x.workId===id && x.state==='pending'); assert.ok(pending);
  assert.deepEqual(JSON.parse(await cli('approval-settings',url,credential,`task:${id}`)),{mode:null,clockEnabled:true});
  assert.deepEqual(JSON.parse(await cli('set-approval-settings',url,credential,`task:${id}`,'ask-every-time','true')),{mode:'ask-every-time',clockEnabled:true});
  assert.equal(JSON.parse(await cli('approve',url,credential,pending.id)).state,'approved');
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI edits revision-safe defaults that affect only subsequently created bots',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-defaults-'));const app=startInstance(join(dir,'db'));const port=await app.listen();const url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');
 const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try{await cli('pair',url,credential,app.code);const old=JSON.parse(await cli('create',url,credential,'Old','--provider','live','--model','fixture-offline'));const initial=JSON.parse(await cli('defaults',url,credential));
  const updated=JSON.parse(await cli('defaults-set',url,credential,String(initial.revision),'codex','synthetic-model','high'));assert.equal(updated.provider,'codex');
  await assert.rejects(cli('defaults-set',url,credential,String(initial.revision),'demo','-','-'));
  const created=JSON.parse(await cli('create',url,credential,'New'));assert.equal(created.provider,'codex');assert.equal(created.model,'synthetic-model');assert.equal(created.reasoning,'high');assert.equal(JSON.parse(await cli('inspect',url,credential,old.id)).provider,'live');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI controls web permissions without enabling other scopes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-web-'));const app=startInstance(join(dir,'db'));const port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try{await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'Owner','--provider','live','--model','fixture-offline'));assert.equal(JSON.parse(await cli('web-permission',url,credential,'instance')).enabled,false);assert.equal(JSON.parse(await cli('web-permission-set',url,credential,'instance','true')).enabled,true);assert.equal(JSON.parse(await cli('web-permission',url,credential,`bot:${bot.id}`)).enabled,false);assert.deepEqual(JSON.parse(await cli('web-approvals',url,credential)),[]);}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI approves the exact pending web target without a live request',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-web-approval-'));let calls=0,dns=0;
 const webDependencies={resolve:async()=>{dns++;return [{address:'8.8.8.8',family:4}];},request:async()=>({status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('safe')})(),close(){}})};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){if(calls++===0)return {role:'assistant',content:null,tool_calls:[{id:'web',type:'function',function:{name:'read_web',arguments:JSON.stringify({url:'https://example.com/path'})}}]};return {role:'assistant',content:'Done'};}});
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory,webDependencies}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try{await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'Owner','--provider','live','--model','fixture-offline'));await cli('web-permission-set',url,credential,'instance','true');await cli('web-permission-set',url,credential,`bot:${bot.id}`,'true');
  const sent=await cli('send',url,credential,bot.id,'Read the page');const commandId=sent.match(/Command ID: ([\w-]+)/)?.[1];assert.ok(commandId);let pending;for(let i=0;i<50;i++){pending=JSON.parse(await cli('web-approvals',url,credential))[0];if(pending)break;}assert.ok(pending);assert.equal(pending.url,'https://example.com/path');assert.equal(dns,0);assert.equal(JSON.parse(await cli('web-approve',url,credential,pending.id)).decision,'approve');
  let status;for(let i=0;i<50;i++){status=JSON.parse(await cli('status',url,credential,commandId));if(status.state==='completed')break;}assert.equal(status.state,'completed');assert.equal(status.webActions[0].state,'succeeded');assert.equal(dns,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI configures and approves a synthetic local search',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-search-'));let calls=0,requests=0;
 const searchTransport=async()=>{requests++;return {status:200,headers:{'content-type':'application/json'},body:(async function*(){yield Buffer.from(JSON.stringify({results:[{title:'Fixture',url:'https://example.test/path',content:'safe'}]}))})(),close(){}};};
 const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){if(calls++===0)return {role:'assistant',content:null,tool_calls:[{id:'search',type:'function',function:{name:'search_web',arguments:JSON.stringify({query:'synthetic query'})}}]};return {role:'assistant',content:'Done'};}});
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory,searchTransport}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try{await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'Owner','--provider','live','--model','fixture-offline')),config=JSON.parse(await cli('search-config',url,credential));assert.equal(config.origin,null);await cli('search-config-set',url,credential,String(config.revision),'http://127.0.0.1:8888');await cli('search-permission-set',url,credential,'instance','true');await cli('search-permission-set',url,credential,`bot:${bot.id}`,'true');
  const sent=await cli('send',url,credential,bot.id,'Find sources'),id=sent.match(/Command ID: ([\w-]+)/)?.[1];assert.ok(id);let pending;for(let i=0;i<50;i++){pending=JSON.parse(await cli('search-approvals',url,credential))[0];if(pending)break;}assert.ok(pending);assert.equal(pending.query,'synthetic query');assert.equal(requests,0);assert.equal(JSON.parse(await cli('search-approve',url,credential,pending.id)).decision,'approve');let status;for(let i=0;i<50;i++){status=JSON.parse(await cli('status',url,credential,id));if(status.state==='completed')break;}assert.equal(status.state,'completed');assert.equal(status.searchActions[0].state,'succeeded');assert.equal(requests,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('CLI controls scratch configuration and exact command approval without Docker',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-cli-shell-'));let calls=0,executions=0;
 const shellExecutor=async request=>{executions++;assert.deepEqual(request.workspace,{kind:'scratch',sizeBytes:16777216,maxInodes:1024});return {output:'synthetic output',exitCode:0,outputComplete:true,stopped:'completed'};};const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){if(calls++===0)return {role:'assistant',content:null,tool_calls:[{id:'shell',type:'function',function:{name:'run_scratch_shell',arguments:JSON.stringify({command:'printf safe'})}}]};return {role:'assistant',content:'Done'};}});
 const app=startInstance(join(dir,'db'),0,{env:{},providerFactory,shellExecutor}),port=await app.listen(),url=`http://127.0.0.1:${port}`,credential=join(dir,'client.json');const cli=async(...args)=>(await run(process.execPath,['dist/cli.js','instance',...args])).stdout;
 try{await cli('pair',url,credential,app.code);const bot=JSON.parse(await cli('create',url,credential,'Owner','--provider','live','--model','fixture-offline')),config=JSON.parse(await cli('shell-config',url,credential));assert.equal(config.dockerBinary,null);await cli('shell-config-set',url,credential,String(config.revision),'/usr/bin/docker','/tmp/synthetic.sock','sha256:'+'a'.repeat(64));await cli('shell-permission-set',url,credential,'instance','true');await cli('shell-permission-set',url,credential,`bot:${bot.id}`,'true');
  const sent=await cli('send',url,credential,bot.id,'Run'),id=sent.match(/Command ID: ([\w-]+)/)?.[1];assert.ok(id);let pending;for(let i=0;i<50;i++){pending=JSON.parse(await cli('shell-approvals',url,credential))[0];if(pending)break;}assert.ok(pending);assert.equal(pending.command,'printf safe');assert.equal(executions,0);assert.equal(JSON.parse(await cli('shell-approve',url,credential,pending.id)).decision,'approve');let status;for(let i=0;i<50;i++){status=JSON.parse(await cli('status',url,credential,id));if(status.state==='completed')break;}assert.equal(status.state,'completed');assert.equal(status.shellActions[0].state,'succeeded');assert.equal(executions,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
