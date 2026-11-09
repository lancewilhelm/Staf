import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {InboxMonitorStore,inboxMonitorSchema} from '../dist/inbox-monitor.js';

function setup() {
 const db=new DatabaseSync(':memory:');db.exec(inboxMonitorSchema);db.exec(`
 ALTER TABLE inbox_monitor_settings ADD COLUMN digest_minutes INTEGER NOT NULL DEFAULT 60;
 ALTER TABLE inbox_monitor_settings ADD COLUMN next_digest_at INTEGER NOT NULL DEFAULT 0;
 ALTER TABLE inbox_monitor_settings ADD COLUMN memory_context INTEGER NOT NULL DEFAULT 0;
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
