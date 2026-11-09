import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {startInstance} from '../../dist/instance-service.js';
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const temp=await mkdtemp(join(tmpdir(),'staf-sensitive-ui-'));let proposalText='synthetic detail one';
const instance=startInstance(join(temp,'db'),0,{env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return {role:'assistant',content:null,tool_calls:[{id:'one',type:'function',function:{name:'memory_remember',arguments:JSON.stringify({scope:{kind:'agent'},text:proposalText,classification:'ordinary'})}}]};}})});
const port=await instance.listen(),url=`http://127.0.0.1:${port}`;let browser,socket,proxy;const pending=new Map();let sequence=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<160;i++){const result=await fn();if(result)return result;await sleep(100);}throw Error('Timed out: '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('CDP timeout')),10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function act(action,condition,label){await evaluate(action);await until(()=>evaluate(condition),label);console.log('PASS '+label);}
try{
 proxy=createServer(c=>c.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp},stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null;}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url));}catch{return null;}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.id&&pending.has(data.id)){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(Error(data.error.message)):p.resolve(data.result);}};
 await cdp('Page.enable');await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');
 await evaluate(`window.clickText=text=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);if(!button)throw Error('Missing '+text);button.click()};window.inputText=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))}`);
 await act(`inputText(document.querySelector('input'),${JSON.stringify(instance.code)});clickText('Pair')`,"document.body.innerText.includes('Provider connections')",'pair');
 const token=await evaluate("localStorage.getItem('staf-token')");
 const api=async(path,body)=>{const r=await fetch(url+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,await r.clone().text());return r.json();};
 const bot=await api('bots',{name:'Sensitive fixture',provider:'live',model:'fixture-offline',toolMode:'direct'});
 await act("document.querySelector('.side button[aria-label=Settings]').click()","document.body.innerText.includes('Memory sensitivity')",'open sensitivity settings');
 await evaluate("const select=document.querySelector('option[value=review-all]').parentElement;select.value='review-all';select.dispatchEvent(new Event('change',{bubbles:true}));const area=[...document.querySelectorAll('label')].find(x=>x.innerText.includes('Sensitive terms')).querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,'synthetic detail');area.dispatchEvent(new Event('input',{bubbles:true}));clickText('Save sensitivity rules')");
 await until(()=>evaluate("document.body.innerText.includes('Memory sensitivity rules saved.')"),'save review-all');const rules=await api('memory-sensitivity');assert.equal(rules.mode,'review-all');assert.deepEqual(rules.terms,['synthetic detail']);
 const propose=async id=>{await api('commands',{id,botId:bot.id,content:'Run synthetic fixture.'});await until(async()=>{const c=await api('commands/'+id);return c.state==='completed';},'proposal completion');};
 await propose('proposal-one');
 await until(()=>evaluate("[...document.querySelectorAll('.side nav button')].some(b=>b.textContent.includes('Sensitive fixture'))"),'agent listed');
 await evaluate("[...document.querySelectorAll('.side nav button')].find(b=>b.textContent.includes('Sensitive fixture')).click()");
 await until(()=>evaluate("document.querySelector('.top').innerText.includes('Sensitive fixture')"),'agent selected');
 await act("document.querySelector('.header-agent-name').click()","!!document.querySelector('.agent-memory-link')",'open agent settings');
 await act("clickText('View agent memory')","document.querySelector('[aria-label=\"Memory proposals\"]')?.innerText.includes('synthetic detail one')",'inspect proposal');
 await act("clickText('Deny memory')","document.body.innerText.includes('Memory proposal denied.')",'deny proposal');assert.deepEqual(await api('memories/bot/'+bot.id),[]);
 proposalText='synthetic detail two';await propose('proposal-two');
 await act("clickText('Refresh proposals')","document.querySelector('[aria-label=\"Memory proposals\"]')?.innerText.includes('synthetic detail two')",'refresh proposal');
 await act("clickText('Confirm memory')","document.body.innerText.includes('Memory proposal confirmed.')",'confirm proposal');assert.equal((await api('memories/bot/'+bot.id))[0].text,'synthetic detail two');
 await evaluate("window.originalFetch=window.fetch;window.fetch=(...args)=>String(args[0]).startsWith('/api/memory-proposals/')?Promise.resolve(new Response(JSON.stringify({error:'revoked'}),{status:401})):window.originalFetch(...args);clickText('Refresh proposals')");
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser') && !document.querySelector('[aria-label=\"Memory proposals\"]')"),'proposal access revocation');assert.equal(await evaluate("localStorage.getItem('staf-token')"),null);
 console.log('PASS controlled provider, owner policy and proposal decisions');
}finally{socket?.close();browser?.kill('SIGTERM');proxy?.close();await instance.close();await rm(temp,{recursive:true,force:true});}
