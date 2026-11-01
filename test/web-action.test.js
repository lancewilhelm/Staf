import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ActionJournal, actionJournalSchema } from '../dist/action-journal.js';
import { readWebAction } from '../dist/web-action.js';

function fixture(t, settings={}) {
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE task_attempts (id TEXT PRIMARY KEY); CREATE TABLE commands (id TEXT PRIMARY KEY)');db.exec(actionJournalSchema);db.exec("INSERT INTO task_attempts VALUES ('task')");t.after(()=>db.close());
 const events=[],controller=new AbortController(),permission=new AbortController();
 const options={journal:new ActionJournal(db),key:Buffer.alloc(32,7),work:{kind:'task',id:'task'},callId:'call',signal:controller.signal,permissionSignal:permission.signal,
  policy:a=>{const boundary={...a.action};delete boundary.risk;const permitted={enabledCapabilities:['web.read'],actions:[boundary]};return {botId:'bot',taskId:'task',scheduleId:null,now:Date.now(),instancePermissions:permitted,botPermissions:settings.revoked?{enabledCapabilities:[],actions:[]}:permitted,taskScope:[boundary],modes:['never-ask'],grants:[],ownerRequest:null};},
  approve:async a=>{events.push(['approve',a.action.resource]);return settings.deny===a.action.resource?'deny':'approve';},recordDecision:async(a,d)=>events.push(['decision',a.fingerprint,d]),
  dependencies:{resolve:async host=>{events.push(['dns',host]);return [{address:settings.private?'127.0.0.1':'8.8.8.8',family:4}];},request:async url=>{events.push(['request',url.href]);return url.hostname==='one.example'?{status:302,headers:{location:'https://two.example/end'},body:(async function*(){})(),close(){}}:{status:200,headers:{'content-type':'text/plain'},body:(async function*(){yield Buffer.from('hello')})(),close(){}};}},
 };
 return {options,events,controller,permission,db};
}

test('each exact redirect target requires a durable approval before DNS',async t=>{
 const f=fixture(t);const result=await readWebAction('https://one.example/start',f.options);assert.equal(result.kind,'source');assert.equal(result.source.text,'hello');
 assert.deepEqual(f.events.map(x=>x[0]),['approve','decision','dns','request','approve','decision','dns','request']);
 assert.deepEqual(f.events.filter(x=>x[0]==='approve').map(x=>x[1]),['https://one.example/start','https://two.example/end']);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM action_journal WHERE state=?').get('succeeded').n,2);
 const duplicate=await readWebAction('https://one.example/start',f.options);assert.equal(duplicate.kind,'stopped');assert.equal(duplicate.reason,'status');assert.equal(f.events.length,8);
 await assert.rejects(readWebAction('https://elsewhere.example/',f.options),/different action/);
});

test('denied redirect and revoked permission prevent that hop from resolving',async t=>{
 const denied=fixture(t,{deny:'https://two.example/end'});const result=await readWebAction('https://one.example/start',denied.options);assert.equal(result.kind,'stopped');assert.equal(result.reason,'denied');assert.equal(denied.events.some(x=>x[0]==='dns'&&x[1]==='two.example'),false);
 const settings={};const revoked=fixture(t,settings);revoked.options.approve=async()=>{settings.revoked=true;return 'approve'};const blocked=await readWebAction('https://test.example/',revoked.options);assert.equal(blocked.kind,'stopped');assert.equal(blocked.reason,'blocked');assert.equal(revoked.events.some(x=>x[0]==='dns'),false);
});

test('refuses credential and query URLs, private DNS and aborted permissions',async t=>{
 for(const url of ['https://user:pass@example.com/','https://example.com/?token=secret']){const f=fixture(t);await assert.rejects(readWebAction(url,f.options));assert.deepEqual(f.events,[]);}
 const f=fixture(t,{private:true});const result=await readWebAction('https://example.com/',f.options);assert.equal(result.kind,'stopped');assert.equal(result.action.state,'uncertain');assert.equal(f.events.some(x=>x[0]==='request'),false);
 const cancelled=fixture(t);cancelled.permission.abort();await assert.rejects(readWebAction('https://example.com/',cancelled.options));assert.deepEqual(cancelled.events,[]);
});

test('permission revocation during DNS aborts before HTTP and never replays',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.options.dependencies.resolve=async()=>{entered();await gate;return [{address:'8.8.8.8',family:4}];};
 const pending=readWebAction('https://example.com/',f.options);await started;f.permission.abort();const result=await pending;assert.equal(result.kind,'stopped');assert.equal(result.action.state,'uncertain');release();await new Promise(r=>setImmediate(r));assert.equal(f.events.some(x=>x[0]==='request'),false);
});


test('permission revocation ends a stalled approval without recording approval or dispatch',async t=>{
 const f=fixture(t);let entered;const started=new Promise(r=>entered=r);
 f.options.approve=async()=>{entered();return new Promise(()=>{});};
 const pending=readWebAction('https://example.com/',f.options);await started;f.permission.abort();
 const result=await pending;assert.equal(result.kind,'stopped');assert.equal(result.action.state,'cancelled');assert.deepEqual(f.events,[]);
});


test('approval delays do not consume per-hop network timeout',async t=>{
 const f=fixture(t);let approvals=0;f.options.timeoutMs=10;
 f.options.approve=async()=>{approvals++;await new Promise(r=>setTimeout(r,30));return 'approve';};
 const result=await readWebAction('https://one.example/start',f.options);
 assert.equal(result.kind,'source');assert.equal(approvals,2);
});

test('full paths appear in owner approval only and are absent from durable records',async t=>{
 const f=fixture(t);let visible;f.options.approve=async a=>{visible=a.action.resource;return 'approve';};
 const result=await readWebAction('https://two.example/private-secret',f.options);assert.equal(result.kind,'source');assert.equal(visible,'https://two.example/private-secret');
 const rows=f.db.prepare('SELECT * FROM action_journal').all();assert.doesNotMatch(JSON.stringify(rows),/private-secret|two.example/);
 assert.doesNotMatch(JSON.stringify(f.events.filter(x=>x[0]==='decision')),/private-secret|two.example/);
});

test('cancellation during redirect approval does not resolve or request the redirect',async t=>{
 const f=fixture(t);let entered;const waiting=new Promise(r=>entered=r);let count=0;
 f.options.approve=async()=>{if(++count===1)return 'approve';entered();return new Promise(()=>{});};
 const pending=readWebAction('https://one.example/start',f.options);await waiting;f.controller.abort();
 const result=await pending;assert.equal(result.kind,'stopped');assert.equal(result.action.state,'cancelled');
 assert.equal(f.events.some(x=>x[0]==='dns'&&x[1]==='two.example'),false);
 assert.equal(f.events.filter(x=>x[0]==='request').length,1);
});
