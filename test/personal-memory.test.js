import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startInstance } from './fixtures/controlled-instance.mjs';

const tool=(name,input)=>({role:'assistant',content:null,tool_calls:[{id:'fixture-call',type:'function',function:{name,arguments:JSON.stringify(input)}}]});
test('sensitive memory proposal is durable, private in the action journal, and bound to the reviewed text',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-personal-memory-')),path=join(dir,'db');let port,token,app;
 let plan={name:'memory_remember',input:{scope:{kind:'agent'},text:'medical synthetic violet',classification:'ordinary'}};
 const options={env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){return messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:tool(plan.name,plan.input);}})};
 const start=async()=>{app=startInstance(path,0,options);port=await app.listen();};
 const call=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(value)}`);return value;};
 const wait=async id=>{for(let i=0;i<500;i++){const c=await call(`/api/commands/${id}`);if(c.state!=='pending')return c;await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
 try {
  await start();token=(await call('/api/pair',{code:app.code})).token;
  const rules=await call('/api/memory-sensitivity');await call('/api/memory-sensitivity',{revision:rules.revision,mode:'model',terms:['medical']});
  const bot=await call('/api/bots',{name:'Fixture',provider:'live',model:'fixture',toolMode:'direct'});
  await call('/api/commands',{id:'propose',botId:bot.id,content:'Run controlled fixture.'});assert.equal((await wait('propose')).state,'completed');
  assert.deepEqual(await call(`/api/memories/bot/${bot.id}`),[]);
  let proposals=await call(`/api/memory-proposals/${bot.id}`);assert.equal(proposals.length,1);assert.equal(proposals[0].text,plan.input.text);
  const proposal=proposals[0];await app.close();const db=new DatabaseSync(path);try {const rows=db.prepare("SELECT input,private_result FROM work_action_invocations WHERE capability='memory_remember'").all();const journal=db.prepare('SELECT * FROM action_journal').all();assert.doesNotMatch(JSON.stringify([rows,journal]),/medical synthetic violet/);db.prepare('UPDATE sensitive_memory_proposals SET text=? WHERE id=?').run('tampered synthetic',proposal.id);}finally{db.close();}
  await start();const tampered=await fetch(`http://127.0.0.1:${port}/api/memory-proposals/${proposal.id}/confirm`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({fingerprint:proposal.fingerprint})});assert.equal(tampered.status,409);assert.deepEqual(await call(`/api/memories/bot/${bot.id}`),[]);
  await app.close();const repair=new DatabaseSync(path);try{repair.prepare('UPDATE sensitive_memory_proposals SET text=? WHERE id=?').run(plan.input.text,proposal.id);}finally{repair.close();}await start();proposals=await call(`/api/memory-proposals/${bot.id}`);assert.equal(proposals[0].text,plan.input.text);
  await call('/api/commands',{id:'propose',botId:bot.id,content:'Run controlled fixture.'});assert.equal((await call(`/api/memory-proposals/${bot.id}`)).length,1);
  await call(`/api/memory-proposals/${proposal.id}/confirm`,{fingerprint:proposal.fingerprint});
  assert.equal((await call(`/api/memories/bot/${bot.id}`))[0].text,plan.input.text);
  const duplicate=await fetch(`http://127.0.0.1:${port}/api/memory-proposals/${proposal.id}/confirm`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({fingerprint:proposal.fingerprint})});assert.equal(duplicate.status,409);
 }finally {await app?.close();rmSync(dir,{recursive:true,force:true});}
});

test('all tool modes gate uncertain and sensitive creates and updates without widening scope',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-sensitive-modes-')),path=join(dir,'db');let plan,port,token,app,sequence=0,closed=false;
 const options={env:{},providerFactory:async()=>({name:'fixture',capabilities:{toolCalls:true},async complete(messages){
   if(messages.at(-1).role==='tool')return {role:'assistant',content:'done'};
   return plan.route==='direct'?tool(plan.name,plan.input):tool('code_mode',{source:`return await capabilities[${JSON.stringify(plan.name)}](${JSON.stringify(plan.input)});`});
 }})};
 app=startInstance(path,0,options);port=await app.listen();
 const call=async(route,body,expected=200)=>{const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,expected,`${route}: ${JSON.stringify(value)}`);return value;};
 const run=async(bot,route,name,input)=>{plan={route,name,input};const id=`work-${++sequence}`;await call('/api/commands',{id,botId:bot.id,content:`Run controlled fixture ${sequence}.`});for(let i=0;i<500;i++){const c=await call(`/api/commands/${id}`);if(c.state!=='pending'){assert.equal(c.state,'completed',c.error);assert.equal(c.workActions.length,1);return c;}await new Promise(r=>setTimeout(r,10));}throw Error('timed out');};
 try {
  token=(await call('/api/pair',{code:app.code})).token;
  const initialRules=await call('/api/memory-sensitivity');await call('/api/memory-sensitivity',{...initialRules,mode:'review-all'});
  await call('/api/memory-sensitivity',{...initialRules,mode:'model'},409);
  const currentRules=await call('/api/memory-sensitivity');await call('/api/memory-sensitivity',{...currentRules,mode:'model'});
  for(const mode of ['direct','hybrid','code']){
   const bot=await call('/api/bots',{name:mode,provider:'live',model:'fixture',toolMode:mode},201),route=mode==='direct'?'direct':'code',scope={kind:'agent'},path=`/api/memories/bot/${bot.id}`;
   for(const approvalMode of ['ask-every-time','ask-for-risky-actions','never-ask']){
    await call('/api/approval-settings/instance',{mode:approvalMode,clockEnabled:true});
    await run(bot,route,'memory_remember',{scope,text:`medical ${approvalMode} synthetic`,classification:'sensitive'});
    const [review]=await call(`/api/memory-proposals/${bot.id}`);assert.equal(review.text,`medical ${approvalMode} synthetic`);assert.deepEqual(await call(path),[]);
    await call(`/api/memory-proposals/${review.id}/confirm`,{fingerprint:review.fingerprint});const [saved]=await call(path);assert.equal(saved.text,review.text);await call(`${path}/${saved.id}/delete`,{version:saved.version});
   }
   await run(bot,route,'memory_remember',{scope,text:'tea preference',classification:'ordinary'});
   let [item]=await call(path);assert.equal(item.text,'tea preference');
   await run(bot,route,'memory_update',{scope,id:item.id,version:item.version,text:'medical synthetic change',classification:'ordinary'});
   let [pending]=await call(`/api/memory-proposals/${bot.id}`);assert.equal(pending.operation,'update');assert.equal((await call(path))[0].text,'tea preference');
   await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:'wrong'},409);
   await call(`${path}/${item.id}/edit`,{version:item.version,text:'owner correction'});
   await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint},409);
   await call(`/api/memory-proposals/${pending.id}/deny`,{fingerprint:pending.fingerprint});assert.equal((await call(path))[0].text,'owner correction');
   item=(await call(path))[0];await run(bot,route,'memory_update',{scope,id:item.id,version:item.version,text:'medical approved synthetic',classification:'sensitive'});
   [pending]=await call(`/api/memory-proposals/${bot.id}`);await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint});assert.equal((await call(path))[0].text,'medical approved synthetic');
   await run(bot,route,'memory_remember',{scope,text:'unclassified synthetic'});
   [pending]=await call(`/api/memory-proposals/${bot.id}`);assert.equal(pending.text,'unclassified synthetic');
   await call(`/api/memory-proposals/${pending.id}/deny`,{fingerprint:pending.fingerprint});
   await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint},409);
   await run(bot,route,'memory_remember',{scope:{kind:'user'},text:'medical shared synthetic',classification:'sensitive'});
   [pending]=await call(`/api/memory-proposals/${bot.id}`);assert.deepEqual(await call('/api/memories/user'),[]);
   const decision=await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint});assert.equal(decision.sharedConfirmationRequired,true);
   assert.deepEqual(await call('/api/memories/user'),[]);
   await call('/api/commands',{id:`shared-${mode}`,botId:bot.id,content:`Confirm shared memory ${pending.id}`});
   const shared=await call('/api/memories/user');assert.ok(shared.some(entry=>entry.text==='medical shared synthetic'));
   for(const entry of shared)await call(`/api/memories/user/${entry.id}/delete`,{version:entry.version});
   await run(bot,route,'memory_remember',{scope,text:'medical revoked synthetic',classification:'sensitive'});
   [pending]=await call(`/api/memory-proposals/${bot.id}`);const defaults=await call('/api/tool-defaults');await call('/api/tool-defaults',{...defaults,memory:false});
   await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint},409);
   const disabled=await call('/api/tool-defaults');await call('/api/tool-defaults',{...disabled,memory:true});
   await call(`/api/memory-proposals/${pending.id}/confirm`,{fingerprint:pending.fingerprint},409);
  }
  await app.close();closed=true;const db=new DatabaseSync(path);try{const records=db.prepare("SELECT input,private_result FROM work_action_invocations WHERE capability IN ('memory_remember','memory_update')").all();const journal=db.prepare('SELECT * FROM action_journal').all();assert.doesNotMatch(JSON.stringify([records,journal]),/medical (synthetic change|approved synthetic|shared synthetic|revoked synthetic)|unclassified synthetic/);}finally{db.close();}
 }finally{if(!closed)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 42 upgrade preserves Slack work, memory, shared proposals, tools and plugin configuration',async()=>{
 const {Instance,INSTANCE_SCHEMA_VERSION}=await import('../dist/instance.js');const dir=mkdtempSync(join(tmpdir(),'staf-sensitive-migrate-')),path=join(dir,'db');let instance;
 try{
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',provider:'live',model:'fixture',instructions:''});
  instance.memories.create({scope:{kind:'bot',botId:bot.id},text:'preserved'});instance.proposeSharedMemory(bot.id,'shared pending','old-proposal');
  const config={teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};instance.plugins.connect(config);instance.plugins.setAccess(bot.id,true);const connection=instance.plugins.setEnabled(true);instance.acceptSlackTask({id:'old-task',eventId:'old-event',revision:connection.revision,config,objective:'Existing work'},'Existing work');instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.exec('DROP TABLE sensitive_memory_proposals; DROP TABLE memory_sensitivity; PRAGMA user_version=42');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(INSTANCE_SCHEMA_VERSION,48);assert.equal(instance.memories.list({kind:'bot',botId:bot.id})[0].text,'preserved');assert.equal(instance.sharedMemoryProposal(bot.id,'old-proposal').state,'pending');assert.equal(instance.plugins.workBinding('old-task').bot_id,bot.id);assert.ok(instance.plugins.deliveries().some(item=>item.attemptId==='old-task'));assert.equal(instance.plugins.connection().enabled,true);assert.equal(instance.plugins.connection().agentAccess,true);assert.equal(instance.toolDefaults().memory,true);assert.equal(instance.memorySensitivity().mode,'model');
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('the other schema 42 lineage retains sensitive decisions while adding Slack work tables',async()=>{
 const {Instance}=await import('../dist/instance.js');const dir=mkdtempSync(join(tmpdir(),'staf-sensitive-lineage-')),path=join(dir,'db');let instance;
 try{
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',provider:'live',model:'fixture',instructions:''});instance.claim({id:'old-command',botId:bot.id,content:'controlled'});
  const proposal=instance.proposeSensitiveMemory({id:'old-sensitive',botId:bot.id,work:{kind:'command',id:'old-command'},scope:'bot',operation:'create',text:'medical synthetic'});instance.close();instance=undefined;
  const db=new DatabaseSync(path);db.exec('DROP TABLE slack_deliveries; DROP TABLE slack_notices; DROP TABLE slack_work; PRAGMA user_version=42');db.close();
  instance=new Instance(path);assert.equal(instance.sensitiveMemoryProposals(bot.id)[0].fingerprint,proposal.fingerprint);assert.deepEqual(instance.plugins.deliveries(),[]);instance.decideSensitiveMemory(proposal.id,proposal.fingerprint,'confirm');assert.equal(instance.memories.list({kind:'bot',botId:bot.id})[0].text,'medical synthetic');
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('plugin permission changes invalidate a pending sensitive proposal',async()=>{
 const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');const instance=new Instance(':memory:');
 try {
  const bot=instance.createBot({name:'Plugin fixture',provider:'live',model:'fixture',instructions:'',toolMode:'direct'});
  instance.plugins.connect({teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id});instance.plugins.setAccess(bot.id,true);const connection=instance.plugins.setEnabled(true);
  instance.claim({id:'plugin-command',botId:bot.id,content:'controlled'});assert.equal(instance.plugins.reserve('event','plugin-command',connection.revision),true);
  const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);const actions=registry.open({kind:'command',id:'plugin-command'},new AbortController().signal);
  const result=await actions.invoke({source:{kind:'provider',responseId:'fixture',callId:'one'},name:'memory_remember',input:{scope:{kind:'agent'},text:'medical synthetic',classification:'sensitive'},intent:{kind:'new'}});
  assert.equal(result.kind,'completed');const proposal=result.value.proposal;instance.plugins.state('plugin-command','sent');instance.plugins.setEnabled(false);instance.plugins.setEnabled(true);
  assert.throws(()=>instance.decideSensitiveMemory(proposal.id,proposal.fingerprint,'confirm'),/Plugin access/);assert.deepEqual(instance.memories.list({kind:'bot',botId:bot.id}),[]);actions.dispose();
 }finally{instance.close();}
});

test('Slack task proposals respect revoked plugin authority, including after sensitive approval of shared memory',async()=>{
 const {Instance}=await import('../dist/instance.js');const instance=new Instance(':memory:');
 try {
  const bot=instance.createBot({name:'Slack task',provider:'live',model:'fixture',instructions:''});
  const config={teamId:'T123',userId:'U123',channelId:'D123',botId:bot.id};instance.plugins.connect(config);instance.plugins.setAccess(bot.id,true);const connection=instance.plugins.setEnabled(true);
  instance.acceptSlackTask({id:'slack-task',eventId:'event',revision:connection.revision,config,objective:'Test'},'Test');
  const proposal=instance.proposeSensitiveMemory({id:'sensitive-task',botId:bot.id,work:{kind:'task',id:'slack-task'},scope:'bot',operation:'create',text:'medical synthetic'});
  const shared=instance.proposeSensitiveMemory({id:'sensitive-shared',botId:bot.id,work:{kind:'task',id:'slack-task'},scope:'user',operation:'create',text:'medical shared synthetic'});
  instance.decideSensitiveMemory(shared.id,shared.fingerprint,'confirm');
  instance.plugins.setEnabled(false);instance.plugins.setEnabled(true);
  assert.throws(()=>instance.decideSensitiveMemory(proposal.id,proposal.fingerprint,'confirm'),/Plugin access/);
  instance.claim({id:'owner-confirm',botId:bot.id,content:'Confirm shared memory sensitive-shared'});
  instance.completeMemoryCommand('owner-confirm',null,'',undefined,{kind:'confirm',id:shared.id});
  assert.deepEqual(instance.memories.list({kind:'user'}),[]);
  assert.equal(instance.sharedMemoryProposal(bot.id,shared.id).state,'pending');
 }finally{instance.close();}
});

test('final shared confirmation rejects changed text and remains cancelled after memory access is revoked',async()=>{
 const {Instance}=await import('../dist/instance.js');const instance=new Instance(':memory:');
 try{
  const bot=instance.createBot({name:'Shared fixture',provider:'live',model:'fixture',instructions:''});instance.claim({id:'origin',botId:bot.id,content:'controlled'});
  const proposal=instance.proposeSensitiveMemory({id:'shared-review',botId:bot.id,work:{kind:'command',id:'origin'},scope:'user',operation:'create',text:'medical approved'});instance.completeMemoryCommand('origin',null,'done');instance.decideSensitiveMemory(proposal.id,proposal.fingerprint,'confirm');
  instance.db.prepare('UPDATE memory_proposals SET text=? WHERE id=?').run('changed text',proposal.id);
  instance.claim({id:'changed-confirm',botId:bot.id,content:'Confirm shared memory shared-review'});instance.completeMemoryCommand('changed-confirm',null,'',undefined,{kind:'confirm',id:proposal.id});assert.deepEqual(instance.memories.list({kind:'user'}),[]);
  instance.db.prepare('UPDATE memory_proposals SET text=? WHERE id=?').run('medical approved',proposal.id);
  const defaults=instance.toolDefaults();instance.setToolDefaults({...defaults,memory:false});instance.setToolDefaults({...instance.toolDefaults(),memory:true});
  instance.claim({id:'revoked-confirm',botId:bot.id,content:'Confirm shared memory shared-review'});instance.completeMemoryCommand('revoked-confirm',null,'',undefined,{kind:'confirm',id:proposal.id});assert.equal(instance.sharedMemoryProposal(bot.id,proposal.id).state,'cancelled');assert.deepEqual(instance.memories.list({kind:'user'}),[]);
 }finally{instance.close();}
});

test('a proposed update cannot be reconciled as an applied memory effect',async()=>{
 const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');const instance=new Instance(':memory:');
 try {
  const bot=instance.createBot({name:'Recovery fixture',provider:'live',model:'fixture',instructions:'',toolMode:'direct'}),scope={kind:'bot',botId:bot.id};
  const item=instance.memories.create({scope,text:'before'});instance.claim({id:'recovery-command',botId:bot.id,content:'controlled'});
  const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);const actions=registry.open({kind:'command',id:'recovery-command'},new AbortController().signal);
  const result=await actions.invoke({source:{kind:'provider',responseId:'fixture',callId:'one'},name:'memory_update',input:{scope:{kind:'agent'},id:item.id,version:item.version,text:'medical synthetic',classification:'sensitive'},intent:{kind:'new'}});
  assert.equal(result.kind,'completed');instance.db.prepare("UPDATE action_journal SET state='uncertain' WHERE id=?").run(result.actionId);
  instance.memories.update({id:item.id,scope,version:item.version,text:'medical synthetic'});
  assert.throws(()=>actions.reconcile(result.actionId,{version:2}),/proposal cannot be reconciled/);actions.dispose();
 }finally{instance.close();}
});

test('proposal actions resume without replay and repeated decisions cannot recreate memory',async()=>{
 const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');const instance=new Instance(':memory:');
 try{
  const bot=instance.createBot({name:'Replay fixture',provider:'live',model:'fixture',instructions:'',toolMode:'direct'});instance.claim({id:'replay-command',botId:bot.id,content:'controlled'});
  const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);const actions=registry.open({kind:'command',id:'replay-command'},new AbortController().signal),input={scope:{kind:'agent'},text:'medical synthetic replay',classification:'sensitive'};
  const invoke=(callId,intent)=>actions.invoke({source:{kind:'provider',responseId:'fixture',callId},name:'memory_remember',input,intent});
  const first=await invoke('first',{kind:'new'});assert.equal(first.kind,'completed');actions.beginRecovery();
  const repeat=await invoke('repeat',{kind:'new'});assert.equal(repeat.kind,'repeat-required');
  const resumed=await invoke('resume',{kind:'resume',actionId:first.actionId});assert.equal(resumed.kind,'completed');assert.equal(resumed.value.proposal.id,first.value.proposal.id);assert.equal(instance.sensitiveMemoryProposals(bot.id).length,1);
  instance.decideSensitiveMemory(first.value.proposal.id,first.value.proposal.fingerprint,'deny');
  const again=await invoke('resume-after-denial',{kind:'resume',actionId:first.actionId});assert.equal(again.kind,'completed');assert.equal(instance.sensitiveMemoryProposals(bot.id).length,0);assert.throws(()=>instance.decideSensitiveMemory(first.value.proposal.id,first.value.proposal.fingerprint,'confirm'));
  const status=await actions.invoke({source:{kind:'provider',responseId:'fixture',callId:'status'},name:'memory_proposal_status',input:{id:first.actionId},intent:{kind:'new'}});assert.equal(status.kind,'completed');assert.equal(status.value.state,'denied');
  assert.deepEqual(instance.memories.list({kind:'bot',botId:bot.id}),[]);actions.dispose();
 }finally{instance.close();}
});

test('an invalid memory target cannot put arbitrary target text in the action journal',async()=>{
 const {Instance}=await import('../dist/instance.js');const {registerMemoryCapabilities}=await import('../dist/memory-actions.js');const instance=new Instance(':memory:');
 try{
  const bot=instance.createBot({name:'Invalid target fixture',provider:'live',model:'fixture',instructions:'',toolMode:'direct'});instance.claim({id:'invalid-target',botId:bot.id,content:'controlled'});
  const registry=instance.workActions();registerMemoryCapabilities(instance,registry,value=>value);const actions=registry.open({kind:'command',id:'invalid-target'},new AbortController().signal);
  const result=await actions.invoke({source:{kind:'provider',responseId:'fixture',callId:'invalid'},name:'memory_update',input:{scope:{kind:'agent'},id:'synthetic private target',version:1,text:'medical private content',classification:'sensitive'},intent:{kind:'new'}});
  assert.equal(result.kind,'status');assert.equal(result.action.state,'failed');const rows=instance.db.prepare('SELECT input,private_result FROM work_action_invocations').all();assert.doesNotMatch(JSON.stringify(rows),/synthetic private target|medical private content/);actions.dispose();
 }finally{instance.close();}
});
