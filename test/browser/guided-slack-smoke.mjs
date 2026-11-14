import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {startInstance} from '../../dist/instance-service.js';

const dir=await mkdtemp(join(tmpdir(),'staf-guided-slack-browser-'));
const seen=[],appToken='xapp-synthetic-browser',botToken='xoxb-synthetic-browser';
const app=startInstance(join(dir,'db'),0,{dataDir:dir,env:{},
 slackTransport:{verifyDestination:async(_tokens,config)=>({channelId:config.channelId}),identify:async()=>({teamId:'T123',botUserId:'B123'}),start:async(_tokens,_receive,status)=>{status?.('connected');return ()=>{};},post:async()=>{}},
 providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){seen.push(JSON.stringify(messages));if(messages.at(-1)?.role==='tool')return {role:'assistant',content:'Setup action finished.'};return {role:'assistant',content:null,tool_calls:[{id:'setup',type:'function',function:{name:'setup_slack',arguments:JSON.stringify({teamId:'T123',userId:'U123',channelId:'D123'})}}]};}})});
const port=await app.listen(),url=`http://127.0.0.1:${port}`;
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
let browser,socket,seq=0;const pending=new Map();
async function until(fn,label){for(let i=0;i<160;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>reject(Error('CDP timeout')),10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
try{
 const paired=await fetch(url+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:app.code})}),token=(await paired.json()).token;
 const api=async(path,body)=>{const response=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,`${path}: ${JSON.stringify(value)}`);return value;};
 const bot=await api('/api/bots',{name:'Guided Slack',provider:'live',model:'fixture',toolMode:'direct'});
 await api('/api/commands',{id:'guided-slack',botId:bot.id,content:'Help me set up Slack'});
 await until(async()=>(await api('/api/inbox')).some(item=>item.kind==='secret'),'first secret request');
 const env={PATH:process.env.PATH,HOME:dir,TMPDIR:dir};browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(dir,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:'ignore'});
 const debug=await until(async()=>{try{return (await readFile(join(dir,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome'),page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url));}catch{return null;}},'page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=e=>{const message=JSON.parse(e.data),item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}};
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');const code=app.issueCode();await evaluate(`(()=>{const el=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(code)});el.dispatchEvent(new Event('input',{bubbles:true}));[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Pair').click()})()`);
 for(const [name,value] of [['app',appToken],['bot',botToken]]){
  await until(()=>evaluate(`document.querySelector('article[aria-label="Secret request"] input[type=password]') && document.querySelector('article[aria-label="Secret request"]').innerText.toLowerCase().includes(${JSON.stringify(name+' token')})`),name+' protected request');
  assert.equal(await evaluate("document.querySelector('article[aria-label=\"Secret request\"] input').type"),'password');
  await evaluate(`(()=>{const a=document.querySelector('article[aria-label="Secret request"]'),el=a.querySelector('input[type=password]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await until(()=>evaluate("[...document.querySelector('article[aria-label=\"Secret request\"]').querySelectorAll('button')].find(b=>b.textContent.trim()==='Save secret' && !b.disabled)"),name+' save enabled');
  await evaluate("[...document.querySelector('article[aria-label=\"Secret request\"]').querySelectorAll('button')].find(b=>b.textContent.trim()==='Save secret').click()");
 }
 await until(()=>evaluate("document.querySelector('article[aria-label=\"Slack setup approval\"]')"),'Slack review');
 const review=await evaluate("document.querySelector('article[aria-label=\"Slack setup approval\"]').innerText");
 for(const value of ['T123','U123','D123','Guided Slack','slack.com/api'])assert.ok(review.includes(value),value);
 assert.ok(!review.includes(appToken)&&!review.includes(botToken));
 assert.equal((await api('/api/plugins')).find(item=>item.id==='slack').connected,false);
 await evaluate("[...document.querySelector('article[aria-label=\"Slack setup approval\"]').querySelectorAll('button')].find(b=>b.textContent.trim()==='Approve and connect').click()");
 await until(async()=>(await api('/api/commands/guided-slack')).state==='completed','completed setup');
 const slack=(await api('/api/plugins')).find(item=>item.id==='slack');assert.equal(slack.connected,true);assert.equal(slack.enabled,true);
 const records=JSON.stringify([await api('/api/commands/guided-slack'),await api(`/api/bots/${bot.id}/chat-work`)]);
 for(const value of [appToken,botToken]){assert.ok(!JSON.stringify(seen).includes(value));assert.ok(!records.includes(value));assert.ok(!(await readFile(join(dir,'db'))).includes(Buffer.from(value)));}
 console.log('PASS protected Slack setup and reviewed connection in the browser');
}finally{socket?.close();browser?.kill('SIGTERM');await app.close();await rm(dir,{recursive:true,force:true});}
