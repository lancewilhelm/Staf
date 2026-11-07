import test from 'node:test';
import assert from 'node:assert/strict';
import { Instance } from '../dist/instance.js';

function setup() {
 const instance=new Instance(':memory:');
 const bot=instance.createBot({name:'Ada',instructions:'',provider:'live',model:'fixture-offline'});
 instance.claim({id:'command',botId:bot.id,content:'read'});
 instance.setWebPermission('instance',true);instance.setWebPermission('bot:'+bot.id,true);
 const work={kind:'command',id:'command'}, boundary={kind:'web',url:'https://example.com/a'};
 const grant=instance.createApprovalGrant(work,boundary,'bot','remembered');
 const identity=instance.webIdentity(work,'call',0,boundary.url),journal=instance.webJournal();
 const prepared=journal.prepare({...identity,work,summary:'Read public web page'});
 return {instance,bot,work,boundary,grant,journal,prepared,controller:new AbortController()};
}
function claim(x) {return x.instance.claimGrantedAction({work:x.work,callId:'call',hop:0,boundary:x.boundary,journal:x.journal,permit:x.prepared.permit,controller:x.controller});}
test('revocation first blocks the claim and starts no action',()=>{
 const x=setup();try{x.instance.revokeApprovalGrant(x.grant.id,x.grant.revision);assert.throws(()=>claim(x));assert.equal(x.journal.get(x.prepared.action.id).state,'prepared');}finally{x.instance.close();}
});
test('claim first starts once and revocation aborts the associated controller',()=>{
 const x=setup();try{assert.equal(claim(x),x.grant.id);assert.equal(x.journal.get(x.prepared.action.id).state,'started');assert.throws(()=>claim(x));x.instance.revokeApprovalGrant(x.grant.id,x.grant.revision);assert.equal(x.controller.signal.aborted,true);}finally{x.instance.close();}
});
test('exact boundary, live permissions and ask-every-time remain enforced',()=>{
 for(const change of ['boundary','permission','mode']){const x=setup();try{if(change==='boundary')x.boundary={kind:'web',url:'https://example.com/b'};if(change==='permission')x.instance.setWebPermission('instance',false);if(change==='mode')x.instance.setApprovalSettings('instance','ask-every-time',true);assert.throws(()=>claim(x));assert.equal(x.journal.get(x.prepared.action.id).state,'prepared');}finally{x.instance.close();}}
});
test('a different payload or work permit cannot be substituted for the approved action',()=>{
 for(const crossWork of [false,true]){const x=setup();try{
  const work=crossWork?{kind:'command',id:'other'}:x.work;
  if(crossWork){const bot=x.instance.createBot({name:'B',instructions:'',provider:'live',model:'fixture-offline'});x.instance.claim({id:'other',botId:bot.id,content:'read'});}
  const other=x.instance.webIdentity(work,'other-call',0,'https://example.com/b');
  const unrelated=x.journal.prepare({...other,work,summary:'Read public web page'});
  assert.throws(()=>x.instance.claimGrantedAction({work:x.work,callId:'call',hop:0,boundary:x.boundary,journal:x.journal,permit:unrelated.permit,controller:x.controller}));
  assert.equal(x.journal.get(other.id).state,'prepared');assert.equal(x.journal.get(x.prepared.action.id).state,'prepared');
 }finally{x.instance.close();}}
});
test('failed commit rolls back the claim without losing its start permit',()=>{
 const x=setup();try{
  const db=x.instance.db,original=db.exec.bind(db);let injected=false;
  db.exec=sql=>{if(sql==='COMMIT'&&!injected){injected=true;throw Error('synthetic commit failure');}return original(sql);};
  assert.throws(()=>claim(x),/synthetic commit failure/);
  assert.equal(x.journal.get(x.prepared.action.id).state,'prepared');
  assert.equal(claim(x),x.grant.id);assert.equal(x.journal.get(x.prepared.action.id).state,'started');
 }finally{x.instance.close();}
});
test('editing a grant aborts its current action and requires its current revision',()=>{
 const x=setup();try{claim(x);x.instance.editApprovalGrant(x.grant.id,x.grant.revision,{kind:'bot',botId:x.bot.id},{kind:'remembered'});assert.equal(x.controller.signal.aborted,true);assert.throws(()=>x.instance.editApprovalGrant(x.grant.id,x.grant.revision,{kind:'all-bots'},{kind:'remembered'}));}finally{x.instance.close();}
});
test('malformed, extended and sensitive grant boundaries are rejected',()=>{
 const x=setup();try{
  for(const boundary of [{kind:'web',url:'https://example.com/a',extra:'widen'}, {kind:'web',url:'https://example.com/?token=secret'}, {kind:'unknown'}, {kind:'search',query:'ok',origin:'http://127.0.0.1:1',revision:1,results:100,timeoutMs:10000}])assert.throws(()=>x.instance.createApprovalGrant(x.work,boundary,'bot','remembered'));
  assert.equal(x.instance.listApprovalGrants().length,1);
 }finally{x.instance.close();}
});
test('failed decision or grant recording cannot leave a remembered authorization',()=>{
 for(const table of ['web_action_decisions','approval_grants']){const x=setup();try{
  x.instance.revokeApprovalGrant(x.grant.id,x.grant.revision);
  x.instance.db.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
  assert.throws(()=>x.instance.recordGrantedDecision({work:x.work,boundary:x.boundary,id:x.prepared.action.id,fingerprint:x.prepared.action.fingerprint,callId:'call',hop:0,scope:'bot',lifetime:'remembered'}));
  assert.equal(x.instance.listApprovalGrants().filter(g=>!g.revoked).length,0);
  assert.equal(x.instance.db.prepare('SELECT count(*) AS count FROM web_action_decisions').get().count,0);
 }finally{x.instance.close();}}
});
test('decision cannot create a grant for a different prepared boundary',()=>{
 const x=setup();try{assert.throws(()=>x.instance.recordGrantedDecision({work:x.work,boundary:{kind:'web',url:'https://example.com/b'},id:x.prepared.action.id,fingerprint:x.prepared.action.fingerprint,callId:'call',hop:0,scope:'bot',lifetime:'remembered'}));assert.equal(x.instance.listApprovalGrants().length,1);assert.equal(x.instance.db.prepare('SELECT count(*) AS count FROM web_action_decisions').get().count,0);}finally{x.instance.close();}
});
