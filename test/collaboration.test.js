import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollaborationStore, collaborationSchema } from '../dist/collaboration.js';

function setup(path=':memory:') {
 const db=new DatabaseSync(path);
 db.exec("PRAGMA foreign_keys=ON; CREATE TABLE bots(id TEXT PRIMARY KEY); CREATE TABLE task_attempts(id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id), state TEXT NOT NULL); INSERT INTO bots VALUES ('owner'),('helper'),('other'); INSERT INTO task_attempts VALUES ('parent','owner','running'),('child','helper','queued'),('other-attempt','other','running'),('done','helper','completed');");
 db.exec(collaborationSchema); return {db,store:new CollaborationStore(db)};
}
const assignment={id:'a',commandId:'create',fingerprint:'digest',parentAttemptId:'parent',helperAttemptId:'child',requesterBotId:'owner',helperBotId:'helper',objective:'Find evidence',context:'Only this task'};
const msg={assignmentId:'a',botId:'owner',id:'m1',commandId:'send1',fingerprint:'d1',kind:'request',toBotId:'helper',body:'Please investigate'};
test('assignment checks attempts, participants, nesting and idempotency',()=>{
 const {db,store}=setup(); try {
  assert.throws(()=>store.create({...assignment,parentAttemptId:'missing'}),/parent/);
  assert.throws(()=>store.create({...assignment,helperAttemptId:'done'}),/helper/);
  assert.throws(()=>store.create({...assignment,helperBotId:'owner'}),/Self/);
  store.create(assignment); assert.equal(store.create(assignment).id,'a');
  assert.throws(()=>store.create({...assignment,objective:'changed'}),/conflict/);
  assert.throws(()=>store.create({...assignment,id:'b',commandId:'b',parentAttemptId:'child',requesterBotId:'helper',helperAttemptId:'other-attempt',helperBotId:'other'}),/Nested/);
  assert.throws(()=>store.inspect({assignmentId:'a',botId:'other'}),/not found/);
 } finally {db.close();}
});
test('ordered messages are scoped, idempotent and require valid replies',()=>{
 const {db,store}=setup(); try {
  store.create(assignment);assert.throws(()=>store.append({...msg,commandId:'create'}),/conflict/);store.append(msg);assert.equal(store.append(msg).id,'m1');
  assert.throws(()=>store.append({...msg,body:'different'}),/conflict/);
  assert.throws(()=>store.append({...msg,id:'evil',commandId:'evil',botId:'other'}),/not found/);
  assert.throws(()=>store.append({...msg,id:'evil',commandId:'evil',toBotId:'other'}),/recipient/);
  assert.throws(()=>store.append({...msg,id:'a1',commandId:'a1',kind:'answer',inReplyTo:'m1'}),/reply/);
  store.append({...msg,id:'q',commandId:'q',kind:'question',botId:'helper',toBotId:'owner',body:'Which source?'});
  store.append({...msg,id:'answer',commandId:'answer',kind:'answer',inReplyTo:'q',body:'The task source'});
  assert.throws(()=>store.append({...msg,id:'answer2',commandId:'answer2',kind:'answer',inReplyTo:'q'}),/already answered/);
  assert.deepEqual(store.inspect({assignmentId:'a',botId:'helper'}).messages.map(m=>m.id),['m1','q','answer']);
 } finally {db.close();}
});
test('terminal transitions reject new messages except explicitly observed late helper output',()=>{
 const {db,store}=setup(); try {
  store.create(assignment);store.append(msg);assert.throws(()=>store.finish({assignmentId:'a',botId:'helper',state:'completed'}),/requester/);
  store.finish({assignmentId:'a',botId:'owner',state:'cancelled'});
  assert.throws(()=>store.finish({assignmentId:'a',botId:'owner',state:'completed'}),/terminal/);
  assert.throws(()=>store.append({...msg,id:'new',commandId:'new'}),/terminal/);
  assert.throws(()=>store.append({...msg,id:'wrong-late',commandId:'wrong-late',late:true}),/late/);
  store.append({...msg,id:'late',commandId:'late',kind:'result',botId:'helper',toBotId:'owner',inReplyTo:'m1',late:true});
  assert.equal(store.inspect({assignmentId:'a',botId:'owner'}).messages[1].late,1);
 } finally {db.close();}
});
test('records survive close and reopen without retry',()=>{
 const dir=mkdtempSync(join(tmpdir(),'staf-collaboration-')),path=join(dir,'db');
 try {const {db,store}=setup(path);store.create(assignment);store.append(msg);db.close();
  const reopened=new DatabaseSync(path);try {const state=new CollaborationStore(reopened).inspect({assignmentId:'a',botId:'owner'});assert.equal(state.assignment.state,'active');assert.equal(state.messages.length,1);}finally{reopened.close();}
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('attempt stop blocks ordinary traffic and preserves correlated late outcome',()=>{
 for (const [attempt,state] of [['parent','stopping'],['parent','interrupted'],['child','failed'],['child','stopped']]) {
  const {db,store}=setup(); try {
   store.create(assignment);store.append(msg);
   db.prepare('UPDATE task_attempts SET state=? WHERE id=?').run(state,attempt);
   assert.throws(()=>store.append({...msg,id:'q',commandId:'q',kind:'question',botId:'helper',toBotId:'owner'}),/terminal/);
   assert.equal(store.finish({assignmentId:'a',botId:'owner',state:'cancelled'}).state,'cancelled');
   const result={...msg,id:'result',commandId:'result',kind:'result',botId:'helper',toBotId:'owner',inReplyTo:'m1'};
   assert.throws(()=>store.append(result),/terminal/);
   store.append({...result,late:true});
   assert.throws(()=>store.append({...result,id:'duplicate',commandId:'duplicate',late:true}),/duplicate outcome/);
   assert.equal(store.inspect({assignmentId:'a',botId:'owner'}).messages.at(-1).late,1);
  } finally {db.close();}
 }
});
test('outcome requires the request and completion requires a matching outcome',()=>{
 const {db,store}=setup(); try {
  store.create(assignment);
  assert.throws(()=>store.append({...msg,id:'r',commandId:'r',kind:'result',botId:'helper',toBotId:'owner'}),/Request required/);
  store.append(msg);
  assert.throws(()=>store.finish({assignmentId:'a',botId:'owner',state:'completed'}),/outcome/);
  assert.throws(()=>store.append({...msg,id:'r',commandId:'r',kind:'result',botId:'helper',toBotId:'owner'}),/outcome/);
  store.append({...msg,id:'r',commandId:'r',kind:'result',botId:'helper',toBotId:'owner',inReplyTo:'m1'});
  assert.throws(()=>store.append({...msg,id:'f',commandId:'f',kind:'failure',botId:'helper',toBotId:'owner',inReplyTo:'m1'}),/duplicate outcome/);
  assert.equal(store.finish({assignmentId:'a',botId:'owner',state:'completed'}).state,'completed');
 } finally {db.close();}
});

test('runtime helper tool is opt-in and passes bounded arguments to the trusted task callback', async () => {
 const {runTurn}=await import('../dist/runtime.js');
 const session={version:1,id:'parent',provider:null,messages:[],events:[]};let count=0, seen;
 const provider={name:'synthetic',capabilities:{toolCalls:true},async complete(messages,tools){
  assert.ok(tools.some(tool=>tool.function.name==='request_bot_help'));
  if(count++===0)return {role:'assistant',content:null,tool_calls:[{id:'call',type:'function',function:{name:'request_bot_help',arguments:JSON.stringify({helperId:'helper',objective:'Check',context:'Only this'})}}]};
  assert.equal(messages.at(-1).content,'Recorded in task inbox');return {role:'assistant',content:'Done'};
 }};
 const task={drain:()=>[],hasPending:()=>false,finish:()=>true,clarify:async()=>'',delegate:async request=>{seen=request;return 'Recorded in task inbox';}};
 await runTurn({session,store:{save:async()=>{}},provider,text:'Start',task});
 assert.deepEqual(seen,{callId:'call',helperId:'helper',objective:'Check',context:'Only this'});
});
