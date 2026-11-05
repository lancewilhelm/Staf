import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {startInstance} from '../dist/instance-service.js';
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
 const app=startInstance(path,0,{env:{OPENROUTER_API_KEY:secret},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return mode==='direct'?tool('terminal_run',{command:`printf %s ${secret} > '${marker}'`}):tool('code_mode',{source:`const value=${JSON.stringify(parts)}.join('-'); return await capabilities.terminal_run({command:'printf %s '+value+${JSON.stringify(" > '"+marker+"'")}});`});}})});
 let closed=false;
 try {const call=await paired(app);for(mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{name:mode,toolMode:mode}),id='input-'+mode;await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});const command=await until(async()=>{const c=await call('/api/commands/'+id);return c.state!=='pending'&&c;});assert.equal(command.state,'completed',command.error);assert.equal(command.workActions.length,0);assert.equal(existsSync(marker),false);assert.deepEqual(await call('/api/processes'),[]);}
  await app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS count FROM work_action_invocations WHERE instr(input,?)>0').get(secret).count,0);}finally{db.close();}
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('terminal output redacts credentials across byte chunks before storage and both API encodings',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-native-output-private-')),path=join(dir,'db');
 const secret=['synthetic','native','unicode','é'].join('-'),bytes=[...Buffer.from(secret)],half=bytes.length-1;
 const script=`process.stdout.write(Buffer.from(${JSON.stringify([0,255,...bytes.slice(0,half)])})); setTimeout(()=>{process.stdout.write(Buffer.from(${JSON.stringify([...bytes.slice(half),10])}));process.stderr.write(Buffer.from(${JSON.stringify(bytes)}));},40);`;
 const command=JSON.stringify(process.execPath)+' -e '+"'"+script+"'";let mode;
 const app=startInstance(path,0,{env:{OPENROUTER_API_KEY:secret},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:mode==='direct'?tool('terminal_run',{command}):tool('code_mode',{source:`return await capabilities.terminal_run({command:${JSON.stringify(command)}});`});}})});
 let closed=false;
 try{const call=await paired(app);for(mode of ['direct','hybrid','code']){const bot=await call('/api/bots',{name:mode,toolMode:mode}),id='output-'+mode;await call('/api/commands',{id,botId:bot.id,content:'Run fixture'});await until(async()=>{const c=await call('/api/commands/'+id);return c.state!=='pending'&&c;});const process=await until(async()=> (await call('/api/processes')).find(p=>p.work.id===id&&p.outputComplete));const page=await call(`/api/processes/${process.id}/output`);assert.equal(JSON.stringify(page).includes(secret),false);for(const stream of ['stdout','stderr']){const actual=Buffer.concat(page.chunks.filter(c=>c.stream===stream).map(c=>Buffer.from(c.data,'base64')));assert.equal(actual.includes(Buffer.from(secret)),false);assert.deepEqual(actual,stream==='stdout'?Buffer.concat([Buffer.from([0,255]),Buffer.from('[REDACTED]\n')]):Buffer.from('[REDACTED]'));}}
  await app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{for(const process of db.prepare('SELECT id FROM native_processes').all())for(const stream of ['stdout','stderr']){const stored=Buffer.concat(db.prepare('SELECT data FROM native_process_output WHERE process_id=? AND stream=? ORDER BY cursor').all(process.id,stream).map(row=>Buffer.from(row.data)));assert.deepEqual(stored,stream==='stdout'?Buffer.concat([Buffer.from([0,255]),Buffer.from('[REDACTED]\n')]):Buffer.from('[REDACTED]'));}}finally{db.close();}
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});
