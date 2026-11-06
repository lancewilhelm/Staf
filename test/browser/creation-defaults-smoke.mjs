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
 await until(()=>evaluate("!!document.querySelector('.side button[aria-label=Settings]')"),'workspace');
 await evaluate("window.originalFetch=window.fetch;window.heldDefaults=[];window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(['/api/creation-defaults','/api/provider-defaults'].includes(args[0])&&!args[1]?.body)await new Promise(resolve=>window.heldDefaults.push(resolve));return response}");
 await evaluate("document.querySelector('.side button[aria-label=Settings]').click()");
 await until(()=>evaluate("document.body.innerText.includes('Provider connections')"),'settings');
 const legacy=await evaluate("(async()=>{const token=localStorage.getItem('staf-token');return (await(await fetch('/api/bots',{headers:{Authorization:'Bearer '+token}})).json()).map(bot=>bot.id)})()");
 await evaluate("document.querySelector('.defaults-editor').open=true");
 await until(()=>evaluate("!!document.querySelector('.defaults-editor fieldset select')"),'creation editor');
 await until(()=>evaluate('window.heldDefaults.length>=2'),'delayed default reads');
 await evaluate("(()=>{const f=document.querySelector('.defaults-editor fieldset'),p=document.querySelector('.provider-pair-defaults fieldset');const select=(el,v)=>{el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))};select(f.querySelector('select'),'codex');input(f.querySelector('input'),'typed-creation');select(document.querySelector('.defaults-editor > select'),'direct');input(p.querySelector('input'),'typed-provider');select(p.querySelector('[aria-label=Reasoning]'),'low');})()");
 await until(()=>evaluate("[...document.querySelector('.defaults-editor fieldset [aria-label=Reasoning]').options].some(o=>o.value==='high')"),'creation reasoning choices');
 await evaluate("(()=>{const r=document.querySelector('.defaults-editor fieldset [aria-label=Reasoning]');r.value='high';r.dispatchEvent(new Event('change',{bubbles:true}));window.heldDefaults.splice(0).forEach(resolve=>resolve())})()");
 await until(()=>evaluate("![...document.querySelectorAll('.defaults-editor button')].find(b=>b.textContent.trim()==='Save creation defaults').disabled"),'default reads resolved');
 assert.deepEqual(await evaluate("(()=>{const f=document.querySelector('.defaults-editor fieldset'),p=document.querySelector('.provider-pair-defaults fieldset');return [f.querySelector('input').value,f.querySelector('[aria-label=Reasoning]').value,document.querySelector('.defaults-editor > select').value,p.querySelector('input').value,p.querySelector('[aria-label=Reasoning]').value]})()"),['typed-creation','high','direct','typed-provider','low']);
 await evaluate('window.fetch=window.originalFetch');
 await evaluate("(()=>{const f=document.querySelector('.defaults-editor fieldset'),select=f.querySelector('select');select.value='codex';select.dispatchEvent(new Event('change',{bubbles:true}));input(f.querySelector('input'),'synthetic-model');clickText('Save creation defaults')})()");
 await until(()=>evaluate("document.body.innerText.includes('Creation defaults saved.')"),'defaults saved');
 const result=await evaluate(`(async()=>{const headers={Authorization:'Bearer '+localStorage.getItem('staf-token')};return await Promise.all(${JSON.stringify(legacy)}.map(async id=>await(await fetch('/api/bots/'+id,{headers})).json()))})()`);
 assert.deepEqual(result.map(a=>[a.provider,a.model,a.archived]),[['codex','synthetic-model',false],['codex','synthetic-model',true]]);assert.equal(result[0].instructions,'Keep soul');
 await evaluate("(async()=>{const headers={Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'};const d=await(await fetch('/api/provider-defaults',{headers})).json();await fetch('/api/provider-defaults',{method:'POST',headers,body:JSON.stringify({revision:d.revision,provider:'openrouter',model:'saved/model',reasoning:'low'})})})()");
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent')).click()");
 await until(()=>evaluate("document.querySelector('.setup .provider-choices input')?.value==='synthetic-model'"),'copied default');
 await evaluate("window.fetch=async(...args)=>{const response=await window.originalFetch(...args);if(args[0]==='/api/provider-defaults'&&!args[1]?.body)await new Promise(resolve=>window.heldDefaults.push(resolve));return response};(()=>{const p=document.querySelector('.setup fieldset select');p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(()=>evaluate("window.heldDefaults.length===1 && [...document.querySelector('.setup [aria-label=Reasoning]').options].some(o=>o.value==='high')"),'held first-use provider defaults');
 await evaluate("(()=>{const r=document.querySelector('.setup [aria-label=Reasoning]');r.value='high';r.dispatchEvent(new Event('change',{bubbles:true}));window.heldDefaults.splice(0).forEach(resolve=>resolve())})()");
 await until(()=>evaluate("document.querySelector('.setup .provider-choices input')?.value==='saved/model'"),'first-use defaults returned');
 assert.equal(await evaluate("document.querySelector('.setup [aria-label=Reasoning]').value"),'high');
 await evaluate("window.fetch=window.originalFetch;input(document.querySelector('.setup > input')||document.querySelector('.setup input'),'Explicit editor');input(document.querySelector('.setup .provider-choices input'),'');(()=>{const r=document.querySelector('.setup [aria-label=Reasoning]');r.value='default';r.dispatchEvent(new Event('change',{bubbles:true}));clickText('Create agent')})()");
 await until(()=>evaluate("document.body.innerText.includes('Agent created.')"),'created explicit blank agent');
 const created=await evaluate("(async()=>{const headers={Authorization:'Bearer '+localStorage.getItem('staf-token')};const bots=await(await fetch('/api/bots',{headers})).json();return bots.find(bot=>bot.name==='Explicit editor')})()");
 assert.equal(created.model,null);assert.equal(created.reasoning,null);
 console.log('PASS Settings migrates active and archived Demo agents and copies defaults into creation');
} finally {socket?.close();browser?.kill('SIGTERM');server?.kill('SIGTERM');await rm(temp,{recursive:true,force:true});}
