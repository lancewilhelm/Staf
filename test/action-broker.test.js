import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ActionJournal, actionJournalSchema } from '../dist/action-journal.js';
import { ActionBroker } from '../dist/action-broker.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE task_attempts (id TEXT PRIMARY KEY); CREATE TABLE commands (id TEXT PRIMARY KEY)');
  db.exec(actionJournalSchema);
  db.exec("INSERT INTO task_attempts VALUES ('attempt')");
  const boundary = { capability: 'mail', operation: 'send', resource: 'alex', effect: 'send', limits: { digest: 'message-1' } };
  const action = { id: 'a', fingerprint: 'keyed-digest', work: { kind: 'task', id: 'attempt' }, summary: 'Send to Alex', action: { ...boundary, risk: 'risky' } };
  const permission = { enabledCapabilities: ['mail'], actions: [boundary] };
  const policy = { botId: 'bot', taskId: 'task', scheduleId: null, now: 100, instancePermissions: permission, botPermissions: permission, taskScope: [boundary], modes: ['ask-for-risky-actions'], grants: [], ownerRequest: null };
  const events = [];
  const hooks = { canonicalize: () => action, policy: () => policy, approve: async a => { events.push(['prompt', a.action]); return 'approve'; }, recordDecision: async (a, d) => events.push(['record', a.fingerprint, d]), effect: async () => { events.push(['effect']); return { state: 'succeeded', safeResult: 'sent' }; } };
  const journal = new ActionJournal(db);
  return { db, boundary, action, policy, events, hooks, journal, broker: new ActionBroker(journal, hooks) };
}

test('prompts, records exact approval, persists outcome, and never repeats an ID', async () => {
  const x = setup();
  assert.equal((await x.broker.execute({})).action.result, 'sent');
  assert.deepEqual(x.events, [['prompt', x.action.action], ['record', 'keyed-digest', 'approve'], ['effect']]);
  assert.equal((await x.broker.execute({})).kind, 'status');
  assert.equal(x.broker.status('a').state, 'succeeded');
  assert.equal(x.events.length, 3);
  x.db.close();
});

test('allows routine actions and blocks missing permission or scope', async () => {
  for (const blocked of ['none', 'permission', 'scope']) {
    const x = setup();
    x.action.action.risk = 'safe';
    if (blocked === 'permission') x.policy.botPermissions = { ...x.policy.botPermissions, enabledCapabilities: [] };
    if (blocked === 'scope') x.policy.taskScope = [{ ...x.boundary, resource: 'other' }];
    const result = await x.broker.execute({});
    assert.equal(result.kind, blocked === 'none' ? 'completed' : 'blocked');
    assert.equal(x.events.some(e => e[0] === 'effect'), blocked === 'none');
    x.db.close();
  }
});

test('revocation while awaiting approval blocks dispatch', async () => {
  const x = setup();
  x.hooks.approve = async () => { x.policy.botPermissions = { ...x.policy.botPermissions, enabledCapabilities: [] }; return 'approve'; };
  const result = await x.broker.execute({});
  assert.equal(result.reason, 'bot-permission');
  assert.deepEqual(x.events, [['record', 'keyed-digest', 'approve']]);
  x.db.close();
});

test('denial and cancellation prevent dispatch', async () => {
  const x = setup(); x.hooks.approve = async () => 'deny';
  assert.equal((await x.broker.execute({})).kind, 'denied');
  assert.deepEqual(x.events, [['record', 'keyed-digest', 'deny']]); x.db.close();
  const y = setup(); const controller = new AbortController();
  y.hooks.approve = async () => { controller.abort(); return 'approve'; };
  assert.equal((await y.broker.execute({}, controller.signal)).kind, 'cancelled');
  assert.equal(y.events.some(e => e[0] === 'effect'), false); y.db.close();
});

test('unsupported cumulative grants cannot authorize actions', async () => {
  const x = setup();
  x.policy.grants = [{ cumulative: true, grant: { botScope: { kind: 'bot', botId: 'bot' }, duration: { kind: 'task', taskId: 'task' }, action: x.boundary, expiresAt: null, revoked: false } }];
  assert.equal((await x.broker.execute({})).reason, 'unsupported-cumulative-grant');
  assert.deepEqual(x.events, []); x.db.close();
});

test('effect failures are uncertain and known results persist independently', async () => {
  for (const thrown of [true, false]) {
    const x = setup(); x.policy.modes = ['never-ask'];
    x.hooks.effect = async () => { assert.equal(x.broker.status('a').state, 'started'); if (thrown) throw new Error('secret'); return { state: 'failed', safeResult: 'redacted failure' }; };
    const result = await x.broker.execute({});
    assert.equal(result.action.state, thrown ? 'uncertain' : 'failed');
    assert.equal(result.action.result, thrown ? 'Outcome unknown' : 'redacted failure');
    assert.equal((await x.broker.execute({})).kind, 'status'); x.db.close();
  }
});

test('outer transaction blocks preparation before dispatch', async () => {
  const x = setup(); x.db.exec('BEGIN');
  await assert.rejects(x.broker.execute({}), /autocommit/);
  x.db.exec('ROLLBACK'); assert.equal(x.broker.status('a'), null); assert.deepEqual(x.events, []); x.db.close();
});

test('silence or an unexpected approval response never authorizes dispatch', async () => {
  for (const response of [undefined, null, 'approved', true]) {
    const x = setup(); x.hooks.approve = async () => response;
    const result = await x.broker.execute({});
    assert.equal(result.reason, 'invalid-approval-response');
    assert.equal(result.action.state, 'cancelled');
    assert.deepEqual(x.events, []); x.db.close();
  }
});

test('approval and dispatch receive an immutable snapshot of the requested scope', async () => {
  const x = setup();
  x.hooks.approve = async requested => {
    assert.throws(() => { requested.action.resource = 'other'; }, TypeError);
    assert.throws(() => { requested.action.limits.digest = 'other'; }, TypeError);
    assert.throws(() => { requested.work.id = 'other'; }, TypeError);
    x.action.action.resource = 'other';
    return 'approve';
  };
  x.hooks.effect = async requested => {
    assert.equal(requested.action.resource, 'alex');
    assert.equal(requested.action.limits.digest, 'message-1');
    assert.equal(requested.work.id, 'attempt');
    return { state: 'succeeded', safeResult: 'sent' };
  };
  assert.equal((await x.broker.execute({})).action.state, 'succeeded');
  x.db.close();
});

test('rejects undeclared payloads and non-record limits before preparation', async () => {
  for (const modify of [
    action => { action.payload = { nested: new Map([['recipient', 'other']]) }; },
    action => { action.action.payload = { recipient: 'other' }; },
    action => { action.work.payload = { nested: 'other' }; },
    action => { action.action.limits = new Map([['digest', 'message-1']]); },
  ]) {
    const x = setup(); modify(x.action);
    await assert.rejects(x.broker.execute({}), /Invalid canonical action/);
    assert.equal(x.broker.status('a'), null);
    assert.deepEqual(x.events, []); x.db.close();
  }
});


test('approval and decision errors cancel before dispatch and cannot be replayed', async () => {
 for (const stage of ['sync-approval','async-approval','sync-decision','async-decision']) {
  const x=setup();
  if(stage==='sync-approval') x.hooks.approve=()=>{throw Error('private');};
  if(stage==='async-approval') x.hooks.approve=async()=>{throw Error('private');};
  if(stage==='sync-decision') x.hooks.recordDecision=()=>{throw Error('private');};
  if(stage==='async-decision') x.hooks.recordDecision=async()=>{throw Error('private');};
  const result=await x.broker.execute({});assert.equal(result.kind,'blocked');assert.equal(result.action.state,'cancelled');assert.equal(x.events.some(e=>e[0]==='effect'),false);
  assert.equal((await x.broker.execute({})).kind,'status');assert.equal(x.broker.status('a').state,'cancelled');x.db.close();
 }
});

