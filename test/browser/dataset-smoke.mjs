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
 // Old records without a dataset identity must only be managed from Settings.
 await until(()=>evaluate("!![...document.querySelectorAll('.settings-content button')].find(b=>b.textContent.trim()==='Back to chat')"),'initial Settings');
 await evaluate("[...document.querySelectorAll('.settings-content button')].find(b=>b.textContent.trim()==='Back to chat').click()");
 await until(()=>evaluate("!document.querySelector('.settings-content')"),'normal chat');
 const oldA='staf-workspace-v1:writer-a:agent-a',oldB='staf-workspace-v1:writer-b:agent-b';
 const valueA=JSON.stringify({text:'First old draft',submission:null}),valueB=JSON.stringify({text:'Second old draft',submission:null});
 const datasetId=(await (await fetch(url+'/api/dataset')).json()).id;
 const scopedDraft=`staf-workspace-v1:${datasetId}:other-writer:other-agent`;
 await evaluate(`localStorage.setItem(${JSON.stringify(oldA)},${JSON.stringify(valueA)});localStorage.setItem(${JSON.stringify(oldB)},${JSON.stringify(valueB)});localStorage.setItem(${JSON.stringify(scopedDraft)},${JSON.stringify(valueA)})`);
 await sleep(1500);
 assert.equal(await evaluate("document.body.innerText.includes('Earlier browser records')"),false,'old records are hidden from chat');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.getAttribute('aria-label')==='Settings' || b.textContent.trim()==='Settings').click()");
 await until(()=>evaluate("document.body.innerText.includes('Earlier browser records')"),'Settings shows old records');
 assert.equal(await evaluate("document.querySelectorAll('.earlier-record').length"),2);
 await cdp('Browser.grantPermissions',{origin:url,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await evaluate(`{const card=[...document.querySelectorAll('.earlier-record')].find(el=>el.textContent.includes(${JSON.stringify(oldA)}));card.querySelector('button').click()}`);
 await until(()=>evaluate("navigator.clipboard.readText().then(text=>text.includes('First old draft'))"),'copy includes saved text');
 const clickRecord=(key,button)=>evaluate(`{const card=[...document.querySelectorAll('.earlier-record')].find(el=>el.textContent.includes(${JSON.stringify(key)}));[...card.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(button)}).click()}`);
 const clickDialog=button=>evaluate(`[...document.querySelector('dialog[open]').querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(button)}).click()`);
 await clickRecord(oldA,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'discard confirmation');await clickDialog('Cancel');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldA)})`),valueA,'cancel retains record');
 await clickRecord(oldA,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'changed record confirmation');
 const changedA=JSON.stringify({text:'Changed after confirmation',submission:null});
 await evaluate(`localStorage.setItem(${JSON.stringify(oldA)},${JSON.stringify(changedA)})`);await clickDialog('Discard record');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldA)})`),changedA,'changed record survives stale confirmation');
 await until(()=>evaluate("document.body.innerText.includes('Changed after confirmation')"),'changed record is refreshed');
 await evaluate(`window.lockTab=window.open(${JSON.stringify(url)},'_blank');void 0`);
 await until(()=>evaluate("window.lockTab?.document.readyState==='complete' && !!window.lockTab.navigator.locks"),'second tab opened');
 await evaluate(`void window.lockTab.navigator.locks.request('staf-draft:'+${JSON.stringify(oldB)},async()=>{window.lockHeld=true;await new Promise(resolve=>window.releaseLock=resolve)})`);
 await until(()=>evaluate('window.lockHeld'),'second tab owns old record');
 await clickRecord(oldB,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'locked record confirmation');await clickDialog('Discard record');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldB)})`),valueB,'another tab lock prevents discard');
 await evaluate('window.releaseLock();window.lockTab.close()');
 await clickRecord(oldA,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'discard changed record');await clickDialog('Discard record');
 await until(()=>evaluate(`localStorage.getItem(${JSON.stringify(oldA)})===null`),'selected record removed');
 assert.equal(await evaluate("document.querySelectorAll('.earlier-record').length"),1,'section remains for the other record');
 assert.equal(await evaluate("!!localStorage.getItem('staf-token')"),true,'pairing survives discard');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(scopedDraft)})`),valueA,'dataset-scoped draft survives discard');
 await clickRecord(oldB,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'discard remaining record');await clickDialog('Discard record');
 await until(()=>evaluate("!document.body.innerText.includes('Earlier browser records')"),'section disappears when resolved');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent')).click()");
 await until(()=>evaluate("!!document.querySelector('.agent-settings input')"),'creation form');
 await evaluate("{const el=document.querySelector('.agent-settings input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Delayed creation');el.dispatchEvent(new Event('input',{bubbles:true}));window.originalFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(args[0]==='/api/bots'&&args[1]?.method==='POST'){window.held=true;await new Promise(resolve=>window.release=resolve)}return response}}");
 await until(()=>evaluate("!!document.querySelector('.setup .provider-choices select')"),'creation provider choices');
 await evaluate("{const el=document.querySelector('.setup .provider-choices select');el.value='codex';el.dispatchEvent(new Event('change',{bubbles:true}))}");
 await evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");
 await evaluate("document.querySelector('.agent-settings button[type=submit]').click()");
 await until(()=>evaluate('window.held'),'creation response held');
 const oldRecord=await evaluate("Object.entries(localStorage).find(([k])=>k.startsWith('staf-workspace-v1:creation:'))[0]");
 const resetLegacy='staf-workspace-v1:reset-writer:reset-agent';
 await evaluate(`localStorage.setItem(${JSON.stringify(resetLegacy)},${JSON.stringify(valueB)});document.querySelector('.side button[aria-label=Settings]').click()`);
 await until(()=>evaluate(`document.body.innerText.includes(${JSON.stringify(resetLegacy)})`),'record visible before dataset change');
 await clickRecord(resetLegacy,'Discard');await until(()=>evaluate("!!document.querySelector('dialog[open]')"),'confirmation open before reset');
 await app.close();app=null;
 const reset=spawnSync(process.execPath,['scripts/dev-data.mjs','reset'],{cwd:root,env,encoding:'utf8'});assert.equal(reset.status,0,reset.stderr);
 app=startInstance(data,port,{env:{}});await app.listen();
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'old token rejected');
 await pair(app.code);await until(()=>evaluate("document.body.innerText.includes('Project guide')"),'paired with replacement');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(resetLegacy)})`),valueB,'dataset reset cannot confirm old discard');
 assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false,'dataset change closes old confirmation');
 await evaluate('window.release()');await sleep(300);
 assert.equal(await evaluate("document.body.innerText.includes('Delayed creation')"),false,'late old response cannot restore old form or agent');
 assert.equal(await evaluate(`localStorage.getItem(${JSON.stringify(oldRecord)})!==null`),true,'old creation stays quarantined');
 const token=await evaluate("localStorage.getItem('staf-token')");const bots=await(await fetch(url+'/api/bots',{headers:{Authorization:`Bearer ${token}`}})).json();assert.equal(bots.some(bot=>bot.name==='Delayed creation'),false);
 console.log('PASS delayed creation response cannot cross a dataset reset in an already-open browser');
} finally {
 socket?.close();if(browser&&browser.exitCode===null){browser.kill('SIGTERM');await new Promise(resolveExit=>browser.once('exit',resolveExit));}
 if(app)await app.close();if(proxy)await new Promise(resolveClose=>proxy.close(resolveClose));await rm(temp,{recursive:true,force:true});
}
