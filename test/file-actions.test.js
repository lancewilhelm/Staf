import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startInstance} from '../dist/instance-service.js';

const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('paired direct and QuickJS file writes reach the same host filesystem',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-files-'));let port,token;
 const app=startInstance(join(dir,'instance.sqlite'),0,{env:{},providerFactory:async()=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const [mode,path]=JSON.parse(messages.findLast(m=>m.role==='user').content);return mode==='direct'?tool('file_write',{path,content:'actual bytes'}):tool('code_mode',{source:`return await capabilities.file_write(${JSON.stringify({path,content:'actual bytes'})});`});}})});
 const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 try {port=await app.listen();token=(await call('/api/pair',{code:app.code})).token;for(const mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{name:mode,toolMode:mode});const path=join(dir,mode+'.txt');await call('/api/commands',{id:mode,botId:bot.id,content:JSON.stringify([mode,path])});let record;for(let i=0;i<1000;i++){record=await call('/api/commands/'+mode);if(record.state!=='pending')break;await new Promise(r=>setTimeout(r,10));}assert.equal(record.state,'completed',record.error);assert.equal(readFileSync(path,'utf8'),'actual bytes');assert.equal(record.workActions[0].state,'succeeded');}}
 finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
