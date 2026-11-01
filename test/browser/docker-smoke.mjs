import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

if(process.env.STAF_RUN_DOCKER_SMOKE!=='1')throw Error('Opt in with STAF_RUN_DOCKER_SMOKE=1 after reviewing this test.');
const root=resolve(import.meta.dirname,'../..'), docker='/usr/local/bin/docker';
const socketPath=join(homedir(),'.docker/run/docker.sock');
const image='sha256:fd7dc98638c8e305f4dc34e979f1c0fdfdcaeb0fbf8fcff77ae834b6da3d7e6e';
const chrome=process.env.CHROME_PATH || join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const temp=await mkdtemp(join(tmpdir(),'staf-docker-browser-')), db=join(temp,'instance.sqlite'), credential=join(temp,'client.json');
const port=await new Promise((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};
let server,browser,socket,proxy,output='', seq=0;const pending=new Map(), sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<300;i++){const v=await fn();if(v)return v;await sleep(100);}throw Error(`Timed out: ${label}`);}
function cli(...args){return execFileSync(process.execPath,['dist/cli.js','instance',...args],{cwd:root,env,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});}
function dockerCli(...args){return execFileSync(docker,['--host',`unix://${socketPath}`,...args],{env,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']});}
function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);rej(Error(`DevTools timeout: ${method}`));},10000);pending.set(id,{resolve:x=>{clearTimeout(timer);res(x)},reject:e=>{clearTimeout(timer);rej(e)}});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const v=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(v.exceptionDetails.text);return v.result.value;}
async function action(expression,condition,label){await evaluate(expression);await until(()=>evaluate(condition),label);console.log(`PASS ${label}`);}
try{
  assert.equal(dockerCli('image','inspect',image,'--format','{{.Id}}').trim(),image);
  proxy=createServer(c=>c.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise((res,rej)=>{proxy.once('error',rej);proxy.listen(0,'127.0.0.1',res);});
  server=spawn(process.execPath,['test/browser/docker-instance.mjs',db,String(port)],{cwd:root,env,stdio:['pipe','pipe','pipe']});server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
  let code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'server startup');
  browser=spawn(chrome,['--headless=new','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url+'/advanced'],{env,stdio:'ignore'});
  const debugPort=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome startup');
  const page=await until(async()=>{try{return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url))}catch{return null}},'Chrome page');
  socket=new WebSocket(page.webSocketDebuggerUrl);await Promise.race([new Promise((res,rej)=>{socket.onopen=res;socket.onerror=rej}),sleep(10000).then(()=>{throw Error('DevTools connection timeout')})]);socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  await until(()=>evaluate("document.readyState==='complete' && !!document.querySelector('#pairButton')"),'page load');
  await action(`document.querySelector('#code').value=${JSON.stringify(code)};document.querySelector('#pairButton').click()`,"!document.querySelector('#app').hidden",'browser pairing');
  await action("document.querySelector('#name').value='Docker smoke bot';document.querySelector('#create').click()","document.querySelector('#bots').options.length===1",'create disposable bot');
  output='';server.stdin.write('\n');code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'CLI pairing code');assert.match(cli('pair',url,credential,code),/Paired/);
  await evaluate("document.querySelector('#shellConfigLoad').click()");await until(()=>evaluate("typeof shellRevision==='number' && shellRevision>0"),'load shell config');
  await action(`document.querySelector('#shellBinary').value=${JSON.stringify(docker)};document.querySelector('#shellSocket').value=${JSON.stringify(socketPath)};document.querySelector('#shellImage').value=${JSON.stringify(image)};document.querySelector('#shellConfigSave').click()`,"document.querySelector('#shellStatus').textContent==='Configuration saved.'",'configure cached image and local daemon');
  for(const scope of ['instance','bot'])await action(`document.querySelector('#shellScope').value=${JSON.stringify(scope)};document.querySelector('#shellEnabled').checked=true;document.querySelector('#shellStatus').textContent='';document.querySelector('#shellSave').click()`,"document.querySelector('#shellStatus').textContent==='Permission saved.'",`enable ${scope} shell`);
  async function request(){return evaluate("document.querySelector('#draft').value='Run a disposable scratch check';document.querySelector('#send').click();JSON.parse(localStorage.getItem('staf-pending')).id")}
  async function approval(){await until(async()=>{await evaluate("document.querySelector('#shellRefresh').click()");await sleep(100);return evaluate("(()=>{try{return JSON.parse(document.querySelector('#shellApprovalDetail').textContent).command==='printf STAF_DOCKER_SMOKE_OK'}catch{return false}})()")},'scratch approval');return JSON.parse(await evaluate("document.querySelector('#shellApprovalDetail').textContent"));}
  async function finish(id){const result=await until(()=>{const c=JSON.parse(cli('status',url,credential,id));return ['completed','failed'].includes(c.state)&&c;},'command completion');await until(async()=>{await evaluate("if(localStorage.getItem('staf-pending'))document.querySelector('#status').click()");await sleep(100);return evaluate("!localStorage.getItem('staf-pending')")},'chat status');return result;}
  let id=await request(),prompt=await approval();assert.equal(prompt.command,'printf STAF_DOCKER_SMOKE_OK');assert.equal(prompt.imageId,image);assert.equal(prompt.dockerSocket,socketPath);
  await action("document.querySelector('#shellApprove').click()","document.querySelector('#shellStatus').textContent==='Command decision saved.'",'approve exact scratch command');
  const result=await finish(id);assert.equal(result.state,'completed');assert.equal(result.shellActions.length,1);assert.equal(result.shellActions[0].state,'succeeded');assert(await evaluate("document.querySelector('#messages').textContent.includes('Observed actual scratch output: STAF_DOCKER_SMOKE_OK')"));
  const executionId=result.shellActions[0].id;assert.match(executionId,/^[a-f0-9-]{36}$/);assert.equal(dockerCli('container','ls','--all','--filter',`label=staf.shell.execution=${executionId}`,'--format','{{.ID}}').trim(),'');
  console.log(`PASS real Docker output and executor cleanup for execution ${executionId}`);
  id=await request();prompt=await approval();await action("document.querySelector('#shellStatus').textContent='';document.querySelector('#shellDeny').click()","document.querySelector('#shellStatus').textContent==='Command decision saved.'",'deny second scratch command');
  const denied=await finish(id);assert.equal(denied.shellActions[0].state,'cancelled');assert.equal(dockerCli('container','ls','--all','--filter',`label=staf.shell.execution=${denied.shellActions[0].id}`,'--format','{{.ID}}').trim(),'');
  console.log('PASS denial created no labeled Docker container');
}finally{
  socket?.close();for(const child of [browser,server])if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(proxy?.listening)await new Promise(r=>proxy.close(r));await rm(temp,{recursive:true,force:true});
}
