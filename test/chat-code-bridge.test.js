import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from '../dist/instance-service.js';

test('paired chat offers each captured mode and runs the real guest clock', async () => {
  const seen=[];
  const factory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages,tools){
    seen.push(tools.map(tool=>tool.function.name));
    if (messages.at(-1)?.role==='tool') return {role:'assistant',content:'done'};
    return {role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name:'code_mode',arguments:JSON.stringify({source:'return await capabilities.clock({});'})}}]};
  }});
  const app=startInstance(':memory:',0,{env:{},providerFactory:factory});const port=await app.listen();
  const call=async(path,token,body)=>{const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok);return response.json();};
  try {
    const {token}=await call('/api/pair',null,{code:app.code});
    const bot=await call('/api/bots',token,{name:'Bridge',toolMode:'code'});
    await call('/api/commands',token,{id:'bridge',botId:bot.id,content:'read time'});
    let record;for(let i=0;i<400;i++){record=await call('/api/commands/bridge',token);if(record.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(record.state,'completed',record.error);
    assert.deepEqual(seen[0],['code_mode']);
    assert.equal(record.codeExecutions.length,1);
    assert.equal(record.codeExecutions[0].outcome,'return');
    assert.match(JSON.stringify(record.codeExecutions[0]),/\d{4}-\d\d-\d\dT/);
    assert.equal(record.workActions.length,1);
  } finally {await app.close();}
});

const memoryOffers=['memory_search','memory_read','memory_remember','memory_update','memory_forget','memory_proposal_status'];
const tool=(name,args={},id='call')=>({role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function fixture(respond,env={}) {
  const seen=[];
  const app=startInstance(':memory:',0,{env,providerFactory:async profile=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages,tools){seen.push({profile,messages:structuredClone(messages),offers:tools.map(x=>x.function.name)});return respond(messages,tools,profile);}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,`${path} ${r.status}: ${JSON.stringify(v)}`);return v;};
  token=(await call('/api/pair',{code:app.code})).token;
  const until=async fn=>{for(let i=0;i<2000;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  const submit=async(id,botId,content='test')=>call('/api/commands',{id,botId,content});
  const wait=async id=>until(async()=>{const c=await call('/api/commands/'+id);return c.state!=='pending' && c;});
  return {app,call,seen,until,submit,wait};
}

test('direct, hybrid and code offers are captured and unoffered calls cannot dispatch',async()=>{
  const f=await fixture((messages)=>{const user=messages.findLast(x=>x.role==='user').content;if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return user==='plain'?{role:'assistant',content:'text'}:user==='forged'?tool('clock'):tool(user==='direct'?'clock':'code_mode',user==='direct'?{}:{source:'return (await capabilities.clock({})).value;'});});
  try {
    for(const mode of ['direct','hybrid','code']){
      const bot=await f.call('/api/bots',{name:mode,toolMode:mode});const index=f.seen.length;
      await f.submit(mode,bot.id,mode);const command=await f.wait(mode);assert.equal(command.state,'completed');
      assert.deepEqual(f.seen[index].offers,mode==='direct'?['clock',...memoryOffers]:mode==='hybrid'?['clock',...memoryOffers,'code_mode']:['code_mode']);
      assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'succeeded');
      assert.equal(command.codeExecutions.length,mode==='direct'?0:1);
      if(mode!=='direct')assert.match(command.codeExecutions[0].result.value,/^\d{4}-/);
    }
    const bot=await f.call('/api/bots',{name:'forged',toolMode:'code'});await f.submit('forged',bot.id,'forged');const forged=await f.wait('forged');assert.equal(forged.workActions.length,0);assert.match(f.seen.at(-1).messages.at(-1).content,/not offered/);
    const plain=await f.call('/api/bots',{name:'plain',toolMode:'hybrid'});await f.submit('plain',plain.id,'plain');const text=await f.wait('plain');assert.equal(text.codeExecutions.length,0);assert.equal(text.workActions.length,0);
  } finally {await f.app.close();}
});

test('hybrid script errors expose recovery and retain a completed child before direct continuation',async()=>{
  const f=await fixture(messages=>{const toolResults=messages.filter(x=>x.role==='tool');if(!toolResults.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'script');if(toolResults.length===1)return tool('clock',{},'direct');return {role:'assistant',content:'continued'};});
  try {const bot=await f.call('/api/bots',{name:'recovery',toolMode:'hybrid'});await f.submit('recovery',bot.id);const c=await f.wait('recovery');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'error');assert.equal(c.codeExecutions[0].actions.length,1);assert.equal(c.workActions.length,2);assert.match(f.seen[1].messages.at(-1).content,/recovery/);assert.equal(c.workActions[0].state,'succeeded');}
  finally {await f.app.close();}
});

test('Code Mode excludes legacy individual tools and rejects their forged calls',async()=>{
  let skill;
  const f=await fixture(messages=>messages.at(-1).role==='tool'
    ? {role:'assistant',content:'done'}
    : tool('select_skill',{id:skill.id,revision:1}));
  try {
    skill=await f.call('/api/skills',{name:'Available helper',description:'A fixture skill',provenance:'owner',body:'Use the clock when needed.'});
    for(const mode of ['direct','hybrid','code']) {
      const bot=await f.call('/api/bots',{name:'skill-'+mode,toolMode:mode});
      await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
      const index=f.seen.length;
      await f.submit('skill-'+mode,bot.id);const command=await f.wait('skill-'+mode);
      assert.equal(command.state,'completed',command.error);
      assert.deepEqual(f.seen[index].offers,mode==='direct'?['clock',...memoryOffers,'select_skill']:mode==='hybrid'?['clock',...memoryOffers,'code_mode','select_skill']:['code_mode']);
      assert.equal(f.seen[index].messages.some(message=>typeof message.content==='string' && message.content.includes('Available skill catalog')),mode!=='code');
      assert.equal(command.skillActivity.length,mode==='code'?0:1);
      const result=command.runtimeEvents.find(event=>event.type==='tool_result' && event.name==='select_skill');
      assert.equal(result.success,mode!=='code');
      if(mode==='code') assert.match(f.seen.at(-1).messages.at(-1).content,/not offered/);
    }
  } finally {await f.app.close();}
});

test('ordinary errors mentioning limits keep Hybrid recovery available',async()=>{
  const f=await fixture(messages=>{
    const results=messages.filter(message=>message.role==='tool');
    if(!results.length) return tool('code_mode',{source:messages.findLast(message=>message.role==='user').content},'script');
    if(results.length===1) return tool('clock',{},'direct');
    return {role:'assistant',content:'continued'};
  });
  try {
    const programs=['interrupted','out of memory','stack overflow','JSON limit','JSON nesting limit','Bridge limit'].map(message=>`await capabilities.clock({}); throw Error(${JSON.stringify(message)});`);
    programs.push('await capabilities.clock({}); throw Object.assign(new Error("stack overflow"), {name:"InternalError"});');
    programs.push('await capabilities.clock({}); throw new InternalError("ordinary failure");');
    for(const [index,source] of programs.entries()) {
      const bot=await f.call('/api/bots',{name:'error-'+index,toolMode:'hybrid'});
      await f.submit('ordinary-'+index,bot.id,source);const command=await f.wait('ordinary-'+index);
      assert.equal(command.state,'completed',command.error);
      assert.equal(command.codeExecutions[0].outcome,'error');
      assert.equal(command.codeExecutions[0].actions.length,1);
      assert.equal(command.workActions.length,2);
      assert.ok(command.workActions.every(action=>action.state==='succeeded'));
    }
  } finally {await f.app.close();}
});

test('a caught per-program allocation rejection preserves the shared work budget',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'
    ? {role:'assistant',content:'done'}
    : tool('code_mode',{source:'let rejected=false; try {new ArrayBuffer(64*1024*1024);} catch {rejected=true;} return {rejected,time:(await capabilities.clock({})).value};'}));
  try {
    const bot=await f.call('/api/bots',{name:'allocation guard',toolMode:'hybrid'});
    await f.submit('allocation-guard',bot.id);const command=await f.wait('allocation-guard');
    assert.equal(command.state,'completed',command.error);
    assert.equal(command.codeExecutions[0].result.value.rejected,true);
    assert.match(command.codeExecutions[0].result.value.time,/^\d{4}-/);
    assert.equal(command.workActions.length,1);
    assert.equal(command.workActions[0].state,'succeeded');
  } finally {await f.app.close();}
});

test('approval denial and Stop close queued guest calls',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'unexpected'}:tool('code_mode',{source:'await Promise.all([capabilities.clock({}),capabilities.clock({})]);'}));
  try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
    for(const disposition of ['deny','stop']){
      const bot=await f.call('/api/bots',{name:disposition,toolMode:'hybrid'});await f.submit(disposition,bot.id);
      const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId===disposition && x.state==='pending'));
      if(disposition==='deny')await f.call(`/api/approvals/${approval.id}/deny`,{});else await f.call(`/api/commands/${disposition}/stop`,{});
      const c=await f.wait(disposition);assert.equal(c.state,disposition==='stop'?'stopped':'failed');assert.equal(c.workActions.length,1);assert.equal(c.codeExecutions[0].outcome,'closed');
      assert.equal((await f.call('/api/approvals')).filter(x=>x.workId===disposition).length,1);
    }
  } finally {await f.app.close();}
});

test('held accepted work keeps mode across profile edits and exact command retry',async()=>{
  let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  const f=await fixture(async messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};started();await gate;return tool('code_mode',{source:'return (await capabilities.clock({})).value;'});});
  try {const bot=await f.call('/api/bots',{name:'held',toolMode:'code'});await f.submit('held',bot.id,'held');await ready;await f.call(`/api/bots/${bot.id}/profile`,{...bot,toolMode:'direct'});assert.equal((await f.submit('held',bot.id,'held')).kind,'existing');release();const c=await f.wait('held');assert.equal(c.state,'completed');assert.equal(c.toolMode,'code');assert.deepEqual(f.seen[0].offers,['code_mode']);assert.equal(c.codeExecutions[0].outcome,'return');}
  finally {release();await f.app.close();}
});

test('both routes use one clock approval and expose the same action journal',async()=>{
  const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const mode=messages.findLast(m=>m.role==='user').content;return mode==='direct'?tool('clock'):tool('code_mode',{source:'return await capabilities.clock({});'});});
  try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});for(const mode of ['direct','code']) {const bot=await f.call('/api/bots',{name:mode,toolMode:mode});await f.submit('approval-'+mode,bot.id,mode);const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='approval-'+mode && x.state==='pending'));await f.call(`/api/approvals/${approval.id}/approve`,{});const c=await f.wait('approval-'+mode);assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.equal((await f.call('/api/approvals')).filter(x=>x.workId==='approval-'+mode).length,1);if(mode==='code')assert.deepEqual(c.codeExecutions[0].actions,[c.workActions[0].id]);}}
  finally {await f.app.close();}
});

test('code-only syntax error returns a clear recovery result without offering direct clock',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'The script failed.'}:tool('code_mode',{source:'let = ;'}));
  try {const bot=await f.call('/api/bots',{name:'syntax',toolMode:'code'});await f.submit('syntax',bot.id);const c=await f.wait('syntax');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'syntax');assert.match(f.seen[1].messages.at(-1).content,/Code Mode remains selected/);assert.deepEqual(f.seen[1].offers,['code_mode']);assert.equal(c.workActions.length,0);}
  finally {await f.app.close();}
});

test('shared action budget closes admission even after a caught allocation rejection',async()=>{
  const f=await fixture(()=>tool('code_mode',{source:'try {new ArrayBuffer(64*1024*1024);} catch {} for (let i=0;i<33;i++) await capabilities.clock({}); return "done";'}));
  try {const bot=await f.call('/api/bots',{name:'budget',toolMode:'hybrid'});await f.submit('budget',bot.id);const c=await f.wait('budget');assert.equal(c.state,'failed');assert.equal(c.codeExecutions[0].outcome,'closed');assert.equal(c.workActions.length,32);assert.ok(c.workActions.every(x=>x.state==='succeeded'));assert.match(c.error,/limit/i);}
  finally {await f.app.close();}
});

test('a completed guest action can be resumed through the direct recovery envelope',async()=>{
  const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'script');if(results.length===1){const recovery=JSON.parse(results[0].content);return tool('clock',{_staf:{kind:'resume',actionId:recovery.recovery.actions[0].id}},'resume');}return {role:'assistant',content:'done'};});
  try {const bot=await f.call('/api/bots',{name:'resume',toolMode:'hybrid'});await f.submit('resume',bot.id);const c=await f.wait('resume');assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.match(f.seen[2].messages.at(-1).content,/^\d{4}-/);}
  finally {await f.app.close();}
});

test('live clock revocation during a guest approval prevents queued work',async()=>{
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'unexpected'}:tool('code_mode',{source:'await Promise.all([capabilities.clock({}),capabilities.clock({})]);'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{name:'revoked',toolMode:'hybrid'});await f.submit('revoked',bot.id);const request=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='revoked' && x.state==='pending'));await f.call('/api/approval-settings/instance',{mode:'never-ask',clockEnabled:false});await f.call(`/api/approvals/${request.id}/approve`,{});const c=await f.wait('revoked');assert.equal(c.state,'failed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'cancelled');assert.equal(c.codeExecutions[0].outcome,'closed');}
 finally {await f.app.close();}
});

test('source that contains configured credentials is rejected; selected guest output is redacted',async()=>{
 const secret='synthetic-secret-unique';
 const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const input=messages.findLast(x=>x.role==='user').content;return tool('code_mode',{source:input==='source' ? `return "${secret}";` : 'return ["synthetic", "secret", "unique"].join("-");'});},{OPENROUTER_API_KEY:secret});
 try {const bot=await f.call('/api/bots',{name:'safe',toolMode:'code'});await f.submit('secret-source',bot.id,'source');const rejected=await f.wait('secret-source');assert.equal(rejected.codeExecutions.length,0);assert.ok(!JSON.stringify(rejected).includes(secret));await f.submit('secret-result',bot.id,'result');const c=await f.wait('secret-result');assert.equal(c.codeExecutions[0].outcome,'return');assert.ok(!JSON.stringify(c).includes(secret));assert.match(JSON.stringify(c.codeExecutions),/REDACTED/);}
 finally {await f.app.close();}
});

test('paired CLI status inspects the same scripted execution',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return (await capabilities.clock({})).value;'}));
 // Use an asynchronous child so the instance can serve its request.
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);const dir=mkdtempSync(join(tmpdir(),'staf-bridge-cli-'));
 try {const pair=await f.call('/api/pair',{code:f.app.issueCode()});const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify(pair));const bot=await f.call('/api/bots',{name:'cli',toolMode:'code'});await f.submit('cli-code',bot.id);const c=await f.wait('cli-code');const address=f.app.server.address();const {stdout}=await run(process.execPath,['dist/cli.js','instance','status',`http://127.0.0.1:${address.port}`,credential,'cli-code']);const inspected=JSON.parse(stdout);assert.deepEqual(inspected.codeExecutions,c.codeExecutions);assert.equal(inspected.workActions[0].id,c.workActions[0].id);}
 finally {await f.app.close();rmSync(dir,{recursive:true,force:true});}
});

test('source, selected output, and child linkage are visible while authorization is pending',async()=>{
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'await staf.emit("before clock"); return await capabilities.clock({});'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{name:'inspect',toolMode:'code'});await f.submit('inspect',bot.id);const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='inspect' && x.state==='pending'));const c=await f.call('/api/commands/inspect');assert.equal(c.codeExecutions[0].outcome,'running');assert.match(c.codeExecutions[0].source,/staf.emit/);assert.deepEqual(c.codeExecutions[0].result.emitted,['before clock']);assert.equal(c.codeExecutions[0].actions.length,1);assert.equal(c.workActions[0].state,'prepared');await f.call(`/api/approvals/${approval.id}/approve`,{});assert.equal((await f.wait('inspect')).state,'completed');}
 finally {await f.app.close();}
});

test('interrupted guest execution is retained across a real instance restart without replay',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'staf-bridge-restart-')),path=join(dir,'instance.sqlite');let requests=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){requests++;return tool('code_mode',{source:'await staf.emit("retained"); while (true) {}'});}});
 let app=startInstance(path,0,{env:{},providerFactory:factory}),port=await app.listen(),token;
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
 try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{name:'restart',toolMode:'code'});await call('/api/commands',{id:'restart',botId:bot.id,content:'run'});let running;for(let i=0;i<400;i++){running=await call('/api/commands/restart');if(running.codeExecutions[0]?.result?.emitted?.includes('retained'))break;await new Promise(r=>setTimeout(r,10));}assert.deepEqual(running.codeExecutions[0].result.emitted,['retained']);await app.close();app=startInstance(path,0,{env:{},providerFactory:factory});port=await app.listen();const record=await call('/api/commands/restart');assert.equal(record.state,'interrupted');assert.ok(['closed','interrupted'].includes(record.codeExecutions[0].outcome));assert.equal(record.codeExecutions[0].result.emitted[0],'retained');assert.equal(requests,1);}
 finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('guest CPU limit interrupts a pending approval before any queued action starts',async()=>{
 const f=await fixture(()=>tool('code_mode',{source:'capabilities.clock({}); while (true) {}'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{name:'limit',toolMode:'hybrid'});await f.submit('guest-limit',bot.id);await f.until(async()=>(await f.call('/api/approvals')).some(x=>x.workId==='guest-limit' && x.state==='pending'));const c=await f.wait('guest-limit');assert.equal(c.state,'failed');assert.match(c.error,/Guest execution limit/);assert.equal(c.workActions[0].state,'cancelled');assert.equal(c.codeExecutions[0].outcome,'closed');assert.equal((await f.call('/api/approvals')).find(x=>x.workId==='guest-limit').state,'interrupted');}
 finally {await f.app.close();}
});

test('hybrid syntax error can continue with direct clock',async()=>{
 const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'let = ;'},'syntax');if(results.length===1)return tool('clock',{},'direct');return {role:'assistant',content:'continued'};});
 try {const bot=await f.call('/api/bots',{name:'syntax-hybrid',toolMode:'hybrid'});await f.submit('syntax-hybrid',bot.id);const c=await f.wait('syntax-hybrid');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'syntax');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');}
 finally {await f.app.close();}
});

test('code-only recovery can resume a completed child in a new guest',async()=>{
 const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'first');if(results.length===1){const id=JSON.parse(results[0].content).recovery.actions[0].id;return tool('code_mode',{source:`return await capabilities.clock({}, {kind:'resume',actionId:${JSON.stringify(id)}});`},'second');}return {role:'assistant',content:'done'};});
 try {const bot=await f.call('/api/bots',{name:'guest-resume',toolMode:'code'});await f.submit('guest-resume',bot.id);const c=await f.wait('guest-resume');assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.codeExecutions.length,2);assert.deepEqual(c.codeExecutions[0].actions,c.codeExecutions[1].actions);assert.deepEqual(f.seen[1].offers,['code_mode']);}
 finally {await f.app.close();}
});

test('Code Mode advertises eligible capability schemas and accepts unrelated query URLs in source',async()=>{
  let offered;
  const f=await fixture((messages,tools)=>{
    if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};
    offered=tools.find(item=>item.function.name==='code_mode');
    return tool('code_mode',{source:'return "https://example.com/path?value=ordinary";'});
  });
  try {
    const bot=await f.call('/api/bots',{name:'catalog',toolMode:'code'});
    await f.submit('catalog',bot.id);
    const command=await f.wait('catalog');
    assert.equal(command.state,'completed',command.error);
    assert.equal(command.codeExecutions[0].result.value,'https://example.com/path?value=ordinary');
    assert.match(offered.function.description,/clock/);
    assert.match(offered.function.description,/additionalProperties/);
  } finally {await f.app.close();}
});

test('guest capability calls appear in paired command progress',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return await capabilities.clock({});'}));
  try {
    const bot=await f.call('/api/bots',{name:'progress',toolMode:'code'});
    await f.submit('guest-progress',bot.id);
    const command=await f.wait('guest-progress');
    assert.equal(command.state,'completed',command.error);
    assert.ok(command.runtimeEvents.some(event=>event.type==='tool_start' && event.name==='clock'));
    assert.ok(command.runtimeEvents.some(event=>event.type==='tool_result' && event.name==='clock' && event.success));
  } finally {await f.app.close();}
});
