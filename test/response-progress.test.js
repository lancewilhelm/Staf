import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { directCodexProvider } from '../dist/codex-direct.js';
import { streamingRedactor } from '../dist/config.js';
import { openRouterProvider } from '../dist/providers.js';

test('interactive terminal shows held OpenRouter chunks as provisional before completion', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-terminal-router-'));let release,child;
  const gate=new Promise(resolve=>{release=resolve});
  const frame=value=>'data: '+JSON.stringify(value)+'\n\n';
  const providerFactory=async()=>openRouterProvider({OPENROUTER_API_KEY:'synthetic-secret'},'fixture/model',async()=>new Response(new ReadableStream({async start(controller){
    const send=value=>controller.enqueue(new TextEncoder().encode(value));
    send(frame({choices:[{index:0,delta:{content:'First provisional router chunk. '},finish_reason:null}]}));
    await gate;send(frame({choices:[{index:0,delta:{content:'Router finished.'},finish_reason:'stop'}]}));send('data: [DONE]\n\n');controller.close();
  }})));
  const app=startInstance(join(dir,'db'),0,{providerFactory,env:{OPENROUTER_API_KEY:'synthetic-secret'}}),port=await app.listen();
  const call=async(route,token,body)=>{const res=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return res.json();};
  try{
    const token=(await call('/api/pair','',{code:app.code})).token,credential=join(dir,'client.json');writeFileSync(credential,JSON.stringify({token}));
    const bot=await call('/api/main-bot',token,{});await call(`/api/bots/${bot.id}/profile`,token,{...bot,provider:'openrouter',model:'fixture/model'});
    child=spawn(process.execPath,['dist/cli.js','--instance',`http://127.0.0.1:${port}`,'--credential',credential,'--data-dir',dir],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
    child.stdin.write('stream now\n');
    for(let i=0;i<120&&!out.includes('First provisional router chunk.');i++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(out,/staf \(provisional\)> First provisional router chunk\./,err);assert.doesNotMatch(out,/Router finished\./);assert.doesNotMatch(out,/synthetic-secret/);
    release();for(let i=0;i<120&&!out.includes('Router finished.');i++)await new Promise(resolve=>setTimeout(resolve,25));assert.match(out,/Router finished\./);
    child.stdin.end('/quit\n');await new Promise(resolve=>child.once('exit',resolve));child=undefined;
  }finally{release();child?.kill();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('interactive terminal shows stopped partial output for another client response', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-terminal-foreign-stop-'));let child;
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(_messages,_tools,{signal}){
    yield {type:'text_delta',text:'Partial output before cancellation.'};
    await new Promise(resolve=>signal.aborted?resolve():signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();
  },async complete(){throw Error('unexpected');}});
  const app=startInstance(join(dir,'db'),0,{providerFactory,env:{}}),port=await app.listen();
  const call=async(route,token,body)=>{const res=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return res.json();};
  try{
    const token=(await call('/api/pair','',{code:app.code})).token,credential=join(dir,'client.json');writeFileSync(credential,JSON.stringify({token}));
    const bot=await call('/api/main-bot',token,{});await call('/api/commands',token,{id:'foreign-stream',botId:bot.id,content:'start elsewhere'});
    for(let i=0;i<100;i++){if((await call('/api/commands/foreign-stream',token)).responseProgress?.text.includes('Partial output'))break;await new Promise(resolve=>setTimeout(resolve,10));}
    child=spawn(process.execPath,['dist/cli.js','--instance',`http://127.0.0.1:${port}`,'--credential',credential,'--data-dir',dir],{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.stdin.write('/stop\n');
    for(let i=0;i<160&&!out.includes('staf (stopped)> Partial output before ');i++)await new Promise(resolve=>setTimeout(resolve,25));
    assert.match(out,/Command foreign-stream: stopped/,err);assert.match(out,/staf \(stopped\)> Partial output before /);
    child.stdin.end('/quit\n');await new Promise(resolve=>child.once('exit',resolve));child=undefined;
  }finally{child?.kill();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('progress withholds only a possible credential suffix, including escaped credentials', () => {
  const secret='synthetic"credential with spaces';
  const redact=streamingRedactor({OPENROUTER_API_KEY:secret});
  assert.equal(redact('Normal short response. '),'Normal short response. ');
  for(const value of [secret,JSON.stringify(secret).slice(1,-1)]){
    for(let i=1;i<value.length;i++)assert.equal(redact('Safe text. '+value.slice(0,i)),'Safe text. ');
    assert.equal(redact('Safe text. '+value+' end.'),'Safe text. [REDACTED] end.');
  }
});

test('paired clients observe provisional response progress and contention', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const providerFactory = async () => ({
    name: 'synthetic', capabilities: { toolCalls: true, incrementalText: true, transport: 'responses' },
    async *stream() {
      yield { type: 'text_delta', text: 'Hello from the streaming response. ' };
      await gate;
      yield { type: 'message', message: { role: 'assistant', content: 'Hello from the streaming response. Finished.' } };
    },
    async complete() { throw Error('unexpected buffered request'); },
  });
  const app = startInstance(':memory:', 0, { providerFactory, env: {OPENROUTER_API_KEY:'synthetic-key-'+'x'.repeat(2048)} });
  const port = await app.listen();
  const call = async (route, token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return response.json();
  };
  try {
    const first = (await call('/api/pair', '', { code: app.code })).token;
    const second = (await call('/api/pair', '', { code: app.issueCode() })).token;
    const bot = await call('/api/bots', first, { name: 'Stream' });
    assert.equal((await call('/api/commands', first, { id: 'stream-one', botId: bot.id, content: 'Hello' })).kind, 'accepted');
    let progress;
    for (let i = 0; i < 100; i++) {
      progress = await call(`/api/bots/${bot.id}/response`, second);
      if (progress?.text?.includes('streaming')) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(progress.state, 'running');
    assert.match(progress.text, /streaming/);
    assert.equal((await call('/api/commands', second, { id: 'stream-two', botId: bot.id, content: 'Wait' })).kind, 'busy');
    release();
    for (let i = 0; i < 100; i++) {
      progress = await call('/api/commands/stream-one', second);
      if (progress.state === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(progress.state, 'completed');
    assert.equal(progress.responseProgress.text, 'Hello from the streaming response. Finished.');
    const messages = await call(`/api/bots/${bot.id}/messages`, second);
    assert.equal(messages.at(-1).content, 'Hello from the streaming response. Finished.');
  } finally { release(); await app.close(); }
});

test('shared progress streams through the real Codex adapter before the SSE response completes', async () => {
  let stream;
  const encoder=new TextEncoder();
  const body=new ReadableStream({start(controller){stream=controller;}});
  const token='synthetic-bearer-'+'x'.repeat(2048);
  const providerFactory=async()=>directCodexProvider({model:'test-model',sessionId:'test',dataDir:'/unused',token:async()=>token,request:async()=>new Response(body)});
  const app=startInstance(':memory:',0,{providerFactory,env:{}}),port=await app.listen();
  const call=async(route,credential,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${credential}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return response.json();};
  const emit=event=>stream.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
  try {
    const credential=(await call('/api/pair','',{code:app.code})).token;
    const bot=await call('/api/bots',credential,{name:'Codex'});
    await call('/api/commands',credential,{id:'codex-stream',botId:bot.id,content:'go'});
    emit({type:'response.output_text.delta',delta:'Live response begins here. '+token.slice(0,20)});
    let progress;
    for(let i=0;i<100;i++){progress=await call(`/api/bots/${bot.id}/response`,credential);if(progress?.text?.includes('Live response'))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.state,'running');assert.match(progress.text,/Live response/);assert.doesNotMatch(progress.text,/synthetic-bearer/);
    emit({type:'response.output_text.delta',delta:token.slice(20)+' continued. '});
    const final='Live response begins here. '+token+' continued.';
    emit({type:'response.completed',response:{status:'completed',model:'test-model',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:final}]}]}});stream.close();
    for(let i=0;i<100;i++){progress=await call('/api/commands/codex-stream',credential);if(progress.state==='completed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.state,'completed');assert.match(progress.responseProgress.text,/\[REDACTED\]/);assert.doesNotMatch(progress.responseProgress.text,/synthetic-bearer/);
  } finally {await app.close();}
});

test('failed progress is provisional, redacted across chunks, and visible to the CLI after restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-response-'));
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  const providerFactory=async()=>({name:'synthetic',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(){
    yield {type:'text_delta',text:'A readable beginning with enough words. secret-'};
    yield {type:'text_delta',text:'value https://example.com/path?private=1 '};
    await gate;
    yield {type:'error',message:'failure'};
  },async complete(){throw Error('unexpected');}});
  let app=startInstance(join(dir,'db'),0,{providerFactory,env:{OPENROUTER_API_KEY:'secret-value'}}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  try {
    const token=(await call('/api/pair','',{code:app.code})).token;
    const bot=await call('/api/bots',token,{name:'Stream'});
    await call('/api/commands',token,{id:'failure',botId:bot.id,content:'go'});
    let progress;
    for(let i=0;i<100;i++){progress=await call(`/api/bots/${bot.id}/response`,token);if(progress?.text?.includes('readable'))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.state,'running');
    assert.doesNotMatch(progress.text,/secret|private=1/);
    const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify({token}));
    const child=spawn(process.execPath,['dist/cli.js','instance','response-follow',`http://127.0.0.1:${port}`,credential,'failure']);
    let liveOutput='';child.stdout.on('data',chunk=>liveOutput+=chunk);
    for(let i=0;i<100&&!liveOutput.includes('"state":"running"');i++)await new Promise(r=>setTimeout(r,10));
    assert.match(liveOutput,/"state":"running"/);
    const exited=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`CLI exited ${code}`)));});
    release();
    await exited;
    assert.match(liveOutput,/"state":"failed"/);
    for(let i=0;i<100;i++){progress=await call('/api/commands/failure',token);if(progress.state==='failed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.responseProgress.state,'failed');
    assert.doesNotMatch(JSON.stringify(progress),/secret-value|private=1/);
    assert.deepEqual((await call(`/api/bots/${bot.id}/messages`,token)).map(m=>m.role),['user']);
    await app.close();app=startInstance(join(dir,'db'),0,{env:{OPENROUTER_API_KEY:'secret-value'}});port=await app.listen();
    assert.equal((await call(`/api/bots/${bot.id}/response`,token)).state,'failed');
    const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['dist/cli.js','instance','response-follow',`http://127.0.0.1:${port}`,credential,'failure']);let out='';child.stdout.on('data',chunk=>out+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(`CLI exited ${code}`)));});
    assert.match(output,/"state":"failed"/);
    assert.doesNotMatch(output,/secret-value|private=1/);
  } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart retains interrupted progress without committing an assistant message', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-interrupted-response-'));
  const providerFactory=async()=>({name:'synthetic',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(_messages,_tools,{signal}){
    yield {type:'text_delta',text:'Partial response that must remain provisional. '};
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    signal.throwIfAborted();
  },async complete(){throw Error('unexpected');}});
  let app=startInstance(join(dir,'db'),0,{providerFactory,env:{}}),port=await app.listen();
  const call=async(route,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return response.json();};
  try {
    const token=(await call('/api/pair','',{code:app.code})).token;
    const bot=await call('/api/bots',token,{name:'Interrupted'});
    await call('/api/commands',token,{id:'interrupted',botId:bot.id,content:'go'});
    for(let i=0;i<100;i++){const p=await call(`/api/bots/${bot.id}/response`,token);if(p?.text?.includes('Partial response'))break;await new Promise(r=>setTimeout(r,10));}
    await app.close();app=startInstance(join(dir,'db'),0,{env:{}});port=await app.listen();
    const progress=await call(`/api/bots/${bot.id}/response`,token);
    assert.equal(progress.state,'interrupted');assert.match(progress.text,/Partial response/);
    assert.deepEqual((await call(`/api/bots/${bot.id}/messages`,token)).map(m=>m.role),['user']);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('streamed progress redacts managed OpenRouter keys saved and replaced during work', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-stream-managed-key-'));
  const first='managed-router-key-one',second='managed-router-key-two';
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(){
    yield {type:'text_delta',text:`Visible first. ${first.slice(0,8)}`};
    yield {type:'text_delta',text:`${first.slice(8)} next. `};
    await gate;
    yield {type:'text_delta',text:`Visible second. ${second.slice(0,8)}`};
    yield {type:'text_delta',text:`${second.slice(8)} done. `};
    yield {type:'message',message:{role:'assistant',content:`Visible first. ${first} next. Visible second. ${second} done.`}};
  },async complete(){throw Error('unexpected');}});
  const app=startInstance(join(dir,'db'),0,{providerFactory,env:{}}),port=await app.listen();
  const call=async(route,token,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return r.json();};
  try{
    const token=(await call('/api/pair','',{code:app.code})).token;
    const agent=await call('/api/bots',token,{name:'Streaming agent'});
    await call('/api/openrouter-connection',token,{key:first});
    await call('/api/commands',token,{id:'managed-stream',botId:agent.id,content:'hello'});
    let progress;
    for(let i=0;i<100;i++){progress=await call(`/api/bots/${agent.id}/response`,token);if(progress?.text?.includes('Visible first.'))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.state,'running');assert.match(progress.text,/\[REDACTED\]/);assert.ok(!progress.text.includes(first));
    await call('/api/openrouter-connection',token,{key:second});release();
    for(let i=0;i<100;i++){progress=await call('/api/commands/managed-stream',token);if(progress.state==='completed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.state,'completed');assert.doesNotMatch(JSON.stringify(progress),/managed-router-key-(one|two)/);
    const messages=await call(`/api/bots/${agent.id}/messages`,token);assert.doesNotMatch(JSON.stringify(messages),/managed-router-key-(one|two)/);
  }finally{release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
