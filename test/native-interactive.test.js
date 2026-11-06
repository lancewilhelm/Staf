import test from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';

const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'interactive',type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('a retained real terminal accepts input after the starting work completes',async()=>{
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('terminal_run',{command:'printf "ready\\n"; read answer; printf "answer:%s\\n" "$answer"',mode:'pty',retain:true});}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
  const until=async f=>{for(let i=0;i<500;i++){const value=await f();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  try {
    token=(await call('/api/pair',{code:app.code})).token;
    const bot=await call('/api/bots',{provider:'demo',name:'interactive',toolMode:'direct'});
    await call('/api/commands',{id:'interactive',botId:bot.id,content:'Start fixture'});
    const command=await until(async()=>{const c=await call('/api/commands/interactive');return c.state!=='pending'&&c;});
    assert.equal(command.state,'completed',command.error);
    const p=(await call('/api/processes'))[0];assert.equal(p.mode,'pty');assert.equal(p.state,'running');
    await call(`/api/processes/${p.id}/input`,{data:'hello\n'});
    await until(async()=>{const page=await call(`/api/processes/${p.id}/output`);return page.chunks.some(c=>Buffer.from(c.data,'base64').toString().includes('answer:hello'));});
    const ended=await until(async()=>{const current=await call(`/api/processes/${p.id}`);return current.outputComplete&&current;});assert.equal(ended.exitCode,0);
  } finally {await app.close();}
});

const until=async read=>{for(let i=0;i<500;i++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');};
async function fixture(env={}) {
 let plan;const app=startInstance(':memory:',0,{env,providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return plan.after?plan.after(messages):{role:'assistant',content:'done'};return profile.toolMode==='direct'?tool(plan.name,plan.input):tool('code_mode',{source:plan.source??`return await capabilities.${plan.name}(${JSON.stringify(plan.input)});`});}})});
 const port=await app.listen();let token;
 const call=async(path,body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 token=(await call('/api/pair',{code:app.code},'')).value.token;
 let serial=0;
 const run=async(bot,name,input,source,after)=>{plan={name,input,source,after};const id='interaction-'+ ++serial;assert.equal((await call('/api/commands',{id,botId:bot.id,content:'Run fixture'})).status,200);const result=await until(async()=>{const {value}=await call('/api/commands/'+id);return value.state!=='pending'&&value;});return {id,result};};
 return {app,port,token,call,run};
}

test('all modes submit later-work pipe input once, close it, and reject another agent',async()=>{
 const f=await fixture();const script='let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>process.stdout.write("received:"+s))';
 try{for(const mode of ['direct','hybrid','code']){const bot=(await f.call('/api/bots',{provider:'demo',name:mode,toolMode:mode})).value;const started=await f.run(bot,'terminal_run',{command:JSON.stringify(process.execPath)+" -e '"+script+"'",retain:true});assert.equal(started.result.state,'completed');const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);assert.equal(record.retained,true);assert.equal(record.state,'running');
  const outsider=(await f.call('/api/bots',{provider:'demo',name:'outsider',toolMode:mode})).value;const denied=await f.run(outsider,'terminal_write',{processId:record.id,data:'bad'});assert.notEqual(denied.result.workActions[0]?.state,'succeeded');
  const sent=await f.run(bot,'terminal_write',{processId:record.id,data:'hello'});assert.equal(sent.result.workActions[0].state,'succeeded');
  const eof=await f.run(bot,'terminal_eof',{processId:record.id});assert.equal(eof.result.workActions[0].state,'succeeded');await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);
  const page=(await f.call(`/api/processes/${record.id}/output`)).value;assert.equal(page.chunks.filter(c=>c.stream==='stdout').map(c=>c.text).join(''),'received:hello');assert.equal((await f.call(`/api/processes/${record.id}/input`,{data:'late'})).status,400);
 }}finally{await f.app.close();}
});

test('real PTY reports a TTY, resizes, and accepts input from another paired client and CLI',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile),directory=mkdtempSync(join(tmpdir(),'staf-pty-cli-'));const f=await fixture();
 try{const bot=(await f.call('/api/bots',{provider:'demo',name:'pty',toolMode:'hybrid'})).value;const {id}=await f.run(bot,'terminal_run',{command:'test -t 0 && echo tty-ready; read answer; stty size; printf "answer:%s\\n" "$answer"',mode:'pty',retain:true});const record=(await f.call('/api/processes')).value.find(p=>p.work.id===id);await until(async()=> (await f.call(`/api/processes/${record.id}/output`)).value.chunks.some(c=>c.text?.includes('tty-ready')));
  const second=(await f.call('/api/pair',{code:f.app.issueCode()},'')).value;const credential=join(directory,'credential.json');writeFileSync(credential,JSON.stringify(second),{mode:0o600});
  assert.equal((await f.call(`/api/processes/${record.id}/resize`,{cols:101,rows:37},second.token)).status,200);
  const result=await exec(process.execPath,['dist/cli.js','instance','process-input',`http://127.0.0.1:${f.port}`,credential,record.id,'hello\n']);assert.equal(JSON.parse(result.stdout).bytesSubmitted,6);
  await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);const page=(await f.call(`/api/processes/${record.id}/output`)).value;assert.ok(page.chunks.every(c=>c.stream==='terminal'));assert.match(page.chunks.map(c=>c.text).join(''),/37 101/);assert.match(page.chunks.map(c=>c.text).join(''),/answer:hello/);
 }finally{await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

for(const ending of ['return','error','limit'])test(`retained pipe survives guest ${ending} and remains controllable`,async()=>{
 const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name:ending,toolMode:'hybrid'})).value;const source='await capabilities.terminal_run({command:"exec sleep 30",retain:true});'+(ending==='return'?'return "started"':ending==='error'?'throw Error("ordinary")':'await staf.emit("x".repeat(300000))');const started=await f.run(bot,'code_mode',{},source);const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);assert.ok(record);assert.equal(record.state,'running');if(ending==='limit')assert.equal(started.result.state,'failed');else assert.equal(started.result.state,'completed');
  const stopped=await f.run(bot,'terminal_stop',{processId:record.id});assert.equal(stopped.result.workActions[0].state,'succeeded');await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);
 }finally{await f.app.close();}
});

test('unfinished nonretained process is stopped when its accepted work completes',async()=>{const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name:'foreground',toolMode:'direct'})).value;const started=await f.run(bot,'terminal_run',{command:'exec sleep 30'});const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);assert.equal((await f.call('/api/processes/'+record.id)).value.stopRequested,true);}finally{await f.app.close();}});

for(const mode of ['direct','hybrid','code'])test(`${mode} active-work Stop terminates its retained PTY`,async()=>{
 const f=await fixture();let release;const gate=new Promise(resolve=>{release=resolve;});
 try{const bot=(await f.call('/api/bots',{provider:'demo',name:mode,toolMode:mode})).value;const running=f.run(bot,'terminal_run',{command:'exec sleep 30',mode:'pty',retain:true},undefined,async()=>{await gate;return {role:'assistant',content:'done'};});const resource=await until(async()=> (await f.call('/api/processes')).value.find(p=>p.botId===bot.id&&p.state==='running'));assert.equal((await f.call(`/api/commands/${resource.work.id}/stop`,{})).status,200);release();const command=await running;assert.equal(command.result.state,'stopped');const ended=await until(async()=>{const p=(await f.call('/api/processes/'+resource.id)).value;return p.outputComplete&&p;});assert.equal(ended.stopRequested,true);assert.equal(ended.exitSignal,'SIGTERM');}
 finally{release();await f.app.close();}
});

test('completed input resumes without submitting the bytes twice',async()=>{
 const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name:'resume',toolMode:'hybrid'})).value;const script='process.stdin.on("data",b=>process.stdout.write(b))';const started=await f.run(bot,'terminal_run',{command:JSON.stringify(process.execPath)+" -e '"+script+"'",retain:true});const resource=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);let responses=0;
  const command=await f.run(bot,'terminal_write',{},`await capabilities.terminal_write({processId:${JSON.stringify(resource.id)},data:"x"});throw Error("ordinary");`,messages=>{if(responses++===0){const action=JSON.parse(messages.at(-1).content).recovery.actions.find(a=>a.state==='succeeded');assert.ok(action);return tool('terminal_write',{processId:resource.id,data:'x',_staf:{kind:'resume',actionId:action.id}});}return {role:'assistant',content:'done'};});assert.equal(command.result.state,'completed',command.result.error);assert.equal(command.result.workActions.length,1);await until(async()=> (await f.call(`/api/processes/${resource.id}/output`)).value.chunks.length);assert.equal((await f.call(`/api/processes/${resource.id}/output`)).value.chunks.map(c=>c.text).join(''),'x');await f.call(`/api/processes/${resource.id}/stop`,{});
 }finally{await f.app.close();}
});

test('secret terminal input is rejected in every mode and through paired controls before submission',async()=>{
 const parts=['synthetic','interactive','credential'],secret=parts.join('-'),f=await fixture({OPENROUTER_API_KEY:secret});try{for(const mode of ['direct','hybrid','code']){const bot=(await f.call('/api/bots',{provider:'demo',name:mode,toolMode:mode})).value;const started=await f.run(bot,'terminal_run',{command:'exec cat',retain:true});const resource=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);const command=await f.run(bot,'terminal_write',{processId:resource.id,data:secret},`return await capabilities.terminal_write({processId:${JSON.stringify(resource.id)},data:${JSON.stringify(parts)}.join('-')});`);assert.equal(command.result.workActions.length,0);assert.equal((await f.call(`/api/processes/${resource.id}/input`,{data:secret})).status,400);await f.call(`/api/processes/${resource.id}/input`,{data:'ping'});await until(async()=> (await f.call(`/api/processes/${resource.id}/output`)).value.chunks.length);assert.equal((await f.call(`/api/processes/${resource.id}/output`)).value.chunks.map(c=>c.text).join(''),'ping');await f.call(`/api/processes/${resource.id}/stop`,{});}}
 finally{await f.app.close();}
});

test('PTY input budget bounds the library queue and leaves explicit Stop usable',async()=>{
 const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name:'budget',toolMode:'direct'})).value;const started=await f.run(bot,'terminal_run',{command:'stty -echo; printf ready; exec sleep 30',mode:'pty',retain:true});const resource=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);await until(async()=> (await f.call(`/api/processes/${resource.id}/output`)).value.chunks.some(c=>c.text?.includes('ready')));const data='x'.repeat(resource.limits.inputBytes);for(let bytes=0;bytes<resource.limits.ptyInputBytes;bytes+=Buffer.byteLength(data))assert.equal((await f.call(`/api/processes/${resource.id}/input`,{data})).status,200);const rejected=await f.call(`/api/processes/${resource.id}/input`,{data:'x'});assert.equal(rejected.status,400);assert.match(rejected.value.error,/budget/);assert.equal((await f.call(`/api/processes/${resource.id}/stop`,{})).status,200);await until(async()=> (await f.call('/api/processes/'+resource.id)).value.outputComplete);}
 finally{await f.app.close();}
});

test('archive stops retained resources using their live ownership',async()=>{const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name:'archive',toolMode:'direct'})).value;const started=await f.run(bot,'terminal_run',{command:'exec sleep 30',retain:true});const resource=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);assert.equal((await f.call(`/api/bots/${bot.id}/archive`,{revision:bot.revision})).status,200);await until(async()=> (await f.call('/api/processes/'+resource.id)).value.outputComplete);assert.equal((await f.call('/api/processes/'+resource.id)).value.stopRequested,true);}finally{await f.app.close();}});

test('combined schema 35 upgrades retained-process metadata with a protected backup',async()=>{
 const {Instance}=await import('../dist/instance.js'),{DatabaseSync}=await import('node:sqlite'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const directory=mkdtempSync(join(tmpdir(),'staf-interaction-upgrade-')),path=join(directory,'db');let instance;
 try{instance=new Instance(path);instance.close();instance=undefined;let db=new DatabaseSync(path);for(const name of ['retained','input_closed','input_bytes','cols','rows'])db.exec('ALTER TABLE native_processes DROP COLUMN '+name);db.exec('PRAGMA user_version=35');db.close();instance=new Instance(path);assert.ok(instance.migrationBackup);db=new DatabaseSync(instance.migrationBackup,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,35);assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('native_processes') WHERE name='retained'").get().n,0);db.close();instance.close();instance=undefined;db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,37);assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_table_info('native_processes') WHERE name IN ('retained','input_closed','input_bytes','cols','rows')").get().n,5);db.close();}
 finally{instance?.close();rmSync(directory,{recursive:true,force:true});}
});

test('PTY output preserves binary bytes and filters a split Unicode credential',async()=>{
 const secret='synthetic-pty-é',bytes=[...Buffer.from(secret)],f=await fixture({OPENROUTER_API_KEY:secret});try{const bot=(await f.call('/api/bots',{provider:'demo',name:'binary',toolMode:'code'})).value;const script=`process.stdout.write(Buffer.from(${JSON.stringify([0,255,...bytes.slice(0,-1)])}));setTimeout(()=>process.stdout.write(Buffer.from(${JSON.stringify([...bytes.slice(-1),10])})),40)`;const started=await f.run(bot,'terminal_run',{command:JSON.stringify(process.execPath)+" -e '"+script+"'",mode:'pty',retain:true});const p=await until(async()=> (await f.call('/api/processes')).value.find(p=>p.work.id===started.id&&p.outputComplete));const output=(await f.call(`/api/processes/${p.id}/output`)).value;assert.ok(output.chunks.every(c=>c.stream==='terminal'));assert.deepEqual(Buffer.concat(output.chunks.map(c=>Buffer.from(c.data,'base64'))),Buffer.concat([Buffer.from([0,255]),Buffer.from('[REDACTED]\r\n')]));}finally{await f.app.close();}
});

test('PTY crash/restart keeps unknown ownership without replay or PID reattachment',async()=>{
 const {fork,spawnSync}=await import('node:child_process'),{once}=await import('node:events'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{randomUUID}=await import('node:crypto');const directory=mkdtempSync(join(tmpdir(),'staf-pty-crash-')),path=join(directory,'db'),marker='staf-pty-'+randomUUID(),command='exec sleep 30 # '+marker;const child=fork('test/native-process-server-fixture.mjs',[path,command,'pty'],{stdio:['ignore','ignore','ignore','ipc']});let app,pid;
 try{const [{port,code}]=await once(child,'message');let token;const call=async(route,body,at=port)=>{const r=await fetch(`http://127.0.0.1:${at}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,value:await r.json()};};token=(await call('/api/pair',{code})).value.token;const bot=(await call('/api/bots',{provider:'demo',name:'crash',toolMode:'direct'})).value;await call('/api/commands',{id:'crash',botId:bot.id,content:'Run fixture'});const resource=await until(async()=> (await call('/api/processes')).value.find(p=>p.state==='running'));pid=resource.pid;child.kill('SIGKILL');await once(child,'exit');app=startInstance(path,0,{env:{},providerFactory:async()=>{throw Error('must not replay')}});const nextPort=await app.listen();const restored=(await call('/api/processes/'+resource.id,undefined,nextPort)).value;assert.equal(restored.state,'unknown');assert.equal(restored.retained,true);assert.equal((await call(`/api/processes/${resource.id}/input`,{data:'x'},nextPort)).status,400);assert.equal((await call(`/api/processes/${resource.id}/stop`,{},nextPort)).status,400);assert.equal((await call('/api/processes',undefined,nextPort)).value.length,1);}
 finally{if(child.exitCode===null&&child.signalCode===null){child.send('shutdown');await once(child,'exit');}if(app)await app.close();if(pid){const listing=spawnSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});if(listing.status===0&&listing.stdout.includes(marker))try{process.kill(-pid,'SIGKILL')}catch{}}rmSync(directory,{recursive:true,force:true});}
});

for(const [name,data] of [['Ctrl-C','\x03'],['Ctrl-Z','\x1a']])test(`PTY ${name} preserves supervisor ownership and Stop control`,async()=>{const f=await fixture();try{const bot=(await f.call('/api/bots',{provider:'demo',name,toolMode:'direct'})).value;const started=await f.run(bot,'terminal_run',{command:'printf ready; exec sleep 30',mode:'pty',retain:true});const resource=await until(async()=> (await f.call('/api/processes')).value.find(p=>p.work.id===started.id&&p.state==='running'));await f.call(`/api/processes/${resource.id}/input`,{data});if(name==='Ctrl-Z')await f.call(`/api/processes/${resource.id}/stop`,{});const ended=await until(async()=>{const p=(await f.call('/api/processes/'+resource.id)).value;return p.outputComplete&&p;});assert.equal(ended.state,'exited');assert.equal(ended.exitSignal,name==='Ctrl-C'?'SIGINT':'SIGTERM');}finally{await f.app.close();}});
