import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startInstance} from './fixtures/controlled-instance.mjs';

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
    const bot=await call('/api/bots',token,{provider:'live',model:'fixture-offline',name:'Bridge',toolMode:'code'});
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
async function fixture(respond,env={},options={}) {
  const seen=[];
  const app=startInstance(options.path ?? ':memory:',0,{...options,env,providerFactory:async profile=>({name:'controlled',capabilities:{toolCalls:true},async complete(messages,tools){seen.push({profile,messages:structuredClone(messages),offers:tools.map(x=>x.function.name)});return respond(messages,tools,profile);}})});
  const port=await app.listen();let token;
  const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();assert.ok(r.ok,`${path} ${r.status}: ${JSON.stringify(v)}`);return v;};
  token=(await call('/api/pair',{code:app.code})).token;
  const until=async fn=>{for(let i=0;i<2000;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('timed out');};
  const submit=async(id,botId,content='test')=>call('/api/commands',{id,botId,content});
  const wait=async id=>until(async()=>{const c=await call('/api/commands/'+id);return c.state!=='pending' && c;});
  return {app,call,seen,until,submit,wait,token};
}

test('all capability inputs are checked before private journaling, including an invalid skill ID',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');
  const directory=mkdtempSync(join(tmpdir(),'staf-capability-input-')),path=join(directory,'db'),parts=['synthetic','skill','credential'],secret=parts.join('-');
  const f=await fixture((messages,_tools,profile)=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:profile.toolMode==='direct'?tool('select_skill',{id:secret,revision:1}):tool('code_mode',{source:`return await capabilities.select_skill({id:${JSON.stringify(parts)}.join('-'),revision:1});`}),{OPENROUTER_API_KEY:secret},{path});let closed=false;
  try{const skill=await f.call('/api/skills',{name:'Privacy fixture',description:'fixture',provenance:'owner',body:'Safe fixture content'});for(const mode of ['direct','hybrid','code']){const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('input-'+mode,bot.id);assert.equal((await f.wait('input-'+mode)).state,'completed');}
    await f.app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS count FROM work_action_invocations WHERE instr(input,?)>0').get(secret).count,0);}finally{db.close();}
  }finally{if(!closed)await f.app.close();rmSync(directory,{recursive:true,force:true});}
});

for(const route of ['direct','guest'])for(const key of ['limit','no longer available','no longer authorized'])test(`${route} schema errors mentioning ${key} permit ordinary Hybrid continuation`,async()=>{
  let calls=0;const f=await fixture(()=>calls++===0?route==='direct'?tool('clock',{[key]:true}):tool('code_mode',{source:`return await capabilities.clock(${JSON.stringify({[key]:true})});`}):calls===2?tool('clock'): {role:'assistant',content:'recovered'});
  try{const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'schema recovery',toolMode:'hybrid'});await f.submit('schema',bot.id);const result=await f.wait('schema');assert.equal(result.state,'completed',result.error);assert.equal(f.seen.length,3);assert.equal(result.workActions.length,1);assert.equal(result.workActions[0].state,'succeeded');if(route==='guest')assert.equal(result.codeExecutions[0].outcome,'error');}finally{await f.app.close();}
});

test('direct, hybrid and code offers are captured and unoffered calls cannot dispatch',async()=>{
  const f=await fixture((messages)=>{const user=messages.findLast(x=>x.role==='user').content;if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return user==='plain'?{role:'assistant',content:'text'}:user==='forged'?tool('clock'):tool(user==='direct'?'clock':'code_mode',user==='direct'?{}:{source:'return (await capabilities.clock({})).value;'});});
  try {
    for(const mode of ['direct','hybrid','code']){
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode});const index=f.seen.length;
      await f.submit(mode,bot.id,mode);const command=await f.wait(mode);assert.equal(command.state,'completed');
      assert.deepEqual(f.seen[index].offers,mode==='direct'?['terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize','clock','file_read','file_write','file_edit','file_search',...memoryOffers,'ask_questions']:mode==='hybrid'?['terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize','clock','file_read','file_write','file_edit','file_search',...memoryOffers,'ask_questions','code_mode']:['code_mode']);
      assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'succeeded');
      assert.equal(command.codeExecutions.length,mode==='direct'?0:1);
      if(mode!=='direct')assert.match(command.codeExecutions[0].result.value,/^\d{4}-/);
    }
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'forged',toolMode:'code'});await f.submit('forged',bot.id,'forged');const forged=await f.wait('forged');assert.equal(forged.workActions.length,0);assert.match(f.seen.at(-1).messages.at(-1).content,/not offered/);
    const plain=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'plain',toolMode:'hybrid'});await f.submit('plain',plain.id,'plain');const text=await f.wait('plain');assert.equal(text.codeExecutions.length,0);assert.equal(text.workActions.length,0);
  } finally {await f.app.close();}
});

test('hybrid script errors expose recovery and retain a completed child before direct continuation',async()=>{
  const f=await fixture(messages=>{const toolResults=messages.filter(x=>x.role==='tool');if(!toolResults.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'script');if(toolResults.length===1)return tool('clock',{},'direct');return {role:'assistant',content:'continued'};});
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'recovery',toolMode:'hybrid'});await f.submit('recovery',bot.id);const c=await f.wait('recovery');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'error');assert.equal(c.codeExecutions[0].actions.length,1);assert.equal(c.workActions.length,2);assert.match(f.seen[1].messages.at(-1).content,/recovery/);assert.equal(c.workActions[0].state,'succeeded');}
  finally {await f.app.close();}
});

test('Code Mode offers skill guidance while rejecting forged individual calls',async()=>{
  let skill;
  const f=await fixture(messages=>messages.at(-1).role==='tool'
    ? {role:'assistant',content:'done'}
    : tool('select_skill',{id:skill.id,revision:1}));
  try {
    skill=await f.call('/api/skills',{name:'Available helper',description:'A fixture skill',provenance:'owner',body:'Use the clock when needed.'});
    for(const mode of ['direct','hybrid','code']) {
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'skill-'+mode,toolMode:mode});
      await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
      const index=f.seen.length;
      await f.submit('skill-'+mode,bot.id);const command=await f.wait('skill-'+mode);
      assert.equal(command.state,'completed',command.error);
      assert.deepEqual(f.seen[index].offers,mode==='direct'?['terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize','clock','file_read','file_write','file_edit','file_search',...memoryOffers,'ask_questions','select_skill']:mode==='hybrid'?['terminal_run','terminal_read','terminal_stop','terminal_write','terminal_eof','terminal_resize','clock','file_read','file_write','file_edit','file_search',...memoryOffers,'ask_questions','code_mode','select_skill']:['code_mode']);
      assert.equal(f.seen[index].messages.some(message=>typeof message.content==='string' && message.content.includes('Available skill catalog')),true);
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
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'error-'+index,toolMode:'hybrid'});
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
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'allocation guard',toolMode:'hybrid'});
    await f.submit('allocation-guard',bot.id);const command=await f.wait('allocation-guard');
    assert.equal(command.state,'completed',command.error);
    assert.equal(command.codeExecutions[0].result.value.rejected,true);
    assert.match(command.codeExecutions[0].result.value.time,/^\d{4}-/);
    assert.equal(command.workActions.length,1);
    assert.equal(command.workActions[0].state,'succeeded');
  } finally {await f.app.close();}
});

test('approval denial and Stop close queued guest calls',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'Denial acknowledged'}:tool('code_mode',{source:'await Promise.all([capabilities.clock({}),capabilities.clock({})]);'}));
  try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});
    for(const disposition of ['deny','stop']){
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:disposition,toolMode:'hybrid'});await f.submit(disposition,bot.id);
      const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId===disposition && x.state==='pending'));
      if(disposition==='deny')await f.call(`/api/approvals/${approval.id}/deny`,{});else await f.call(`/api/commands/${disposition}/stop`,{});
      const c=await f.wait(disposition);assert.equal(c.state,disposition==='stop'?'stopped':'completed');assert.equal(c.workActions.length,1);assert.equal(c.codeExecutions[0].outcome,'closed');
      assert.equal((await f.call('/api/approvals')).filter(x=>x.workId===disposition).length,1);
    }
  } finally {await f.app.close();}
});

test('held accepted work keeps mode across profile edits and exact command retry',async()=>{
  let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
  const f=await fixture(async messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};started();await gate;return tool('code_mode',{source:'return (await capabilities.clock({})).value;'});});
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'held',toolMode:'code'});await f.submit('held',bot.id,'held');await ready;await f.call(`/api/bots/${bot.id}/profile`,{...bot,toolMode:'direct'});assert.equal((await f.submit('held',bot.id,'held')).kind,'existing');release();const c=await f.wait('held');assert.equal(c.state,'completed');assert.equal(c.toolMode,'code');assert.deepEqual(f.seen[0].offers,['code_mode']);assert.equal(c.codeExecutions[0].outcome,'return');}
  finally {release();await f.app.close();}
});

test('both routes use one clock approval and expose the same action journal',async()=>{
  const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const mode=messages.findLast(m=>m.role==='user').content;return mode==='direct'?tool('clock'):tool('code_mode',{source:'return await capabilities.clock({});'});});
  try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});for(const mode of ['direct','code']) {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:mode,toolMode:mode});await f.submit('approval-'+mode,bot.id,mode);const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='approval-'+mode && x.state==='pending'));await f.call(`/api/approvals/${approval.id}/approve`,{});const c=await f.wait('approval-'+mode);assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.equal((await f.call('/api/approvals')).filter(x=>x.workId==='approval-'+mode).length,1);if(mode==='code')assert.deepEqual(c.codeExecutions[0].actions,[c.workActions[0].id]);}}
  finally {await f.app.close();}
});

test('code-only syntax error returns a clear recovery result without offering direct clock',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'The script failed.'}:tool('code_mode',{source:'let = ;'}));
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'syntax',toolMode:'code'});await f.submit('syntax',bot.id);const c=await f.wait('syntax');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'syntax');assert.match(f.seen[1].messages.at(-1).content,/Code Mode remains selected/);assert.deepEqual(f.seen[1].offers,['code_mode']);assert.equal(c.workActions.length,0);}
  finally {await f.app.close();}
});

test('shared action budget closes admission even after a caught allocation rejection',async()=>{
  const f=await fixture(()=>tool('code_mode',{source:'try {new ArrayBuffer(64*1024*1024);} catch {} for (let i=0;i<33;i++) await capabilities.clock({}); return "done";'}));
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'budget',toolMode:'hybrid'});await f.submit('budget',bot.id);const c=await f.wait('budget');assert.equal(c.state,'failed');assert.equal(c.codeExecutions[0].outcome,'closed');assert.equal(c.workActions.length,32);assert.ok(c.workActions.every(x=>x.state==='succeeded'));assert.match(c.error,/limit/i);}
  finally {await f.app.close();}
});

test('a completed guest action can be resumed through the direct recovery envelope',async()=>{
  const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'script');if(results.length===1){const recovery=JSON.parse(results[0].content);return tool('clock',{_staf:{kind:'resume',actionId:recovery.recovery.actions[0].id}},'resume');}return {role:'assistant',content:'done'};});
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'resume',toolMode:'hybrid'});await f.submit('resume',bot.id);const c=await f.wait('resume');assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.match(f.seen[2].messages.at(-1).content,/^\d{4}-/);}
  finally {await f.app.close();}
});

test('live clock revocation during a guest approval prevents queued work',async()=>{
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'unexpected'}:tool('code_mode',{source:'await Promise.all([capabilities.clock({}),capabilities.clock({})]);'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'revoked',toolMode:'hybrid'});await f.submit('revoked',bot.id);const request=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='revoked' && x.state==='pending'));await f.call('/api/approval-settings/instance',{mode:'never-ask',clockEnabled:false});await f.call(`/api/approvals/${request.id}/approve`,{});const c=await f.wait('revoked');assert.equal(c.state,'failed');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'cancelled');assert.equal(c.codeExecutions[0].outcome,'closed');}
 finally {await f.app.close();}
});

test('source that contains configured credentials is rejected; selected guest output is redacted',async()=>{
 const secret='synthetic-secret-unique';
 const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const input=messages.findLast(x=>x.role==='user').content;return tool('code_mode',{source:input==='source' ? `return "${secret}";` : 'return ["synthetic", "secret", "unique"].join("-");'});},{OPENROUTER_API_KEY:secret});
 try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'safe',toolMode:'code'});await f.submit('secret-source',bot.id,'source');const rejected=await f.wait('secret-source');assert.equal(rejected.codeExecutions.length,0);assert.ok(!JSON.stringify(rejected).includes(secret));await f.submit('secret-result',bot.id,'result');const c=await f.wait('secret-result');assert.equal(c.codeExecutions[0].outcome,'return');assert.ok(!JSON.stringify(c).includes(secret));assert.match(JSON.stringify(c.codeExecutions),/REDACTED/);}
 finally {await f.app.close();}
});

test('paired CLI status inspects the same scripted execution',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return (await capabilities.clock({})).value;'}));
 // Use an asynchronous child so the instance can serve its request.
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);const dir=mkdtempSync(join(tmpdir(),'staf-bridge-cli-'));
 try {const pair=await f.call('/api/pair',{code:f.app.issueCode()});const credential=join(dir,'credential.json');writeFileSync(credential,JSON.stringify(pair));const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'cli',toolMode:'code'});await f.submit('cli-code',bot.id);const c=await f.wait('cli-code');const address=f.app.server.address();const {stdout}=await run(process.execPath,['dist/cli.js','instance','status',`http://127.0.0.1:${address.port}`,credential,'cli-code']);const inspected=JSON.parse(stdout);assert.deepEqual(inspected.codeExecutions,c.codeExecutions);assert.equal(inspected.workActions[0].id,c.workActions[0].id);}
 finally {await f.app.close();rmSync(dir,{recursive:true,force:true});}
});

test('source, selected output, and child linkage are visible while authorization is pending',async()=>{
 const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'await staf.emit("before clock"); return await capabilities.clock({});'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'inspect',toolMode:'code'});await f.submit('inspect',bot.id);const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='inspect' && x.state==='pending'));const c=await f.call('/api/commands/inspect');assert.equal(c.codeExecutions[0].outcome,'running');assert.match(c.codeExecutions[0].source,/staf.emit/);assert.deepEqual(c.codeExecutions[0].result.emitted,['before clock']);assert.equal(c.codeExecutions[0].actions.length,1);assert.equal(c.workActions[0].state,'prepared');await f.call(`/api/approvals/${approval.id}/approve`,{});assert.equal((await f.wait('inspect')).state,'completed');}
 finally {await f.app.close();}
});

test('interrupted guest execution is retained across a real instance restart without replay',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=mkdtempSync(join(tmpdir(),'staf-bridge-restart-')),path=join(dir,'instance.sqlite');let requests=0;
 const factory=async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(){requests++;return tool('code_mode',{source:'await staf.emit("retained"); while (true) {}'});}});
 let app=startInstance(path,0,{env:{},providerFactory:factory}),port=await app.listen(),token;
 const call=async(route,body)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(r.ok);return r.json();};
 try {token=(await call('/api/pair',{code:app.code})).token;const bot=await call('/api/bots',{provider:'live',model:'fixture-offline',name:'restart',toolMode:'code'});await call('/api/commands',{id:'restart',botId:bot.id,content:'run'});let running;for(let i=0;i<400;i++){running=await call('/api/commands/restart');if(running.codeExecutions[0]?.result?.emitted?.includes('retained'))break;await new Promise(r=>setTimeout(r,10));}assert.deepEqual(running.codeExecutions[0].result.emitted,['retained']);await app.close();app=startInstance(path,0,{env:{},providerFactory:factory});port=await app.listen();const record=await call('/api/commands/restart');assert.equal(record.state,'interrupted');assert.ok(['closed','interrupted'].includes(record.codeExecutions[0].outcome));assert.equal(record.codeExecutions[0].result.emitted[0],'retained');assert.equal(requests,1);}
 finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('guest CPU limit interrupts a pending approval before any queued action starts',async()=>{
 const f=await fixture(()=>tool('code_mode',{source:'capabilities.clock({}); while (true) {}'}));
 try {await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'limit',toolMode:'hybrid'});await f.submit('guest-limit',bot.id);await f.until(async()=>(await f.call('/api/approvals')).some(x=>x.workId==='guest-limit' && x.state==='pending'));const c=await f.wait('guest-limit');assert.equal(c.state,'failed');assert.match(c.error,/Guest execution limit/);assert.equal(c.workActions[0].state,'cancelled');assert.equal(c.codeExecutions[0].outcome,'closed');assert.equal((await f.call('/api/approvals')).find(x=>x.workId==='guest-limit').state,'interrupted');}
 finally {await f.app.close();}
});

test('hybrid syntax error can continue with direct clock',async()=>{
 const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'let = ;'},'syntax');if(results.length===1)return tool('clock',{},'direct');return {role:'assistant',content:'continued'};});
 try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'syntax-hybrid',toolMode:'hybrid'});await f.submit('syntax-hybrid',bot.id);const c=await f.wait('syntax-hybrid');assert.equal(c.state,'completed');assert.equal(c.codeExecutions[0].outcome,'syntax');assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');}
 finally {await f.app.close();}
});

test('code-only recovery can resume a completed child in a new guest',async()=>{
 const f=await fixture(messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.clock({}); throw Error("oops");'},'first');if(results.length===1){const id=JSON.parse(results[0].content).recovery.actions[0].id;return tool('code_mode',{source:`return await capabilities.clock({}, {kind:'resume',actionId:${JSON.stringify(id)}});`},'second');}return {role:'assistant',content:'done'};});
 try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'guest-resume',toolMode:'code'});await f.submit('guest-resume',bot.id);const c=await f.wait('guest-resume');assert.equal(c.state,'completed');assert.equal(c.workActions.length,1);assert.equal(c.codeExecutions.length,2);assert.deepEqual(c.codeExecutions[0].actions,c.codeExecutions[1].actions);assert.deepEqual(f.seen[1].offers,['code_mode']);}
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
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'catalog',toolMode:'code'});
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
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'progress',toolMode:'code'});
    await f.submit('guest-progress',bot.id);
    const command=await f.wait('guest-progress');
    assert.equal(command.state,'completed',command.error);
    assert.ok(command.runtimeEvents.some(event=>event.type==='tool_start' && event.name==='clock'));
    assert.ok(command.runtimeEvents.some(event=>event.type==='tool_result' && event.name==='clock' && event.success));
  } finally {await f.app.close();}
});

test('configured search uses one paired action in every tool mode',async()=>{
  const {createServer}=await import('node:http');const requests=[];
  const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Fixture',url:'https://example.test/result',content:'local result'}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const mode=messages.findLast(x=>x.role==='user').content;return mode==='direct'?tool('search_web',{query:'exact local query'}):tool('code_mode',{source:'return await capabilities.search_web({query:"exact local query"});'});});
  try {
    const config=await f.call('/api/search-config');await f.call('/api/search-config',{revision:config.revision,origin:`http://127.0.0.1:${server.address().port}`});await f.call('/api/search-permissions/instance',{enabled:true});
    for(const mode of ['direct','hybrid','code']){
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'search-'+mode,toolMode:mode});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});
      await f.submit('search-'+mode,bot.id,mode);
      const pending=await f.until(async()=>{const command=await f.call('/api/commands/search-'+mode);const approvals=await f.call('/api/search-approvals');return approvals.find(x=>x.work.id==='search-'+mode) || (command.state!=='pending' && {unexpected:command});});
      assert.ok(!pending.unexpected,`search did not request approval: ${JSON.stringify(pending.unexpected)}`);
      assert.equal(requests.length,['direct','hybrid','code'].indexOf(mode));assert.equal(pending.query,'exact local query');
      await f.call(`/api/search-approvals/${pending.id}/approve`,{});const command=await f.wait('search-'+mode);
      assert.equal(command.state,'completed',command.error);assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'succeeded');
      assert.deepEqual([...new URLSearchParams(requests.at(-1))],[['q','exact local query'],['format','json']]);
      if(mode!=='direct')assert.deepEqual(command.codeExecutions[0].actions,[command.workActions[0].id]);
    }
  } finally {await f.app.close();await new Promise(resolve=>server.close(resolve));}
});

test('search recovery resumes the captured result without redispatch and rejects a changed backend',async()=>{
  const {createServer}=await import('node:http');let requests=0;
  const server=createServer(async(req,res)=>{for await(const _ of req){}requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Fixture',url:'https://example.test/result',content:'result'}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let f,change=false;
  f=await fixture(async messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.search_web({query:"recover query"}); throw Error("recover");'},'script');if(results.length===1){if(change){const config=await f.call('/api/search-config');await f.call('/api/search-config',{revision:config.revision,origin:'http://127.0.0.1:9999'});}const id=JSON.parse(results[0].content).recovery.actions[0].id;return tool('search_web',{query:'recover query',_staf:{kind:'resume',actionId:id}},'resume');}return {role:'assistant',content:'done'};});
  try {let config=await f.call('/api/search-config');config=await f.call('/api/search-config',{revision:config.revision,origin:`http://127.0.0.1:${server.address().port}`});await f.call('/api/search-permissions/instance',{enabled:true});
    for(const changed of [false,true]) {change=changed;const id=changed?'changed-resume':'resume-search';const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:id,toolMode:'hybrid'});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});await f.submit(id,bot.id);const approval=await f.until(async()=>(await f.call('/api/search-approvals')).find(x=>x.work.id===id));await f.call(`/api/search-approvals/${approval.id}/approve`,{});const command=await f.wait(id);assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'succeeded');assert.equal(requests,changed?2:1);if(!changed)assert.match(f.seen.at(-1).messages.at(-1).content,/Untrusted search results/);else assert.doesNotMatch(f.seen.at(-1).messages.at(-1).content,/local result|Fixture/);}
  }finally{await f.app.close();await new Promise(resolve=>server.close(resolve));}
});

test('stopping a scripted search during approval never contacts the backend',async()=>{
  const {createServer}=await import('node:http');let requests=0;const server=createServer((_req,res)=>{requests++;res.end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const f=await fixture(()=>tool('code_mode',{source:'return await capabilities.search_web({query:"stop query"});'}));
  try {const config=await f.call('/api/search-config');await f.call('/api/search-config',{revision:config.revision,origin:`http://127.0.0.1:${server.address().port}`});await f.call('/api/search-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'stop-search',toolMode:'code'});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});await f.submit('stop-search',bot.id);await f.until(async()=>(await f.call('/api/search-approvals')).find(x=>x.work.id==='stop-search'));await f.call('/api/commands/stop-search/stop',{});const command=await f.wait('stop-search');assert.equal(command.state,'stopped');assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'cancelled');assert.equal(requests,0);}
  finally{await f.app.close();await new Promise(resolve=>server.close(resolve));}
});

test('scripted search reuses an exact grant and revocation aborts its in-flight request',async()=>{
  const {createServer}=await import('node:http');let requests=0,entered;const started=new Promise(resolve=>entered=resolve);
  const server=createServer(async(req,res)=>{for await(const _ of req){}requests++;if(requests===2){entered();return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'Fixture',url:'https://example.test/result',content:'result'}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return await capabilities.search_web({query:"grant query"});'}),{}, {enableReusableApprovals:true});
  try {const config=await f.call('/api/search-config');await f.call('/api/search-config',{revision:config.revision,origin:`http://127.0.0.1:${server.address().port}`});await f.call('/api/search-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'grant-code',toolMode:'code'});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});
    await f.submit('grant-first',bot.id);const approval=await f.until(async()=>(await f.call('/api/search-approvals')).find(x=>x.work.id==='grant-first'));await f.call(`/api/search-approvals/${approval.id}/approve`,{grant:{scope:'bot',lifetime:'remembered',retentionAcknowledged:true}});assert.equal((await f.wait('grant-first')).workActions[0].state,'succeeded');const grant=(await f.call('/api/approval-grants'))[0];
    await f.submit('grant-second',bot.id);await started;assert.equal((await f.call('/api/search-approvals')).length,0);await f.call(`/api/approval-grants/${grant.id}/revoke`,{revision:grant.revision});const command=await f.wait('grant-second');assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'uncertain');assert.equal(requests,2);
  } finally {await f.app.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('completed search binding survives instance restart without redispatch',async()=>{
  const {createServer}=await import('node:http'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-search-restart-')),path=join(dir,'instance.sqlite');let requests=0;
  const server=createServer(async(req,res)=>{for await(const _ of req){}requests++;res.writeHead(200,{'content-type':'application/json'});res.end('{"results":[]}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return await capabilities.search_web({query:"restart query"});'}),{}, {path});let restarted,closed=false;
  try {const config=await f.call('/api/search-config'),origin=`http://127.0.0.1:${server.address().port}`;const saved=await f.call('/api/search-config',{revision:config.revision,origin});await f.call('/api/search-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'restart-search',toolMode:'code'});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});await f.submit('restart-search',bot.id);const approval=await f.until(async()=>(await f.call('/api/search-approvals')).find(x=>x.work.id==='restart-search'));await f.call(`/api/search-approvals/${approval.id}/approve`,{});const before=await f.wait('restart-search');await f.app.close();closed=true;
    const db=new DatabaseSync(path,{readOnly:true});const row=db.prepare('SELECT action_id,boundary FROM search_action_bindings').get();db.close();assert.equal(row.action_id,before.workActions[0].id);assert.deepEqual(JSON.parse(row.boundary),{kind:'search',query:'restart query',origin,revision:saved.revision,results:10,timeoutMs:10000});
    restarted=startInstance(path,0,{env:{}});const port=await restarted.listen();const response=await fetch(`http://127.0.0.1:${port}/api/commands/restart-search`,{headers:{Authorization:`Bearer ${f.token}`}});assert.ok(response.ok);const after=await response.json();assert.equal(after.workActions[0].id,before.workActions[0].id);assert.equal(after.workActions[0].state,'succeeded');assert.equal(requests,1);
  } finally {if(!closed)await f.app.close();if(restarted)await restarted.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});

test('denied direct search closes admission for other queued tools',async()=>{
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'search',type:'function',function:{name:'search_web',arguments:JSON.stringify({query:'deny query'})}},{id:'clock',type:'function',function:{name:'clock',arguments:'{}'}}]});
  try {const config=await f.call('/api/search-config');await f.call('/api/search-config',{revision:config.revision,origin:'http://127.0.0.1:8888'});await f.call('/api/search-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'deny-queue',toolMode:'direct'});await f.call(`/api/search-permissions/bot:${bot.id}`,{enabled:true});await f.submit('deny-queue',bot.id);const pending=await f.until(async()=>(await f.call('/api/search-approvals')).find(x=>x.work.id==='deny-queue'));await f.call(`/api/search-approvals/${pending.id}/deny`,{});const command=await f.wait('deny-queue');assert.equal(command.workActions.length,1);assert.equal(command.workActions[0].state,'cancelled');assert.ok(command.runtimeEvents.some(x=>x.type==='tool_result' && x.name==='clock' && !x.success));}
  finally {await f.app.close();}
});

test('scratch commands use one registered action in every mode with the controlled backend',async()=>{
 const executions=[];
 const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const mode=messages.findLast(x=>x.role==='user').content;return mode==='direct'?tool('run_scratch_shell',{command:'printf safe'}):tool('code_mode',{source:'return await capabilities.run_scratch_shell({command:"printf safe"});'});},{},{shellExecutor:async request=>{executions.push(request);return {output:'controlled output',exitCode:0,outputComplete:true,stopped:'completed'};}});
 try {
  const config=await f.call('/api/shell-config');await f.call('/api/shell-config',{revision:config.revision,dockerBinary:'/usr/bin/docker',dockerSocket:'/tmp/staf-controlled.sock',imageId:'sha256:'+'a'.repeat(64)});await f.call('/api/shell-permissions/instance',{enabled:true});
  for(const mode of ['direct','hybrid','code']){
   const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'scratch-'+mode,toolMode:mode});await f.call('/api/shell-permissions/bot:'+bot.id,{enabled:true});await f.submit('scratch-'+mode,bot.id,mode);
   const pending=await f.until(async()=>(await f.call('/api/shell-approvals')).find(x=>x.work.id==='scratch-'+mode));assert.equal(pending.command,'printf safe');
   await f.call(`/api/shell-approvals/${pending.id}/approve`,{});const c=await f.wait('scratch-'+mode);assert.equal(c.state,'completed',c.error);assert.equal(c.workActions.length,1);assert.equal(c.shellActions.length,1);assert.equal(c.workActions[0].id,pending.id);assert.equal(c.workActions[0].state,'succeeded');
   if(mode!=='direct')assert.deepEqual(c.codeExecutions[0].actions,[pending.id]);
  }
  assert.equal(executions.length,3);assert.ok(executions.every(x=>x.command==='printf safe' && x.workspace.kind==='scratch'));
 }finally{await f.app.close();}
});

test('web redirects authorize and record each hop in all tool modes',async()=>{
 const requests=[];const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const mode=messages.findLast(x=>x.role==='user').content;return mode==='direct'?tool('read_web',{url:'https://one.example/start'}):tool('code_mode',{source:'return await capabilities.read_web({url:"https://one.example/start"});'});},{},{webDependencies:{resolve:async()=>[{address:'8.8.8.8',family:4}],request:async url=>{requests.push(url.href);return url.hostname==='one.example'?{status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}}:{status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('controlled page');})(),close(){}};}}});
 try {await f.call('/api/web-permissions/instance',{enabled:true});for(const mode of ['direct','hybrid','code']) {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'web-'+mode,toolMode:mode});await f.call('/api/web-permissions/bot:'+bot.id,{enabled:true});await f.submit('web-'+mode,bot.id,mode);for(const url of ['https://one.example/start','https://two.example/end']){const p=await f.until(async()=>(await f.call('/api/web-approvals')).find(x=>x.work.id==='web-'+mode));assert.equal(p.url,url);await f.call(`/api/web-approvals/${p.id}/approve`,{});}const c=await f.wait('web-'+mode);assert.equal(c.state,'completed',c.error);assert.equal(c.webActions.length,2);assert.ok(c.webActions.every(x=>x.state==='succeeded'));}assert.equal(requests.length,6);
 }finally{await f.app.close();}
});

test('revoking an earlier redirect grant prevents later hop and result release',async()=>{
 let requests=0;const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return await capabilities.read_web({url:"https://one.example/start"});'}),{},{enableReusableApprovals:true,webDependencies:{resolve:async()=>[{address:'8.8.8.8',family:4}],request:async url=>{requests++;if(requests===2)return {status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}};return {status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('private fixture result');})(),close(){}};}}});
 try{await f.call('/api/web-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'web-grant',toolMode:'code'});await f.call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});await f.submit('web-warm',bot.id);const first=await f.until(async()=>(await f.call('/api/web-approvals'))[0]);await f.call(`/api/web-approvals/${first.id}/approve`,{grant:{scope:'bot',lifetime:'remembered',retentionAcknowledged:true}});assert.equal((await f.wait('web-warm')).state,'completed');const grant=(await f.call('/api/approval-grants'))[0];await f.submit('web-revoke',bot.id);const hop=await f.until(async()=>(await f.call('/api/web-approvals')).find(x=>x.work.id==='web-revoke'));assert.equal(hop.url,'https://two.example/end');const pending=await f.call('/api/commands/web-revoke');assert.equal(pending.workActions[1].parentActionId,pending.workActions[0].id);await f.call(`/api/approval-grants/${grant.id}/revoke`,{revision:grant.revision});const command=await f.wait('web-revoke');assert.equal(requests,2);assert.equal(command.webActions.length,2);assert.deepEqual(command.webActions.map(x=>x.state),['succeeded','cancelled']);assert.doesNotMatch(JSON.stringify(command.codeExecutions),/private fixture result/);
 }finally{await f.app.close();}
});

test('scratch recovery releases a completed result only while the captured backend remains current',async()=>{
 let f,change=false,runs=0;
 f=await fixture(async messages=>{const results=messages.filter(x=>x.role==='tool');if(!results.length)return tool('code_mode',{source:'await capabilities.run_scratch_shell({command:"printf recover"}); throw Error("recover");'},'script');if(results.length===1){if(change){const config=await f.call('/api/shell-config');await f.call('/api/shell-config',{...config,dockerSocket:'/tmp/staf-changed.sock'});}const id=JSON.parse(results[0].content).recovery.actions[0].id;return tool('run_scratch_shell',{command:'printf recover',_staf:{kind:'resume',actionId:id}},'resume');}return {role:'assistant',content:'done'};},{},{shellExecutor:async()=>{runs++;return {output:'scratch recovery fixture',exitCode:0,outputComplete:true,stopped:'completed'};}});
 try{const config=await f.call('/api/shell-config');await f.call('/api/shell-config',{revision:config.revision,dockerBinary:'/usr/bin/docker',dockerSocket:'/tmp/staf-recover.sock',imageId:'sha256:'+'a'.repeat(64)});await f.call('/api/shell-permissions/instance',{enabled:true});for(const changed of [false,true]){change=changed;const id=changed?'scratch-changed':'scratch-resume',bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:id,toolMode:'hybrid'});await f.call(`/api/shell-permissions/bot:${bot.id}`,{enabled:true});await f.submit(id,bot.id);const p=await f.until(async()=>(await f.call('/api/shell-approvals')).find(x=>x.work.id===id));await f.call(`/api/shell-approvals/${p.id}/approve`,{});const c=await f.wait(id);assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'succeeded');assert.equal(runs,changed?2:1);if(!changed)assert.match(f.seen.at(-1).messages.at(-1).content,/scratch recovery fixture/);else assert.doesNotMatch(f.seen.at(-1).messages.at(-1).content,/scratch recovery fixture/);}
 }finally{await f.app.close();}
});

test('web and scratch denial or Stop fences queued tools in direct and guest calls',async()=>{
 for(const kind of ['web','shell'])for(const mode of ['direct','hybrid','code'])for(const disposition of ['deny','stop']){
  let effects=0;const name=kind==='web'?'read_web':'run_scratch_shell',input=kind==='web'?{url:'https://example.com/fence'}:{command:'printf fence'};
  const f=await fixture(messages=>{if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};if(mode==='direct')return {role:'assistant',content:null,tool_calls:[{id:'first',type:'function',function:{name,arguments:JSON.stringify(input)}},{id:'second',type:'function',function:{name:'clock',arguments:'{}'}}]};return tool('code_mode',{source:`return await Promise.all([capabilities.${name}(${JSON.stringify(input)}),capabilities.clock({})]);`});},{},{webDependencies:{resolve:async()=>{effects++;return [{address:'8.8.8.8',family:4}];},request:async()=>{throw Error('unexpected');}},shellExecutor:async()=>{effects++;throw Error('unexpected');}});
  try{const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'fence-'+kind+mode+disposition,toolMode:mode});if(kind==='shell'){const c=await f.call('/api/shell-config');await f.call('/api/shell-config',{revision:c.revision,dockerBinary:'/usr/bin/docker',dockerSocket:'/tmp/fence.sock',imageId:'sha256:'+'a'.repeat(64)});}await f.call(`/api/${kind}-permissions/instance`,{enabled:true});await f.call(`/api/${kind}-permissions/bot:${bot.id}`,{enabled:true});await f.submit('fence',bot.id);const p=await f.until(async()=>(await f.call(`/api/${kind}-approvals`))[0]);if(disposition==='deny')await f.call(`/api/${kind}-approvals/${p.id}/deny`,{});else await f.call('/api/commands/fence/stop',{});const c=await f.wait('fence');assert.equal(effects,0);assert.equal(c.workActions.length,1);assert.equal(c.workActions[0].state,'cancelled');if(disposition==='stop')assert.equal(c.state,'stopped');
  }finally{await f.app.close();}
 }
});

test('web recovery rechecks the grant for every completed redirect before releasing saved text',async()=>{
 let f,requests=0;
 f=await fixture(async messages=>{const index=messages.findLastIndex(x=>x.role==='user'),user=messages[index].content,results=messages.slice(index+1).filter(x=>x.role==='tool');if(user==='warm')return results.length?{role:'assistant',content:'done'}:tool('read_web',{url:'https://one.example/start'});if(!results.length)return tool('code_mode',{source:'await capabilities.read_web({url:"https://one.example/start"}); throw Error("recover");'},'script');if(results.length===1){const grants=await f.call('/api/approval-grants'),second=grants.find(x=>x.boundary.url==='https://two.example/end');await f.call(`/api/approval-grants/${second.id}/revoke`,{revision:second.revision});const id=JSON.parse(results[0].content).recovery.actions.find(x=>x.summary==='Read public web page').id;return tool('read_web',{url:'https://one.example/start',_staf:{kind:'resume',actionId:id}},'resume');}return {role:'assistant',content:'done'};},{},{enableReusableApprovals:true,webDependencies:{resolve:async()=>[{address:'8.8.8.8',family:4}],request:async url=>{requests++;return url.hostname==='one.example'?{status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}}:{status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('private resumed page');})(),close(){}};}}});
 try{await f.call('/api/web-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'web-recover',toolMode:'hybrid'});await f.call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});await f.submit('web-warm-recovery',bot.id,'warm');for(let i=0;i<2;i++){const p=await f.until(async()=>(await f.call('/api/web-approvals')).find(x=>x.work.id==='web-warm-recovery'));await f.call(`/api/web-approvals/${p.id}/approve`,{grant:{scope:'bot',lifetime:'remembered',retentionAcknowledged:true}});}assert.equal((await f.wait('web-warm-recovery')).state,'completed');await f.submit('web-resume-revoked',bot.id,'resume');const c=await f.wait('web-resume-revoked');assert.equal(requests,4);assert.equal(c.webActions.length,2);assert.ok(c.webActions.every(x=>x.state==='succeeded'));assert.doesNotMatch(f.seen.at(-1).messages.at(-1).content,/private resumed page/);
 }finally{await f.app.close();}
});

test('a denied redirect retains the completed first hop and prevents the next request',async()=>{
 let requests=0;const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:'return await capabilities.read_web({url:"https://one.example/start"});'}),{},{webDependencies:{resolve:async()=>[{address:'8.8.8.8',family:4}],request:async()=>{requests++;return {status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}};}}});
 try{await f.call('/api/web-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'denied-hop',toolMode:'code'});await f.call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});await f.submit('denied-hop',bot.id);const first=await f.until(async()=>(await f.call('/api/web-approvals'))[0]);await f.call(`/api/web-approvals/${first.id}/approve`,{});const second=await f.until(async()=>(await f.call('/api/web-approvals'))[0]);await f.call(`/api/web-approvals/${second.id}/deny`,{});const c=await f.wait('denied-hop');assert.equal(requests,1);assert.deepEqual(c.webActions.map(x=>x.state),['succeeded','cancelled']);assert.equal(c.workActions[1].parentActionId,first.id);
 }finally{await f.app.close();}
});

test('paired Code Mode loads an available skill through a registered guest action', async()=>{
  let skill;
  const f=await fixture(messages=>messages.at(-1).role==='tool' ? {role:'assistant',content:'done'} : tool('code_mode',{source:`return (await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1})).value;`}));
  try {
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'guest skill',toolMode:'code'});
    skill=await f.call('/api/skills',{name:'Fixture',description:'A skill',provenance:'owner',body:'A distinctive skill body'});
    await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
    await f.submit('guest-skill',bot.id);const command=await f.wait('guest-skill');
    assert.equal(command.state,'completed',command.error);
    assert.match(JSON.stringify(f.seen[0].messages),/Available skill catalog/);
    assert.equal(command.workActions.length,1);
    assert.equal(command.skillActivity.length,1);
    assert.match(JSON.stringify(f.seen[1].messages),/A distinctive skill body/);
    assert.match(JSON.stringify(f.seen[1].messages),/Untrusted skill data/);
  } finally {await f.app.close();}
});

test('three modes retain selection evidence and scrub loaded bodies from later provider replay',async()=>{
  let skill;
  const f=await fixture((messages,_tools,profile)=>{
    const user=messages.findLast(m=>m.role==='user').content;
    if(user.startsWith('second'))return {role:'assistant',content:'done again'};
    if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};
    return profile.toolMode==='direct' ? tool('select_skill',{id:skill.id,revision:1}) : tool('code_mode',{source:`const s=await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1}); const c=await capabilities.clock({}); return [s.value,c.value];`});
  });
  try {
    skill=await f.call('/api/skills',{name:'Replay skill',description:'replay',provenance:'owner',body:'REPLAY_SKILL_BODY'});
    for(const mode of ['direct','hybrid','code']) {
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'replay '+mode,toolMode:mode});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
      let index=f.seen.length;await f.submit('first-'+mode,bot.id,'first');const first=await f.wait('first-'+mode);
      assert.equal(first.state,'completed',first.error);assert.equal(first.skillActivity.length,1);assert.equal(first.skillActivity[0].sourceDigest,skill.digest);
      assert.match(JSON.stringify(f.seen[index+1].messages),/REPLAY_SKILL_BODY/);assert.equal(first.workActions.length,mode==='direct'?1:2);
      index=f.seen.length;await f.submit('second-'+mode,bot.id,'second');const second=await f.wait('second-'+mode);assert.equal(second.state,'completed');
      assert.doesNotMatch(JSON.stringify(f.seen[index].messages),/REPLAY_SKILL_BODY/);assert.match(JSON.stringify(f.seen[index].messages),/Previously loaded skill content/);
    }
  } finally {await f.app.close();}
});

test('guest skill revocation during a later approval fences the queued child',async()=>{
  let skill;const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:`await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1}); await capabilities.clock({}); return await capabilities.file_write({path:'must-not-exist',content:'no'});`}));
  try {
    const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'revoke guest',toolMode:'code'});skill=await f.call('/api/skills',{name:'Revoke',description:'test',provenance:'owner',body:'body'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
    await f.call('/api/approval-settings/instance',{mode:'ask-every-time',clockEnabled:true});await f.submit('revoke-guest',bot.id);
    const approval=await f.until(async()=>(await f.call('/api/approvals')).find(x=>x.workId==='revoke-guest' && x.state==='pending'));
    await f.call(`/api/skills/${skill.id}/enabled`,{enabled:false});await f.call(`/api/approvals/${approval.id}/approve`,{});
    const command=await f.wait('revoke-guest');assert.equal(command.state,'failed');assert.equal(command.skillActivity.length,1);assert.equal(command.workActions.length,2);assert.equal(command.workActions[1].state,'cancelled');
  } finally {await f.app.close();}
});

test('guest selection rejects stale and out-of-catalog IDs without load evidence',async()=>{
  let skill,other;
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:`const a=await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:99}).catch(e=>String(e)); const b=await capabilities.select_skill({id:${JSON.stringify(other.id)},revision:1}).catch(e=>String(e)); return [a,b];`}));
  try {const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'bounded',toolMode:'code'});skill=await f.call('/api/skills',{name:'Allowed',description:'allowed',provenance:'owner',body:'allowed body'});other=await f.call('/api/skills',{name:'Other',description:'other',provenance:'owner',body:'OTHER_SECRET_BODY'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('bounded',bot.id);const c=await f.wait('bounded');assert.equal(c.state,'completed',c.error);assert.equal(c.skillActivity.length,0);assert.ok(c.workActions.every(action=>action.state==='failed'));assert.doesNotMatch(JSON.stringify(f.seen),/OTHER_SECRET_BODY|allowed body/);}finally{await f.app.close();}
});

test('completed guest skill selection resumes without a second load',async()=>{
  let skill,actionId;
  const f=await fixture(messages=>{const results=messages.filter(m=>m.role==='tool');if(!results.length)return tool('code_mode',{source:`await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1}); throw Error('ordinary');`},'first');if(results.length===1){const result=JSON.parse(results[0].content);actionId=result.recovery.actions[0].id;return tool('select_skill',{id:skill.id,revision:1,_staf:{kind:'resume',actionId}},'resume');}return {role:'assistant',content:'done'};});
  try{const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'recovery skill',toolMode:'hybrid'});skill=await f.call('/api/skills',{name:'Recover',description:'test',provenance:'owner',body:'RECOVER_BODY'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('recover-skill',bot.id);const c=await f.wait('recover-skill');assert.equal(c.state,'completed',c.error);assert.equal(c.workActions.length,1);assert.equal(c.skillActivity.length,1);assert.equal(c.workActions[0].id,actionId);assert.match(f.seen[2].messages.at(-1).content,/RECOVER_BODY/);}finally{await f.app.close();}
});

test('maximum-size skill can be selected directly and inspected in a guest',async()=>{
  let skill;const body='x'.repeat(256*1024);
  const f=await fixture((messages,_tools,profile)=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:profile.toolMode==='direct'?tool('select_skill',{id:skill.id,revision:1}):tool('code_mode',{source:`const s=await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1}); return JSON.parse(s.value.split('\\n')[1]).body.length;`}));
  try{skill=await f.call('/api/skills',{name:'Large',description:'test',provenance:'owner',body});for(const mode of ['direct','code']){const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'large '+mode,toolMode:mode});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('large-'+mode,bot.id);const c=await f.wait('large-'+mode);assert.equal(c.state,'completed',c.error);assert.equal(c.skillActivity.length,1);assert.equal(c.workActions[0].state,'succeeded');if(mode==='code')assert.equal(c.codeExecutions[0].result.value,body.length);}}finally{await f.app.close();}
});

test('skill replay scrub preserves native reasoning and call boundaries',async()=>{
  const {responsesInput}=await import('../dist/codex-direct.js');let skill;
  const f=await fixture(messages=>{const user=messages.findLast(m=>m.role==='user').content;if(user.startsWith('second') || messages.at(-1).role==='tool')return {role:'assistant',content:'done'};const response=tool('code_mode',{source:`return (await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1})).value;`},'native-call');response.responseReplay={provider:'codex-direct',model:'fixture-model',items:[{type:'reasoning',encrypted_content:'opaque+/=exact'},{type:'function_call',call_id:'native-call',name:'code_mode',arguments:response.tool_calls[0].function.arguments}]};return response;});
  try{const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'native replay',toolMode:'code'});skill=await f.call('/api/skills',{name:'Native',description:'test',provenance:'owner',body:'NATIVE_SKILL_BODY'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('native-first',bot.id,'first');assert.equal((await f.wait('native-first')).state,'completed');const index=f.seen.length;await f.submit('native-second',bot.id,'second');assert.equal((await f.wait('native-second')).state,'completed');const native=responsesInput(f.seen[index].messages,'fixture-model');assert.equal(native.find(x=>x.type==='reasoning').encrypted_content,'opaque+/=exact');assert.equal(native.find(x=>x.type==='function_call').call_id,'native-call');const output=native.find(x=>x.type==='function_call_output');assert.equal(output.call_id,'native-call');assert.match(output.output,/Previously loaded skill content/);assert.doesNotMatch(JSON.stringify(native),/NATIVE_SKILL_BODY/);}finally{await f.app.close();}
});

test('replay scrubbing leaves persisted skill history inspectable',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {DatabaseSync}=await import('node:sqlite');const dir=mkdtempSync(join(tmpdir(),'staf-skill-replay-'));const path=join(dir,'instance.sqlite');let skill;
  const f=await fixture(messages=>{const user=messages.findLast(m=>m.role==='user').content;if(user.startsWith('second')||messages.at(-1).role==='tool')return {role:'assistant',content:'done'};return tool('code_mode',{source:`return (await capabilities.select_skill({id:${JSON.stringify(skill.id)},revision:1})).value;`});},{},{path});let closed=false;
  try{const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'history',toolMode:'code'});skill=await f.call('/api/skills',{name:'History',description:'test',provenance:'owner',body:'PERSISTED_SKILL_BODY'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});await f.submit('history-first',bot.id,'first');assert.equal((await f.wait('history-first')).state,'completed');await f.submit('history-second',bot.id,'second');assert.equal((await f.wait('history-second')).state,'completed');await f.app.close();closed=true;const db=new DatabaseSync(path,{readOnly:true});try{const saved=db.prepare('SELECT session FROM sessions WHERE bot_id=?').get(bot.id).session;assert.match(saved,/PERSISTED_SKILL_BODY/);}finally{db.close();}}finally{if(!closed)await f.app.close();rmSync(dir,{recursive:true,force:true});}
});

test('model calls cannot forge internal redirect actions or their parent context',async()=>{
  let requests=0;
  const f=await fixture((messages,_tools,profile)=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:profile.toolMode==='direct'?tool('read_web_hop',{url:'https://example.com/',parentId:'forged',hop:1}):tool('code_mode',{source:'return await capabilities.read_web_hop({url:"https://example.com/",parentId:"forged",hop:1});'}),{},{webDependencies:{resolve:async()=>{requests++;return [{address:'8.8.8.8',family:4}];},request:async()=>{requests++;throw Error('unexpected');}}});
  try {
    await f.call('/api/web-permissions/instance',{enabled:true});
    for(const mode of ['direct','code']) {
      const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'forged-hop-'+mode,toolMode:mode});await f.call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});
      await f.submit('forged-hop-'+mode,bot.id);const command=await f.wait('forged-hop-'+mode);
      assert.equal(command.state,'completed');assert.equal(command.workActions.length,0);assert.equal((await f.call('/api/web-approvals')).length,0);
      assert.ok(!f.seen.find(x=>x.profile.toolMode===mode).offers.includes('read_web_hop'));
    }
    assert.equal(requests,0);
  } finally {await f.app.close();}
});

test('revoking a selected skill during redirect approval fences the next hop',async()=>{
  let skill,requests=0;
  const f=await fixture(messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool('code_mode',{source:`await capabilities.select_skill({id:${JSON.stringify(skill?.id)},revision:1}); return await capabilities.read_web({url:"https://one.example/start"});`}),{},{webDependencies:{resolve:async()=>[{address:'8.8.8.8',family:4}],request:async()=>{requests++;return {status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}};}}});
  try {
    await f.call('/api/web-permissions/instance',{enabled:true});const bot=await f.call('/api/bots',{provider:'live',model:'fixture-offline',name:'skill-redirect',toolMode:'code'});await f.call(`/api/web-permissions/bot:${bot.id}`,{enabled:true});
    skill=await f.call('/api/skills',{name:'Redirect skill',description:'fixture',provenance:'owner',body:'fixture'});await f.call(`/api/skills/${skill.id}/availability`,{botId:bot.id,available:true});
    await f.submit('skill-redirect',bot.id);const first=await f.until(async()=>(await f.call('/api/web-approvals'))[0]);await f.call(`/api/web-approvals/${first.id}/approve`,{});
    const second=await f.until(async()=>(await f.call('/api/web-approvals'))[0]);assert.notEqual(second.id,first.id);await f.call(`/api/skills/${skill.id}/enabled`,{enabled:false});await f.call(`/api/web-approvals/${second.id}/approve`,{});
    const command=await f.wait('skill-redirect');assert.equal(command.state,'failed');assert.equal(requests,1);assert.deepEqual(command.webActions.map(x=>x.state),['succeeded','cancelled']);assert.equal(command.workActions.at(-1).parentActionId,first.id);
  } finally {await f.app.close();}
});
