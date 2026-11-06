import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-defaults-browser-'));
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};let server,browser,socket,output='',seq=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){for(let i=0;i<160;i++){const value=await fn();if(value)return value;await sleep(100)}throw Error('Timed out: '+label)}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(Error('CDP timeout')),10000);pending.set(id,{resolve:x=>{clearTimeout(timer);resolve(x)},reject});socket.send(JSON.stringify({id,method,params}))})}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
try {
 server=spawn(process.execPath,['test/browser/held-instance.mjs',join(temp,'instance.sqlite'),String(port),'--legacy-fixture'],{cwd:root,env,stdio:['pipe','pipe','pipe']});server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'pairing code');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url))}catch{return null}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pair page');
 await evaluate(`window.input=(el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};window.clickText=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text).click();input(document.querySelector('input'),${JSON.stringify(code)});clickText('Pair')`);
 await until(()=>evaluate("document.body.innerText.includes('Provider connections')"),'settings');
 const legacy=await evaluate("(async()=>{const token=localStorage.getItem('staf-token');return (await(await fetch('/api/bots',{headers:{Authorization:'Bearer '+token}})).json()).map(bot=>bot.id)})()");
 await evaluate("document.querySelector('.defaults-editor').open=true");
 await until(()=>evaluate("!!document.querySelector('.defaults-editor fieldset select')"),'creation editor');
 await evaluate("(()=>{const f=document.querySelector('.defaults-editor fieldset'),select=f.querySelector('select');select.value='codex';select.dispatchEvent(new Event('change',{bubbles:true}));input(f.querySelector('input'),'synthetic-model');clickText('Save creation defaults')})()");
 await until(()=>evaluate("document.body.innerText.includes('Creation defaults saved.')"),'defaults saved');
 const result=await evaluate(`(async()=>{const headers={Authorization:'Bearer '+localStorage.getItem('staf-token')};return await Promise.all(${JSON.stringify(legacy)}.map(async id=>await(await fetch('/api/bots/'+id,{headers})).json()))})()`);
 assert.deepEqual(result.map(a=>[a.provider,a.model,a.archived]),[['codex','synthetic-model',false],['codex','synthetic-model',true]]);assert.equal(result[0].instructions,'Keep soul');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent')).click()");
 await until(()=>evaluate("document.querySelector('.setup .provider-choices input')?.value==='synthetic-model'"),'copied default');
 console.log('PASS Settings migrates active and archived Demo agents and copies defaults into creation');
} finally {socket?.close();browser?.kill('SIGTERM');server?.kill('SIGTERM');await rm(temp,{recursive:true,force:true});}
