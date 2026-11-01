import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { TaskInbox, taskInboxSchema } from '../dist/task-inbox.js';

function fixture() {
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE task_attempts(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, state TEXT NOT NULL); INSERT INTO task_attempts VALUES('a','bot','running'),('b','other','running');");
 db.exec(taskInboxSchema);return {db, inbox:new TaskInbox(db),scope:{botId:'bot',attemptId:'a'}};
}
const direction=(scope,commandId,digest=commandId)=>({...scope,commandId,digest,kind:'direction',text:'redacted direction'});
test('scope, deduplication, ordered claims and completion barrier',()=>{
 const {db,inbox,scope}=fixture();try {
  assert.equal(inbox.enqueue(direction(scope,'one')).kind,'accepted');
  assert.equal(inbox.enqueue(direction(scope,'one')).kind,'existing');
  assert.throws(()=>inbox.enqueue(direction(scope,'one','different')),/conflict/);
  assert.throws(()=>inbox.inspect({...scope,botId:'other'}),/not found/);
  assert.throws(()=>inbox.enqueue(direction({...scope,attemptId:'b'},'one')),/not found/);
  inbox.enqueue(direction(scope,'two'));assert.equal(inbox.hasPending(scope),true);
  assert.throws(()=>inbox.mark({...scope,commandId:'two',status:'applied'}),/transition/);
  assert.equal(inbox.claimNext(scope).command_id,'one');assert.equal(inbox.claimNext(scope).command_id,'one');
  inbox.mark({...scope,commandId:'one',status:'applied'});assert.equal(inbox.claimNext(scope).command_id,'two');
  inbox.mark({...scope,commandId:'two',status:'rejected'});assert.equal(inbox.hasPending(scope),false);
  db.exec("UPDATE task_attempts SET state='completed' WHERE id='a'");
  assert.throws(()=>inbox.enqueue(direction(scope,'late')),/not active/);
  assert.equal(inbox.enqueue(direction(scope,'one')).kind,'existing');
 } finally {db.close();}
});
test('question has one matching answer and stale replies cannot be accepted',()=>{
 const {db,inbox,scope}=fixture();try {
  inbox.createQuestion({...scope,questionId:'q',text:'Which file?'});
  assert.throws(()=>inbox.createQuestion({...scope,questionId:'q2',text:'Another?'}));
  const answer={...scope,commandId:'answer',digest:'digest',kind:'answer',questionId:'q',text:'The redacted file'};
  assert.equal(inbox.enqueue(answer).kind,'accepted');assert.equal(inbox.enqueue(answer).kind,'existing');
  assert.throws(()=>inbox.enqueue({...answer,commandId:'other'}),/not open/);
  assert.equal(inbox.inspect(scope).questions[0].state,'answered');
  inbox.createQuestion({...scope,questionId:'q2',text:'Another?'});inbox.cancelQuestion({...scope,questionId:'q2'});
  assert.throws(()=>inbox.enqueue({...answer,commandId:'stale',questionId:'q2'}),/not open/);
  assert.throws(()=>inbox.enqueue({...answer,commandId:'wrong',questionId:'missing'}),/not open/);
 } finally {db.close();}
});
test('stop and interruption retain pending work without applying it',()=>{
 const {db,inbox,scope}=fixture();try {
  inbox.enqueue(direction(scope,'one'));inbox.claimNext(scope);inbox.enqueue(direction(scope,'two'));
  db.exec("UPDATE task_attempts SET state='stopping' WHERE id='a'");
  assert.throws(()=>inbox.enqueue(direction(scope,'late')),/not active/);
  assert.throws(()=>inbox.claimNext(scope),/not active/);
  assert.throws(()=>inbox.mark({...scope,commandId:'one',status:'applied'}),/not active/);
  db.exec("UPDATE task_attempts SET state='interrupted' WHERE id='a'");
  assert.deepEqual(inbox.inspect(scope).inputs.map(x=>x.status),['claimed','accepted']);
  inbox.mark({...scope,commandId:'one',status:'cancelled'});assert.equal(inbox.hasPending(scope),true);
 } finally {db.close();}
});

test('a serialized completion boundary observes accepted direction',()=>{
 const {db,inbox,scope}=fixture();try {
  inbox.enqueue(direction(scope,'before-completion'));
  db.exec('BEGIN IMMEDIATE');
  assert.equal(inbox.hasPending(scope),true);
  db.exec('ROLLBACK');
  inbox.claimNext(scope);inbox.mark({...scope,commandId:'before-completion',status:'applied'});
  db.exec('BEGIN IMMEDIATE');
  assert.equal(inbox.hasPending(scope),false);
  db.prepare("UPDATE task_attempts SET state='completed' WHERE id=?").run(scope.attemptId);
  db.exec('COMMIT');
  assert.throws(()=>inbox.enqueue(direction(scope,'after-completion')),/not active/);
 } finally {db.close();}
});
