import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {startInstance} from '../../dist/instance-service.js';

const dir=await mkdtemp(join(tmpdir(),'staf-gmail-history-ui-'));
const seen=[];
const app=startInstance(join(dir,'db'),0,{dataDir:dir,env:{},gmailPollIntervalMs:3600000,gmailRequest:async url=>new URL(url).hostname==='oauth2.googleapis.com'?Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'https://www.googleapis.com/auth/gmail.readonly',token_type:'Bearer'}):Response.json({emailAddress:'owner@example.test',historyId:'100'}),providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));if(!messages.some(m=>m.role==='tool'))return {role:'assistant',content:null,tool_calls:[{id:'q',type:'function',function:{name:'guide_gmail_setup',arguments:'{}'}}]};return {role:'assistant',content:'Task finished.'};}})});
const port=await app.listen(),url=`http://127.0.0.1:${port}`,cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell'),chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
let browser,socket,seq=0;const pending=new Map();async function until(fn,label){for(let i=0;i<160;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('CDP timeout')),10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try{
 const paired=await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})}),token=(await paired.json()).token;
 const api=async(path,body)=>{const response=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,`${path}: ${response.status}`);return response.json();};
 const bot=await api('/api/bots',{name:'Guided Gmail',provider:'live',model:'fixture',toolMode:'direct'});await api('/api/tasks',{id:'gmail-setup',botId:bot.id,objective:'Set up Gmail'});const q=await until(async()=>(await api('/api/question-sets')).find(item=>item.workId==='gmail-setup'),'question');
 const env={PATH:process.env.PATH,HOME:dir,TMPDIR:dir};browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(dir,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:'ignore'});
 const debug=await until(async()=>{try{return (await readFile(join(dir,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome'),page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url));}catch{return null;}},'page');socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=e=>{const message=JSON.parse(e.data),item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}};
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');const code=app.issueCode();await evaluate(`(()=>{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(code)});el.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()})()`);
 await until(()=>evaluate("document.querySelector('.question-set textarea')"),'Gmail question');
 const answer=async value=>evaluate(`(()=>{const el=document.querySelector('.question-set textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
 const button=async label=>evaluate(`(()=>{const b=[...document.querySelectorAll('.question-set button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b || b.disabled)throw Error('Button unavailable: '+${JSON.stringify(label)});b.click()})()`);
 await answer('owner@example.test');await button('Next');
 await until(()=>evaluate("document.querySelector('.question-set legend')?.textContent.includes('client ID')"),'client ID');await answer('synthetic-client');await button('Next');
 await until(()=>evaluate("document.querySelector('.question-set input[type=password]')"),'protected secret');
 await evaluate("(()=>{const el=document.querySelector('.question-set input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'synthetic-client-secret');el.dispatchEvent(new Event('input',{bubbles:true}))})()");
 await until(()=>evaluate("[...document.querySelectorAll('.question-set button')].some(b=>b.textContent.trim()==='Save secret' && !b.disabled)"),'secret save enabled');await button('Save secret');
 await until(()=>evaluate("document.querySelector('.question-set').innerText.includes('Saved secret:')"),'saved secret');assert.equal(await evaluate("!!document.querySelector('.question-set input[type=password]')"),false);
 await button('Review Gmail connection');await until(()=>evaluate("document.querySelector('.question-set').innerText.includes('Connect owner@example.test using client ID synthetic-client')"),'review');
 const review=await evaluate("document.querySelector('.question-set [aria-label=\"Gmail setup\"]').innerText");assert.match(review,/OAuth token endpoint and Gmail API/);assert.doesNotMatch(review,/synthetic-client-secret/);
 assert.equal((await api('/api/plugins')).find(item=>item.id==='gmail').connected,false);await button('Confirm and continue to Google');
 await until(()=>evaluate("document.querySelector('.question-set a')?.textContent.includes('Open Google authorization')"),'authorization pending');
 const auth=new URL(await evaluate("document.querySelector('.question-set a').href")),callback=new URL(auth.searchParams.get('redirect_uri'));callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('code','synthetic-code');assert.equal((await fetch(callback)).status,200);
 await button('Refresh Gmail status');await until(()=>evaluate("document.querySelector('.question-set').innerText.includes('credentials available')"),'verified status');
 await button('Submit answers');await until(async()=>(await api('/api/tasks/gmail-setup')).state==='completed','task completed');
 assert.equal((await api('/api/plugins')).find(item=>item.id==='gmail').connected,true);
 const records=JSON.stringify([await api('/api/tasks/gmail-setup'),await api('/api/question-sets'),await api(`/api/bots/${bot.id}/chat-work`)]);
 for(const value of ['synthetic-client-secret','synthetic-refresh','synthetic-access']){assert.ok(!JSON.stringify(seen).includes(value));assert.ok(!records.includes(value));assert.ok(!(await readFile(join(dir,'db'))).includes(Buffer.from(value)));}
 console.log('PASS protected Gmail setup, exact review and synthetic OAuth in the browser');
}finally{socket?.close();browser?.kill('SIGTERM');await app.close();await rm(dir,{recursive:true,force:true});}
