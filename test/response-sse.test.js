import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInstance } from '../dist/instance-service.js';

async function readEvent(reader) {
  let timer;
  try {return await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out waiting for a response event')),3000);})]);}
  finally {clearTimeout(timer);}
}

test('paired clients receive live response snapshots and can reconnect without resubmission', async () => {
  let advance, finish;
  const next=new Promise(resolve=>{advance=resolve}),end=new Promise(resolve=>{finish=resolve});
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(){
    yield {type:'text_delta',text:'First visible words. '};await next;
    yield {type:'text_delta',text:'Second visible words. '};await end;
    yield {type:'message',message:{role:'assistant',content:'First visible words. Second visible words. Done.'}};
  },async complete(){throw Error('unexpected');}});
  const app=startInstance(':memory:',0,{providerFactory,env:{}}),port=await app.listen();
  const call=async(path,token,body)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const abort=new AbortController();let reader;
  try {
    const token=(await (await call('/api/pair','',{code:app.code})).json()).token;
    const second=(await (await call('/api/pair','',{code:app.issueCode()})).json()).token;
    const bot=await (await call('/api/bots',token,{name:'SSE'})).json();
    assert.equal((await call(`/api/bots/${bot.id}/response/stream`,'')).status,401);
    const response=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});
    assert.match(response.headers.get('content-type'),/^text\/event-stream/);
    const otherAbort=new AbortController();
    const other=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${second}`},signal:otherAbort.signal});
    const otherReader=other.body.getReader();
    reader=response.body.getReader();let buffer='';
    const read=async()=>{while(!buffer.includes('\n\n')){const part=await readEvent(reader);if(part.done)throw Error('Stream closed before event');buffer+=new TextDecoder().decode(part.value);}const end=buffer.indexOf('\n\n');const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);return JSON.parse(frame.split('\n').find(line=>line.startsWith('data: ')).slice(6));};
    let current=null;
    const apply=event=>{if(event.type==='snapshot')current=event.response;else if(event.type==='delta'&&current?.id===event.id)current={...current,text:current.text+event.text};return current;};
    const until=async predicate=>{for(let i=0;i<12;i++){const event=apply(await read());if(predicate(event))return event;}throw Error('Missing event');};
    assert.equal(apply(await read()),null);
    assert.equal((await (await call('/api/commands',token,{id:'sse-command',botId:bot.id,content:'go'})).json()).kind,'accepted');
    assert.equal((await until(event=>event?.text?.includes('First visible'))).state,'running');
    let otherFrames='';for(let i=0;i<10&&!otherFrames.includes('First visible');i++){const part=await readEvent(otherReader);if(part.done)break;otherFrames+=new TextDecoder().decode(part.value);}assert.match(otherFrames,/First visible/);
    otherAbort.abort();await otherReader.cancel().catch(()=>{});
    advance();assert.equal((await until(event=>event?.text?.includes('Second visible'))).state,'running');
    abort.abort();await reader.cancel().catch(()=>{});
    const reconnect=new AbortController();
    const recovered=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${token}`},signal:reconnect.signal});
    const recoveredReader=recovered.body.getReader();const initial=new TextDecoder().decode((await readEvent(recoveredReader)).value);
    assert.match(initial,/Second visible/);
    finish();let frames=initial;
    for(let i=0;i<10&&!frames.includes('"state":"completed"');i++){const part=await readEvent(recoveredReader);if(part.done)break;frames+=new TextDecoder().decode(part.value);}
    assert.match(frames,/"state":"completed"/);
    reconnect.abort();await recoveredReader.cancel().catch(()=>{});
    assert.equal((await (await call('/api/commands',token,{id:'sse-command',botId:bot.id,content:'go'})).json()).kind,'existing');
  } finally {advance();finish();abort.abort();if(reader)await reader.cancel().catch(()=>{});await app.close();}
});

test('completed responses larger than the stream frame limit remain available in chat',async()=>{
  const answer='x'.repeat(2_100_000);
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:false,transport:'demo'},async complete(){return {role:'assistant',content:answer};}});
  const app=startInstance(':memory:',0,{providerFactory,env:{}}),port=await app.listen();
  const call=(path,token,body)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const abort=new AbortController();let reader;
  try {
    const token=(await (await call('/api/pair','',{code:app.code})).json()).token;
    const bot=await (await call('/api/bots',token,{name:'Large response'})).json();
    const response=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});reader=response.body.getReader();
    await call('/api/commands',token,{id:'large-response',botId:bot.id,content:'go'});
    let buffer='',completed;
    while(!completed){const part=await readEvent(reader);assert.equal(part.done,false);buffer+=new TextDecoder().decode(part.value);let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').find(line=>line.startsWith('data: '));if(data){const event=JSON.parse(data.slice(6));if(event.response?.state==='completed')completed=event.response;}}}
    assert.equal(completed.text.length,0);
    const messages=await (await call(`/api/bots/${bot.id}/messages`,token)).json();
    assert.equal(messages.at(-1).content,answer);
    const reconnectAbort=new AbortController();
    const reconnected=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${token}`},signal:reconnectAbort.signal});
    const reconnectReader=reconnected.body.getReader();const initial=new TextDecoder().decode((await readEvent(reconnectReader)).value);
    assert.match(initial,/"state":"completed"/);assert.ok(initial.length<1000);
    reconnectAbort.abort();await reconnectReader.cancel().catch(()=>{});
  } finally {abort.abort();if(reader)await reader.cancel().catch(()=>{});await app.close();}
});

test('response streams reject bad origins and close immediately on client revocation',async()=>{
  const app=startInstance(':memory:',0,{env:{}}),port=await app.listen();
  const call=(path,token,body,origin)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});
  let reader;
  try {
    const first=(await (await call('/api/pair','',{code:app.code})).json()).token;
    const second=(await (await call('/api/pair','',{code:app.issueCode()})).json()).token;
    const bot=await (await call('/api/bots',first,{name:'Secure stream'})).json();
    assert.equal((await call(`/api/bots/${bot.id}/response/stream`,first,undefined,'http://evil.example')).status,403);
    assert.equal((await call('/api/bots/no-such-agent/response/stream',first)).status,404);
    const response=await call(`/api/bots/${bot.id}/response/stream`,first);
    reader=response.body.getReader();assert.equal((await readEvent(reader)).done,false);
    const clients=await (await call('/api/clients',second)).json();
    const victim=clients.find(client=>!client.current);
    assert.equal((await call(`/api/clients/${victim.id}/revoke`,second,{})).status,200);
    assert.equal((await readEvent(reader)).done,true);
    assert.equal((await call(`/api/bots/${bot.id}/response/stream`,first)).status,401);
  } finally {if(reader)await reader.cancel().catch(()=>{});await app.close();}
});

test('a failed response is pushed with its incomplete text',async()=>{
  let fail;
  const gate=new Promise(resolve=>{fail=resolve});
  const providerFactory=async()=>({name:'fixture',capabilities:{toolCalls:true,incrementalText:true,transport:'responses'},async *stream(){yield {type:'text_delta',text:'Incomplete answer. '};await gate;yield {type:'error',message:'synthetic failure'};},async complete(){throw Error('unexpected');}});
  const app=startInstance(':memory:',0,{providerFactory,env:{}}),port=await app.listen();
  const call=(path,token,body)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const abort=new AbortController();let reader;
  try {
    const token=(await (await call('/api/pair','',{code:app.code})).json()).token;
    const bot=await (await call('/api/bots',token,{name:'Failure'})).json();
    const response=await fetch(`http://127.0.0.1:${port}/api/bots/${bot.id}/response/stream`,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal});reader=response.body.getReader();
    await call('/api/commands',token,{id:'failure-stream',botId:bot.id,content:'go'});
    let output='';for(let i=0;i<10&&!output.includes('Incomplete answer');i++){const part=await readEvent(reader);if(part.done)break;output+=new TextDecoder().decode(part.value);}
    assert.match(output,/Incomplete answer/);fail();
    for(let i=0;i<10&&!output.includes('"state":"failed"');i++){const part=await readEvent(reader);if(part.done)break;output+=new TextDecoder().decode(part.value);}
    assert.match(output,/"state":"failed"/);assert.doesNotMatch(output,/"state":"completed"/);
  } finally {fail();abort.abort();if(reader)await reader.cancel().catch(()=>{});await app.close();}
});
