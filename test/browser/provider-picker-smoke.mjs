import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const temp=await mkdtemp(join(tmpdir(),'staf-gui-test-'));
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const url=`http://127.0.0.1:${port}`, env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let server,secondServer,browser,socket,browserSocket,proxy,output='';const pending=new Map();let seq=0;
async function until(fn,label){for(let i=0;i<160;i++){let x=await fn();if(x)return x;await sleep(100)}throw Error('Timed out: '+label)}
function cdp(method,params={},sessionId,connection=socket){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out '+method))},10000);pending.set(id,{resolve:x=>{clearTimeout(timer);resolve(x)},reject:x=>{clearTimeout(timer);reject(x)}});connection.send(JSON.stringify({id,method,params,sessionId}))})}
async function evaluate(expression){const x=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(x.exceptionDetails)throw Error(JSON.stringify(x.exceptionDetails));return x.result.value}
async function act(expression,condition,label){await evaluate(expression);await until(()=>evaluate(condition),label);console.log('PASS '+label)}
try{
 proxy=createServer(c=>c.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 server=spawn(process.execPath,['test/browser/held-instance.mjs',join(temp,'instance.sqlite'),String(port)],{cwd:root,env,stdio:['pipe','pipe','pipe']});server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'pairing code');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url))}catch{return null}},'page');
 const receive=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});socket.onmessage=receive;await cdp('Page.enable');
 const browserPath=(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[1];browserSocket=new WebSocket(`ws://127.0.0.1:${debug}${browserPath}`);await new Promise((resolve,reject)=>{browserSocket.onopen=resolve;browserSocket.onerror=reject});browserSocket.onmessage=receive;
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'pair page');
 await evaluate(`window.testInput=(selector,value)=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}; window.testClick=text=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b)throw Error('Missing button '+text);b.click()}`);
 await act(`testInput('input',${JSON.stringify(code)});testClick('Pair')`,"document.body.innerText.includes('Providers') && document.body.innerText.includes('Connect Codex')",'pair browser and open global provider setup');

 const api=async(path,body)=>evaluate(`(async()=>{const r=await fetch('/api/'+${JSON.stringify(path)},{method:${JSON.stringify(body?'POST':'GET')},headers:{Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'},${body?'body:JSON.stringify('+JSON.stringify(body)+'),':''}});return r.json()})()`);
 await evaluate("window.confirm=()=>true");
 await evaluate("document.querySelector('[aria-label=\"Provider defaults\"] select').value='openrouter';document.querySelector('[aria-label=\"Provider defaults\"] select').dispatchEvent(new Event('change',{bubbles:true}))");
 await evaluate("testInput('[aria-label=\"Provider defaults\"] input','owner/model');testClick('Save provider defaults')");
 await until(async()=>(await api('provider-defaults')).providers.openrouter?.model==='owner/model','owner defaults persist');
 const bot=await api('bots',{name:'Picker agent',provider:'demo'});
 await until(()=>evaluate("document.querySelector('.side nav button')?.textContent.includes('Picker agent')"),'agent appears');
 await evaluate("document.querySelector('.side nav button').click()");
 await until(()=>evaluate("!!document.querySelector('.model-button')"),'chat');
 await evaluate("testInput('[aria-label=Message]','Retained picker draft');document.querySelector('.model-button').click()");
 await until(()=>evaluate("!!document.querySelector('[aria-label=\"Provider picker\"] select')"),'picker opens');
 const change=async(value)=>evaluate(`(()=>{const e=document.querySelector('[aria-label="Provider picker"] select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 await evaluate('window.confirm=()=>false');await change('openrouter');
 assert.equal((await api('bots/'+bot.id)).provider,'demo');
 await evaluate('window.confirm=()=>true');await change('openrouter');
 await until(async()=>(await api('bots/'+bot.id)).model==='owner/model','provider selection applies defaults immediately');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'selection settled');
 await evaluate("testClick('List models')");
 await until(()=>evaluate("document.querySelectorAll('[aria-label=\"Provider picker\"] datalist option').length===2"),'synthetic catalog listed');
 await evaluate("testInput('[aria-label=\"Provider picker\"] input','fixture/model')");
 await until(async()=>(await api('bots/'+bot.id)).model==='fixture/model','catalog model selection saves without blur');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'model settled');
 await evaluate("(()=>{const e=document.querySelectorAll('[aria-label=\"Provider picker\"] select')[1];e.value='high';e.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(async()=>(await api('bots/'+bot.id)).reasoning==='high','reasoning saves immediately');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'reasoning settled');
 await evaluate("testInput('[aria-label=\"Provider picker\"] input','fixture/plain');document.querySelector('[aria-label=\"Provider picker\"] input').focus();document.querySelector('[aria-label=\"Provider picker\"] input').blur()");
 await until(()=>evaluate("document.body.innerText.includes('Reasoning changed to Provider default')"),'visible unsupported reasoning reset');
 assert.equal((await api('bots/'+bot.id)).reasoning,null);
 await change('demo');await until(async()=>(await api('bots/'+bot.id)).provider==='demo','switch away');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'switch settled');
 await change('openrouter');await until(async()=>(await api('bots/'+bot.id)).model==='fixture/plain','remembered pair restored');
 assert.equal(await evaluate("document.querySelector('[aria-label=Message]').value"),'Retained picker draft');
 assert.equal((await api('bots/'+bot.id+'/messages')).length,0);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'narrow viewport has no horizontal overflow');
 console.log('PASS provider defaults, immediate picker, confirmation, catalog, manual entry, reasoning fallback, remembered pair, draft retention and no inference');
} finally {socket?.close();browserSocket?.close();browser?.kill();server?.kill();proxy?.close();await sleep(200);await rm(temp,{recursive:true,force:true})}
