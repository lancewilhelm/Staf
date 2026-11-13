import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {startInstance} from './fixtures/controlled-instance.mjs';

const enabled=process.platform==='linux' && process.env.STAF_TEST_LINUX_SERVICE==='1';
const wait=async fn=>{for(let i=0;i<500;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Timed out');};

test('configured service runs file and terminal work inside the Linux boundary',{
 skip:enabled?false:'Requires an operator-prepared disposable Linux service and launcher',timeout:60000,
},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-linux-service-')),secret='synthetic-service-private-482913',name='staf-fixture-'+randomUUID();
 writeFileSync(join(dir,'private'),secret,{mode:0o600});let planned,seen=[];
 const app=startInstance(join(dir,'instance.sqlite'),0,{dataDir:dir,env:{STAF_LINUX_HOST_EXECUTION:'1',OPENROUTER_API_KEY:secret},providerFactory:async profile=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
  seen.push(JSON.stringify(messages));if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'done'};
  const guest=profile.toolMode==='code';return {role:'assistant',content:null,tool_calls:[{id:'effect',type:'function',function:{name:guest?'code_mode':planned.name,arguments:JSON.stringify(guest?{source:`return await capabilities.${planned.name}(${JSON.stringify(planned.input)});`}:planned.input)}}]};
 }})});
 let token,port;
 const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
 try {
  port=await app.listen();token=(await call('/api/pair',{code:app.code})).token;
  for(const mode of ['direct','hybrid','code']) {
   const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture-offline',toolMode:mode});let sequence=0;
   const run=async(name,input)=>{planned={name,input};const id=`service-${mode}-${++sequence}`;await call('/api/commands',{id,botId:bot.id,content:'Run controlled action'});const command=await wait(async()=>{const value=await call('/api/commands/'+id);return value.state!=='pending'&&value;});assert.equal(command.state,'completed');assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'succeeded',JSON.stringify(command));return id;};
   const file=name+'-'+mode;
   await run('file_write',{path:file,content:'ordinary fixture'});await run('file_read',{path:`/workspace/${file}`,offset:0,limit:64});
   await run('file_read',{path:`/srv/staf-workspace/${file}`,offset:0,limit:64});
   await run('file_search',{path:file,query:'fixture'});
   await run('file_edit',{path:file,expectedHash:createHash('sha256').update('ordinary fixture').digest('hex'),oldText:'fixture',newText:'edited'});
   await run('file_read',{path:file,offset:0,limit:64});
   const link=file+'-link',makeLink=await run('terminal_run',{command:`ln -s /usr/bin/node '${link}'`,retain:true});
   await wait(async()=>(await call('/api/processes')).find(item=>item.work.id===makeLink && item.outputComplete));
   planned={name:'file_read',input:{path:link,offset:0,limit:64}};const denied=`service-${mode}-${++sequence}`;
   await call('/api/commands',{id:denied,botId:bot.id,content:'Run controlled action'});
   const rejected=await wait(async()=>{const item=await call('/api/commands/'+denied);return item.state!=='pending'&&item;});
   assert.equal(rejected.state,'completed');assert.ok(rejected.workActions.every(item=>item.state!=='succeeded'));
   for(const terminalMode of ['pipe','pty']) {
    const id=await run('terminal_run',{command:`printf 'ordinary env:%s' "\${OPENROUTER_API_KEY-unset}"; test ! -r '${join(dir,'private')}'`,cwd:terminalMode==='pipe'?'/workspace':'/srv/staf-workspace',mode:terminalMode,retain:true});
    const process=await wait(async()=>(await call('/api/processes')).find(item=>item.work.id===id && item.outputComplete));
    const output=await call(`/api/processes/${process.id}/output`);const text=output.chunks.map(chunk=>chunk.text??'').join('');
    assert.match(text,/ordinary env:unset/);assert.equal(process.cwd,'/workspace');assert.equal(process.exitCode,0);assert.ok(!text.includes(secret));
   }
   const cleanup=await run('terminal_run',{command:`rm -f '${file}' '${link}'`,retain:true});
   await wait(async()=>(await call('/api/processes')).find(item=>item.work.id===cleanup && item.outputComplete));
  }
  assert.ok(seen.every(message=>!message.includes(secret)));
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
