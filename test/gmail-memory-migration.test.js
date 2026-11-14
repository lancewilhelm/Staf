import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Instance,INSTANCE_SCHEMA_VERSION} from '../dist/instance.js';

test('both schema 43 predecessors keep their Gmail and sensitive-memory state',()=>{
 for(const predecessor of ['gmail','memory']){
  const dir=mkdtempSync(join(tmpdir(),'staf-gmail-memory-migration-')),path=join(dir,'db');let instance;
  try {
   instance=new Instance(path);const bot=instance.createBot({name:'Preserved',instructions:'',provider:'live',model:'fixture'});instance.close();instance=undefined;
   let db=new DatabaseSync(path);
   db.prepare("INSERT INTO plugin_connections VALUES ('gmail','owner@example.test',?,1,0,1)").run(JSON.stringify({email:'owner@example.test',clientId:'fixture'}));
   db.prepare("INSERT INTO gmail_history VALUES ('owner@example.test','17','ready',NULL)").run();
   db.prepare("INSERT INTO gmail_arrivals VALUES ('owner@example.test','retained')").run();
   db.prepare("UPDATE memory_sensitivity SET revision=2,mode='review-all',terms=? WHERE id=1").run('["private topic"]');
   db.prepare("INSERT INTO sensitive_memory_proposals VALUES (?,?, 'command','work','bot','create',NULL,NULL,'pending detail','fingerprint','pending')").run('proposal',bot.id);
   if(predecessor==='gmail')db.exec('DROP TABLE sensitive_memory_proposals; DROP TABLE memory_sensitivity');
   else db.exec('DROP TABLE gmail_history; DROP TABLE gmail_arrivals; DROP TABLE gmail_history_gaps; DROP TABLE gmail_model_access; DROP TABLE gmail_private_commands; DROP TABLE gmail_private_messages');
   db.exec('PRAGMA user_version=43');db.close();
   instance=new Instance(path);assert.ok(instance.migrationBackup);instance.close();instance=undefined;
   db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);assert.equal(INSTANCE_SCHEMA_VERSION,57);
   assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gmail_history'").get());assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_sensitivity'").get());
   if(predecessor==='gmail'){assert.equal(db.prepare("SELECT message_id FROM gmail_arrivals").get().message_id,'retained');assert.equal(db.prepare('SELECT cursor FROM gmail_history').get().cursor,'17');}
   else {assert.equal(db.prepare('SELECT mode FROM memory_sensitivity').get().mode,'review-all');assert.equal(db.prepare('SELECT text FROM sensitive_memory_proposals').get().text,'pending detail');}
   assert.equal(db.prepare("SELECT connected FROM plugin_connections WHERE plugin_id='gmail'").get().connected,1);db.close();
  }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
 }
});


test('schema 44 chat grants do not authorize task or Slack model disclosure',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-gmail-grant-migration-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',instructions:'',provider:'live',model:'fixture'});instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.prepare("INSERT INTO plugin_connections VALUES ('gmail','owner@example.test',?,1,1,1)").run(JSON.stringify({email:'owner@example.test',clientId:'fixture'}));db.prepare("INSERT INTO gmail_model_access VALUES ('owner@example.test',?,'live','fixture')").run(bot.id);db.exec('DROP TABLE gmail_task_scopes; DROP TABLE gmail_task_messages; DROP TABLE gmail_private_tasks; DROP TABLE gmail_work_model_access; PRAGMA user_version=44');db.close();
  instance=new Instance(path);assert.equal(instance.plugins.gmailModelAllowed('owner@example.test',bot.id,'live','fixture'),true);assert.equal(instance.plugins.gmailWorkModelAllowed('owner@example.test',bot.id,'live','fixture'),false);
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 46 upgrade preserves Gmail scans and starts the inbox assistant disabled',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-inbox-migration-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Preserved',instructions:'',provider:'live',model:'fixture'});instance.memories.create({scope:{kind:'bot',botId:bot.id},text:'Preserved memory'});instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.prepare("INSERT INTO gmail_history VALUES ('owner@example.test','42','ready',NULL)").run();db.prepare("INSERT INTO gmail_monitor_runs (account_id,started_at,finished_at,outcome) VALUES ('owner@example.test',1,2,'completed')").run();db.exec('DROP TABLE inbox_monitor_settings; DROP TABLE inbox_monitor_items; DROP TABLE inbox_monitor_replies; DROP TABLE inbox_monitor_failure; PRAGMA user_version=46');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.inboxMonitor.settings(),null);assert.equal(instance.gmailHistory().snapshot('owner@example.test').runs[0].outcome,'completed');assert.equal(instance.memories.list({kind:'bot',botId:bot.id})[0].text,'Preserved memory');
 } finally {instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 47 inbox decisions survive upgrade and legacy uncertain sends cannot be replayed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-inbox-digest-migration-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',instructions:'',provider:'live',model:'fixture'});instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.prepare("INSERT INTO inbox_monitor_settings (id,revision,enabled,account_id,bot_id,provider,model,agent_revision,gmail_revision,slack_revision,attention,sensitive_terms,start_seq) VALUES (1,1,1,'owner@example.test',?,'live','fixture','rev',1,1,'attention','[]',0)").run(bot.id);db.prepare("INSERT INTO inbox_monitor_items (account_id,message_id,settings_revision,attempt_id,state,summary) VALUES ('owner@example.test','old',1,'old-attempt','uncertain','private summary')").run();db.exec('DROP TABLE inbox_digest_items; DROP TABLE inbox_digest_batches; ALTER TABLE inbox_monitor_settings DROP COLUMN digest_minutes; ALTER TABLE inbox_monitor_settings DROP COLUMN next_digest_at; ALTER TABLE inbox_monitor_settings DROP COLUMN memory_context; ALTER TABLE inbox_monitor_items DROP COLUMN delivery_ts; ALTER TABLE inbox_monitor_items DROP COLUMN uncertain_from; ALTER TABLE inbox_monitor_items DROP COLUMN urgency; ALTER TABLE inbox_monitor_items DROP COLUMN correction; ALTER TABLE inbox_monitor_items DROP COLUMN sender_key; PRAGMA user_version=47');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.inboxMonitor.settings().digestMinutes,60);assert.equal(instance.inboxMonitor.settings().memoryContext,false);const item=instance.inboxMonitor.status().items[0];assert.equal(item.state,'uncertain');assert.equal(item.uncertainFrom,null);assert.throws(()=>instance.inboxMonitor.resolveItem('old-attempt','resend'),/unknown/i);assert.equal(instance.inboxMonitor.status().items[0].state,'uncertain');
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 46 reply lineage and schema 48 inbox lineage converge without losing data',()=>{
 for(const lineage of ['reply','inbox']) {
  const dir=mkdtempSync(join(tmpdir(),'staf-inbox-reply-migration-')),path=join(dir,'db');let instance;
  try {
   instance=new Instance(path);const bot=instance.createBot({name:'Existing',instructions:'',provider:'live',model:'fixture'});instance.claim({id:'old-command',botId:bot.id,content:'Existing work'},'Existing work');instance.close();instance=undefined;
   let db=new DatabaseSync(path);
   if(lineage==='reply') {
    db.prepare("INSERT INTO action_journal VALUES ('old-action','fp','identity',NULL,'old-command','uncertain','Reply',NULL)").run();
    db.prepare("INSERT INTO gmail_reply_proposals VALUES ('old-action','fp','command','old-command',?,'owner@example.test',1,1,'T123','U123','D123','message','{}','digest','effect-digest','uncertain',NULL,'preserved')").run(bot.id);
    db.exec('DROP TABLE inbox_digest_items; DROP TABLE inbox_digest_batches; DROP TABLE inbox_monitor_settings; DROP TABLE inbox_monitor_items; DROP TABLE inbox_monitor_replies; DROP TABLE inbox_monitor_failure; DROP TABLE gmail_monitor_runs; PRAGMA user_version=46');
   } else {db.prepare("INSERT INTO gmail_monitor_runs (account_id,started_at,finished_at,outcome) VALUES ('owner@example.test',1,2,'completed')").run();db.exec('DROP TABLE gmail_reply_proposals; PRAGMA user_version=48');}
   db.close();instance=new Instance(path);assert.ok(instance.migrationBackup);instance.close();instance=undefined;
   db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gmail_reply_proposals'").get());assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gmail_monitor_runs'").get());assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='inbox_digest_batches'").get());
   if(lineage==='reply')assert.equal(db.prepare("SELECT detail FROM gmail_reply_proposals WHERE action_id='old-action'").get().detail,'preserved');else assert.equal(db.prepare('SELECT outcome FROM gmail_monitor_runs').get().outcome,'completed');db.close();
  }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('schema 49 candidates remain visible and uncertain without changing saved inbox state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-inbox-evidence-upgrade-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);const bot=instance.createBot({name:'Existing',instructions:'',provider:'live',model:'fixture'});
  instance.db.prepare("INSERT INTO gmail_arrivals VALUES ('owner@example.test','legacy')").run();
  instance.db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,summary) VALUES ('owner@example.test','legacy',1,'legacy-task','digest_batched','Preserve this summary')").run();
  instance.db.prepare("INSERT INTO inbox_digest_batches VALUES ('legacy-batch',1,'pending','Old digest',NULL,1)").run();instance.db.prepare("INSERT INTO inbox_digest_items VALUES ('legacy-batch','legacy-task')").run();
  instance.inboxMonitor.configure({enabled:true,accountId:'owner@example.test',botId:bot.id,provider:'live',model:'fixture',agentRevision:bot.revision,gmailRevision:1,slackRevision:1,attention:'keep this preference',sensitiveTerms:[],digestMinutes:60,memoryContext:false});
  instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.exec('DROP TABLE gmail_arrival_evidence; PRAGMA user_version=49');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.inboxMonitor.settings().attention,'keep this preference');assert.equal(instance.inboxMonitor.next(),null);
  assert.deepEqual(instance.gmailHistory().arrivals('owner@example.test'),[{messageId:'legacy',inbox:'unknown'}]);assert.equal(instance.db.prepare("SELECT state FROM inbox_monitor_items WHERE attempt_id='legacy-task'").get().state,'stale');assert.equal(instance.db.prepare("SELECT summary FROM inbox_monitor_items WHERE attempt_id='legacy-task'").get().summary,'Preserve this summary');assert.equal(instance.db.prepare("SELECT state FROM inbox_digest_batches WHERE id='legacy-batch'").get().state,'stale');instance.close();instance=undefined;
  db=new DatabaseSync(path,{readOnly:true});assert.equal(db.prepare('PRAGMA user_version').get().user_version,INSTANCE_SCHEMA_VERSION);db.close();
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 50 upgrade retains pending decisions and creates durable recovery records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-inbox-recovery-upgrade-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);instance.db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,clarification_ts) VALUES ('owner','m',1,'a','awaiting','1.1')").run();instance.close();instance=undefined;
  let db=new DatabaseSync(path);db.exec('DROP TABLE inbox_candidate_reviews; DROP TABLE inbox_delivery_retry; PRAGMA user_version=50');db.close();
  instance=new Instance(path);assert.ok(instance.migrationBackup);assert.equal(instance.inboxMonitor.item('a').state,'awaiting');assert.equal(instance.inboxMonitor.item('a').clarification_ts,'1.1');assert.ok(instance.db.prepare("SELECT 1 FROM sqlite_master WHERE name='inbox_candidate_reviews'").get());assert.ok(instance.db.prepare("SELECT 1 FROM sqlite_master WHERE name='inbox_delivery_retry'").get());
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});

test('schema 51 retains sensitivity independently when later corrections change',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-inbox-sensitivity-upgrade-')),path=join(dir,'db');let instance;
 try {
  instance=new Instance(path);instance.db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,sender_key,correction) VALUES ('owner','old',1,'old','delivered','sender','sensitive'),('owner','new',1,'new','evaluating','sender',NULL)").run();instance.close();instance=undefined;
  const db=new DatabaseSync(path);db.exec('DROP TABLE inbox_sensitive_corrections; DROP TABLE inbox_correction_events; DROP TABLE inbox_legacy_corrections; DROP TABLE inbox_assessment_history; DROP TABLE inbox_digest_history; DROP TABLE inbox_digest_archive; ALTER TABLE inbox_monitor_items DROP COLUMN recheck_private; PRAGMA user_version=51');db.close();
  instance=new Instance(path);assert.equal(instance.inboxMonitor.hasSensitiveFeedback('new'),true);instance.inboxMonitor.correct('urgent','old','urgent');instance.inboxMonitor.correct('not-sensitive','old','not-sensitive');assert.equal(instance.inboxMonitor.hasSensitiveFeedback('new'),true);instance.inboxMonitor.correct('clear','old','clear');assert.equal(instance.inboxMonitor.hasSensitiveFeedback('new'),false);assert.equal(instance.db.prepare('SELECT count(*) AS n FROM inbox_correction_events').get().n,3);assert.equal(instance.db.prepare("SELECT correction FROM inbox_legacy_corrections WHERE message_id='old'").get().correction,'sensitive');
 }finally{instance?.close();rmSync(dir,{recursive:true,force:true});}
});
