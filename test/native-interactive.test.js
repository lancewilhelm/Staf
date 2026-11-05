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
    const bot=await call('/api/bots',{name:'interactive',toolMode:'direct'});
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
 let plan;const app=startInstance(':memory:',0,{env,providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return profile.toolMode==='direct'?tool(plan.name,plan.input):tool('code_mode',{source:plan.source??`return await capabilities.${plan.name}(${JSON.stringify(plan.input)});`});}})});
 const port=await app.listen();let token;
 const call=async(path,body,credential=token)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,value:await response.json()};};
 token=(await call('/api/pair',{code:app.code},'')).value.token;
 let serial=0;
 const run=async(bot,name,input,source)=>{plan={name,input,source};const id='interaction-'+ ++serial;assert.equal((await call('/api/commands',{id,botId:bot.id,content:'Run fixture'})).status,200);const result=await until(async()=>{const {value}=await call('/api/commands/'+id);return value.state!=='pending'&&value;});return {id,result};};
 return {app,port,token,call,run};
}

test('all modes submit later-work pipe input once, close it, and reject another agent',async()=>{
 const f=await fixture();const script='let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>process.stdout.write("received:"+s))';
 try{for(const mode of ['direct','hybrid','code']){const bot=(await f.call('/api/bots',{name:mode,toolMode:mode})).value;const started=await f.run(bot,'terminal_run',{command:JSON.stringify(process.execPath)+" -e '"+script+"'",retain:true});assert.equal(started.result.state,'completed');const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);assert.equal(record.retained,true);assert.equal(record.state,'running');
  const outsider=(await f.call('/api/bots',{name:'outsider',toolMode:mode})).value;const denied=await f.run(outsider,'terminal_write',{processId:record.id,data:'bad'});assert.notEqual(denied.result.workActions[0]?.state,'succeeded');
  const sent=await f.run(bot,'terminal_write',{processId:record.id,data:'hello'});assert.equal(sent.result.workActions[0].state,'succeeded');
  const eof=await f.run(bot,'terminal_eof',{processId:record.id});assert.equal(eof.result.workActions[0].state,'succeeded');await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);
  const page=(await f.call(`/api/processes/${record.id}/output`)).value;assert.equal(page.chunks.filter(c=>c.stream==='stdout').map(c=>c.text).join(''),'received:hello');assert.equal((await f.call(`/api/processes/${record.id}/input`,{data:'late'})).status,400);
 }}finally{await f.app.close();}
});

test('real PTY reports a TTY, resizes, and accepts input from another paired client and CLI',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile),directory=mkdtempSync(join(tmpdir(),'staf-pty-cli-'));const f=await fixture();
 try{const bot=(await f.call('/api/bots',{name:'pty',toolMode:'hybrid'})).value;const {id}=await f.run(bot,'terminal_run',{command:'test -t 0 && echo tty-ready; read answer; stty size; printf "answer:%s\\n" "$answer"',mode:'pty',retain:true});const record=(await f.call('/api/processes')).value.find(p=>p.work.id===id);await until(async()=> (await f.call(`/api/processes/${record.id}/output`)).value.chunks.some(c=>c.text?.includes('tty-ready')));
  const second=(await f.call('/api/pair',{code:f.app.issueCode()},'')).value;const credential=join(directory,'credential.json');writeFileSync(credential,JSON.stringify(second),{mode:0o600});
  assert.equal((await f.call(`/api/processes/${record.id}/resize`,{cols:101,rows:37},second.token)).status,200);
  const result=await exec(process.execPath,['dist/cli.js','instance','process-input',`http://127.0.0.1:${f.port}`,credential,record.id,'hello\n']);assert.equal(JSON.parse(result.stdout).bytesSubmitted,6);
  await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);const page=(await f.call(`/api/processes/${record.id}/output`)).value;assert.ok(page.chunks.every(c=>c.stream==='terminal'));assert.match(page.chunks.map(c=>c.text).join(''),/37 101/);assert.match(page.chunks.map(c=>c.text).join(''),/answer:hello/);
 }finally{await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

for(const ending of ['return','error','limit'])test(`retained pipe survives guest ${ending} and remains controllable`,async()=>{
 const f=await fixture();try{const bot=(await f.call('/api/bots',{name:ending,toolMode:'hybrid'})).value;const source='await capabilities.terminal_run({command:"exec sleep 30",retain:true});'+(ending==='return'?'return "started"':ending==='error'?'throw Error("ordinary")':'await staf.emit("x".repeat(300000))');const started=await f.run(bot,'code_mode',{},source);const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);assert.ok(record);assert.equal(record.state,'running');if(ending==='limit')assert.equal(started.result.state,'failed');else assert.equal(started.result.state,'completed');
  const stopped=await f.run(bot,'terminal_stop',{processId:record.id});assert.equal(stopped.result.workActions[0].state,'succeeded');await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);
 }finally{await f.app.close();}
});

test('unfinished nonretained process is stopped when its accepted work completes',async()=>{const f=await fixture();try{const bot=(await f.call('/api/bots',{name:'foreground',toolMode:'direct'})).value;const started=await f.run(bot,'terminal_run',{command:'exec sleep 30'});const record=(await f.call('/api/processes')).value.find(p=>p.work.id===started.id);await until(async()=> (await f.call('/api/processes/'+record.id)).value.outputComplete);assert.equal((await f.call('/api/processes/'+record.id)).value.stopRequested,true);}finally{await f.app.close();}});
