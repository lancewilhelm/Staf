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
 await act(`testInput('input',${JSON.stringify(code)});testClick('Pair')`,"document.body.innerText.includes('Provider connections') && document.body.innerText.includes('Connect ChatGPT')",'pair browser and open global provider setup');


 await until(()=>evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea')"),'shared core editor loads');
 const api=async(path,body)=>evaluate(`(async()=>{const r=await fetch('/api/'+${JSON.stringify(path)},{method:${JSON.stringify(body?'POST':'GET')},headers:{Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'},${body?'body:JSON.stringify('+JSON.stringify(body)+'),':''}});return r.json()})()`);
 const agent=await api('bots',{name:'Cache fixture',provider:'codex',model:'fixture-model'});
 await until(()=>evaluate("document.querySelector('.side nav')?.textContent.includes('Cache fixture')"),'fixture agent loaded');
 const initial=await api('core');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea').value"),initial.content);
 await act("testClick('Save core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent==='Core saved.'",'save unchanged effective core');
 assert.equal(await evaluate("!!document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),false,'unchanged effective core has no cache warning');
 await act("testInput('[aria-label=\"Shared core guidance\"] textarea','Shared browser edit');testClick('Save core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('Core saved')",'save shared core');
 await until(()=>evaluate("document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),'changed core reports possible cache impact');
 let saved=await api('core');assert.equal(saved.content,'Shared browser edit');assert.equal(await readFile(saved.path,'utf8'),'Shared browser edit');
 const credential=join(temp,'paired.json');await writeFile(credential,JSON.stringify({token:await evaluate("localStorage.getItem('staf-token')")}));
 const cli=async(...args)=>JSON.parse((await run(process.execPath,['dist/cli.js','instance',...args],{cwd:root,env})).stdout);
 assert.equal((await cli('core',url,credential)).content,'Shared browser edit');
 await act("testInput('[aria-label=\"Shared core guidance\"] textarea','');testClick('Save core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('Core saved')",'save empty override');
 await until(async()=>(await api('core')).content==='','empty override persisted');saved=await api('core');assert.equal(saved.source,'override');
 await act("testClick('Reset core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('Core reset')",'reset core');
 saved=await api('core');assert.equal(saved.source,'default');assert.equal(saved.content,saved.defaultContent);
 await evaluate("testInput('[aria-label=\"Shared core guidance\"] textarea','Retained draft');document.querySelector('.side nav button').click()");
 await until(()=>evaluate("document.querySelector('.top').textContent.includes('Cache fixture')"),'navigate to chat');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.trim()==='Settings').click()");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea')?.value==='Retained draft'"),'retain draft across navigation');
 await api('core',{revision:saved.revision,content:'External edit'});
 await act("testClick('Save core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('retained')",'stale save retains draft');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea').value"),'Retained draft');
 await act("testClick('Compare latest core')","document.querySelector('[aria-label=\"Current saved core\"] pre')?.textContent.includes('External edit')",'compare latest core');
 await act("testClick('Save core')","document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('Core saved')",'save reconciled draft');
 assert.equal((await api('core')).content,'Retained draft');
 await evaluate("window.realCoreFetch=window.fetch;window.fetch=async(...args)=>args[0]==='/api/core'&&args[1].method==='POST'?Promise.reject(Error('fixture network failure')):window.realCoreFetch(...args);testInput('[aria-label=\"Shared core guidance\"] textarea','Uncertain draft');testClick('Save core')");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('uncertain')"),'uncertain save requires comparison');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea').value"),'Uncertain draft');
 assert.equal(await evaluate("[...document.querySelectorAll('[aria-label=\"Shared core guidance\"] button')].find(b=>b.textContent.trim()==='Save core').disabled"),true);
 await evaluate("window.fetch=window.realCoreFetch");
 await act("testClick('Compare latest core')","document.querySelector('[aria-label=\"Current saved core\"] pre')?.textContent.includes('Retained draft')",'reconcile uncertain save');
 await evaluate("window.realCoreFetch=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/core'&&args[1].method==='POST'){await window.realCoreFetch(...args);throw Error('lost response')}return window.realCoreFetch(...args)};testClick('Save core')");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('uncertain')"),'lost response retains draft');
 assert.equal((await api('core')).content,'Uncertain draft');
 await evaluate("window.fetch=window.realCoreFetch");
 await act("testClick('Compare latest core')","document.querySelector('[aria-label=\"Current saved core\"] pre')?.textContent.includes('Uncertain draft')",'inspect committed uncertain save');

 // Settings navigation retains the core draft and feedback follows committed request inputs.
 await evaluate("testInput('[aria-label=\"Shared core guidance\"] textarea','Unsaved after reset');testClick('Reset core')");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] [role=status]').textContent.includes('unsaved draft is retained')"),'reset retains an unrelated draft');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Shared core guidance\"] textarea').value"),'Unsaved after reset');
 await evaluate("document.querySelector('.side nav button').click()");
 await until(()=>evaluate("document.querySelector('.header-agent-image')"),'open fixture chat');
 await evaluate("document.querySelector('.header-agent-image').click()");
 await until(()=>evaluate("document.querySelector('.agent-settings textarea')"),'open agent settings');
 await evaluate("document.querySelectorAll('.toast button').forEach(b=>b.click());testInput('.agent-settings input','Renamed fixture');testClick('Save settings')");
 await until(()=>evaluate("!document.querySelector('.agent-settings')"),'save cosmetic change');
 assert.equal(await evaluate("!!document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),false,'name alone has no cache warning');
 await evaluate("document.querySelector('.header-agent-image').click()");
 await until(()=>evaluate("document.querySelector('.agent-settings textarea')"),'reopen agent settings');
 await evaluate("testInput('.agent-settings textarea','New soul for fixture');testClick('Save settings')");
 await until(()=>evaluate("document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),'instruction change reports cache impact');
 // A single staged editor save commits provider and instructions together and reports
 // cache impact only after the provider confirmation is accepted.
 await until(()=>evaluate("!!document.querySelector('.header-agent-image')"),'instruction save returned to chat');
 await evaluate("document.querySelectorAll('.toast button').forEach(b=>b.click());document.querySelector('.header-agent-image').click()");
 await until(()=>evaluate("!!document.querySelector('.agent-settings .provider-choices select')"),'open staged provider editor');
 const beforeStaged=await api('bots/'+agent.id);
 await evaluate("testInput('.agent-settings input','Combined fixture');testInput('.agent-settings textarea','Combined staged soul');(()=>{const p=document.querySelector('.agent-settings .provider-choices select');p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(()=>evaluate("document.querySelector('.agent-settings .provider-choices select').value==='openrouter'"),'stage provider');
 assert.equal((await api('bots/'+agent.id)).revision,beforeStaged.revision,'staged fields do not commit before Save');
 await act("testClick('Save settings')","document.querySelector('dialog')?.innerText.includes('Change provider?')",'confirm staged provider change');
 await evaluate("[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Cancel').click()");
 assert.equal((await api('bots/'+agent.id)).revision,beforeStaged.revision,'canceling confirmation does not commit');
 assert.equal(await evaluate("document.querySelector('.agent-settings textarea').value"),'Combined staged soul','canceling confirmation retains staged instructions');
 assert.equal(await evaluate("!!document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),false,'uncommitted edits do not report cache impact');
 await act("testClick('Save settings')","document.querySelector('dialog')?.innerText.includes('Change provider?')",'reopen staged provider confirmation');
 await evaluate("[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Change provider').click()");
 await until(()=>evaluate("!!document.querySelector('.header-agent-image') && !!document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),'committed staged provider change reports cache impact');
 const afterStaged=await api('bots/'+agent.id);
 assert.equal(afterStaged.name,'Combined fixture');assert.equal(afterStaged.instructions,'Combined staged soul');assert.equal(afterStaged.provider,'openrouter');
 await evaluate("document.querySelectorAll('.toast button').forEach(b=>b.click());document.querySelector('.model-button').click()");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Provider picker\"] input')"),'open model picker');
 await evaluate("const m=document.querySelector('[aria-label=\"Provider picker\"] input');m.focus();testInput('[aria-label=\"Provider picker\"] input','changed-model');m.blur()");
 await until(async()=>(await api('bots/'+agent.id)).model==='changed-model','model change committed');
 await until(()=>evaluate("document.querySelector('.toasts')?.textContent.includes('may reduce provider prompt cache reuse')"),'model change reports cache impact');
 console.log('PASS core editor and paired CLI share the authoritative file');
} finally {socket?.close();browserSocket?.close();browser?.kill();server?.kill();proxy?.close();await sleep(200);await rm(temp,{recursive:true,force:true})}
