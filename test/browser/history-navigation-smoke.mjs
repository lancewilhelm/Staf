import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Instance} from '../../dist/instance.js';
import {startInstance} from '../../dist/instance-service.js';
import {openWorkspaceBrowser,until} from './workspace-harness.mjs';

const temp=await mkdtemp(join(tmpdir(),'staf-history-navigation-')),path=join(temp,'db');
const seed=new Instance(path),bot=seed.createBot({name:'Long history',instructions:''});
for(let i=0;i<130;i++){seed.claim({id:'page-'+i,botId:bot.id,content:'Original message '+i});seed.complete('page-'+i,'Answer '+i);}
const target='command-user-page-115',fresh=seed.createSession({botId:bot.id,operationId:'fresh-navigation',expectedSessionId:bot.chatId});seed.close();
const app=startInstance(path,0,{env:{}}),port=await app.listen(),url=`http://127.0.0.1:${port}`;let browser,token;
const api=async(route,body)=>{const response=await fetch(url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,await response.clone().text());return response.json();};
try {
  token=(await api('pair',{code:app.code})).token;
  const page=await api('bots/'+bot.id+'/sessions/'+bot.chatId+'?messageId='+target);assert.equal(page.offset,200);assert.ok(page.messages.some(message=>message.id===target));
  const code=app.issueCode();browser=await openWorkspaceBrowser(url,temp);const {evaluate}=browser;
  await until(()=>evaluate("document.body?.innerText.includes('Pair this browser')"),'pairing');await browser.helpers();await evaluate(`testInput('input',${JSON.stringify(code)});testClick('Pair')`);
  await until(()=>evaluate("document.querySelector('textarea[aria-label=Message]')?.disabled===false"),'ready');
  await evaluate("testClick('History')");await until(()=>evaluate("document.querySelector('.session-history')?.open"),'history open');
  await evaluate("testInput('.session-history input[required]','Original message 115');testClick('Search','.session-history')");await until(()=>evaluate("document.querySelector('.session-history li')?.innerText.includes('Original message 115')"),'target search result');
  await evaluate("testClick('Open user message','.session-history')");
  const targetFocused=()=>evaluate(`document.activeElement?.dataset.messageId===${JSON.stringify(target)}&&document.querySelector('.matched-message')?.innerText.includes('Original message 115')`);
  await until(targetFocused,'search opens exact message past first 100');
  assert.ok(await evaluate("[...document.querySelectorAll('.session-history button')].some(button=>button.textContent==='Previous messages')"));
  await evaluate("testClick('Previous messages','.session-history')");await until(()=>evaluate("!document.querySelector('.matched-message')"),'earlier history page');
  await api('commands',{id:'cited-navigation',botId:bot.id,sessionId:fresh.id,content:'Inspect this source',references:[{kind:'session-message',sessionId:bot.chatId,messageId:target}]});
  await until(async()=>(await api('commands/cited-navigation')).state==='completed','cited command');
  await until(()=>evaluate("!!document.querySelector('.message-sources summary')"),'source control');await evaluate("document.querySelector('.message-sources summary').click();testClick('Initial session · Original user message','.message-sources')");
  await until(()=>evaluate("document.querySelector('dialog[open]')?.innerText.includes('Original message 115')"),'source excerpt');await evaluate("testClick('Open original')");await until(targetFocused,'source opens exact original past first 100');
  assert.equal((await api('bots/'+bot.id+'/sessions')).current.id,fresh.id);assert.equal(browser.errors.length,0,JSON.stringify(browser.errors));
  console.log('PASS history navigation: search and cited sources open and focus the exact original beyond the first page; browsing preserves the fresh session');
} finally {await browser?.close();await app.close();await rm(temp,{recursive:true,force:true});}
