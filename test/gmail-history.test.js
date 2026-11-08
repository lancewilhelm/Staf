import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GmailHistory, GmailHistoryExpired, gmailHistorySchema} from '../dist/gmail-history.js';

test('history baseline, arrivals and cursor survive restart without duplicates', async () => {
  const dir=mkdtempSync(join(tmpdir(),'staf-gmail-history-')), path=join(dir,'db');
  let db=new DatabaseSync(path); db.exec(gmailHistorySchema);
  let pages=[];
  const transport={profile:async()=>({emailAddress:'owner@example.test',historyId:'10'}),history:async ({pageToken})=>pages.find(page=>page.token===pageToken).value};
  try {
    let history=new GmailHistory(db,transport);
    await history.connect('owner@example.test');
    assert.deepEqual(history.arrivals('owner@example.test'),[]);
    pages=[{token:undefined,value:{historyId:'15',nextPageToken:'next',messageIds:['new-a']}},{token:'next',value:{historyId:'15',messageIds:['new-a','new-b']}}];
    await history.poll('owner@example.test');
    assert.deepEqual(history.arrivals('owner@example.test').map(x=>x.messageId),['new-a','new-b']);
    db.close(); db=new DatabaseSync(path);history=new GmailHistory(db,transport);
    pages=[{token:undefined,value:{historyId:'16',messageIds:['new-a','new-c']}}];
    await history.poll('owner@example.test');
    assert.deepEqual(history.arrivals('owner@example.test').map(x=>x.messageId),['new-a','new-b','new-c']);
    assert.equal(history.status('owner@example.test').cursor,'16');
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test('an expired cursor stays in place and reports the unknown interval', async () => {
  const db=new DatabaseSync(':memory:');db.exec(gmailHistorySchema);
  const transport={profile:async()=>({emailAddress:'owner@example.test',historyId:'10'}),history:async()=>{throw new GmailHistoryExpired();}};
  try {
    const history=new GmailHistory(db,transport);await history.connect('owner@example.test');
    await assert.rejects(history.poll('owner@example.test'),GmailHistoryExpired);
    assert.deepEqual(history.status('owner@example.test'),{cursor:'10',state:'uncertain',detail:'History expired; arrivals during the gap are unknown'});
    transport.profile=async()=>({emailAddress:'owner@example.test',historyId:'100'});
    await history.connect('owner@example.test');
    assert.equal(history.status('owner@example.test').cursor,'10');
  } finally {db.close();}
});

test('failed pages and stale polls never advance the checkpoint or lose arrivals', async () => {
  const db=new DatabaseSync(':memory:');db.exec(gmailHistorySchema);
  let fail=true,release; const gate=new Promise(resolve=>{release=resolve});
  const transport={profile:async()=>({emailAddress:'owner@example.test',historyId:'10'}),history:async ({pageToken})=>{if(!pageToken)return {historyId:'20',nextPageToken:'next',messageIds:['a']};if(fail)throw Error('offline');await gate;return {historyId:'20',messageIds:[]};}};
  try {
    const history=new GmailHistory(db,transport);await history.connect('owner@example.test');
    await assert.rejects(history.poll('owner@example.test'),/offline/);
    assert.equal(history.status('owner@example.test').cursor,'10');assert.deepEqual(history.arrivals('owner@example.test'),[]);
    assert.equal(history.status('owner@example.test').state,'failed');
    fail=false;const first=history.poll('owner@example.test'),second=history.poll('owner@example.test');release();
    const results=await Promise.allSettled([first,second]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(history.status('owner@example.test').cursor,'20');assert.deepEqual(history.arrivals('owner@example.test').map(x=>x.messageId),['a']);
  } finally {db.close();}
});

test('revoking authority during a scan prevents committing the fetched page', async () => {
  const db=new DatabaseSync(':memory:');db.exec(gmailHistorySchema);
  let allowed=true,release,started;const startedPromise=new Promise(resolve=>{started=resolve});const gate=new Promise(resolve=>{release=resolve});
  const transport={profile:async()=>({emailAddress:'owner@example.test',historyId:'10'}),history:async()=>{started();await gate;return {historyId:'11',messageIds:['new']};}};
  try {
    const history=new GmailHistory(db,transport,()=>{if(!allowed)throw Error('revoked');});await history.connect('owner@example.test');
    const poll=history.poll('owner@example.test');await startedPromise;allowed=false;release();
    await assert.rejects(poll,/revoked/);
    assert.equal(history.status('owner@example.test').cursor,'10');assert.deepEqual(history.arrivals('owner@example.test'),[]);
  } finally {db.close();}
});
