import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

export async function until(check,label) {
  for(let i=0;i<150;i++){const result=await check();if(result)return result;await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error('Timed out: '+label);
}

export async function openWorkspaceBrowser(url,temp) {
  const cached=join(homedir(),'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  const executable=process.env.CHROME_PATH||(existsSync(cached)?cached:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const proxy=createServer(socket=>socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const browser=spawn(executable,['--headless=new','--no-first-run','--disable-background-networking','--disable-extensions',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${join(temp,'chrome')}`,'--remote-debugging-port=0',url],{env:{PATH:process.env.PATH,HOME:temp,TMPDIR:temp},stdio:'ignore'});
  let socket,browserSocket;const pending=new Map(),errors=[];let sequence=0;
  try {
    const debug=await until(async()=>{try{return (await readFile(join(temp,'chrome','DevToolsActivePort'),'utf8')).split('\n');}catch{return null;}},'Chrome startup');
    const page=await until(async()=>{try{return (await(await fetch(`http://127.0.0.1:${debug[0]}/json/list`)).json()).find(page=>page.type==='page'&&page.url.startsWith(url));}catch{return null;}},'workspace tab');
    const connect=async address=>{const connection=new WebSocket(address);await new Promise((resolve,reject)=>{connection.onopen=resolve;connection.onerror=reject;});connection.onmessage=event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);const receiver=pending.get(message.id);if(receiver){pending.delete(message.id);message.error?receiver.reject(Error(message.error.message)):receiver.resolve(message.result);}};return connection;};
    socket=await connect(page.webSocketDebuggerUrl);browserSocket=await connect(`ws://127.0.0.1:${debug[0]}${debug[1]}`);
    const command=(method,params={},connection=socket)=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});connection.send(JSON.stringify({id,method,params}));});
    const evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
    await command('Page.enable');await command('Runtime.enable');
    return {command,evaluate,errors,browserCommand:(method,params)=>command(method,params,browserSocket),async helpers(){await evaluate(`window.testInput=(selector,value)=>{const el=document.querySelector(selector);if(!el)throw Error('Missing input '+selector);const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))};window.testClick=(text,root='body')=>{const button=[...document.querySelector(root).querySelectorAll('button')].find(button=>button.textContent.trim()===text&&button.getClientRects().length&&!button.disabled);if(!button)throw Error('Missing enabled visible button '+text);button.click()}`);},async close(){socket.close();browserSocket.close();browser.kill();await new Promise(resolve=>{if(browser.exitCode!==null)return resolve();browser.once('exit',resolve);});await new Promise(resolve=>proxy.close(resolve));}};
  } catch(error) {socket?.close();browserSocket?.close();browser.kill();proxy.close();throw error;}
}
