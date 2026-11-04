import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, appendFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

const source=resolve(import.meta.dirname,'../..'), temp=await mkdtemp(join(tmpdir(),'staf-dev-browser-'));
const checkout=join(temp,'checkout'), data=join(temp,'data');
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH || (existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise(resolvePort=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolvePort(p));});});
const url=`http://127.0.0.1:${port}`, env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp,STAF_DEV_DATA_DIR:data,STAF_DEV_PORT:String(port)};
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
async function until(fn,label){for(let i=0;i<300;i++){try{const result=await fn();if(result)return result;}catch{}await sleep(100);}throw Error(`Timed out: ${label}\n${output}`);}
let launcher,browser,socket,proxy,output='',seq=0;const pending=new Map();
function cdp(method,params={}){return new Promise((resolveResult,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timed out: ${method}`));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolveResult(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try {
 await mkdir(checkout);for(const name of ['src','web','scripts','package.json','tsconfig.json','vite.config.ts'])await cp(join(source,name),join(checkout,name),{recursive:true});await symlink(join(source,'node_modules'),join(checkout,'node_modules'),'dir');
 proxy=createServer(socket=>socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(resolveListen=>proxy.listen(0,'127.0.0.1',resolveListen));
 launcher=spawn('corepack',['pnpm','dev'],{cwd:checkout,env,detached:true,stdio:['pipe','pipe','pipe']});launcher.stdout.on('data',b=>output+=b);launcher.stderr.on('data',b=>output+=b);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'backend ready');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0],'browser');
 const page=await until(async()=>(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url)),'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolveOpen,reject)=>{socket.onopen=resolveOpen;socket.onerror=reject});socket.onmessage=event=>{const msg=JSON.parse(event.data), entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(msg.error.message)):entry.resolve(msg.result);}};
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'pair page');
 await evaluate(`{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(code)});el.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()}`);
 await until(()=>evaluate("!!localStorage.getItem('staf-token')"),'browser paired');
 const token=await evaluate("localStorage.getItem('staf-token')");
 const call=async(path,body)=>{const response=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,`${path}: ${response.status}`);return response.json();};
 const bot=await call('/api/bots',{operationId:'smoke-agent',name:'Smoke agent',provider:'demo'});
 await until(()=>evaluate("[...document.querySelectorAll('.side button')].some(b=>b.textContent.includes('Smoke agent'))"),'agent shown');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('Smoke agent')).click()");
 await until(()=>evaluate("!!document.querySelector('textarea[aria-label=Message]')"),'chat opened');
 await evaluate(`{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'draft survives restart');el.dispatchEvent(new Event('input',{bubbles:true}))}`);
 await until(()=>evaluate("document.querySelector('textarea').value==='draft survives restart'"),'draft typed');
 await call('/api/commands',{id:'smoke-command',botId:bot.id,content:'offline smoke'});
 await until(async()=>(await call('/api/commands/smoke-command')).state==='completed','demo response');
 await until(()=>evaluate("document.body.innerText.includes('offline smoke')"),'browser sees shared chat');
 await appendFile(join(checkout,'web/style.css'),'\n:root { --staf-dev-smoke: reloaded; }\n');
 await until(()=>evaluate("getComputedStyle(document.documentElement).getPropertyValue('--staf-dev-smoke').trim()==='reloaded'"),'frontend hot reload');
 assert.equal(await evaluate("document.querySelector('textarea').value"),'draft survives restart');
 await call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
 await call('/api/commands',{id:'smoke-pending',botId:bot.id,content:'what time is it?'});
 await until(async()=>(await call('/api/inbox')).some(item=>item.kind==='approval' && item.work?.id==='smoke-pending'),'pending clock approval');
 const before=(output.match(/Backend ready/g)||[]).length;
 await appendFile(join(checkout,'src/provider-label.ts'),'\n// Disposable restart smoke edit.\n');
 await until(()=>(output.match(/Backend ready/g)||[]).length>before,'backend rebuilt and restarted');
 await until(()=>evaluate("document.body.innerText.includes('offline smoke') && document.querySelector('textarea')?.value==='draft survives restart' && !document.body.innerText.includes('Connection unavailable')"),'browser reconnected with draft');
 const messages=await call(`/api/bots/${bot.id}/messages`);assert.equal(messages.filter(message=>message.role==='user' && message.content==='offline smoke').length,1);
 assert.equal((await call('/api/commands/smoke-command')).state,'completed');
 assert.equal((await call('/api/commands/smoke-pending')).state,'interrupted');
 assert.equal(messages.filter(message=>message.role==='user' && message.content==='what time is it?').length,1);
 assert.equal((await call('/api/inbox')).some(item=>item.work?.id==='smoke-pending'),false);
 const dataset=(await (await fetch(url+'/api/dataset')).json()).id;
 const creationKey=`staf-workspace-v1:creation:${dataset}:retained-operation`;
 const oldKey='staf-workspace-v1:creation:legacy-operation';
 const record={kind:'create',operationId:'retained-operation',name:'Retained creation',instructions:'Saved text',provider:'demo',model:'',status:''};
 await evaluate(`localStorage.setItem(${JSON.stringify(creationKey)},${JSON.stringify(JSON.stringify(record))});localStorage.setItem(${JSON.stringify(oldKey)},${JSON.stringify(JSON.stringify({...record,operationId:'legacy-operation',name:'Legacy creation'}))})`);
 await cdp('Page.reload');
 await until(()=>evaluate("document.body.innerText.includes('Recovered creation. Check status')"),'same dataset restores pending creation');
 assert.equal(await evaluate("document.querySelector('.setup input').value"),'Retained creation');
 await evaluate("window.savedFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.savedFetch(...args);if(args[0]==='/api/bots'&&args[1]?.method==='POST'){window.creationHeld=true;await new Promise(resolve=>window.releaseCreation=resolve)}return response};[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry same creation').click()");
 await until(()=>evaluate('window.creationHeld'),'old creation response held');
 process.kill(-launcher.pid,'SIGINT');await new Promise(resolveExit=>launcher.once('exit',resolveExit));
 await run(process.execPath,['scripts/dev-data.mjs','reset'],{cwd:checkout,env});
 output='';launcher=spawn('corepack',['pnpm','dev'],{cwd:checkout,env,detached:true,stdio:['pipe','pipe','pipe']});launcher.stdout.on('data',b=>output+=b);launcher.stderr.on('data',b=>output+=b);
 const newCode=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'reset backend ready');
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'reset expires prior pairing');
 assert.equal(await evaluate("document.body.innerText.includes('Retained creation')"),false);
 await evaluate(`{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(newCode)});el.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()}`);
 await until(()=>evaluate("!!localStorage.getItem('staf-token') && document.body.innerText.includes('Project guide')"),'pair new dataset');
 await evaluate("if(typeof window.releaseCreation==='function')window.releaseCreation()");
 await sleep(200);
 assert.equal(await evaluate("document.body.innerText.includes('Retained creation')"),false,'old creation is not shown after reset');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(creationKey)})!==null && localStorage.getItem(${JSON.stringify(oldKey)})!==null`),true,'old records remain quarantined');
 assert.equal(await evaluate("document.body.innerText.includes('Recovered creation. Check status')"),false);
 await cdp('Page.reload');await until(()=>evaluate("document.body.innerText.includes('Project guide')"),'new dataset reload');
 assert.equal(await evaluate("document.body.innerText.includes('Retained creation') || document.body.innerText.includes('Legacy creation')"),false);
 const newToken=await evaluate("localStorage.getItem('staf-token')");
 const stale=await fetch(url+'/api/bots',{method:'POST',headers:{Authorization:`Bearer ${newToken}`,'Content-Type':'application/json','X-Staf-Dataset':dataset},body:JSON.stringify({operationId:'retained-operation',name:'Retained creation'})});assert.equal(stale.status,409);
 assert.equal((await (await fetch(url+'/api/bots',{headers:{Authorization:`Bearer ${newToken}`}})).json()).some(item=>item.name==='Retained creation'),false);
 process.kill(-launcher.pid,'SIGINT');await new Promise(resolveExit=>launcher.once('exit',resolveExit));
 await until(async()=>{try{await fetch(url,{signal:AbortSignal.timeout(300)});return false;}catch{return true;}},'shutdown with browser still open');
 console.log('PASS development command: browser pairing, shared demo chat, frontend HMR, backend restart, draft retention, reconnection, interrupted command without replay, same-dataset creation recovery, reset pairing and stale-record isolation');
} finally {
 socket?.close();if(browser && browser.exitCode===null){browser.kill('SIGTERM');await new Promise(resolveExit=>browser.once('exit',resolveExit));}
 if(launcher && launcher.exitCode===null && launcher.signalCode===null){process.kill(-launcher.pid,'SIGINT');await new Promise(resolveExit=>launcher.once('exit',resolveExit));}
 if(proxy)await new Promise(resolveClose=>proxy.close(resolveClose));await rm(temp,{recursive:true,force:true});
}
