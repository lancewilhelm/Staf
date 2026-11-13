import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-secret-browser-'));
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const url=`http://127.0.0.1:${port}`,env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};let service,browser,socket,output='',seq=0;const pending=new Map();
const until=async(fn,label)=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out: '+label+' '+output);};
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try {
 service=spawn(process.execPath,['test/fixtures/gmail-browser.mjs',join(temp,'instance.sqlite'),String(port)],{cwd:root,env,stdio:['pipe','pipe','pipe']});service.stdout.on('data',chunk=>output+=chunk);service.stderr.on('data',chunk=>output+=chunk);
 const code=await until(()=>output.match(/Pairing code: (\S+)/)?.[1],'service');
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:'ignore'});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url))}catch{return null}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=event=>{const message=JSON.parse(event.data),item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}};
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');
 await evaluate(`(()=>{const input=document.querySelector('input');input.value=${JSON.stringify(code)};input.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()})()`);
 await until(()=>evaluate("[...document.querySelectorAll('.side button')].some(b=>b.textContent.trim()==='Settings')"),'workspace');
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.trim()==='Settings').click()");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Named secrets\"]')"),'secret settings');
 const click=label=>evaluate(`[...document.querySelectorAll('[aria-label="Named secrets"] button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
 await click('Add secret');
 await evaluate(`(()=>{const form=document.querySelector('[aria-label="Named secrets"] form');['Fixture','Future use','synthetic-browser-old'].forEach((value,i)=>{const input=form.querySelectorAll('input')[i];input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));});form.requestSubmit();})()`);
 await until(()=>evaluate("document.querySelector('[aria-label=\"Named secrets\"]').innerText.includes('Secret saved.')"),'saved');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Named secrets\"]').innerText.includes('synthetic-browser-old')"),false);
 await click('Replace');assert.equal(await evaluate("document.querySelector('[aria-label=\"Named secrets\"] input').type"),'password');
 await click('Cancel');assert.equal(await evaluate("document.querySelector('[aria-label=\"Named secrets\"]').innerText.includes('Fixture')"),true);
 await click('Replace');await evaluate(`(()=>{const input=document.querySelector('[aria-label="Named secrets"] input');input.value='synthetic-browser-new';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('Confirm replacement');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Named secrets\"] form')"),'replacement');
 await click('Delete');assert.equal(await evaluate("document.querySelector('[aria-label=\"Named secrets\"]').innerText.includes('does not revoke')"),true);await click('Confirm delete');
 await until(()=>evaluate("document.querySelector('[aria-label=\"Named secrets\"]').innerText.includes('No named secrets saved')"),'deletion');
 console.log('PASS synthetic owner secret settings');
}finally{socket?.close();browser?.kill();if(service && service.exitCode===null && service.signalCode===null){service.kill('SIGTERM');await new Promise(resolve=>service.once('exit',resolve));}await rm(temp,{recursive:true,force:true});}
