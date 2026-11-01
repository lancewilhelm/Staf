import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cli=(root,input)=>spawnSync(process.execPath,['dist/cli.js','--data-dir',root],{input,encoding:'utf8',timeout:20000});
const descriptor=root=>JSON.parse(readFileSync(join(root,'terminal-service.json'),'utf8'));
const request=async(root,path,body)=>{
 const {port}=descriptor(root), {token}=JSON.parse(readFileSync(join(root,'terminal-credential.json'),'utf8'));
 const res=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};
};
async function stop(root){try{process.kill(descriptor(root).pid,'SIGTERM');await pause(300);}catch{}}

test('terminal main chat and profile survive client and daemon restarts, and revocation stays revoked',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-instance-'));
 try {
  let result=cli(root,'hello one\nhello two\nset provider to codex\n/confirm-provider\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/User turns saved: 2/);assert.match(result.stdout,/Saved provider: codex/);
  const bot=await request(root,'/api/main-bot',{});assert.equal(bot.body.provider,'codex');const id=bot.body.id;
  result=cli(root,'/settings\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Provider: codex/);assert.match(result.stdout,/hello one/);assert.match(result.stdout,/hello two/);
  await stop(root);result=cli(root,'/settings\nset provider to demo\n/confirm-provider\nhello three\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Provider: codex/);assert.match(result.stdout,/User turns saved: 3/);assert.equal((await request(root,'/api/main-bot',{})).body.id,id);
  const clients=(await request(root,'/api/clients')).body;await request(root,`/api/clients/${clients.find(x=>x.current).id}/revoke`,{});
  result=cli(root,'/quit\n');assert.equal(result.status,1);assert.match(result.stderr,/authorization was revoked/);
  await stop(root);result=cli(root,'/quit\n');assert.equal(result.status,1);assert.match(result.stderr,/authorization was revoked/);
 } finally {await stop(root);rmSync(root,{recursive:true,force:true});}
});

test('clock approval leaves the terminal usable and resolves the original command',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-approval-'));
 try {
  let result=cli(root,'/quit\n');assert.equal(result.status,0,result.stderr);
  await request(root,'/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
  result=cli(root,'what time is it?\n/approvals\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Still running/);assert.match(result.stdout,/\[tool_start\]/);assert.match(result.stdout,/"state": "pending"/);
  const command=result.stdout.match(/Command ID: ([\w-]+)/)[1];const approval=(await request(root,'/api/approvals')).body.find(x=>x.workId===command && x.state==='pending');assert.ok(approval);
  result=cli(root,`/approve ${approval.id}\n/status ${command}\n/quit\n`);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/"state":"approved"/);
  for(let i=0;i<30;i++){if((await request(root,`/api/commands/${command}`)).body.state==='completed')break;await pause(50);}
  assert.equal((await request(root,`/api/commands/${command}`)).body.state,'completed');
  result=cli(root,`/status ${command}\n/quit\n`);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/\[tool_result\].*\[ok\]/);
 }finally{await stop(root);rmSync(root,{recursive:true,force:true});}
});


test('simultaneous first clients converge on one main bot and one daemon',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-race-'));
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['dist/cli.js','--data-dir',root],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));child.stdin.end('/quit\n');});
 try {const results=await Promise.all([run(),run(),run()]);for(const result of results)assert.equal(result.code,0,result.err);const ids=results.map(result=>result.out.match(/shared main chat ([\w-]+)/)?.[1]);assert.ok(ids[0]);assert.equal(new Set(ids).size,1);assert.equal((await request(root,'/api/bots')).body.length,1);assert.equal((await request(root,'/api/clients')).body.length,1);}
 finally{await stop(root);rmSync(root,{recursive:true,force:true});}
});

test('migrating an existing database does not silently pair a credential',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {Instance}=await import('../dist/instance.js');
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-existing-')),path=join(root,'instance.sqlite');
 try{const instance=new Instance(path);instance.createBot({name:'Existing',instructions:''});instance.close();const db=new DatabaseSync(path);db.exec('DROP TABLE local_bootstrap; DROP TABLE main_bot; PRAGMA user_version=24');db.close();writeFileSync(join(root,'terminal-credential.json'),JSON.stringify({token:'a'.repeat(43)}),{mode:0o600});
  const result=cli(root,'/quit\n');assert.equal(result.status,1);assert.match(result.stderr,/authorization was revoked/);await stop(root);const data=new DatabaseSync(path,{readOnly:true});assert.equal(data.prepare('SELECT count(*) AS n FROM clients').get().n,0);assert.equal(data.prepare('SELECT count(*) AS n FROM bots').get().n,1);data.close();
 }finally{await stop(root);rmSync(root,{recursive:true,force:true});}
});


test('bare CLI shares one per-user instance across working directories and preserves checkout data',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-default-')),first=join(root,'first'),second=join(root,'second'),old=join(first,'.staf','instance.sqlite'),current=join(root,'.staf','terminal-instance');
 try{mkdirSync(join(first,'.staf'),{recursive:true});mkdirSync(second);writeFileSync(old,'existing data');const run=cwd=>spawnSync(process.execPath,[resolve('dist/cli.js')],{cwd,env:{...process.env,HOME:root},input:'/settings\n/quit\n',encoding:'utf8',timeout:20000});const a=run(first),b=run(second);assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);const id=a.stdout.match(/shared main chat ([\w-]+)/)?.[1];assert.ok(id);assert.match(b.stdout,new RegExp(`shared main chat ${id}`));assert.equal(readFileSync(old,'utf8'),'existing data');assert.ok(descriptor(current).pid);}
 finally{await stop(current);rmSync(root,{recursive:true,force:true});}
});


test('provider switches require explicit confirmation and settings can be cleared',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-settings-'));
 const one=(...args)=>spawnSync(process.execPath,['dist/cli.js','settings',...args,'--data-dir',root],{encoding:'utf8',timeout:20000});
 try{
  let result=cli(root,'hello\n/set provider codex\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/conversation history.*codex/);assert.equal((await request(root,'/api/main-bot',{})).body.provider,'demo');
  result=cli(root,'set provider to codex\n/cancel-provider\n/confirm-provider\n/quit\n');assert.match(result.stderr,/No provider change/);assert.equal((await request(root,'/api/main-bot',{})).body.provider,'demo');
  result=one('set','provider','codex');assert.equal(result.status,1);assert.match(result.stderr,/conversation history.*confirm-provider-change/);assert.equal((await request(root,'/api/main-bot',{})).body.provider,'demo');
  result=one('set','provider','codex','--confirm-provider-change');assert.equal(result.status,0,result.stderr);assert.equal((await request(root,'/api/main-bot',{})).body.provider,'codex');
  result=one('set','provider','codex');assert.equal(result.status,0,result.stderr);
  for(const [key,value] of [['model','example-model'],['reasoning','high']]){assert.equal(one('set',key,value).status,0);assert.equal(one('unset',key).status,0);assert.equal((await request(root,'/api/main-bot',{})).body[key],null);assert.equal(one('set-default',key,value).status,0);assert.equal(one('unset-default',key).status,0);assert.equal((await request(root,'/api/creation-defaults')).body[key],null);}
  result=cli(root,'/set model example-model\n/set reasoning high\n/unset model\n/unset reasoning\n/settings reasoning\n/quit\n');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Reasoning: \(provider default\)/);const profile=(await request(root,'/api/main-bot',{})).body;assert.equal(profile.model,null);assert.equal(profile.reasoning,null);
 }finally{await stop(root);rmSync(root,{recursive:true,force:true});}
});

test('busy messages remain saved across restarts and retry only when requested',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-busy-'));
 try{
  let result=cli(root,'/quit\n');assert.equal(result.status,0,result.stderr);const bot=(await request(root,'/api/main-bot',{})).body;
  await request(root,'/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
  assert.equal((await request(root,'/api/commands',{id:'other-client',botId:bot.id,content:'what time is it?'})).body.kind,'accepted');
  for(let i=0;i<50;i++){if((await request(root,'/api/approvals')).body.some(x=>x.workId==='other-client' && x.state==='pending'))break;await pause(30);}
  result=cli(root,'keep this message\n/quit\n');assert.equal(result.status,0,result.stderr);const id=result.stdout.match(/Unsent draft ([\w-]+): keep this message/)?.[1];assert.ok(id,result.stdout);
  result=cli(root,'/quit\n');assert.match(result.stdout,new RegExp(`Unsent draft ${id}: keep this message`));assert.ok(!(await request(root,`/api/bots/${bot.id}/messages`)).body.some(m=>m.content==='keep this message'));
  const approval=(await request(root,'/api/approvals')).body.find(x=>x.workId==='other-client' && x.state==='pending');assert.ok(approval);await request(root,`/api/approvals/${approval.id}/approve`,{});
  for(let i=0;i<50;i++){if((await request(root,'/api/commands/other-client')).body.state==='completed')break;await pause(30);}
  result=cli(root,`/retry ${id}\n/quit\n`);assert.equal(result.status,0,result.stderr);assert.ok((await request(root,`/api/bots/${bot.id}/messages`)).body.some(m=>m.content==='keep this message'));
 }finally{await stop(root);rmSync(root,{recursive:true,force:true});}
});


test('a slow accepted response appears without a status command while chat remains usable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'staf-terminal-watch-'));let child;
 try{
  let result=cli(root,'/quit\n');assert.equal(result.status,0,result.stderr);await request(root,'/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
  child=spawn(process.execPath,['dist/cli.js','--data-dir',root],{stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  child.stdin.write('what time is it?\n');for(let i=0;i<100 && !output.includes('Still running');i++)await pause(50);assert.match(output,/Still running/,errors);
  child.stdin.write('/settings show\n');for(let i=0;i<100 && !output.includes('Revision:');i++)await pause(20);assert.match(output,/Revision:/);
  const approval=(await request(root,'/api/approvals')).body.find(x=>x.state==='pending');assert.ok(approval);await request(root,`/api/approvals/${approval.id}/approve`,{});
  for(let i=0;i<100 && !/Command [\w-]+: completed/.test(output);i++)await pause(50);assert.match(output,/\[tool_result\].*\[ok\]/);assert.match(output,/Command [\w-]+: completed/);
  child.stdin.end('/quit\n');await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(errors)));});child=undefined;
 }finally{child?.kill();await stop(root);rmSync(root,{recursive:true,force:true});}
});
