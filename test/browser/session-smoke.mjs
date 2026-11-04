import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-session-gui-'));
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};let server,browser,socket,output='',seq=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){for(let i=0;i<150;i++){const value=await fn();if(value)return value;await sleep(100)}throw Error('Timed out: '+label)}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('CDP timeout')),10000);pending.set(id,{resolve:x=>{clearTimeout(timer);resolve(x)},reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
try {
 server=spawn(process.execPath,['test/browser/held-instance.mjs',join(temp,'instance.sqlite'),String(port)],{cwd:root,env,stdio:['pipe','pipe','pipe']});server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'pairing code');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'browser');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url))}catch{return null}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};await cdp('Page.enable');
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');
 await evaluate(`(()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(code)});input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()})()`);
 await until(()=>evaluate("!!localStorage.getItem('staf-token')"),'paired');
 const bot=await evaluate(`(async()=>{const r=await fetch('/api/bots',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'},body:JSON.stringify({name:'Session smoke',provider:'demo'})});return r.json()})()`);
 assert.ok(bot.id,JSON.stringify(bot));
 await evaluate("document.querySelector('[aria-label=\"Back to chat\"]')?.click()");
 await until(()=>evaluate("document.body.innerText.includes('Session smoke') && !!document.querySelector('.session-history')"),'agent selected');
 const first=await evaluate(`(async()=>{const r=await fetch('/api/bots/${bot.id}/sessions',{headers:{Authorization:'Bearer '+localStorage.getItem('staf-token')}});return (await r.json()).current.id})()`);
 await evaluate(`(async()=>{await fetch('/api/commands',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'},body:JSON.stringify({id:'gui-old',botId:'${bot.id}',sessionId:'${first}',content:'Remember this for me: GUI old source'})})})()`);
 await until(()=>evaluate("document.body.innerText.includes('GUI old source')"),'old message');
 await evaluate("(()=>{const input=document.querySelector('[aria-label=Message]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Old unsent draft');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
 await evaluate(`(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('staf-workspace-v1:')&&key.includes(':${bot.id}:${first}'));const value=JSON.parse(localStorage.getItem(key));value.submission={id:'gui-old',text:'Remember this for me: GUI old source',kind:'unknown',error:'Result uncertain'};localStorage.setItem(key,JSON.stringify(value))})()`);
 await evaluate("document.querySelector('.session-history summary').focus();document.querySelector('.session-history summary').click()");
 await until(()=>evaluate("!![...document.querySelectorAll('.session-history button')].find(b=>b.textContent.trim()==='Start fresh session')"),'history controls');
 await evaluate("[...document.querySelectorAll('.session-history button')].find(b=>b.textContent.trim()==='Start fresh session').click()");
 await until(()=>evaluate("document.body.innerText.includes('New session') && !document.querySelector('.messages').innerText.includes('GUI old source')"),'fresh session');
 await until(()=>evaluate("document.querySelector('[aria-label=Message]').value==='' && document.body.innerText.includes('Earlier browser records')"),'old draft remains separate');
 await evaluate("document.querySelector('.connection-recovery summary').click();[...document.querySelectorAll('.connection-recovery button')].find(button=>button.textContent.trim()==='Check original submission').click()");
 await until(()=>evaluate("document.querySelector('.connection-recovery').innerText.includes('Original command: completed')"),'original command status');
 await evaluate("(()=>{const input=document.querySelectorAll('.session-history input')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'GUI old source');input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('.session-history button')].find(b=>b.textContent.trim()==='Search').click()})()");
 await until(()=>evaluate("document.querySelector('.session-history').innerText.includes('Open user message')"),'history search');
 await evaluate("[...document.querySelectorAll('.session-history button')].find(b=>b.textContent.trim()==='Initial session').click()");
 await until(()=>evaluate("document.querySelector('.session-history').innerText.includes('GUI old source')"),'old history');
 await evaluate("[...document.querySelectorAll('.session-history button')].find(b=>b.textContent.trim()==='Select reference').click()");
 assert.match(await evaluate("document.querySelector('.session-history').innerText"),/session-message/);
 await cdp('Page.reload');await until(()=>evaluate("!!document.querySelector('.session-history') && !document.querySelector('.messages').innerText.includes('GUI old source')"),'restart active session');
 console.log('PASS paired served GUI fresh session, separate draft, original command status, search, reference and reload');
}finally{socket?.close();browser?.kill();server?.kill();await rm(temp,{recursive:true,force:true});}
