import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {startInstance} from '../../dist/instance-service.js';

const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-dataset-browser-')),data=join(temp,'instance.sqlite');
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise(resolvePort=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolvePort(p));});});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp,STAF_DEV_DATA_DIR:temp};
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
async function until(fn,label){for(let i=0;i<250;i++){try{const value=await fn();if(value)return value;}catch{}await sleep(100);}throw Error(`Timed out: ${label}`);}
let app=startInstance(data,port,{env:{}}),browser,socket,proxy,seq=0;const pending=new Map();
function cdp(method,params={}){return new Promise((resolveResult,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error(`CDP timed out: ${method}`)),10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolveResult(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try {
 await app.listen();
 proxy=createServer(socket=>socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(resolveListen=>proxy.listen(0,'127.0.0.1',resolveListen));
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0],'browser');
 const page=await until(async()=>(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url)),'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolveOpen,reject)=>{socket.onopen=resolveOpen;socket.onerror=reject});socket.onmessage=event=>{const msg=JSON.parse(event.data),entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(msg.error.message)):entry.resolve(msg.result);}};
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'pair page');
 const pair=code=>evaluate(`{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(code)});el.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()}`);
 await pair(app.code);await until(()=>evaluate("!![...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent'))"),'paired');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent')).click()");
 await until(()=>evaluate("!!document.querySelector('.agent-settings input')"),'creation form');
 await evaluate("{const el=document.querySelector('.agent-settings input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Delayed creation');el.dispatchEvent(new Event('input',{bubbles:true}));window.originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(args[0]==='/api/bots'&&args[1]?.method==='POST'){window.held=true;await new Promise(resolve=>window.release=resolve)}return response}}");
 await evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");
 await evaluate("document.querySelector('.agent-settings button[type=submit]').click()");
 await until(()=>evaluate('window.held'),'creation response held');
 const oldRecord=await evaluate("Object.entries(localStorage).find(([k])=>k.startsWith('staf-workspace-v1:creation:'))[0]");
 await app.close();app=null;
 const reset=spawnSync(process.execPath,['scripts/dev-data.mjs','reset'],{cwd:root,env,encoding:'utf8'});assert.equal(reset.status,0,reset.stderr);
 app=startInstance(data,port,{env:{}});await app.listen();
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'old token rejected');
 await pair(app.code);await until(()=>evaluate("document.body.innerText.includes('Project guide')"),'paired with replacement');
 await evaluate('window.release()');await sleep(300);
 assert.equal(await evaluate("document.body.innerText.includes('Delayed creation')"),false,'late old response cannot restore old form or agent');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldRecord)})!==null`),true,'old creation stays quarantined');
 const token=await evaluate("localStorage.getItem('staf-token')");const bots=await(await fetch(url+'/api/bots',{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(bots.some(bot=>bot.name==='Delayed creation'),false);
 console.log('PASS delayed creation response cannot cross a dataset reset in an already-open browser');
} finally {
 socket?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await new Promise(resolveExit=>browser.once('exit',resolveExit));}
 if(app)await app.close();if(proxy)await new Promise(resolveClose=>proxy.close(resolveClose));await rm(temp,{recursive:true,force:true});
}
