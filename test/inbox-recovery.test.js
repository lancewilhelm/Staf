import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {InboxMonitorStore,inboxMonitorSchema} from '../dist/inbox-monitor.js';

function setup() {
 const db=new DatabaseSync(':memory:');db.exec(inboxMonitorSchema);db.exec(`
 ALTER TABLE inbox_monitor_settings ADD COLUMN digest_minutes INTEGER NOT NULL DEFAULT 60;
 ALTER TABLE inbox_monitor_settings ADD COLUMN next_digest_at INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE inbox_monitor_settings ADD COLUMN memory_context INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE inbox_monitor_items ADD COLUMN recheck_private INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE inbox_monitor_items ADD COLUMN delivery_ts TEXT;
 ALTER TABLE inbox_monitor_items ADD COLUMN uncertain_from TEXT;
 ALTER TABLE inbox_monitor_items ADD COLUMN urgency TEXT;
 ALTER TABLE inbox_monitor_items ADD COLUMN correction TEXT;
 ALTER TABLE inbox_monitor_items ADD COLUMN sender_key TEXT;
 CREATE TABLE inbox_digest_batches(id TEXT PRIMARY KEY,settings_revision INTEGER,state TEXT,text TEXT,thread_ts TEXT,created_at INTEGER);
 CREATE TABLE inbox_digest_items(batch_id TEXT,attempt_id TEXT);
 CREATE TABLE slack_notices(id TEXT,state TEXT);
 CREATE TABLE gmail_arrivals(account_id TEXT,message_id TEXT);
 CREATE TABLE gmail_arrival_evidence(account_id TEXT,message_id TEXT,inbox TEXT);
 `);const store=new InboxMonitorStore(db);
 const prefs={enabled:true,accountId:'owner',botId:'bot',provider:'live',model:'fixture',agentRevision:'a',gmailRevision:1,slackRevision:1,attention:'',sensitiveTerms:[],digestMinutes:60,memoryContext:false};
 store.configure(prefs);return {db,store,prefs};
}
test('compatible preference edits retain pending work and its approval binding',()=>{
 const {db,store,prefs}=setup();try {
  for(const state of ['ready','clarify','awaiting','approved'])db.prepare('INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,clarification_ts) VALUES (?,?,?,?,?,?)').run('owner',state,1,state,state,'1.1');
  store.configure({...prefs,attention:'new preference'});
  assert.deepEqual(db.prepare('SELECT state,settings_revision FROM inbox_monitor_items ORDER BY rowid').all().map(x=>[x.state,x.settings_revision]),[['ready',2],['clarify',2],['awaiting',2],['approved',2]]);
 }finally{db.close();}
});
test('an active sensitive correction remains effective beyond bounded feedback and can be cleared',()=>{
 const {db,store}=setup();try {
  const insert=db.prepare('INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,sender_key,correction) VALUES (?,?,?,?,?,?,?)');
  insert.run('owner','sensitive',1,'sensitive','delivered','sender','sensitive');
  for(let i=0;i<6;i++)insert.run('owner','other'+i,1,'other'+i,'delivered','sender','urgent');
  insert.run('owner','new',1,'new','evaluating','sender',null);
  assert.equal(store.hasSensitiveFeedback('new'),true);
  assert.equal(store.correct('clear-event','sensitive','clear'),true);
  assert.equal(store.hasSensitiveFeedback('new'),false);
 }finally{db.close();}
});
test('owner can queue an unknown arrival without changing evidence and retry a failed assessment',()=>{
 const {db,store}=setup();try {
  db.prepare('INSERT INTO gmail_arrivals VALUES (?,?)').run('owner','unknown');db.prepare('INSERT INTO gmail_arrival_evidence VALUES (?,?,?)').run('owner','unknown','unknown');
  assert.equal(store.next(),null);store.reviewCandidate('owner','unknown',1);assert.equal(store.next(),'unknown');store.add('owner','unknown',1,'attempt1');
  assert.equal(store.item('attempt1').forced_private,1);assert.equal(db.prepare('SELECT inbox FROM gmail_arrival_evidence').get().inbox,'unknown');
  store.setResult('attempt1','failed',null);store.retryEvaluation('attempt1',1);assert.equal(store.next(),'unknown');store.add('owner','unknown',1,'attempt2');
  assert.equal(store.item('attempt2').state,'evaluating');assert.equal(store.item('attempt2').forced_private,1);assert.equal(store.next(),null);
  db.prepare('INSERT INTO gmail_arrivals VALUES (?,?)').run('owner','legacy');store.reviewCandidate('owner','legacy',1);assert.equal(store.next(),'legacy');store.add('owner','legacy',1,'legacy-attempt');assert.equal(store.item('legacy-attempt').forced_private,1);
 }finally{db.close();}
});
test('rate limited deliveries remain pending until their persisted retry time',()=>{
 const {db,store}=setup();try {
  db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES ('owner','m',1,'a','sending')").run();
  db.prepare("INSERT INTO inbox_digest_batches VALUES ('d',1,'sending','digest',NULL,0)").run();
  store.deferDelivery('item','a','sending','ready',1000);store.deferDelivery('digest','d','sending','pending',2000);
  assert.equal(store.deliveries(999).length,0);assert.equal(store.deliveries(1000).length,1);
  assert.equal(store.digestBatches(1999).length,0);assert.equal(store.digestBatches(2000).length,1);
 }finally{db.close();}
});
test('stale digest members can each be explicitly reassessed without changing uncertain batches',()=>{
 const {db,store}=setup();try {
  for(const id of ['a','b','u']){db.prepare('INSERT INTO gmail_arrivals VALUES (?,?)').run('owner',id);db.prepare('INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,summary) VALUES (?,?,?,?,?,?)').run('owner',id,1,id,id==='u'?'uncertain':id==='a'?'stale':'digest_batched','old '+id);}
  db.prepare("INSERT INTO inbox_digest_batches VALUES ('stale-batch',1,'stale','old digest',NULL,0)").run();for(const id of ['a','b'])db.prepare('INSERT INTO inbox_digest_items VALUES (?,?)').run('stale-batch',id);
  db.prepare("INSERT INTO inbox_digest_batches VALUES ('uncertain-batch',1,'uncertain','unknown',NULL,0)").run();db.prepare("INSERT INTO inbox_digest_items VALUES ('uncertain-batch','u')").run();
  store.reviewCandidate('owner','a',1);assert.equal(store.item('b').state,'stale');assert.equal(store.next(),'a');store.add('owner','a',1,'a-new');assert.equal(store.item('a-new').forced_private,1);
  store.reviewCandidate('owner','b',1);assert.equal(store.next(),'b');store.add('owner','b',1,'b-new');assert.equal(store.item('b-new').forced_private,1);assert.throws(()=>store.reviewCandidate('owner','u',1));
  assert.equal(store.item('u').state,'uncertain');assert.equal(db.prepare("SELECT text FROM inbox_digest_batches WHERE id='stale-batch'").get().text,'old digest');
 }finally{db.close();}
});
test('sensitive sender protection survives same-item urgency and not-sensitive edits until clear',()=>{
 const {db,store}=setup();try {
  for(const id of ['old','new'])db.prepare('INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,sender_key) VALUES (?,?,?,?,?,?)').run('owner',id,1,id,id==='old'?'delivered':'evaluating','sender');
  store.correct('s','old','sensitive');store.correct('u','old','urgent');store.correct('n','old','not-sensitive');assert.equal(store.hasSensitiveFeedback('new'),true);
  store.correct('c','old','clear');assert.equal(store.hasSensitiveFeedback('new'),false);
 }finally{db.close();}
});
test('a compatible preference change preserves a delivered correction binding',()=>{
 const {db,store,prefs}=setup();try {db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES ('owner','a',1,'a','delivered')").run();store.configure({...prefs,attention:'different'});assert.equal(store.item('a').settings_revision,2);}finally{db.close();}
});
test('privacy edits keep an in-flight delivery bound and force clarification on rejection',()=>{
 const {db,store,prefs}=setup();try {db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES ('owner','a',1,'a','sending')").run();store.configure({...prefs,sensitiveTerms:['private']});store.deferDelivery('item','a','sending','ready',1000);assert.equal(store.item('a').settings_revision,2);assert.equal(store.item('a').state,'clarify');assert.equal(store.deliveries(999).length,0);assert.equal(store.deliveries(1000).length,1);}finally{db.close();}
});
test('revoked delivery preserves its retry deadline through owner reassessment',()=>{
 const {db,store}=setup();try {
  db.prepare("INSERT INTO gmail_arrivals VALUES ('owner','a')").run();db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES ('owner','a',1,'old','sending')").run();
  store.deferDelivery('item','old','sending','ready',7200000,false);assert.equal(store.item('old').state,'stale');store.retryEvaluation('old',1);store.add('owner','a',1,'new');store.setResult('new','ready','summary');assert.equal(store.deliveries(7199999).length,0);assert.equal(store.deliveries(7200000).length,1);
 }finally{db.close();}
});
test('revoked digest retains deadlines for all stale members when reassessed',()=>{
 const {db,store}=setup();try {
  for(const id of ['a','b']){db.prepare('INSERT INTO gmail_arrivals VALUES (?,?)').run('owner',id);db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state) VALUES ('owner',?,1,?,'digest_batched')").run(id,id);}
  db.prepare("INSERT INTO inbox_digest_batches VALUES ('batch',1,'sending','digest',NULL,0)").run();for(const id of ['a','b'])db.prepare('INSERT INTO inbox_digest_items VALUES (?,?)').run('batch',id);
  store.deferDelivery('digest','batch','sending','pending',7200000,false);for(const id of ['a','b']){assert.equal(store.item(id).state,'stale');store.retryEvaluation(id,1);store.add('owner',id,1,id+'-new');store.setResult(id+'-new','ready','summary');}assert.equal(store.deliveries(7199999).length,0);assert.equal(store.deliveries(7200000).length,2);
 }finally{db.close();}
});
test('a pending rate-limited digest retains its deadline when a sender is corrected',()=>{
 const {db,store}=setup();try {
  db.prepare("INSERT INTO inbox_monitor_items(account_id,message_id,settings_revision,attempt_id,state,sender_key) VALUES ('owner','old',1,'old','delivered','sender'),('owner','a',1,'a','digest_batched','sender'),('owner','b',1,'b','digest_batched','other')").run();
  db.prepare("INSERT INTO inbox_digest_batches VALUES ('batch',1,'sending','digest',NULL,0)").run();db.prepare("INSERT INTO inbox_digest_items VALUES ('batch','a'),('batch','b')").run();store.deferDelivery('digest','batch','sending','pending',7200000);store.correct('sensitive','old','sensitive');assert.equal(JSON.parse(db.prepare("SELECT snapshot FROM inbox_digest_archive WHERE batch_id='batch'").get().snapshot).text,'digest');assert.equal(db.prepare("SELECT count(*) AS n FROM inbox_digest_history WHERE batch_id='batch'").get().n,2);
  assert.equal(store.item('a').state,'clarify');assert.equal(store.item('b').state,'digest_pending');assert.equal(store.deliveries(7199999).length,0);db.exec('UPDATE inbox_monitor_settings SET next_digest_at=0');store.claimDigest('new',1,3600001,7199999);assert.equal(store.digestBatches(7199999).length,0);db.exec('UPDATE inbox_monitor_settings SET next_digest_at=0');store.claimDigest('new',1,3600001,7200000);assert.equal(store.digestBatches(7200000).length,1);assert.equal(store.deliveries(7200000).length,1);
 }finally{db.close();}
});
