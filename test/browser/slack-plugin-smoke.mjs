import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-slack-browser-'));
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};let service,browser,socket,output='',seq=0;const pending=new Map();
const until=async(fn,label)=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label+' '+output);};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try {
 service=spawn(process.execPath,['test/fixtures/slack-browser.mjs',join(temp,'instance.sqlite'),String(port)],{cwd:root,env,stdio:['pipe','pipe','pipe']});service.stdout.on('data',chunk=>output+=chunk);service.stderr.on('data',chunk=>output+=chunk);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'service');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:'ignore'});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url))}catch{return null}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}};
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');
 await evaluate(`(()=>{const input=document.querySelector('input');input.value=${JSON.stringify(code)};input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()})()`);
 await until(()=>evaluate("document.body.innerText.includes('Plugins') && document.body.innerText.includes('Not connected')"),'plugins shown');
 await evaluate(`(async()=>{const token=localStorage.getItem('staf-token');const r=await fetch('/api/bots',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'Slack agent',provider:'live',model:'fixture'})});if(!r.ok)throw Error(await r.text());})()`);
 await until(()=>evaluate("[...document.querySelectorAll('.side button')].some(b=>b.textContent.includes('Slack agent'))"),'agent loaded');
 await evaluate(`(()=>{const section=document.querySelector('section[aria-label="Plugins"]');section.querySelector('summary').click();const values=['xapp-synthetic','xoxb-synthetic','T123','U123','D123'];section.querySelectorAll('input').forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}));});const select=section.querySelector('select');select.selectedIndex=1;select.dispatchEvent(new Event('change',{bubbles:true}));section.querySelector('form').requestSubmit();})()`);
 await until(()=>evaluate("document.querySelector('section[aria-label=Plugins]').innerText.includes('Agent access: Not allowed')"),'connect');
 assert.equal(await evaluate("[...document.querySelectorAll('section[aria-label=Plugins] input[type=password]')].every(input=>input.value==='')"),true);
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Allow agent access').click()");
 await until(()=>evaluate("document.querySelector('section[aria-label=Plugins]').innerText.includes('Agent access: Allowed')"),'allow agent');
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Enable').click()");
 await until(()=>evaluate("document.querySelector('section[aria-label=Plugins]').innerText.includes('connected')"),'enable');
 service.stdin.write('event\n');await until(()=>output.includes('POST '),'fixture Slack reply');
 assert.match(output,/Browser fixture reply/);
 await evaluate("[...document.querySelectorAll('section[aria-label=Plugins] button')].find(b=>b.textContent.trim()==='Refresh status').click()");
 await until(()=>evaluate("document.querySelector('section[aria-label=Plugins]').innerText.includes('Recent message outcomes')"),'outcome shown');
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Disable').click()");
 await until(()=>evaluate("document.querySelector('section[aria-label=Plugins]').innerText.includes('Disabled')"),'disabled');
 console.log('PASS controlled Slack plugin settings and DM journey');
}finally{socket?.close();browser?.kill();if(service){service.kill('SIGTERM');await new Promise(resolve=>service.once('exit',resolve));}await rm(temp,{recursive:true,force:true});}
