import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Instance } from '../dist/instance.js';

function beginApproved(instance,input) {
 const parent=instance.taskAttempt(input.parentAttemptId);const content=`${input.objective}\n\nAssignment context:\n${input.context}`;
 const disclosureId=instance.proposeDisclosure({parentAttemptId:input.parentAttemptId,senderBotId:parent.botId,recipientBotId:input.helperBotId,kind:'request',content});instance.decideDisclosure(disclosureId,true);
 return instance.beginDelegation({...input,disclosureId});
}
function completeApproved(instance,id,session) {
 const assignment=instance.helperAssignment(id);const content=session.messages.at(-1).content;
 const disclosureId=instance.proposeDisclosure({parentAttemptId:assignment.parent_attempt_id,senderBotId:assignment.helper_bot_id,recipientBotId:assignment.requester_bot_id,kind:'result',content});instance.decideDisclosure(disclosureId,true);
 return instance.taskComplete(id,session,disclosureId);
}

test('durable claims, busy drafts, duplicate IDs and restart interruption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'staf-instance-'));
  const path = join(dir, 'instance.sqlite');
  let instance = new Instance(path);
  try {
    const bot = instance.createBot({name: 'Ada', instructions: 'Help', provider: 'demo'});
    assert.equal(instance.claim({id:'one', botId:bot.id, content:'hello'}).kind, 'accepted');
    assert.equal(instance.claim({id:'two', botId:bot.id, content:'draft'}).kind, 'busy');
    assert.equal(instance.command('two'), undefined);
    assert.equal(instance.claim({id:'one', botId:bot.id, content:'hello'}).kind, 'existing');
    assert.throws(() => instance.claim({id:'one', botId:bot.id, content:'different'}), /conflict/);
    instance.complete('one', 'response');
    assert.equal(instance.command('one').state, 'completed');
    assert.deepEqual(instance.messages(bot.id).map(m => m.content), ['hello', 'response']);
    instance.claim({id:'three', botId:bot.id, content:'later'});
    instance.close();
    instance = new Instance(path);
    assert.equal(instance.bots()[0].chatId, bot.chatId);
    assert.equal(instance.command('three').state, 'interrupted');
    assert.deepEqual(instance.messages(bot.id).map(m => m.content), ['hello', 'response', 'later']);
    assert.equal(instance.claim({id:'four', botId:bot.id, content:'retry'}).kind, 'accepted');
    instance.fail('four', 'provider unavailable');
    assert.equal(instance.command('four').state, 'failed');
  } finally { instance.close(); rmSync(dir, {recursive:true, force:true}); }
});

test('upgrades an existing database after making a readable backup', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readdirSync, statSync } = await import('node:fs');
  const dir=mkdtempSync(join(tmpdir(),'staf-migration-')), path=join(dir,'instance.sqlite');
  const legacy=new DatabaseSync(path);
  legacy.exec("CREATE TABLE bots (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, instructions TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, reasoning TEXT); INSERT INTO bots VALUES ('bot','chat','Ada','Help','demo',NULL,NULL)");
  legacy.exec("CREATE TABLE commands (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL, error TEXT); INSERT INTO commands VALUES ('old-command','bot','[REDACTED]','completed',NULL)");
  legacy.close();
  let instance;
  try {
    instance=new Instance(path);
    assert.equal(instance.command('old-command').state,'completed');
    assert.throws(()=>instance.claim({id:'old-command',botId:'bot',content:'[REDACTED]'}),/unverifiable/);
    const backup=readdirSync(dir).find(name=>name.startsWith('instance.sqlite.before-profiles-'));
    assert.ok(backup);
    assert.equal(statSync(join(dir,backup)).mode & 0o077,0);
    const saved=new DatabaseSync(join(dir,backup),{readOnly:true});
    try { assert.equal(saved.prepare('SELECT name FROM bots WHERE id=?').get('bot').name,'Ada'); }
    finally { saved.close(); }
  } finally {instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('upgrading a journal database keeps unverifiable legacy command IDs fail closed', async () => {
 const {DatabaseSync}=await import('node:sqlite');const {readdirSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'staf-fingerprint-migration-')),path=join(dir,'db');let instance=new Instance(path);
 const bot=instance.createBot({name:'Ada',instructions:'',provider:'demo'});instance.claim({id:'legacy',botId:bot.id,content:'[REDACTED]'});instance.complete('legacy','done');instance.close();
 const legacy=new DatabaseSync(path);legacy.exec('DROP TABLE task_inbox; DROP TABLE task_questions; DROP TABLE command_fingerprints; DROP TABLE instance_secrets; DROP TABLE schedule_task_retries; DROP TABLE schedule_occurrences; DROP TABLE schedules; PRAGMA user_version=1;');legacy.close();
 try{instance=new Instance(path);assert.ok(readdirSync(dir).some(name=>name.startsWith('db.before-profiles-')));assert.equal(instance.command('legacy').state,'completed');assert.throws(()=>instance.claim({id:'legacy',botId:bot.id,content:'[REDACTED]'}),/unverifiable/);assert.throws(()=>instance.claim({id:'legacy',botId:bot.id,content:'a secret'},'[REDACTED]'),/unverifiable/);assert.equal(instance.claim({id:'new',botId:bot.id,content:'hello'}).kind,'accepted');}finally{instance.close();rmSync(dir,{recursive:true,force:true});}
});

test('new instance databases and SQLite journal are owner-only under a permissive umask', async () => {
 const {spawnSync}=await import('node:child_process'); const dir=mkdtempSync(join(tmpdir(),'staf-private-db-'));
 const script=`
  import {Instance} from './dist/instance.js';
  import {DatabaseSync} from 'node:sqlite';
  import {chmodSync,statSync,existsSync} from 'node:fs';
  import {join} from 'node:path';
  process.umask(0o022);
  const path=join(process.argv[1],'new.sqlite');
  const instance=new Instance(path);instance.createBot({name:'private',instructions:'private',provider:'demo'});instance.close();
  const db=new DatabaseSync(path);db.exec("PRAGMA journal_mode=PERSIST; BEGIN IMMEDIATE; UPDATE bots SET name='updated'; COMMIT;");
  const journal=path+'-journal';const result={database:statSync(path).mode & 0o777,journal:existsSync(journal)?statSync(journal).mode & 0o777:null};db.close();
  const existing=join(process.argv[1],'existing.sqlite');const old=new DatabaseSync(existing);old.exec('PRAGMA user_version=3');old.close();chmodSync(existing,0o644);
  try{new Instance(existing);}catch{}
  result.existing=statSync(existing).mode & 0o777;
  const check=new DatabaseSync(existing);result.version=check.prepare('PRAGMA user_version').get().user_version;check.close();
  process.stdout.write(JSON.stringify(result));`;
 try{const child=spawnSync(process.execPath,['--input-type=module','-e',script,dir],{cwd:process.cwd(),encoding:'utf8'});assert.equal(child.status,0,child.stderr);const modes=JSON.parse(child.stdout);assert.equal(modes.database,0o600);assert.equal(modes.journal,0o600);assert.equal(modes.existing,0o644);assert.equal(modes.version,3);}finally{rmSync(dir,{recursive:true,force:true});}
});


test('version 11 bot profiles migrate with backed-up empty descriptions', async () => {
 const {DatabaseSync}=await import('node:sqlite'); const {readdirSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'staf-description-')), path=join(dir,'db');
 let instance=new Instance(path); const bot=instance.createBot({name:'Ada',instructions:'private',provider:'demo'}); instance.close();
 const db=new DatabaseSync(path); db.exec("ALTER TABLE bot_profiles DROP COLUMN description; PRAGMA user_version=11"); db.close();
 try {instance=new Instance(path); assert.equal(instance.bot(bot.id).description,''); assert.ok(readdirSync(dir).some(name=>name.startsWith('db.before-bot-description-'))); const backup=new DatabaseSync(instance.migrationBackup,{readOnly:true}); try {assert.equal(backup.prepare('PRAGMA user_version').get().user_version,11);} finally {backup.close();}} finally {instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('delegation clock scope is explicit, durable, and cannot change on retry', () => {
 const dir=mkdtempSync(join(tmpdir(),'staf-delegation-scope-')), path=join(dir,'db'); let instance=new Instance(path);
 try {
  const bot=instance.createBot({name:'Ada',instructions:'',provider:'demo'});
  assert.equal(instance.acceptTask({id:'first',botId:bot.id,objective:'First',limitMs:1000}).attempt.delegationClock,0);
  instance.taskStart('first'); instance.taskFinish('first','failed','failed');
  assert.throws(()=>instance.acceptTask({id:'changed',botId:bot.id,objective:'First',limitMs:1000,predecessor:'first',delegateClock:true}),/scope/);
  assert.equal(instance.acceptTask({id:'retry',botId:bot.id,objective:'First',limitMs:1000,predecessor:'first'}).attempt.delegationClock,0);
  instance.taskStart('retry'); instance.taskFinish('retry','failed','failed');
  assert.equal(instance.acceptTask({id:'allowed',botId:bot.id,objective:'Second',limitMs:1000,delegateClock:true}).attempt.delegationClock,1);
  assert.equal(instance.acceptTask({id:'allowed',botId:bot.id,objective:'Second',limitMs:1000,delegateClock:true}).kind,'existing');
  assert.throws(()=>instance.acceptTask({id:'allowed',botId:bot.id,objective:'Second',limitMs:1000}),/conflict/);
  instance.close(); instance=new Instance(path); assert.equal(instance.taskAttempt('allowed').delegationClock,1);
 } finally {instance.close();rmSync(dir,{recursive:true,force:true});}
});


test('helper preparation commits one bounded request and isolated helper attempt atomically', () => {
 const instance=new Instance(':memory:');
 try {
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}), helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.claim({id:'private',botId:helper.id,content:'helper main chat secret'});instance.complete('private','private response');
  instance.acceptTask({id:'parent',botId:owner.id,objective:'Parent objective',limitMs:1000});instance.taskStart('parent');
  const input={parentAttemptId:'parent',commandId:'call-1',helperBotId:helper.id,objective:'Check fact',context:'Only this brief'};
  const created=beginApproved(instance,input);assert.equal(created.kind,'accepted');
  assert.equal(created.message.kind,'request');assert.equal(created.message.body,'Check fact\n\nAssignment context:\nOnly this brief');
  assert.deepEqual(instance.taskExecution(created.helperAttemptId).context,[]);
  assert.equal(beginApproved(instance,input).kind,'existing');
  assert.equal(instance.taskAttempts(helper.id).length,1);
  assert.throws(()=>beginApproved(instance,{...input,objective:'Changed'}),/conflict/);
  assert.throws(()=>beginApproved(instance,{...input,commandId:'call-2'}),/busy/);
  assert.equal(instance.taskAttempts(helper.id).length,1);
 } finally {instance.close();}
});


test('helper completion records the correlated result and delivers it once to the parent inbox', () => {
 const instance=new Instance(':memory:');try {
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}), helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});
  instance.taskStart(helperAttemptId);
  const session={version:1,id:helperAttemptId,provider:'synthetic',events:[],messages:[{role:'user',content:'Check'},{role:'assistant',content:'Actual result'}]};
  assert.equal(completeApproved(instance,helperAttemptId,session).completed,true);
  const exchanges=instance.taskCollaborations('p');assert.equal(exchanges.length,1);assert.deepEqual(exchanges[0].messages.map(m=>m.kind),['request','result']);
  const inbox=instance.taskAttempt('p').inbox.inputs;assert.equal(inbox.length,1);assert.match(inbox[0].text,/Actual result/);
  assert.throws(()=>instance.taskComplete(helperAttemptId,session));assert.equal(instance.taskAttempt('p').inbox.inputs.length,1);
 } finally {instance.close();}
});

test('helper clock requires explicit root scope and current intersected permissions and modes', () => {
 const instance=new Instance(':memory:');try {
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}), helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000,delegateClock:true});instance.taskStart('p');
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);
  assert.equal(instance.clockDecision(helper.id,'task',helperAttemptId).outcome,'allow');
  instance.setApprovalSettings(`bot:${owner.id}`,null,false);assert.equal(instance.clockDecision(helper.id,'task',helperAttemptId).outcome,'block');
  instance.setApprovalSettings(`bot:${owner.id}`,null,true);instance.setApprovalSettings(`bot:${helper.id}`,null,false);assert.equal(instance.clockDecision(helper.id,'task',helperAttemptId).outcome,'block');
  instance.setApprovalSettings(`bot:${helper.id}`,'ask-every-time',true);assert.equal(instance.clockDecision(helper.id,'task',helperAttemptId).outcome,'prompt');
  instance.taskStop('p','Stop');assert.equal(instance.clockDecision(helper.id,'task',helperAttemptId).outcome,'block');
 } finally {instance.close();}
});

test('stopping a parent cancels helper and records a late result without inbox delivery', () => {
 const instance=new Instance(':memory:');try {
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}), helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000,delegateClock:true});instance.taskStart('p');
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);
  instance.taskStop('p','Stop');assert.equal(instance.taskAttempt(helperAttemptId).state,'stopping');
  const session={version:1,id:helperAttemptId,provider:'synthetic',events:[],messages:[{role:'assistant',content:'Late result'}]};
  assert.equal(instance.taskComplete(helperAttemptId,session).completed,true);
  const exchange=instance.taskCollaborations('p')[0];assert.equal(exchange.assignment.state,'cancelled');assert.equal(exchange.messages.length,1);assert.equal(instance.taskAttempt(helperAttemptId).state,'stopped');assert.ok(instance.taskAttempt(helperAttemptId).activity.some(event=>event.type==='assistant_observed' && event.text==='Late result'));
  assert.equal(instance.taskAttempt('p').inbox.inputs.length,0);
 } finally {instance.close();}
});

test('replacement records its explicit helper scope and conflicts if the retry changes it',()=>{
 const instance=new Instance(':memory:');try{
  const bot=instance.createBot({name:'Owner',instructions:'',provider:'demo'});instance.acceptTask({id:'p',botId:bot.id,objective:'Old',limitMs:1000});instance.taskStart('p');
  const input={id:'next',predecessor:'p',objective:'New',limitMs:1000,delegateClock:true};
  assert.equal(instance.replaceTask(input).attempt.delegationClock,1);assert.equal(instance.replaceTask(input).kind,'existing');
  assert.throws(()=>instance.replaceTask({...input,delegateClock:false}),/conflict/);
 }finally{instance.close();}
});

test('disclosure approval is bound to exact direction, recipient, kind and content',()=>{
 const instance=new Instance(':memory:');try{
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}), helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'}), other=instance.createBot({name:'Other',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');
  const request={parentAttemptId:'p',senderBotId:owner.id,recipientBotId:helper.id,kind:'request',content:'Check\n\nAssignment context:\nOnly this'};
  const id=instance.proposeDisclosure(request);assert.throws(()=>instance.consumeDisclosure(id,request),/approval/);instance.decideDisclosure(id,true);
  for(const altered of [{...request,recipientBotId:other.id},{...request,senderBotId:helper.id,recipientBotId:owner.id},{...request,kind:'answer'},{...request,content:request.content+' hidden private text'}])assert.throws(()=>instance.consumeDisclosure(id,altered),/approval/);
  instance.consumeDisclosure(id,request);assert.throws(()=>instance.consumeDisclosure(id,request),/approval/);
 }finally{instance.close();}
});

test('pending parent directions block approved helper requests and answers at dispatch',()=>{
 const instance=new Instance(':memory:');try{
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}),helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');
  const input={parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'};
  const content='Check\n\nAssignment context:\nOnly this';const approval=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:owner.id,recipientBotId:helper.id,kind:'request',content});instance.decideDisclosure(approval,true);
  instance.taskInput({attemptId:'p',commandId:'direction-1',kind:'direction',text:'Do not send'},'Do not send');
  assert.throws(()=>instance.beginDelegation({...input,disclosureId:approval}),/pending input/);assert.equal(instance.taskAttempts(helper.id).length,0);
  assert.equal(instance.disclosureRequests().find(item=>item.id===approval).state,'interrupted');
  instance.taskDrain('p',{version:1,id:'p',provider:null,messages:[],events:[]});
  const fresh=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:owner.id,recipientBotId:helper.id,kind:'request',content});instance.decideDisclosure(fresh,true);
  const {helperAttemptId}=instance.beginDelegation({...input,disclosureId:fresh});instance.taskStart(helperAttemptId);
  const q=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:helper.id,recipientBotId:owner.id,kind:'question',content:'Which source?'});instance.decideDisclosure(q,true);
  const question=instance.helperQuestion(helperAttemptId,'Which source?',q);instance.taskDrain('p',{version:1,id:'p',provider:null,messages:[],events:[]});
  const a=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:owner.id,recipientBotId:helper.id,kind:'answer',content:'Primary'});instance.decideDisclosure(a,true);
  instance.taskInput({attemptId:'p',commandId:'direction-2',kind:'direction',text:'Do not answer'},'Do not answer');
  assert.throws(()=>instance.answerHelper('p',question.assignmentId,question.questionId,'Primary',a,'answer-call'),/pending input/);assert.equal(instance.disclosureRequests().find(item=>item.id===a).state,'interrupted');
  assert.deepEqual(instance.taskCollaborations('p')[0].messages.map(message=>message.kind),['request','question']);
 }finally{instance.close();}
});

test('pending parent input invalidates helper question and result disclosures without sending',()=>{
 const instance=new Instance(':memory:');try{
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}),helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);
  const question=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:helper.id,recipientBotId:owner.id,kind:'question',content:'Which source?'});instance.decideDisclosure(question,true);
  instance.taskInput({attemptId:'p',commandId:'direction',kind:'direction',text:'Stop sharing'},'Stop sharing');
  assert.throws(()=>instance.helperQuestion(helperAttemptId,'Which source?',question),/pending input/);assert.equal(instance.disclosureRequests().find(item=>item.id===question).state,'interrupted');
  const result=instance.proposeDisclosure({parentAttemptId:'p',senderBotId:helper.id,recipientBotId:owner.id,kind:'result',content:'private result'});instance.decideDisclosure(result,true);
  const session={version:1,id:helperAttemptId,provider:'synthetic',events:[],messages:[{role:'assistant',content:'private result'}]};
  assert.throws(()=>instance.taskComplete(helperAttemptId,session,result),/pending input/);assert.equal(instance.disclosureRequests().find(item=>item.id===result).state,'interrupted');
  instance.taskStop(helperAttemptId,'Could not deliver');instance.taskFinish(helperAttemptId,'stopped','Task stopped');
  assert.equal(instance.taskAttempt(helperAttemptId).state,'stopped');assert.equal(instance.taskCollaborations('p')[0].assignment.state,'cancelled');assert.deepEqual(instance.taskCollaborations('p')[0].messages.map(message=>message.kind),['request']);
 }finally{instance.close();}
});

test('creation defaults are revision safe and copied once into new bots',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-defaults-')),path=join(dir,'db');let instance=new Instance(path);
 try{
  const old=instance.createBot({name:'Old',instructions:'',provider:'demo'});const initial=instance.creationDefaults();
  const updated=instance.setCreationDefaults({revision:initial.revision,provider:'codex',model:'synthetic-model',reasoning:'high'});
  assert.throws(()=>instance.setCreationDefaults({revision:initial.revision,provider:'codex',model:'stale',reasoning:null}),/changed/);
  const created=instance.createBot({name:'New',instructions:''});assert.equal(created.provider,'codex');assert.equal(created.model,'synthetic-model');assert.equal(created.reasoning,'high');
  instance.setCreationDefaults({revision:updated.revision,provider:'openrouter',model:'other',reasoning:null});assert.equal(instance.bot(old.id).provider,'codex');assert.equal(instance.bot(created.id).model,'synthetic-model');
  instance.close();instance=new Instance(path);assert.equal(instance.creationDefaults().provider,'openrouter');assert.equal(instance.bot(created.id).provider,'codex');
 }finally{instance.close();rmSync(dir,{recursive:true,force:true});}
});


test('chat task command identity rejects changed objectives and permits only one attempt per command',()=>{
 const instance=new Instance(':memory:');try{const bot=instance.createBot({name:'Owner',instructions:'',provider:'demo'});instance.claim({id:'chat',botId:bot.id,content:'Investigate'});const first=instance.startChatTask('chat','call','Original');assert.equal(first.kind,'accepted');assert.equal(instance.startChatTask('chat','call','Original').kind,'existing');assert.throws(()=>instance.startChatTask('chat','call','Changed'),/already requested/);assert.throws(()=>instance.startChatTask('chat','another','Original'),/already requested/);assert.equal(instance.taskAttempts(bot.id).length,1);}finally{instance.close();}
});

test('web permissions default off and cannot grant helper or scheduled reads',()=>{
 const instance=new Instance(':memory:');try{
  const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}),helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});instance.setWebPermission('instance',true);instance.setWebPermission(`bot:${owner.id}`,true);instance.setWebPermission(`bot:${helper.id}`,true);
  instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');assert.equal(instance.webAllowed({kind:'task',id:'p'}),false);instance.setWebPermission('task:p',true);assert.equal(instance.webAllowed({kind:'task',id:'p'}),true);
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);instance.setWebPermission(`task:${helperAttemptId}`,true);assert.equal(instance.webCanOffer({kind:'task',id:helperAttemptId}),false);assert.equal(instance.webAllowed({kind:'task',id:helperAttemptId}),false);
  instance.taskStop('p','stop');instance.taskFinish('p','stopped','stopped');instance.taskFinish(helperAttemptId,'stopped','stopped');
  const due=Date.parse('2024-03-01T12:00:00Z');const schedule=instance.schedules.create({botId:owner.id,objective:'Scheduled',recurrence:{kind:'daily',timeZone:'UTC',hour:12,minute:0},maxLatenessMs:300000,cursor:due-3600000,enabled:true,authorization:{action:'clock.read',resource:'utc',limits:{reads:'permitted'}}});const occurrence=instance.scheduleTick(schedule.id,due);instance.taskStart(occurrence.task_id);instance.setWebPermission(`task:${occurrence.task_id}`,true);assert.equal(instance.webCanOffer({kind:'task',id:occurrence.task_id}),false);assert.equal(instance.webAllowed({kind:'task',id:occurrence.task_id}),false);
 }finally{instance.close();}
});

test('search stays blocked for helpers and schedules despite enabled scopes',()=>{
 const instance=new Instance(':memory:');try{const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}),helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'});const config=instance.searchConfig();instance.setSearchConfig({revision:config.revision,origin:'http://127.0.0.1:8888'});instance.setSearchPermission('instance',true);instance.setSearchPermission(`bot:${owner.id}`,true);instance.setSearchPermission(`bot:${helper.id}`,true);instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');assert.equal(instance.searchAllowed({kind:'task',id:'p'},'http://127.0.0.1:8888',2),false);instance.setSearchPermission('task:p',true);assert.equal(instance.searchAllowed({kind:'task',id:'p'},'http://127.0.0.1:8888',2),true);
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);instance.setSearchPermission(`task:${helperAttemptId}`,true);assert.equal(instance.searchCanOffer({kind:'task',id:helperAttemptId}),false);assert.equal(instance.searchAllowed({kind:'task',id:helperAttemptId},'http://127.0.0.1:8888',2),false);instance.taskStop('p','stop');instance.taskFinish('p','stopped','stopped');instance.taskFinish(helperAttemptId,'stopped','stopped');
  const due=Date.parse('2024-03-01T12:00:00Z'),schedule=instance.schedules.create({botId:owner.id,objective:'Scheduled',recurrence:{kind:'daily',timeZone:'UTC',hour:12,minute:0},maxLatenessMs:300000,cursor:due-3600000,enabled:true,authorization:{action:'clock.read',resource:'utc',limits:{reads:'permitted'}}}),occurrence=instance.scheduleTick(schedule.id,due);instance.taskStart(occurrence.task_id);instance.setSearchPermission(`task:${occurrence.task_id}`,true);assert.equal(instance.searchCanOffer({kind:'task',id:occurrence.task_id}),false);assert.equal(instance.searchAllowed({kind:'task',id:occurrence.task_id},'http://127.0.0.1:8888',2),false);
 }finally{instance.close();}
});

test('shell permissions remain disabled for helper and scheduled attempts',()=>{
 const instance=new Instance(':memory:');try{const owner=instance.createBot({name:'Owner',instructions:'',provider:'demo'}),helper=instance.createBot({name:'Helper',instructions:'',provider:'demo'}),base=instance.shellConfig(),config=instance.setShellConfig({revision:base.revision,dockerBinary:'/usr/bin/docker',dockerSocket:'/tmp/synthetic.sock',imageId:'sha256:'+'a'.repeat(64)});instance.setShellPermission('instance',true);instance.setShellPermission(`bot:${owner.id}`,true);instance.setShellPermission(`bot:${helper.id}`,true);instance.acceptTask({id:'p',botId:owner.id,objective:'Parent',limitMs:1000});instance.taskStart('p');assert.equal(instance.shellAllowed({kind:'task',id:'p'},config.revision),false);instance.setShellPermission('task:p',true);assert.equal(instance.shellAllowed({kind:'task',id:'p'},config.revision),true);
  const {helperAttemptId}=beginApproved(instance,{parentAttemptId:'p',commandId:'call',helperBotId:helper.id,objective:'Check',context:'Only this'});instance.taskStart(helperAttemptId);instance.setShellPermission(`task:${helperAttemptId}`,true);assert.equal(instance.shellCanOffer({kind:'task',id:helperAttemptId}),false);assert.equal(instance.shellAllowed({kind:'task',id:helperAttemptId},config.revision),false);instance.taskStop('p','stop');instance.taskFinish('p','stopped','stopped');instance.taskFinish(helperAttemptId,'stopped','stopped');
  const due=Date.parse('2024-03-01T12:00:00Z'),schedule=instance.schedules.create({botId:owner.id,objective:'Scheduled',recurrence:{kind:'daily',timeZone:'UTC',hour:12,minute:0},maxLatenessMs:300000,cursor:due-3600000,enabled:true,authorization:{action:'clock.read',resource:'utc',limits:{reads:'permitted'}}}),occurrence=instance.scheduleTick(schedule.id,due);instance.taskStart(occurrence.task_id);instance.setShellPermission(`task:${occurrence.task_id}`,true);assert.equal(instance.shellCanOffer({kind:'task',id:occurrence.task_id}),false);assert.equal(instance.shellAllowed({kind:'task',id:occurrence.task_id},config.revision),false);
 }finally{instance.close();}
});
