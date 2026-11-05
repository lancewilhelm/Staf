import test from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';

const tool = (name, args) => ({role:'assistant',content:null,tool_calls:[{id:'native',type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('paired Direct command executes ordinary shell text and records its owner and output', async () => {
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool' ? {role:'assistant',content:'done'} : tool('terminal_run',{retain:true,command:"printf '%s\\n' 'https://example.test/?x=1'; printf 'error\\n' >&2; exit 7"});}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
  try {
    token=(await call('/api/pair',{code:app.code})).token;
    const bot=await call('/api/bots',{name:'native',toolMode:'direct'});
    await call('/api/commands',{id:'native-test',botId:bot.id,content:'Run a local fixture'});
    let command;
    for(let i=0;i<500;i++){command=await call('/api/commands/native-test');if(command.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(command.state,'completed',command.error);
    const processes=await call('/api/processes');assert.equal(processes.length,1);
    assert.equal(processes[0].botId,bot.id);assert.equal(processes[0].work.id,'native-test');assert.equal(processes[0].exitCode,7);
    const page=await call(`/api/processes/${processes[0].id}/output`);
    assert.equal(Buffer.from(page.chunks.find(chunk=>chunk.stream==='stdout').data,'base64').toString(), 'https://example.test/?x=1\n');assert.equal(Buffer.from(page.chunks.find(chunk=>chunk.stream==='stderr').data,'base64').toString(),'error\n');
  } finally {await app.close();}
});

test('paired clients inspect and stop a real held process in all tool modes',async()=>{
  let source;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return source==='direct'?tool('terminal_run',{retain:true,command:"printf 'ready\\n'; exec sleep 30"}):tool('code_mode',{source:'return await capabilities.terminal_run({retain:true,command:"printf ready; exec sleep 30"});'});}})});
  const port=await app.listen();let token;
  const call=async(path,body,t=token)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(t?{Authorization:`Bearer ${t}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async f=>{for(let i=0;i<500;i++){const value=await f();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  try {
    token=(await call('/api/pair',{code:app.code})).token;const second=(await call('/api/pair',{code:app.issueCode()},'')).token;
    for(const mode of ['direct','hybrid','code']) {
      source=mode==='direct'?'direct':'code';const bot=await call('/api/bots',{name:mode,toolMode:mode});await call('/api/commands',{id:`held-${mode}`,botId:bot.id,content:'Run fixture'});
      const proc=await until(async()=> (await call('/api/processes',undefined,second)).find(p=>p.work.id===`held-${mode}` && p.state==='running'));
      assert.equal(proc.botId,bot.id);assert.ok(proc.actionId);
      const stopped=await call(`/api/processes/${proc.id}/stop`,{},second);assert.equal(stopped.stopRequested,true);
      const ended=await until(async()=>{const p=await call(`/api/processes/${proc.id}`,undefined,second);return p.state==='exited' && p;});assert.equal(ended.exitSignal,'SIGTERM');
      const command=await until(async()=>{const c=await call(`/api/commands/held-${mode}`);return c.state!=='pending' && c;});assert.equal(command.state,'completed',command.error);assert.equal(command.workActions[0].id,proc.actionId);
    }
  } finally {await app.close();}
});

test('stopping active work terminates its process after the initial action returned',async()=>{
  let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool'){entered();await gate;return {role:'assistant',content:'done'};}return tool('terminal_run',{retain:true,command:'exec sleep 30'});}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async f=>{for(let i=0;i<500;i++){const v=await f();if(v)return v;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'stop',toolMode:'direct'});await call('/api/commands',{id:'stop-work',botId:bot.id,content:'Start fixture'});await ready;const process=(await call('/api/processes'))[0];assert.equal(process.state,'running');await call('/api/commands/stop-work/stop',{});release();const ended=await until(async()=>{const p=await call(`/api/processes/${process.id}`);return p.state==='exited' && p;});assert.equal(ended.stopRequested,true);assert.equal(ended.exitSignal,'SIGTERM');const command=await until(async()=>{const c=await call('/api/commands/stop-work');return c.state!=='pending'&&c;});assert.equal(command.state,'stopped');}
  finally {release();await app.close();}
});

test('default and explicit cwd use the host filesystem and normal service environment',async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'staf-native-cwd-'));writeFileSync(join(dir,'fixture.txt'),'from-file');let number=0;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return tool('terminal_run',number++===0?{command:'pwd; node --version; printf "%s" "$PATH"'}:{command:'pwd; cat fixture.txt',cwd:dir});}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'cwd',toolMode:'direct'});for(const id of ['default-cwd','explicit-cwd']){await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});for(let i=0;i<500;i++){if((await call(`/api/commands/${id}`)).state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}}const processes=await call('/api/processes');const d=processes.find(p=>p.work.id==='default-cwd'),e=processes.find(p=>p.work.id==='explicit-cwd');assert.ok(d.cwd.endsWith('/work'));assert.equal(e.cwd,dir);for(const [p,expected] of [[d,process.env.PATH],[e,'from-file']]){const page=await call(`/api/processes/${p.id}/output`);const text=page.chunks.filter(c=>c.stream==='stdout').map(c=>Buffer.from(c.data,'base64').toString()).join('');assert.ok(text.includes(expected));if(p===d)assert.ok(text.includes(process.version));assert.equal(p.exitCode,0);}}
  finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('crash loses observations without replay or PID-based reattachment',async()=>{
  const {fork}=await import('node:child_process');const {mkdtempSync,rmSync,readFileSync,existsSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {once}=await import('node:events');
  const dir=mkdtempSync(join(tmpdir(),'staf-native-crash-')),path=join(dir,'db'),marker=join(dir,'marker');
  const child=fork('test/native-process-server-fixture.mjs',[path,`printf x >> '${marker}'; exec sleep 30`],{stdio:['ignore','ignore','ignore','ipc']});let app,pid;
  try {
    const [{port,code}]=await once(child,'message');let token;
    const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
    token=(await call('/api/pair',{code})).token;const bot=await call('/api/bots',{name:'crash',toolMode:'direct'});await call('/api/commands',{id:'crash',botId:bot.id,content:'Run fixture'});
    let processRecord;for(let i=0;i<500;i++){processRecord=(await call('/api/processes')).find(p=>p.state==='running');if(processRecord)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(processRecord);pid=processRecord.pid;for(let i=0;i<500 && (!existsSync(marker) || readFileSync(marker,'utf8')!=='x');i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(readFileSync(marker,'utf8'),'x');
    child.kill('SIGKILL');await once(child,'exit');process.kill(-pid,'SIGKILL');pid=undefined;
    app=startInstance(path,0,{env:{},providerFactory:async()=>{throw Error('must not replay');}});const restartedPort=await app.listen();const response=await fetch(`http://127.0.0.1:${restartedPort}/api/processes/${processRecord.id}`,{headers:{Authorization:`Bearer ${token}`}});const restored=await response.json();assert.equal(restored.state,'unknown');assert.equal(restored.exitCode,null);assert.equal(readFileSync(marker,'utf8'),'x');const stop=await fetch(`http://127.0.0.1:${restartedPort}/api/processes/${processRecord.id}/stop`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(stop.status,400);
  } finally {if(pid)try{process.kill(-pid,'SIGKILL');}catch{}if(child.exitCode===null && child.signalCode===null){if(pid)child.kill('SIGKILL');else child.send('shutdown');await once(child,'exit');}if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('bounded output reports an expired cursor and paginates retained bytes',async()=>{
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('terminal_run',{retain:true,command:"head -c 200000 /dev/zero | tr '\\000' x"});}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'bounded',toolMode:'direct'});await call('/api/commands',{id:'bounded',botId:bot.id,content:'Run fixture'});let p;for(let i=0;i<500;i++){p=(await call('/api/processes'))[0];if(p?.outputComplete)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(p.outputComplete,true);let page=await call(`/api/processes/${p.id}/output`);assert.equal(page.gap,true);assert.ok(page.firstCursor>0);let bytes=0;while(true){bytes+=page.chunks.reduce((total,c)=>total+Buffer.from(c.data,'base64').length,0);if(!page.hasMore)break;page=await call(`/api/processes/${p.id}/output?cursor=${page.nextCursor}`);assert.equal(page.gap,false);}assert.ok(bytes>0&&bytes<=p.limits.outputBytes);}
  finally {await app.close();}
});

test('paired CLI inspects output and stops the same live process',async()=>{
  const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile),dir=mkdtempSync(join(tmpdir(),'staf-process-cli-'));
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('terminal_run',{retain:true,command:"printf 'cli fixture'; exec sleep 30"});}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try {token=(await call('/api/pair',{code:app.code})).token;const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify(await call('/api/pair',{code:app.issueCode()})));const bot=await call('/api/bots',{name:'cli',toolMode:'direct'});await call('/api/commands',{id:'cli',botId:bot.id,content:'Run fixture'});let p;for(let i=0;i<500;i++){p=(await call('/api/processes'))[0];if(p?.state==='running')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(p.state,'running');for(let i=0;i<500;i++){if((await call(`/api/processes/${p.id}/output`)).chunks.length)break;await new Promise(resolve=>setTimeout(resolve,10));}const args=['dist/cli.js','instance'],url=`http://127.0.0.1:${port}`;const list=JSON.parse((await run(process.execPath,[...args,'processes',url,credential])).stdout);assert.equal(list[0].id,p.id);const output=JSON.parse((await run(process.execPath,[...args,'process-output',url,credential,p.id])).stdout);assert.match(output.chunks.map(c=>c.text??'').join(''),/cli fixture/);const stop=JSON.parse((await run(process.execPath,[...args,'process-stop',url,credential,p.id])).stdout);assert.equal(stop.stopRequested,true);}
  finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('a recovered shell action requires a repeat challenge before running again',async()=>{
  const {mkdtempSync,rmSync,readFileSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'staf-process-repeat-')),marker=join(dir,'marker');const command=`printf x >> '${marker}'`;
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){const results=messages.filter(m=>m.role==='tool');if(results.length===0)return tool('code_mode',{source:`await capabilities.terminal_run({retain:true,command:${JSON.stringify(command)}}); throw Error('retry');`});if(results.length===1)return tool('terminal_run',{retain:true,command});if(results.length===2){const prior=JSON.parse(results[1].content);assert.equal(prior.kind,'repeat-required');return tool('terminal_run',{retain:true,command,_staf:{kind:'repeat',challenge:prior.challenge}});}return {role:'assistant',content:'done'};}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try{token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'repeat',toolMode:'hybrid'});await call('/api/commands',{id:'repeat',botId:bot.id,content:'Run fixture'});let result;for(let i=0;i<500;i++){result=await call('/api/commands/repeat');if(result.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(result.state,'completed',result.error);assert.equal(readFileSync(marker,'utf8'),'xx');assert.equal(result.workActions.length,2);assert.ok(result.workActions.every(action=>action.state==='succeeded'));}
  finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('all modes preserve arbitrary shell text and observe stdout, stderr and nonzero exit',async()=>{
  let mode;const command="printf '%s\\n' 'https://example.test/?q=1'; printf 'stderr\\n' >&2; exit 7";
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return mode==='direct'?tool('terminal_run',{retain:true,command}):tool('code_mode',{source:`return await capabilities.terminal_run({retain:true,command:${JSON.stringify(command)}});`});}})});const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  try{token=(await call('/api/pair',{code:app.code})).token;for(mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{name:'result-'+mode,toolMode:mode});await call('/api/commands',{id:'result-'+mode,botId:bot.id,content:'Run fixture'});let result;for(let i=0;i<500;i++){result=await call('/api/commands/result-'+mode);if(result.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(result.state,'completed',result.error);const process=(await call('/api/processes')).find(p=>p.work.id==='result-'+mode);assert.equal(process.exitCode,7);const page=await call(`/api/processes/${process.id}/output`);assert.equal(page.chunks.filter(c=>c.stream==='stdout').map(c=>c.text).join(''),'https://example.test/?q=1\n');assert.equal(page.chunks.filter(c=>c.stream==='stderr').map(c=>c.text).join(''),'stderr\n');}}
  finally{await app.close();}
});

for(const [description,redirect] of [['pipe-holding child',''],['child with redirected pipes',' >/dev/null 2>&1']]) test(`another client stopping active work terminates a ${description} after the shell exits`,async()=>{
  const {randomUUID}=await import('node:crypto');const {spawnSync}=await import('node:child_process');const marker='staf-fixture-'+randomUUID();
  const command=`${JSON.stringify(process.execPath)} -e 'setTimeout(()=>{},30000)' ${marker}${redirect} & echo $!; exit 0`;
  let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const app=startInstance(':memory:',0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool'){entered();await gate;return {role:'assistant',content:'done'};}return tool('terminal_run',{retain:true,command});}})});
  const port=await app.listen();let token,childPid;
  const call=async(path,body,t=token)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(t?{Authorization:`Bearer ${t}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
  const until=async f=>{for(let i=0;i<300;i++){const v=await f();if(v)return v;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  const alive=()=>{try{process.kill(childPid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
  try {
    token=(await call('/api/pair',{code:app.code})).token;const second=(await call('/api/pair',{code:app.issueCode()},'')).token;
    const bot=await call('/api/bots',{name:'orphan',toolMode:'direct'});await call('/api/commands',{id:'orphan-work',botId:bot.id,content:'Start fixture'});await ready;
    const resource=(await call('/api/processes'))[0];const page=await call(`/api/processes/${resource.id}/output`);childPid=Number(page.chunks.map(c=>c.text??'').join('').trim());assert.ok(Number.isSafeInteger(childPid)&&childPid>1);assert.ok(alive());assert.equal(resource.exitCode,0);assert.equal(resource.outputComplete,false);
    await call('/api/commands/orphan-work/stop',{},second);release();
    await until(()=>!alive());childPid=undefined;
    const ended=await until(async()=>{const p=await call(`/api/processes/${resource.id}`,undefined,second);return p.outputComplete&&p;});assert.equal(ended.stopRequested,true);
    const work=await until(async()=>{const c=await call('/api/commands/orphan-work',undefined,second);return c.state!=='pending'&&c;});assert.equal(work.state,'stopped');
  } finally {release();if(childPid){const ps=spawnSync('/bin/ps',['-p',String(childPid),'-o','command='],{encoding:'utf8'});if(ps.status===0 && ps.stdout.includes(marker))try{process.kill(childPid,'SIGKILL');}catch{}}await app.close();}
});
