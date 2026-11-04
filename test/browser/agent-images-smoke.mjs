import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {startInstance} from '../../dist/instance-service.js';

// Same disposable instance and Chrome/CDP pattern as the memory and workspace journeys.
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(join(tmpdir(),'staf-agent-images-'));
const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const chrome=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
let providerCalls=0;
const options={env:{},providerFactory:async()=>{providerCalls++;throw Error('Image tests must not call a provider');}};
let app=startInstance(join(temp,'instance.sqlite'),0,options),port=await app.listen();
const url=`http://127.0.0.1:${port}`;
let browser,socket,browserSocket,proxy,seq=0;const pending=new Map(),requests=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<160;i++){const result=await fn();if(result)return result;await sleep(100);}throw Error('Timed out: '+label);}
function cdp(method,params={},sessionId,connection=socket){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});connection.send(JSON.stringify({id,method,params,sessionId}));});}
async function evaluate(expression,sessionId){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId,sessionId?browserSocket:socket);if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function act(actions,condition,label){for(const expression of Array.isArray(actions)?actions:[actions])await evaluate(expression);await until(()=>evaluate(condition),label);console.log('PASS '+label);}
const helpers="window.input=(selector,value)=>{const node=document.querySelector(selector);Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))};window.click=text=>{const node=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text);if(!node)throw Error('Missing '+text);node.click()};";
try {
  proxy=createServer(client=>client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  browser=spawn(chrome,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp},stdio:['ignore','ignore','pipe']});
  const debug=await until(async()=>{try{return(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'Chrome');
  const page=await until(async()=>{try{return(await(await fetch(`http://127.0.0.1:${debug}/json/list`)).json()).find(item=>item.type==='page'&&item.url.startsWith(url));}catch{return null;}},'page');
  const receive=event=>{const message=JSON.parse(event.data);if(message.method==='Network.requestWillBeSent'&&message.params.request.url.startsWith(url+'/api/'))requests.push(message.params.request);if(message.id&&pending.has(message.id)){const callback=pending.get(message.id);pending.delete(message.id);message.error?callback.reject(Error(message.error.message)):callback.resolve(message.result);}};
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});socket.onmessage=receive;
  const browserPath=(await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n')[1];browserSocket=new WebSocket(`ws://127.0.0.1:${debug}${browserPath}`);await new Promise((resolve,reject)=>{browserSocket.onopen=resolve;browserSocket.onerror=reject;});browserSocket.onmessage=receive;
  await cdp('Page.enable');await cdp('Network.enable');
  await until(()=>evaluate("document.body.innerText.includes('Pair this browser')"),'pair page');
  await evaluate(helpers);
  await act([`input('input',${JSON.stringify(app.code)})`,"click('Pair')"],"document.body.innerText.includes('Provider connections')",'pair synthetic instance');
  const token=await evaluate("localStorage.getItem('staf-token')");
  const api=async(path,body)=>{const response=await fetch(url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,await response.clone().text());return response.json();};
  await act("document.querySelector('.new-agent').click()","!!document.querySelector('dialog[open]')",'open New agent');
  assert.equal(await evaluate("document.activeElement===document.querySelector('dialog input')"),true,'Name focus retained');
  await act(["input('dialog input','Cancelled image')", "click('Change image')", "click('Built-in avatar')"],"document.querySelectorAll('[data-image-shape]').length===6",'both shape groups are in one chooser');
  await act("document.querySelector('[data-image-shape=pentagon]').click()","document.querySelector('[data-image-shape=pentagon]').getAttribute('aria-pressed')==='true'",'choose a polygon');
  await act("click('Cancel')","!document.querySelector('dialog')",'cancel creation');assert.equal((await api('/api/bots')).length,0);
  await act("document.querySelector('.new-agent').click()","!!document.querySelector('dialog[open]')",'reopen clean creation');
  await act(["input('dialog input','Image one')", "click('Change image')"],"document.querySelector('.image-modes button').getAttribute('aria-pressed')==='true'",'new agents start with initials');
  await act(["click('Built-in avatar')", "document.querySelector('[data-image-shape=pentagon]').click()"],"document.querySelector('[data-image-shape=pentagon]').getAttribute('aria-pressed')==='true'",'preview pentagon');
  await act("document.querySelector('[data-image-color=lilac]').click()","document.querySelector('[data-image-color=lilac]').getAttribute('aria-pressed')==='true'",'choose color separately');
  await act("click('Create agent')","!document.querySelector('dialog')&&document.querySelector('.title')?.textContent==='Image one'",'create with the selected image');
  const one=(await api('/api/bots'))[0];assert.deepEqual(one.image,{kind:'avatar',shape:'pentagon',color:'lilac'});
  const two=await api('/api/bots',{name:'Image two',provider:'demo',image:{kind:'avatar',shape:'circle',color:'sky'}});
  await until(()=>evaluate("document.querySelectorAll('.side nav button').length===2"),'second agent appears');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.side nav .agent-image')).map(node=>!!node.querySelector('svg'))"),[true,true]);
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'open agent Settings');
  await act(["click('Change image')", "document.querySelector('[data-image-shape=triangle]').click()"],"document.querySelector('[data-image-shape=triangle]').getAttribute('aria-pressed')==='true'",'preview another shape');
  assert.deepEqual((await api('/api/bots/'+one.id)).image,one.image,'preview has not saved');
  await act("click('Cancel')","!!document.querySelector('.composer')",'cancel keeps the saved image');
  assert.deepEqual((await api('/api/bots/'+one.id)).image,one.image);

  const context=await cdp('Target.createBrowserContext',{},undefined,browserSocket);
  const target=await cdp('Target.createTarget',{url,browserContextId:context.browserContextId},undefined,browserSocket);
  const peer=(await cdp('Target.attachToTarget',{targetId:target.targetId,flatten:true},undefined,browserSocket)).sessionId;
  await until(()=>evaluate("document.body.innerText.includes('Pair this browser')",peer),'second isolated browser context');
  await evaluate(helpers,peer);
  await evaluate(`input('input',${JSON.stringify(app.issueCode())});click('Pair')`,peer);
  await until(()=>evaluate("document.querySelector('.title')?.textContent==='Image one'",peer),'independently paired second browser');
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'edit shared image');
  await act(["click('Change image')", "document.querySelector('[data-image-shape=rounded-square]').click()"],"document.querySelector('[data-image-shape=rounded-square]').getAttribute('aria-pressed')==='true'",'choose rounded shape alongside polygons');
  assert.equal(await evaluate("document.querySelector('[data-image-color=lilac]').getAttribute('aria-pressed')"),'true','shape preserves color');
  await act("document.querySelector('[data-image-color=coral]').click()","document.querySelector('[data-image-color=coral]').getAttribute('aria-pressed')==='true'",'change color without changing shape');
  await act("click('Save settings')","!!document.querySelector('.composer')",'save the image');
  await until(()=>evaluate("document.querySelector('.top .agent-vector g').getAttribute('fill')==='#EB8D88'",peer),'second browser sees the committed color');
  assert.deepEqual((await api('/api/bots/'+two.id)).image,two.image,'other agent is unchanged');

  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'open upload chooser');
  await act(["click('Change image')", "click('Uploaded image')"],"!!document.querySelector('input[type=file]')",'choose upload mode');
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent==='Save settings').disabled"),true,'upload requires a chosen crop');
  await evaluate("(async()=>{const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#E6C368';ctx.fillRect(0,0,480,320);ctx.fillStyle='#245D50';ctx.fillRect(100,40,140,240);ctx.fillStyle='#EB8D88';ctx.fillRect(300,0,180,160);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'portrait.jpg',{type:'image/jpeg'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(()=>evaluate("document.querySelector('.image-previews img')?.naturalWidth===256"),'JPEG decoded to a 256px PNG preview');
  const before=await evaluate("document.querySelector('.image-crop').toDataURL()");
  await act("input('.image-crop-controls input[type=range]','2')","document.querySelector('.image-crop-controls input').value==='2'",'zoom crop');
  await evaluate("input('.image-crop-controls label:nth-child(2) input','.6')");
  await until(()=>evaluate(`document.querySelector('.image-crop').toDataURL()!==${JSON.stringify(before)}`),'position changes square crop');
  assert.equal((await api('/api/bots/'+one.id)).image.kind,'avatar','cropping remains a local draft');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.image-previews figure .agent-image')).map(node=>node.getBoundingClientRect().width)"),[24,28,30]);
  await act("click('Save settings')","!!document.querySelector('.composer')",'save uploaded crop');
  await until(()=>evaluate("document.querySelector('.top img')?.naturalWidth===256"),'protected image loads under the served CSP');
  await until(()=>evaluate("document.querySelector('.top img')?.naturalWidth===256",peer),'second paired context sees the upload');
  const uploaded=(await api('/api/bots/'+one.id)).image;assert.equal(uploaded.kind,'upload');
  const src=await evaluate("document.querySelector('.top img').src");await sleep(1200);assert.equal(await evaluate("document.querySelector('.top img').src"),src,'ordinary polling does not recreate image URLs');
  assert.ok(requests.some(request=>request.method==='POST'&&request.headers['Content-Type']==='application/vnd.staf.agent-image+json'));
  assert.ok(requests.filter(request=>request.url.includes('/api/agent-images/')).every(request=>request.headers.Authorization&&!request.url.includes(token)));
  await app.close();app=startInstance(join(temp,'instance.sqlite'),port,options);await app.listen();
  await cdp('Page.reload');await until(()=>evaluate("document.querySelector('.top img')?.naturalWidth===256"),'upload survives instance restart and browser reload');
  await evaluate(helpers);
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'reopen uploaded image');
  await act(["click('Change image')", "click('Initials')", "click('Save settings')"],"!!document.querySelector('.composer')",'return to initials');
  await until(()=>evaluate("!document.querySelector('.top img')&&!document.querySelector('.top .agent-vector')"),'initial badge restored');
  await until(()=>evaluate("!document.querySelector('.top img')&&!document.querySelector('.top .agent-vector')",peer),'initials propagate to the second browser');
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'review small-size layout');
  await act(["click('Change image')", "click('Built-in avatar')"],"document.querySelectorAll('[data-image-shape]').length===6",'all six choices remain available');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const theme of ['light','dark']){await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(theme)}`);assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,'no horizontal overflow in '+theme);}
  await evaluate("document.querySelector('[data-image-color=sky]').focus()");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(()=>evaluate("document.querySelector('[data-image-color=sky]').getAttribute('aria-pressed')==='true'"),'keyboard selects color');
  assert.equal(providerCalls,0,'image editing never invokes a provider');
  console.log('PASS two paired contexts, durable uploads, crop, keyboard, narrow themes and no provider calls');
} finally {socket?.close();browserSocket?.close();browser?.kill();proxy?.close();await app.close();await sleep(200);await rm(temp,{recursive:true,force:true});}
