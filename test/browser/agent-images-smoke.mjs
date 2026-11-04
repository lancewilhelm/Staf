import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
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
async function key(key,windowsVirtualKeyCode){for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode});}
async function choosePhoto(){
  await evaluate("(async()=>{if(!window.photoFile){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;const ctx=canvas.getContext('2d');ctx.fillStyle='#E6C368';ctx.fillRect(0,0,480,320);ctx.fillStyle='#245D50';ctx.fillRect(100,40,140,240);ctx.fillStyle='#EB8D88';ctx.fillRect(300,0,180,160);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));window.photoFile=new File([blob],'portrait.jpg',{type:'image/jpeg'});}const transfer=new DataTransfer();transfer.items.add(window.photoFile);const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(()=>evaluate("document.querySelector('.image-previews img')?.naturalWidth===256"),'JPEG decoded to a 256px PNG preview');
}
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
  await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pair page');
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
  await app.close();
  const database=new DatabaseSync(join(temp,'instance.sqlite'));
  try {database.prepare("INSERT INTO messages VALUES ('image-fixture-message', ?, 'assistant', 'Retained conversation fixture.', 1)").run(one.id);} finally {database.close();}
  app=startInstance(join(temp,'instance.sqlite'),port,options);await app.listen();
  await until(()=>evaluate("document.querySelector('.message .agent-image svg')&&document.body.innerText.includes('Retained conversation fixture.')"),'saved image appears on retained agent messages');
  assert.deepEqual(await evaluate("['.side nav .agent-image','.top .agent-image','.message .agent-image'].map(selector=>document.querySelector(selector).getBoundingClientRect().width)"),[30,30,24],'actual navigation, header and message sizes');
  await act("document.querySelector('[aria-label=\"Collapse sidebar into Focus\"]').click()","document.querySelector('.shell').dataset.sidebar==='focus'",'saved character remains in Focus navigation');
  assert.equal(await evaluate("!!document.querySelector('.side nav .agent-image svg')&&document.querySelector('.side nav button').getAttribute('aria-label')==='Image one'"),true);
  await act("document.querySelector('[aria-label=\"Expand sidebar\"]').click()","document.querySelector('.shell').dataset.sidebar==='expanded'",'restore expanded navigation');
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
  await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')",peer),'second isolated browser context');
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
  for(const [file,error] of [["new File(['text'],'text.txt',{type:'text/plain'})",'Choose a PNG, JPEG, or WebP'],["new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'})",'Choose an image up to 10 MiB'],["new File(['broken'],'broken.png',{type:'image/png'})",null]]) {
    await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(${file});const node=document.querySelector('input[type=file]');node.files=transfer.files;node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(()=>evaluate(error?`document.querySelector('.image-error')?.textContent.includes(${JSON.stringify(error)})`:"!!document.querySelector('.image-error')&&!document.querySelector('.image-chooser').disabled"),'failed source selection reports an error and remains recoverable');
    assert.equal((await api('/api/bots/'+one.id)).image.kind,'avatar','rejected upload preserves saved image');
  }
  await choosePhoto();
  const before=await evaluate("document.querySelector('.image-crop').toDataURL()");
  await evaluate("document.querySelector('.image-crop-controls input').focus()");await key('End',35);await key('ArrowLeft',37);
  await until(()=>evaluate("document.querySelector('.image-crop-controls input').value==='2.99'"),'keyboard zoom changes crop');
  const point=await evaluate("(()=>{const node=document.querySelector('.image-crop');node.scrollIntoView({block:'center'});const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()");
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x+24,y:point.y+18,button:'left',buttons:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x+24,y:point.y+18,button:'left',clickCount:1});
  await until(()=>evaluate("Number(document.querySelector('.image-crop-controls label:nth-child(2) input').value)<0&&Number(document.querySelector('.image-crop-controls label:nth-child(3) input').value)<0"),'pointer drag repositions the crop');
  for(const index of [2,3]) {
    const prior=await evaluate(`document.querySelector('.image-crop-controls label:nth-child(${index}) input').value`);
    await evaluate(`document.querySelector('.image-crop-controls label:nth-child(${index}) input').focus()`);await key('ArrowRight',39);
    await until(()=>evaluate(`Number(document.querySelector('.image-crop-controls label:nth-child(${index}) input').value)>${Number(prior)}`),'keyboard repositions crop axis '+index);
  }
  await until(()=>evaluate(`document.querySelector('.image-crop').toDataURL()!==${JSON.stringify(before)}`),'controls change square crop pixels');
  assert.equal((await api('/api/bots/'+one.id)).image.kind,'avatar','cropping remains a local draft');
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.image-previews figure .agent-image')).map(node=>node.getBoundingClientRect().width)"),[24,28,30]);
  const uploadRequests=requests.filter(request=>request.headers['Content-Type']==='application/vnd.staf.agent-image+json').length;
  await act("click('Cancel')","!!document.querySelector('.composer')",'cancel a decoded and positioned upload');
  assert.equal((await api('/api/bots/'+one.id)).image.kind,'avatar');
  assert.equal(requests.filter(request=>request.headers['Content-Type']==='application/vnd.staf.agent-image+json').length,uploadRequests,'cancelled crop sends no upload bytes');
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'reopen after cancelling upload');
  await act(["click('Change image')", "click('Uploaded image')"],"!!document.querySelector('input[type=file]')",'choose replacement upload');
  await choosePhoto();
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
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'open an image and text draft before a concurrent edit');
  await until(()=>evaluate("!!document.querySelector('.provider-picker input')"),'owner provider picker is ready');
  await evaluate("input('.agent-settings input','My retained draft');input('.agent-settings textarea','My retained instructions');input('.provider-picker input','owner/model')");
  await evaluate("document.querySelector('[aria-label=\"Open agent settings\"]').click()",peer);
  await until(()=>evaluate("!!document.querySelector('.agent-settings input')",peer),'peer opens settings');
  await evaluate("click('Change image')",peer);
  await until(()=>evaluate("!!document.querySelector('.image-modes')",peer),'peer image modes appear');
  await evaluate("click('Built-in avatar')",peer);
  await until(()=>evaluate("!!document.querySelector('[data-image-shape=capsule]')",peer),'peer opens built-in gallery');
  await evaluate("document.querySelector('[data-image-shape=capsule]').click()",peer);
  await evaluate("document.querySelector('[data-image-color=rose]').click()",peer);
  await evaluate("click('Save settings')",peer);
  await until(()=>evaluate("!!document.querySelector('.composer')",peer),'peer commits the new image');
  const peerImage=(await api('/api/bots/'+one.id)).image;
  assert.deepEqual(peerImage,{kind:'avatar',shape:'capsule',color:'rose'});
  await evaluate("document.querySelector('[aria-label=\"Open agent settings\"]').click()",peer);
  await until(()=>evaluate("!!document.querySelector('.provider-picker input')",peer),'peer reopens provider settings after image save');
  await evaluate("input('.provider-picker input','peer/model');document.querySelector('.provider-picker input').focus();document.querySelector('.provider-picker input').blur()",peer);
  await until(async()=>(await api('/api/bots/'+one.id)).model==='peer/model','peer saves a provider choice after the image');
  await until(()=>evaluate("!document.querySelector('.provider-choices').disabled",peer),'peer provider choice settles');
  await evaluate("click('Save settings')",peer);
  await until(()=>evaluate("!!document.querySelector('.composer')",peer),'same-client provider save keeps the form revision current');
  await until(()=>evaluate("document.querySelector('.provider-picker').innerText.includes('Choices changed in another client')"),'picker reports the concurrent edit without replacing model text');
  await act("click('Compare latest choices')","document.querySelector('.provider-picker').innerText.includes('Current saved model: peer/model')",'refresh picker choices while keeping the form draft');
  assert.equal(await evaluate("document.querySelector('.provider-picker input').value"),'owner/model');
  await evaluate("document.querySelector('.provider-picker input').focus();document.querySelector('.provider-picker input').blur()");
  await until(async()=>(await api('/api/bots/'+one.id)).model==='owner/model','owner saves a provider choice from the newer picker revision');
  await until(()=>evaluate("!document.querySelector('.provider-choices').disabled"),'owner provider save settles');
  await act("click('Save settings')","document.body.innerText.includes('Your edits are retained.')&&document.body.innerText.includes('Profile changed')",'stale form conflicts after provider refresh without overwriting the peer image');
  assert.deepEqual((await api('/api/bots/'+one.id)).image,peerImage);
  assert.equal(await evaluate("document.querySelector('.agent-settings input').value"),'My retained draft');
  assert.equal(await evaluate("document.querySelector('.agent-settings textarea').value"),'My retained instructions');
  await act("click('Compare latest settings')","!!document.querySelector('.saved-settings')",'compare the saved image while retaining the local draft');
  assert.equal(await evaluate("document.querySelector('.image-summary img')?.naturalWidth"),256,'losing upload draft remains available');
  await act("click('Use latest image')","document.querySelectorAll('.image-modes button')[1]?.getAttribute('aria-pressed')==='true'||!document.querySelector('.image-modes')",'explicitly adopt the latest saved image');
  await act("click('Change image')","document.querySelector('[data-image-shape=capsule]')?.getAttribute('aria-pressed')==='true'",'chooser follows the reconciled image');
  await act("click('Save settings')","!!document.querySelector('.composer')",'save retained text with the reconciled image');
  const reconciled=await api('/api/bots/'+one.id);
  assert.equal(reconciled.name,'My retained draft');assert.equal(reconciled.instructions,'My retained instructions');assert.deepEqual(reconciled.image,peerImage);assert.equal(reconciled.model,'owner/model');
  await api('/api/bots/'+one.id+'/profile',{...reconciled,image:uploaded});
  await until(()=>evaluate("document.querySelector('.top img')?.naturalWidth===256"),'reuse an accepted upload');
  await rm(join(temp,'agents','.images',uploaded.assetId+'.png'));
  await cdp('Page.reload');
  await until(()=>evaluate("document.querySelector('.top .agent-image')?.textContent.trim()==='M'&&!!document.querySelector('.composer')&&document.body.innerText.includes('Retained conversation fixture.')"),'unavailable image falls back to initials and preserves the conversation');
  assert.equal(await evaluate("document.querySelector('.message .agent-image').textContent.trim()"),'M','message badge also falls back');
  await evaluate(helpers);
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'reopen uploaded image');
  await until(()=>evaluate("document.body.innerText.includes('Image unavailable. Choose another image or use initials.')"),'settings explains the unavailable image');
  await act(["click('Change image')", "click('Initials')", "click('Save settings')"],"!!document.querySelector('.composer')",'return to initials');
  await until(()=>evaluate("!document.querySelector('.top img')&&!document.querySelector('.top .agent-vector')"),'initial badge restored');
  await until(()=>evaluate("!document.querySelector('.top img')&&!document.querySelector('.top .agent-vector')",peer),'initials propagate to the second browser');
  await act("document.querySelector('[aria-label=\"Open agent settings\"]').click()","!!document.querySelector('.agent-settings input')",'review small-size layout');
  await act(["click('Change image')", "click('Built-in avatar')"],"document.querySelectorAll('[data-image-shape]').length===6",'all six choices remain available');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("document.querySelector('.side nav .agent-image').getBoundingClientRect().width"),28,'actual narrow sidebar badge size');
  for(const theme of ['light','dark']){await evaluate(`document.documentElement.dataset.appearance=${JSON.stringify(theme)}`);assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true,'no horizontal overflow in '+theme);}
  await evaluate("document.querySelector('[data-image-color=sky]').focus()");
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await until(()=>evaluate("document.querySelector('[data-image-color=sky]').getAttribute('aria-pressed')==='true'"),'keyboard selects color');
  assert.equal(providerCalls,0,'image editing never invokes a provider');
  console.log('PASS two paired contexts, durable uploads, crop, keyboard, narrow themes and no provider calls');
} finally {socket?.close();browserSocket?.close();browser?.kill();proxy?.close();await app.close();await sleep(200);await rm(temp,{recursive:true,force:true});}
