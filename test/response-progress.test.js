import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

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
  const app = startInstance(':memory:', 0, { providerFactory, env: {} });
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
    const messages = await call(`/api/bots/${bot.id}/messages`, second);
    assert.equal(messages.at(-1).content, 'Hello from the streaming response. Finished.');
  } finally { release(); await app.close(); }
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
    release();
    for(let i=0;i<100;i++){progress=await call('/api/commands/failure',token);if(progress.state==='failed')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(progress.responseProgress.state,'failed');
    assert.doesNotMatch(JSON.stringify(progress),/secret-value|private=1/);
    assert.deepEqual((await call(`/api/bots/${bot.id}/messages`,token)).map(m=>m.role),['user']);
    await app.close();app=startInstance(join(dir,'db'),0,{env:{OPENROUTER_API_KEY:'secret-value'}});port=await app.listen();
    assert.equal((await call(`/api/bots/${bot.id}/response`,token)).state,'failed');
    const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify({token}));
    const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['dist/cli.js','instance','response-follow',`http://127.0.0.1:${port}`,credential,'failure']);let out='';child.stdout.on('data',chunk=>out+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(`CLI exited ${code}`)));});
    assert.match(output,/"state":"failed"/);
    assert.doesNotMatch(output,/secret-value|private=1/);
  } finally {release();await app.close();rmSync(dir,{recursive:true,force:true});}
});
