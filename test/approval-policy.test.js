import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateApproval } from '../dist/approval-policy.js';

const action = { capability: 'email', operation: 'send', resource: 'alex', effect: 'send-exact-message', limits: { message: 'hello' }, risk: 'risky' };
const permission = { enabledCapabilities: ['email'], actions: [action] };
const grant = { botScope: { kind: 'bot', botId: 'bot-1' }, duration: { kind: 'task', taskId: 'task-1' }, action, expiresAt: 200, revoked: false };
const base = { action, botId: 'bot-1', taskId: 'task-1', scheduleId: null, now: 100, instancePermissions: permission, botPermissions: permission, taskScope: [action], modes: ['ask-for-risky-actions'], grants: [], ownerRequest: null };
const decide = (overrides = {}) => evaluateApproval({ ...base, ...overrides });

test('risky, unknown, safe, and never ask decisions', () => {
  assert.equal(decide().outcome, 'prompt');
  assert.equal(decide({ action: { ...action, risk: 'unknown' } }).outcome, 'prompt');
  assert.equal(decide({ action: { ...action, risk: 'safe' } }).reason, 'safe-action');
  assert.equal(decide({ modes: ['never-ask'] }).reason, 'never-ask');
  assert.equal(decide({ modes: ['never-ask', 'ask-for-risky-actions'] }).outcome, 'prompt');
});

test('explicit owner request and scoped grants authorize the exact action', () => {
  assert.equal(decide({ ownerRequest: { action } }).reason, 'owner-request');
  assert.equal(decide({ grants: [grant] }).reason, 'grant');
  assert.equal(decide({ grants: [{ ...grant, botScope: { kind: 'all-bots' }, duration: { kind: 'remembered' } }] }).reason, 'grant');
  assert.equal(decide({ grants: [{ ...grant, duration: { kind: 'schedule', scheduleId: 's1' } }], scheduleId: 's1' }).reason, 'grant');
  assert.equal(decide({ modes: ['ask-every-time'], grants: [grant], ownerRequest: { action } }).outcome, 'prompt');
});

test('grants fail closed for revocation, expiry, scope, and exact limits', () => {
  for (const bad of [
    { ...grant, revoked: true }, { ...grant, expiresAt: 100 }, { ...grant, expiresAt: NaN },
    { ...grant, botScope: { kind: 'bot', botId: 'other' } },
    { ...grant, duration: { kind: 'task', taskId: 'other' } },
    { ...grant, duration: { kind: 'schedule', scheduleId: 'other' } },
    { ...grant, action: { ...action, resource: 'someone-else' } },
    { ...grant, action: { ...action, effect: 'publish' } },
    { ...grant, action: { ...action, limits: { message: 'different' } } },
    { ...grant, action: { ...action, limits: {} } },
  ]) assert.equal(decide({ grants: [bad] }).outcome, 'prompt');
  assert.equal(decide({ ownerRequest: { action: { ...action, resource: 'other' } } }).outcome, 'prompt');
  assert.equal(decide({ now: NaN, grants: [grant] }).outcome, 'prompt');
});

test('permissions and scope block even with a grant or never ask', () => {
  const disabled = { ...permission, enabledCapabilities: [] };
  const cases = [
    [{ instancePermissions: disabled }, 'instance-permission'],
    [{ botPermissions: disabled }, 'bot-permission'],
    [{ taskScope: [] }, 'task-scope'],
    [{ helper: { permissions: disabled, assignmentScope: [action], mode: 'never-ask' } }, 'helper-permission'],
    [{ helper: { permissions: permission, assignmentScope: [], mode: 'never-ask' } }, 'assignment-scope'],
  ];
  for (const [change, reason] of cases) assert.deepEqual(decide({ ...change, modes: ['never-ask'], grants: [grant] }), { outcome: 'block', reason });
});

test('delegation uses the strictest mode and live revocation', () => {
  const helper = { permissions: permission, assignmentScope: [action], mode: 'ask-every-time' };
  assert.equal(decide({ modes: ['never-ask'], helper, grants: [grant] }).outcome, 'prompt');
  assert.equal(decide({ grants: [grant] }).outcome, 'allow');
  assert.equal(decide({ grants: [{ ...grant, revoked: true }] }).outcome, 'prompt');
});


test('malformed runtime modes and grant variants fail closed', () => {
  for (const modes of [[], ['bogus'], ['never-ask', 'bogus']]) {
    assert.deepEqual(decide({ modes }), { outcome: 'block', reason: 'invalid-policy' });
  }
  assert.equal(decide({ helper: { permissions: permission, assignmentScope: [action], mode: 'bogus' } }).outcome, 'block');
  for (const bad of [
    { ...grant, botScope: { kind: 'bogus' } },
    { ...grant, duration: { kind: 'bogus' } },
    { ...grant, revoked: undefined },
    { ...grant, duration: { kind: 'schedule', scheduleId: null } },
  ]) assert.equal(decide({ grants: [bad] }).outcome, 'prompt');
});
