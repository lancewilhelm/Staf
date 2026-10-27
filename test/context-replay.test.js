import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {contextStatus, contextDetails, contextFooter} from '../dist/context-status.js';
import {responsesRequest} from '../dist/codex-direct.js';
import {resolveSettings} from '../dist/settings.js';
import {Store} from '../dist/store.js';
import {tools} from '../dist/runtime.js';

const effective = (provider = 'codex', model = 'test') => resolveSettings({saved: {}, file: {}, shell: {}, cli: {provider, model}, session: {}});
const replaySession = (encrypted = 'opaque') => ({
  version: 1,
  id: '00000000-0000-0000-0000-000000000000',
  provider: 'codex-direct:test',
  messages: [
    {role: 'user', content: 'Hello'},
    {role: 'assistant', content: 'Hello back', responseReplay: {provider: 'codex-direct', model: 'test', items: [
      {type: 'reasoning', id: 'reasoning-1', encrypted_content: encrypted},
      {type: 'message', role: 'assistant', content: [{type: 'output_text', text: 'Hello back'}]},
    ]}},
  ],
  events: [],
});

test('opaque replay length does not inflate the visible context estimate', () => {
  const short = contextStatus(replaySession(), effective());
  const long = contextStatus(replaySession('x'.repeat(20000)), effective());
  assert.equal(long.bytes, short.bytes);
  assert.equal(long.proxyTokens, short.proxyTokens);
  assert.equal(long.excludedReasoningItems, 1);
});

test('readable replay and submitted user input still grow the visible estimate', () => {
  const session = replaySession('x'.repeat(20000));
  const before = contextStatus(session, effective());
  const expanded = structuredClone(session);
  expanded.messages[1].responseReplay.items[1].content.push({type: 'refusal', refusal: 'Readable refusal. '.repeat(100)});
  const readable = contextStatus(expanded, effective());
  assert.ok(readable.proxyTokens > before.proxyTokens);
  const pending = contextStatus(session, effective(), 'Submitted input. '.repeat(100));
  assert.ok(pending.proxyTokens > before.proxyTokens);
  assert.equal(pending.messages, 3);
  assert.equal(pending.pending, true);
});

test('context details identify omitted opaque items without claiming their occupancy', () => {
  const session = replaySession('private-opaque-content');
  session.messages[1].responseReplay.items.unshift({type: 'reasoning', encrypted_content: 'other-opaque-content'});
  const settings = effective();
  const status = contextStatus(session, settings);
  assert.equal(status.excludedReasoningItems, 2);
  const details = contextDetails(session, settings);
  assert.match(details, /2 opaque reasoning replay items excluded/i);
  assert.match(details, /token occupancy is unknown/i);
  assert.match(contextFooter(status), /\(visible est\.\)$/);
  assert.ok(!details.includes('private-opaque-content'));
  assert.ok(!details.includes('other-opaque-content'));
});

test('model switches estimate canonical visible history instead of unused replay metadata', () => {
  const session = replaySession('x'.repeat(20000));
  const canonical = structuredClone(session);
  delete canonical.messages[1].responseReplay;
  const switched = contextStatus(session, effective('codex', 'other'));
  const expected = contextStatus(canonical, effective('codex', 'other'));
  assert.equal(switched.bytes, expected.bytes);
  assert.equal(switched.proxyTokens, expected.proxyTokens);
  assert.equal(switched.excludedReasoningItems || 0, 0);
  assert.match(contextFooter(switched), /\(est\.\)$/);
});

test('HTTP provider switches exclude unsent replay and usage metadata', () => {
  const session = replaySession('x'.repeat(20000));
  session.messages[1].usage = {scope: 'request', status: 'reported', source: 'synthetic usage', metrics: {input: 123456, output: 99999}};
  const canonical = structuredClone(session);
  delete canonical.messages[1].responseReplay;
  delete canonical.messages[1].usage;
  for (const provider of ['openrouter', 'lmstudio', 'live']) {
    const actual = contextStatus(session, effective(provider));
    const expected = contextStatus(canonical, effective(provider));
    assert.equal(actual.bytes, expected.bytes, provider);
    assert.equal(actual.proxyTokens, expected.proxyTokens, provider);
    assert.equal(actual.excludedReasoningItems || 0, 0, provider);
    assert.match(contextFooter(actual), /\(est\.\)$/);
  }
});

test('same-model visible replay is counted once and retains tool boundaries', () => {
  const session = replaySession();
  const original = contextStatus(session, effective());
  session.messages[1].content = 'Duplicated saved transcript content. '.repeat(1000);
  session.messages[1].tool_calls = [{id: 'unused-call', function: {name: 'clock', arguments: '{}'}}];
  assert.equal(contextStatus(session, effective()).bytes, original.bytes);
  session.messages[1].responseReplay.items.push({type: 'function_call', call_id: 'clock-1', name: 'clock', arguments: '{}'});
  session.messages.push({role: 'tool', tool_call_id: 'clock-1', content: 'Readable tool output. '.repeat(100)});
  assert.ok(contextStatus(session, effective()).proxyTokens > original.proxyTokens);
});

test('context display preserves saved history, exact encrypted replay and request continuity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'staf-context-replay-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const store = new Store(root);
  const session = await store.create();
  session.provider = 'codex-direct:test';
  session.messages = replaySession('encrypted-replay-preserved-byte-for-byte').messages;
  await store.save(session);
  const before = await readFile(store.path(session.id), 'utf8');
  const settings = effective();
  const settingsBefore = JSON.stringify(settings);
  const requestBefore = responsesRequest(session.messages, tools, 'test', session.id);
  contextDetails(session, settings, 'pending');
  contextFooter(contextStatus(session, settings));
  const requestAfter = responsesRequest(session.messages, tools, 'test', session.id);
  assert.deepEqual(requestAfter, requestBefore);
  assert.equal(requestAfter.input[1].encrypted_content, 'encrypted-replay-preserved-byte-for-byte');
  assert.equal(await readFile(store.path(session.id), 'utf8'), before);
  assert.equal(JSON.stringify(settings), settingsBefore);
  assert.equal(JSON.stringify(session), JSON.stringify(await store.load(session.id)));
});
