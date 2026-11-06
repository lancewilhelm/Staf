import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import { startInstance } from '../../dist/instance-service.js';
const root=resolve(import.meta.dirname,'../..');
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const temp=await mkdtemp(join(tmpdir(),'staf-gui-test-'));
let providerCalls=0;
const instance=startInstance(join(temp,'instance.sqlite'),0,{env:{},providerFactory:async()=>{providerCalls++;throw Error('Memory UI must not call a provider');}});
const port=await instance.listen();
const url=`http://127.0.0.1:${port}`, env={PATH:process.env.PATH,HOME:temp,TMPDIR:temp};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser,socket,browserSocket,proxy;const pending=new Map();const memoryRequests=[];let seq=0;
async function until(fn,label){for(let i=0;i<160;i++){let x=await fn();if(x)return x;await sleep(100)}throw Error('Timed out: '+label)}
function cdp(method,params={},sessionId,connection=socket){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out '+method))},10000);pending.set(id,{resolve:x=>{clearTimeout(timer);resolve(x)},reject:x=>{clearTimeout(timer);reject(x)}});connection.send(JSON.stringify({id,method,params,sessionId}))})}
async function evaluate(expression){const x=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(x.exceptionDetails)throw Error(JSON.stringify(x.exceptionDetails));return x.result.value}
async function act(expression,condition,label){await evaluate(expression);await until(()=>evaluate(condition),label);console.log('PASS '+label)}
try{
 proxy=createServer(c=>c.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 const code=instance.code;
 browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env,stdio:['ignore','ignore','pipe']});
 const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'Chrome');
 const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(x=>x.type==='page'&&x.url.startsWith(url))}catch{return null}},'page');
 const receive=e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent' && m.params.request.url.startsWith(url+'/api/memories/'))memoryRequests.push(m.params.request);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});socket.onmessage=receive;await cdp('Page.enable');await cdp('Network.enable');
 const browserPath=(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[1];browserSocket=new WebSocket(`ws://127.0.0.1:${debug}${browserPath}`);await new Promise((resolve,reject)=>{browserSocket.onopen=resolve;browserSocket.onerror=reject});browserSocket.onmessage=receive;
 await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pair page');
 await evaluate(`window.testInput=(selector,value)=>{const el=document.querySelector(selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}; window.testClick=text=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b)throw Error('Missing button '+text);b.click()}`);
 await act(`testInput('input',${JSON.stringify(code)});testClick('Pair')`,"document.body.innerText.includes('Provider connections') && document.body.innerText.includes('Connect ChatGPT')",'pair browser and open global provider setup');

 const token=await evaluate("localStorage.getItem('staf-token')");
 const api=async(path,body)=>{const r=await fetch(url+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,await r.clone().text());return r.json()};
 const one=await api('bots',{name:'Ada',provider:'demo'}),two=await api('bots',{name:'Grace',provider:'demo'}),archived=await api('bots',{name:'Retired',provider:'demo'});
 const privatePath='memories/bot/'+one.id,secondPath='memories/bot/'+two.id;
 const privateEntry=await api(privatePath,{text:'Ada private preference\n<img src=x onerror=alert(1)>'+ 'x'.repeat(1000)});
 const foreign=await api(secondPath,{text:'Grace private preference'});
 await api('memories/bot/'+archived.id,{text:'Retained archived preference'});
 const archivedProfile=await api('bots/'+archived.id);await api('bots/'+archived.id+'/archive',{revision:archivedProfile.revision});
 const sharedEntries=[];
 for(let i=1;i<=45;i++)sharedEntries.push(await api('memories/user',{text:'Shared preference '+i}));
 await until(()=>evaluate("document.querySelectorAll('.side nav button').length===2"),'agents appear');
 await evaluate("window.realMemoryFetch=window.fetch;document.querySelector('.defaults-editor').open=true;testInput('[aria-label=\"Provider defaults\"] input','retained/model')");
 await act("window.fetch=(...args)=>args[0]==='/api/provider-defaults' && args[1]?.method==='POST'?Promise.resolve(new Response(JSON.stringify({error:'synthetic defaults failure'}),{status:503})):window.realMemoryFetch(...args);testClick('Save provider defaults')","document.querySelector('[aria-label=\"Provider defaults\"]').innerText.includes('Could not save defaults')",'retain failed creation-default draft');
 await evaluate("window.fetch=window.realMemoryFetch");
 await act("testClick('View user memory')","document.querySelectorAll('.memory-entry').length===20",'shared memory first page');
 assert.match(await evaluate("document.querySelector('.memory-view').innerText"),/Available to all your agents/);
 assert.doesNotMatch(await evaluate("document.querySelector('.memory-view').innerText"),/Ada private|Grace private|Retained archived/);
 assert.equal(await evaluate("document.activeElement===document.querySelector('.memory-view h1')"),true,'heading receives focus');
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
 assert.equal(await evaluate("document.activeElement.textContent"),'Back to settings','keyboard reaches Back');
 await act("testClick('Next page')","document.querySelector('.memory-page-status').innerText.includes('21–40')",'shared memory second page');
 assert.equal(await evaluate("document.activeElement===document.querySelector('.memory-page-status')"),true,'pagination announces and focuses status');
 await sleep(1300);
 assert.match(await evaluate("document.querySelector('.memory-page-status').innerText"),/21–40/,'ordinary workspace polling preserves memory page');
 assert.equal(memoryRequests.length,1,'polling does not refetch the complete list');
 await act("testClick('Next page')","document.querySelectorAll('.memory-entry').length===5",'shared memory last page');
 const allIds=new Set();
 for(let p=2;p>=0;p--){
  const ids=await evaluate("[...document.querySelectorAll('.memory-entry code')].map(el=>el.textContent)");ids.forEach(id=>allIds.add(id));
  if(p)await act("testClick('Previous page')",`document.querySelector('.memory-page-status').innerText.includes('Page ${p} of')`,'previous memory page');
 }
 assert.deepEqual([...allIds].sort(),sharedEntries.map(entry=>entry.id).sort(),'pagination exposes every saved entry');
 await act("testClick('Back to settings')","document.activeElement?.classList.contains('user-memory-link')",'return focus to user settings link');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Provider defaults\"] input').value"),'retained/model','shared-memory visit retains creation-default draft');
 assert.match(await evaluate("document.querySelector('[aria-label=\"Provider defaults\"]').innerText"),/Could not save defaults/,'shared-memory visit retains inline failure');
 await evaluate("[...document.querySelectorAll('.side nav button')].find(b=>b.textContent.includes('Ada')).click()");
 await until(()=>evaluate("document.querySelector('.top').innerText.includes('Ada')"),'Ada selected');
 await act("document.querySelector('.header-agent-name').click()","!!document.querySelector('.agent-memory-link')",'open agent settings');
 await evaluate("testInput('.agent-settings input','Unsaved Ada name')");
 await act("testClick('View agent memory')","document.querySelectorAll('.memory-entry').length===1",'agent memory');
 assert.match(await evaluate("document.querySelector('.memory-view').innerText"),/Ada’s memory[\s\S]*Available only to Ada/);
 assert.doesNotMatch(await evaluate("document.querySelector('.memory-view').innerText"),/Grace private|Shared preference/);
 assert.equal(await evaluate("document.querySelector('.memory-text img')"),null,'memory is escaped plain text');
 await evaluate("document.querySelector('.memory-entry summary').focus()");
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
 await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
 assert.equal(await evaluate("document.querySelector('.memory-entry details').open"),true,'details work with keyboard');
 assert.match(await evaluate("document.querySelector('.memory-entry details').innerText"),new RegExp(privateEntry.id));
 assert.match(await evaluate("document.querySelector('.memory-entry details').innerText"),/Version\s+1[\s\S]*Origin\s+Not recorded/);
 const shots=join(root,'test-results','memory');await mkdir(shots,{recursive:true});
 for(const mode of ['light','dark','system']){
  await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(mode)}`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth && document.querySelector('.memory-view').scrollWidth<=document.querySelector('.main').clientWidth"),true,mode+' narrow memory has no overflow');
  const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,mode+'-narrow.png'),Buffer.from(shot.data,'base64'));
 }
 await cdp('Emulation.clearDeviceMetricsOverride');
 await evaluate("document.documentElement.dataset.appearance='light'");
 const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(shots,'agent-desktop.png'),Buffer.from(shot.data,'base64'));
 await act("testClick('View shared user memory')","document.querySelectorAll('.memory-entry').length===20",'agent link to shared memory');
 await act("testClick('Back to agent memory')","document.querySelector('.memory-view h1')?.textContent==='Ada’s memory'",'shared memory returns to originating agent');
 await act("testClick('Back to agent settings')","document.activeElement?.classList.contains('agent-memory-link')",'return focus to agent settings');
 assert.equal(await evaluate("document.querySelector('.agent-settings input').value"),'Unsaved Ada name','memory inspection retains agent draft');
 console.log('PASS scope isolation, complete pagination, escaped text, details, draft retention, focus and narrow themes');

 // Archived navigation follows the same lock as every other agent setting action.
 await evaluate(`window.saveHeld=false;window.saveGate=new Promise(resolve=>window.releaseSave=resolve);window.fetch=async(...args)=>{if(args[0]==='/api/bots/${one.id}/profile'){window.saveHeld=true;await window.saveGate;return new Response(JSON.stringify({error:'held save failure'}),{status:503})}return window.realMemoryFetch(...args)};testClick('Save settings')`);
 await until(()=>evaluate("window.saveHeld"),'pending settings save');
 assert.equal(await evaluate("document.querySelector('.archived-agents button[aria-label^=\"View memory\"]').disabled"),true,'archived memory disabled during save');
 await evaluate("document.querySelector('.archived-agents button[aria-label^=\"View memory\"]').click()");
 assert.equal(await evaluate("!!document.querySelector('.memory-view')"),false,'disabled action cannot navigate');
 await act("window.releaseSave();window.fetch=window.realMemoryFetch","document.querySelector('.agent-settings>p[role=status]').innerText.includes('The save failed')",'settle held settings save');
 // Capture a successful response, then deliver it after navigation despite abort.
 await evaluate(`window.heldMemoryPath='/api/${privatePath}';window.heldStarted=false;window.heldAborted=false;window.heldGate=new Promise(resolve=>window.releaseHeld=resolve);window.fetch=async(...args)=>{if(args[0]===window.heldMemoryPath){args[1].signal.addEventListener('abort',()=>window.heldAborted=true,{once:true});const response=await window.realMemoryFetch(...args);window.heldStarted=true;await window.heldGate;return response}return window.realMemoryFetch(...args)};testClick('View agent memory')`);
 await until(()=>evaluate("window.heldStarted && document.body.innerText.includes('Loading memory…')"),'held request loading');
 await evaluate("[...document.querySelectorAll('.side nav button')].find(b=>b.textContent.includes('Grace')).click()");
 await until(()=>evaluate("document.querySelector('.top').innerText.includes('Grace') && !!document.querySelector('.header-agent-name')"),'switch agent during memory load');
 await act("document.querySelector('.header-agent-name').click()","document.querySelector('.agent-settings h1')?.textContent==='Grace'",'Grace settings');
 await act("testClick('View agent memory')","document.querySelector('.memory-text')?.textContent==='Grace private preference'",'Grace memory before old response');
 assert.equal(await evaluate("window.heldAborted"),true,'leaving aborts old request');
 await evaluate("window.releaseHeld();window.fetch=window.realMemoryFetch");await sleep(200);
 assert.equal(await evaluate("document.querySelector('.memory-text').textContent"),'Grace private preference','late response cannot cross agents');
 for(let i=0;i<3;i++){
  await act("testClick('Back to agent settings')","!!document.querySelector('.agent-memory-link')",'repeated memory exit');
  await act("testClick('View agent memory')","document.querySelector('.memory-text')?.textContent==='Grace private preference'",'repeated memory entry');
 }
 // Loading failure is not empty, and refreshing removes the prior snapshot.
 await evaluate(`window.fetch=(...args)=>args[0]==='/api/${secondPath}'?Promise.resolve(new Response(JSON.stringify({error:'offline fixture'}),{status:503})):window.realMemoryFetch(...args);testClick('Refresh memory')`);
 await until(()=>evaluate("document.querySelector('.memory-view [role=alert]')?.innerText.includes('Could not load memory')"),'memory error');
 assert.equal(await evaluate("document.querySelectorAll('.memory-entry').length"),0,'failed refresh clears old entries');
 assert.doesNotMatch(await evaluate("document.querySelector('.memory-view').innerText"),/No memories saved/);
 await act("window.fetch=window.realMemoryFetch;testClick('Retry loading memory')","document.querySelectorAll('.memory-entry').length===1",'retry memory');
 await evaluate(`window.fetch=(...args)=>args[0]==='/api/${secondPath}'?Promise.resolve(new Response(JSON.stringify([${JSON.stringify(privateEntry)}]),{status:200})):window.realMemoryFetch(...args);testClick('Refresh memory')`);
 await until(()=>evaluate("!!document.querySelector('.memory-view [role=alert]')"),'wrong audience rejected');
 assert.doesNotMatch(await evaluate("document.querySelector('.memory-view').innerText"),/Ada private/);
 await act("window.fetch=window.realMemoryFetch;testClick('Retry loading memory')","document.querySelectorAll('.memory-entry').length===1",'recover from wrong audience');
 await api(`${secondPath}/${foreign.id}/delete`,{version:foreign.version});
 await act("testClick('Refresh memory')","document.querySelector('.memory-view [role=status]')?.innerText.includes('No memories saved for this agent')",'agent empty state');
 await evaluate("document.querySelector('.archived-agents').open=true");
 await act("testClick('View memory')","document.querySelector('.memory-text')?.textContent==='Retained archived preference'",'archived memory inspection');
 assert.match(await evaluate("document.querySelector('.memory-view').innerText"),/Retired’s memory[\s\S]*archived/);
 assert.match(await evaluate("document.querySelector('.top').innerText"),/Retired/,'header names inspected archived agent');
 assert.equal((await api('bots/'+archived.id)).archived,true,'inspection does not restore archived agent');
 await evaluate("document.querySelector('.side button[aria-label=Settings]').click()");
 // A missing agent is a load error, with no fallback to another scope.
 await evaluate(`window.fetch=(...args)=>args[0]==='/api/memories/bot/${archived.id}'?Promise.resolve(new Response(JSON.stringify({error:'Agent not found'}),{status:404})):window.realMemoryFetch(...args);testClick('View memory')`);
 await until(()=>evaluate("!!document.querySelector('.memory-view [role=alert]')"),'missing agent is an error');
 await evaluate("window.fetch=window.realMemoryFetch;document.querySelector('.side button[aria-label=Settings]').click()");
 // Test a shared empty state using real deletion, not a synthetic empty array.
 for(const entry of sharedEntries)await api('memories/user/'+entry.id+'/delete',{version:entry.version});
 await act("testClick('View user memory')","document.querySelector('.memory-view [role=status]')?.innerText.includes('No shared user memories saved yet')",'shared empty state');
 console.log('PASS interrupted/repeated navigation, loading, failure/retry, wrong-scope rejection, missing/archived agents and both empty states');

 // A 401 from the memory endpoint itself must expire pairing immediately.
 await evaluate("window.fetch=(...args)=>args[0]==='/api/memories/user'?Promise.resolve(new Response(JSON.stringify({error:'Unauthorized'}),{status:401})):window.realMemoryFetch(...args);testClick('Refresh memory')");
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser') && !document.querySelector('.memory-view') && !document.querySelector('.agent-settings')"),'memory 401 clears settings and requires pairing');
 assert.equal(await evaluate("localStorage.getItem('staf-token')"),null);
 await act("document.querySelector('.header-agent-name').click()","document.body.innerText.includes('Pair this browser') && !document.querySelector('.agent-settings')",'settings navigation cannot hide re-pair form');
 await act("document.querySelector('.side button[aria-label=Settings]').click()","document.body.innerText.includes('Pair this browser') && !document.querySelector('.settings-content')",'global settings cannot bypass pairing');
 await evaluate("document.querySelector('.top button[aria-label=\"Back to chat\"]').click()");
 // Re-pair then revoke a real client with a successful memory response held.
 const newCode=instance.issueCode();
 await act(`window.fetch=window.realMemoryFetch;testInput('input',${JSON.stringify(newCode)});testClick('Pair')`,"!!document.querySelector('.composer')",'re-pair');
 await evaluate("document.querySelector('.side button[aria-label=Settings]').click()");
 await evaluate("window.heldStarted=false;window.heldGate=new Promise(resolve=>window.releaseHeld=resolve);window.fetch=async(...args)=>{if(args[0]==='/api/memories/user'){const response=await window.realMemoryFetch(...args);window.heldStarted=true;await window.heldGate;return response}return window.realMemoryFetch(...args)};testClick('View user memory')");
 await until(()=>evaluate("window.heldStarted"),'hold response before real revocation');
 const currentToken=await evaluate("localStorage.getItem('staf-token')");
 const clients=await (await fetch(url+'/api/clients',{headers:{Authorization:'Bearer '+currentToken}})).json();
 const revoked=await fetch(url+'/api/clients/'+clients.find(client=>client.current).id+'/revoke',{method:'POST',headers:{Authorization:'Bearer '+currentToken,'Content-Type':'application/json'},body:'{}'});assert.equal(revoked.status,200);
 await until(()=>evaluate("document.body.innerText.includes('Pair this browser') && !document.querySelector('.memory-view')"),'real revocation hides memory');
 await evaluate("window.releaseHeld();window.fetch=window.realMemoryFetch");await sleep(250);
 assert.equal(await evaluate("!!document.querySelector('.memory-view') || !!document.querySelector('.agent-settings')"),false,'late success after revocation stays discarded');
 assert.equal(providerCalls,0,'no provider inference');
 assert.ok(memoryRequests.length>10,'observed memory network traffic');
 assert.equal(memoryRequests.some(request=>request.method!=='GET'),false,'memory navigation only performs GET requests');
 console.log('PASS memory-specific 401, real client revocation, discarded late success and zero provider calls');
 console.log('Screenshots: '+shots);
} finally {socket?.close();browserSocket?.close();browser?.kill();proxy?.close();await instance.close();await sleep(200);await rm(temp,{recursive:true,force:true})}
