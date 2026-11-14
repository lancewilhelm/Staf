import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {startControlledInstance as startInstance} from './fixtures/controlled-instance.mjs';
import {byteStreamRedactor} from '../dist/config.js';

const tool=(name,args)=>({role:'assistant',content:null,tool_calls:[{id:'privacy',type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const until=async read=>{for(let i=0;i<500;i++){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Fixture timed out');};
async function paired(app){const port=await app.listen();let token;const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();};token=(await call('/api/pair',{code:app.code})).token;return call;}

test('byte redaction preserves binary data across every split, escaped credentials and token tails',()=>{
 const secret='fixture-"é',escaped=JSON.stringify(secret).slice(1,-1),binary=Buffer.from([0,255,195,169]);
 const input=Buffer.concat([binary,Buffer.from(secret+'|'+escaped+'|sk-or-v1-abcdef\nend')]);
 const expected=Buffer.concat([binary,Buffer.from('[REDACTED]|[REDACTED]|[REDACTED]\nend')]);
 for(let split=0;split<=input.length;split++){const filter=byteStreamRedactor({OPENROUTER_API_KEY:secret});assert.deepEqual(Buffer.concat([filter.write(input.subarray(0,split)),filter.write(input.subarray(split)),filter.finish()]),expected);}
 const filter=byteStreamRedactor({},()=>[secret]);assert.deepEqual(Buffer.concat([...input].map(byte=>filter.write(Buffer.from([byte]))).concat(filter.finish())),expected);
});

test('terminal input changed by credential redaction never starts or enters the invocation journal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-native-private-')),path=join(dir,'db'),marker=join(dir,'marker');
 const parts=['synthetic','native','credential'],secret=parts.join('-');let mode;
 const app=startInstance(path,0,{env:{OPENROUTER_API_KEY:secret},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return mode==='direct'?tool('terminal_run',{retain:true,command:`printf %s ${secret} > '${marker}'`}):tool('code_mode',{source:`const value=${JSON.stringify(parts)}.join('-'); return await capabilities.terminal_run({retain:true,command:'printf %s '+value+${JSON.stringify(" > '"+marker+"'")}});`});}})});
 let closed=false;
 try {const call=await paired(app);for(mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode}),id='input-'+mode;await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});const command=await until(async()=>{const c=await call('/api/commands/'+id);return c.state!=='pending'&&c;});assert.equal(command.state,'completed',command.error);assert.equal(command.workActions.length,0);assert.equal(existsSync(marker),false);assert.deepEqual(await call('/api/processes'),[]);}
  await app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS count FROM work_action_invocations WHERE instr(input,?)>0').get(secret).count,0);}finally{db.close();}
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('terminal output is withheld before execution when credentials are known',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-native-output-private-')),path=join(dir,'db');
 const secret='synthetic-native-unicode-é';let mode;
 const app=startInstance(path,0,{env:{OPENROUTER_API_KEY:secret},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:mode==='direct'?tool('terminal_run',{retain:true,command:'printf fixture'}):tool('code_mode',{source:'return await capabilities.terminal_run({retain:true,command:"printf fixture"});'});}})});
 let closed=false;try{const call=await paired(app);for(mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode}),id='output-'+mode;await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});const c=await until(async()=>{const value=await call('/api/commands/'+id);return value.state!=='pending'&&value;});assert.equal(c.state,'completed');assert.equal(c.workActions[0].state,'cancelled');assert.deepEqual(await call('/api/processes'),[]);}
 await app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM native_process_output').get().n,0);}finally{db.close();}
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('byte redaction preserves binary output while filtering split Unicode credentials',async()=>{
 const {byteStreamRedactor}=await import('../dist/config.js');const secret='synthetic-native-unicode-é',bytes=Buffer.from(secret),filter=byteStreamRedactor({OPENROUTER_API_KEY:secret});
 const actual=Buffer.concat([filter.write(Buffer.concat([Buffer.from([0,255]),bytes.subarray(0,bytes.length-1)])),filter.write(Buffer.concat([bytes.subarray(bytes.length-1),Buffer.from('\n')])),filter.finish()]);
 assert.deepEqual(actual,Buffer.concat([Buffer.from([0,255]),Buffer.from('[REDACTED]\n')]));
});
