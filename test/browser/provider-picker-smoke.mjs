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

 await evaluate("document.querySelector('.defaults-editor').open=true");
 const api=async(path,body)=>evaluate(`(async()=>{const r=await fetch('/api/'+${JSON.stringify(path)},{method:${JSON.stringify(body?'POST':'GET')},headers:{Authorization:'Bearer '+localStorage.getItem('staf-token'),'Content-Type':'application/json'},${body?'body:JSON.stringify('+JSON.stringify(body)+'),':''}});return r.json()})()`);
 await evaluate("window.confirm=()=>{throw Error('Unexpected native confirmation')}");
 await evaluate("document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select').value='openrouter';document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select').dispatchEvent(new Event('change',{bubbles:true}))");
 await until(()=>evaluate("document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select').value==='openrouter'"),'provider defaults selection settled');
 await until(()=>evaluate("document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices [role=status]')?.textContent.includes('2 models loaded')"),'model discovery reports loaded models');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Available models\"]')?.options.length"),3,'loaded models have a visible picker');
 if(process.env.STAF_SETTINGS_SCREENSHOT){const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(process.env.STAF_SETTINGS_SCREENSHOT,Buffer.from(shot.data,'base64'))}
 assert.equal(await evaluate("(()=>{const form=document.querySelector('.setup'),scroller=form.closest('.settings-scroll');return !!scroller&&Math.abs(scroller.getBoundingClientRect().right-document.querySelector('.main').getBoundingClientRect().right)<2})()"),true,'Settings scrolls at the pane edge');
 assert.equal(await evaluate("(()=>{const section=document.querySelector('[aria-label=\"Provider defaults\"]');return section.querySelector('.provider-default-actions button').getBoundingClientRect().top-section.querySelector('fieldset').getBoundingClientRect().bottom>=12})()"),true,'provider actions have space below their group');
 await evaluate("testInput('[aria-label=\"Provider defaults\"] input','owner/model');testClick('Save provider defaults')");
 await until(async()=>(await api('provider-defaults')).providers.openrouter?.model==='owner/model','owner defaults persist');await until(()=>evaluate("document.body.innerText.includes('Defaults saved.')"),'defaults save settled');
 // An empty successful catalog is distinct from both loaded choices and failure.
 await evaluate("window.realPickerFetch=window.fetch;window.fetch=async(...args)=>args[0]==='/api/models'?new Response(JSON.stringify({models:[]}),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args);(()=>{const p=document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select');p.value='codex';p.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(()=>{p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))},0)})()");
 await until(()=>evaluate("document.body.innerText.includes('No models were returned.') && !document.querySelector('[aria-label=\"Available models\"]')"),'empty catalog explains manual entry');
 await evaluate("window.fetch=window.realPickerFetch");
 for(const appearance of ['light','dark','system']){
  await evaluate(`document.querySelector('input[name=appearance][value=${appearance}]').click()`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("(()=>{const scroller=document.querySelector('.settings-scroll');return document.documentElement.scrollWidth<=innerWidth && scroller.scrollHeight>scroller.clientHeight && Math.abs(scroller.getBoundingClientRect().right-document.querySelector('.main').getBoundingClientRect().right)<2})()"),true,appearance+' narrow Settings scrolls at pane edge without overflow');
  await cdp('Emulation.clearDeviceMetricsOverride');
 }
 // A late catalog for the previous provider must not replace the current choices.
 await evaluate("window.fetch=async(...args)=>{if(args[0]!=='/api/models')return window.realPickerFetch(...args);const p=JSON.parse(args[1].body).provider;const body=p==='codex'?{models:[{id:'old/model',label:'Old',reasoning:null,reasoningStatus:'unknown'}]}:{models:[{id:'new/model',label:'New',reasoning:null,reasoningStatus:'unknown'}]};if(p==='codex')await new Promise(r=>window.releaseOldCatalog=r);return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}})};(()=>{const p=document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select');p.value='codex';p.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(()=>evaluate("typeof window.releaseOldCatalog==='function'"),'older catalog held');
 await evaluate("(()=>{const p=document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select');p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(()=>evaluate("!!document.querySelector('[aria-label=\"Provider defaults\"] option[value=\"new/model\"]')"),'newer catalog shown');
 await evaluate("window.releaseOldCatalog();window.fetch=window.realPickerFetch");
 await sleep(100);
 assert.equal(await evaluate("!!document.querySelector('[aria-label=\"Provider defaults\"] option[value=\"new/model\"]') && !document.querySelector('[aria-label=\"Provider defaults\"] option[value=\"old/model\"]')"),true,'late catalog is ignored');
 // A malformed response must leave the form usable for manual entry and retry.
 await evaluate("window.realPickerFetch=window.fetch;window.fetch=async(...args)=>args[0]==='/api/provider-defaults'?new Response(JSON.stringify({revision:'r',providers:{codex:{model:42}}}),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args);testClick('Compare latest defaults')");
 await until(()=>evaluate("document.body.innerText.includes('Invalid provider defaults response')"),'malformed defaults remain recoverable');
 await evaluate("window.fetch=async(...args)=>args[0]==='/api/models'?new Response(JSON.stringify({models:[null]}),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args);(()=>{const p=document.querySelector('[aria-label=\"Provider defaults\"] .provider-choices select');p.value='codex';p.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(()=>{p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))},0)})()");
 await until(()=>evaluate("document.body.innerText.includes('Invalid model catalog') && document.body.innerText.includes('Enter a model ID manually')"),'malformed catalog offers recovery');
 await evaluate("window.fetch=window.realPickerFetch");
 await evaluate("[...document.querySelectorAll('.side button')].find(b=>b.textContent.includes('New agent')).click()");
 await until(()=>evaluate("document.body.innerText.includes('Create agent')"),'creation choices');
 await evaluate("(()=>{const p=document.querySelector('.setup fieldset select');p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))})()");
 await until(()=>evaluate("document.querySelector('.setup fieldset input').value==='owner/model' && [...document.querySelector('.setup select[aria-label=Reasoning]')?.options??[]].some(o=>o.value==='high')"),'creation defaults and reasoning options');
 await evaluate("window.fetch=async(...args)=>{const response=await window.realPickerFetch(...args);if(args[0]!=='/api/models')return response;const catalog=await response.json();catalog.models.push({id:'fixture/unknown',label:'Unknown reasoning',reasoning:null,reasoningStatus:'unknown'});return new Response(JSON.stringify(catalog),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}})};(()=>{const r=document.querySelector('.setup select[aria-label=Reasoning]');r.value='high';r.dispatchEvent(new Event('change',{bubbles:true}));const p=document.querySelector('.setup fieldset select');p.value='codex';p.dispatchEvent(new Event('change',{bubbles:true}));setTimeout(()=>{p.value='openrouter';p.dispatchEvent(new Event('change',{bubbles:true}))},0)})()");
 await until(()=>evaluate("document.querySelectorAll('.setup datalist option').length===3"),'creation catalog and reasoning');
 await evaluate("(()=>{const r=document.querySelector('.setup select[aria-label=Reasoning]');r.value='high';r.dispatchEvent(new Event('change',{bubbles:true}))})();testInput('.setup fieldset input','fixture/unknown')");assert.equal(await evaluate("document.querySelector('.setup select[aria-label=Reasoning]').value"),'high','unknown metadata preserves reasoning');await evaluate("window.fetch=window.realPickerFetch");
 await evaluate("document.querySelector('.setup fieldset input').focus();testInput('.setup fieldset input','fixture/plain');document.querySelector('.setup fieldset input').blur()");
 try{await until(()=>evaluate("document.querySelector('.setup select[aria-label=Reasoning]').value==='default' && document.body.innerText.includes('Reasoning changed to Automatic')"),'creation visibly resets unsupported reasoning')}catch(e){console.error(await evaluate("({text:document.querySelector('.setup').innerText,values:[...document.querySelectorAll('.setup fieldset select')].map(e=>e.value),model:document.querySelector('.setup fieldset input').value})"));throw e}
 await evaluate("testClick('Cancel')");
 const bot=await api('bots',{name:'Picker agent',provider:'demo'});
 await until(()=>evaluate("document.querySelector('.side nav button')?.textContent.includes('Picker agent')"),'agent appears');
 await evaluate("document.querySelector('.side nav button').click()");
 await until(()=>evaluate("!!document.querySelector('.model-button')"),'chat');
 await evaluate("testInput('[aria-label=Message]','Retained picker draft');document.querySelector('.model-button').click()");
 await until(()=>evaluate("!!document.querySelector('[aria-label=\"Provider picker\"] [data-provider]')"),'picker opens');
 const change=async(value)=>evaluate(`document.querySelector('[aria-label="Provider picker"] [data-provider="'+${JSON.stringify(value)}+'"]').click()`);
 await change('openrouter');
 await until(()=>evaluate("!!document.querySelector('[aria-label=\"Confirm provider change\"]')"),'inline provider confirmation');
 await evaluate("document.querySelector('[data-cancel-provider]').click()");
 assert.equal(await evaluate("document.activeElement?.dataset.provider"),'openrouter','cancel restores provider focus');
 assert.equal((await api('bots/'+bot.id)).provider,'demo');
 await evaluate("window.fetch=async(...args)=>String(args[0]).endsWith('/selection')?new Response(JSON.stringify({id:'bad'}),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args)");await change('openrouter');await evaluate("testClick('Change provider')");
 await until(()=>evaluate("document.body.innerText.includes('Invalid selection response') && document.body.innerText.includes('Compare')"),'malformed selection offers comparison');
 assert.equal((await api('bots/'+bot.id)).provider,'demo');await evaluate("window.fetch=window.realPickerFetch");
 await change('openrouter');await evaluate("testClick('Change provider')");
 await until(async()=>(await api('bots/'+bot.id)).model==='owner/model','provider selection applies defaults immediately');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'selection settled');
 await until(()=>evaluate("document.querySelectorAll('[aria-label=\"Provider picker\"] datalist option').length===2"),'synthetic catalog listed');
 const beforeRepeat=await api('bots/'+bot.id);
 await evaluate("document.querySelector('[data-model=\"owner/model\"]').click()");
 assert.equal((await api('bots/'+bot.id)).revision,beforeRepeat.revision,'reselecting the current model does not write');
 await evaluate("document.querySelector('[data-model=\"fixture/model\"]').focus();document.querySelector('[data-model=\"fixture/model\"]').click()");
 await until(async()=>(await api('bots/'+bot.id)).model==='fixture/model','catalog model selection saves without blur');
 assert.equal(await evaluate("document.querySelector('.composer-picker').hidden"),false,'selection keeps picker open');
 assert.equal(await evaluate("document.querySelector('[data-model=\"fixture/model\"]').getAttribute('aria-checked')"),'true','selected model is marked');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'model settled');
 assert.equal(await evaluate("document.activeElement?.dataset.model"),'fixture/model','selection restores keyboard focus after save');
 await evaluate("if(document.querySelector('.composer-picker').hidden) document.querySelector('.model-button').click();document.querySelector('[data-reasoning=high]').click()");
 await until(async()=>(await api('bots/'+bot.id)).reasoning==='high','reasoning saves immediately');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'reasoning settled');
 await until(()=>evaluate("document.querySelector('.model-button').textContent.includes('high')"),'trigger shows selected reasoning');
 await evaluate("document.querySelector('[aria-label=\"Provider picker\"] input').focus();testInput('[aria-label=\"Provider picker\"] input','fixture/plain')");
 await sleep(150);
 assert.equal(await evaluate("document.querySelector('.composer-picker').hidden"),false,'typing a catalog ID prefix does not close manual entry');
 assert.equal((await api('bots/'+bot.id)).model,'fixture/model','typing keeps the saved model until entry is completed');
 await evaluate("document.querySelector('[aria-label=\"Provider picker\"] input').blur()");
 await until(()=>evaluate("document.body.innerText.includes('Reasoning changed to Automatic')"),'visible unsupported reasoning reset');
 assert.equal((await api('bots/'+bot.id)).reasoning,null);
 await evaluate("if(document.querySelector('.composer-picker').hidden) document.querySelector('.model-button').click()");await change('demo');await evaluate("testClick('Change provider')");await until(async()=>(await api('bots/'+bot.id)).provider==='demo','switch away');
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'switch settled');
 await change('openrouter');await evaluate("testClick('Change provider')");await until(async()=>(await api('bots/'+bot.id)).model==='fixture/plain','remembered pair restored');
 assert.equal(await evaluate("document.querySelector('[aria-label=Message]').value"),'Retained picker draft');
 assert.equal((await api('bots/'+bot.id+'/messages')).length,0);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'narrow viewport has no horizontal overflow');

 await cdp('Emulation.clearDeviceMetricsOverride');
 await evaluate("if(document.querySelector('.composer-picker').hidden) document.querySelector('.model-button').click()");
 await until(()=>evaluate("!document.querySelector('[aria-label=\"Provider picker\"] fieldset').disabled"),'picker ready for conflict');
 await evaluate("window.fetch=async(...args)=>String(args[0]).endsWith('/selection')?new Response(JSON.stringify({error:'fixture conflict'}),{status:409,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args);testInput('[aria-label=\"Provider picker\"] input','retained/conflict');document.querySelector('[aria-label=\"Provider picker\"] input').focus()");
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
 await until(()=>evaluate("document.querySelector('.composer-picker').hidden && document.activeElement===document.querySelector('.model-button')"),'dismiss conflicting edit with focus return');
 await until(()=>evaluate("document.querySelector('.composer-picker').textContent.includes('Save failed or is uncertain')"),'failed save feedback retained while hidden');
 await evaluate("document.querySelector('.model-button').click()");
 await until(()=>evaluate("!document.querySelector('.composer-picker').hidden"),'reopen retained picker');
 assert.equal(await evaluate("document.querySelector('[aria-label=\"Provider picker\"] input').value"),'retained/conflict','failed model edit remains available');
 assert.equal(await evaluate("document.querySelector('.composer-picker').textContent.includes('fixture conflict')"),true);
 await evaluate("window.fetch=window.realPickerFetch");
 const triggerPoint=await evaluate("(()=>{const r=document.querySelector('.model-button').getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()");
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...triggerPoint,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...triggerPoint,button:'left',clickCount:1});
 await until(()=>evaluate("document.querySelector('.composer-picker').hidden"),'pointer click on open trigger closes popup');
 console.log('PASS popup dismissal preserves failed model edit and feedback; trigger closes with pointer');

 const unconfigured=await api('bots',{name:'Unconfigured menu check',provider:'demo'});
 await until(()=>evaluate("[...document.querySelectorAll('.side nav button')].some(b=>b.textContent.includes('Unconfigured menu check'))"),'unconfigured agent appears');
 await evaluate("[...document.querySelectorAll('.side nav button')].find(b=>b.textContent.includes('Unconfigured menu check')).click()");
 await until(()=>evaluate("document.querySelector('.top').textContent.includes('Unconfigured menu check')"),'unconfigured chat selected');
 const beforeOpen=await api('bots/'+unconfigured.id);
 await evaluate("window.fetch=async(...args)=>args[0]==='/api/models'?new Response(JSON.stringify({models:[{id:'suggested/default',label:'Suggested default',reasoning:null,reasoningStatus:'unknown'}],defaultModel:'suggested/default'}),{status:200,headers:{'Content-Type':'application/json','X-Staf-Dataset':args[1].headers['X-Staf-Dataset']}}):window.realPickerFetch(...args)");
 await evaluate("document.querySelector('.model-button').click()");
 await until(()=>evaluate("document.querySelector('.composer-picker .model-discovery-status')?.textContent.includes('loaded')"),'automatic model discovery');
 const afterOpen=await api('bots/'+unconfigured.id);
 assert.equal(afterOpen.revision,beforeOpen.revision,'opening the menu does not change agent configuration');
 assert.equal(afterOpen.model,beforeOpen.model,'discovery does not select a default model');
 await evaluate("window.fetch=window.realPickerFetch");
 console.log('PASS menu discovery is read-only and manual model prefixes remain editable');
 console.log('PASS provider defaults, immediate picker, confirmation, catalog, manual entry, reasoning fallback, remembered pair, draft retention and no inference');
} finally {socket?.close();browserSocket?.close();browser?.kill();server?.kill();proxy?.close();await sleep(200);await rm(temp,{recursive:true,force:true})}
