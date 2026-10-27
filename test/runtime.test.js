import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../dist/store.js';
import { runTurn } from '../dist/runtime.js';
import { demoProvider, liveProvider } from '../dist/providers.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'staf-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root);
  return { root, store, session: await store.create() };
}

test('tool round trip emits activity, persists and resumes provider context', async t => {
  const { store, session } = await fixture(t);
  const events = [];
  await runTurn({ store, session, provider: demoProvider, text: 'time?', clock: () => 'FIXED', emit: e => events.push(e.type) });
  assert.deepEqual(events, ['provider_start', 'tool_start', 'tool_result', 'provider_start', 'assistant']);
  const resumed = await store.load(session.id);
  assert.equal(resumed.messages[2].content, 'FIXED');
  await runTurn({ store, session: resumed, provider: demoProvider, text: 'hello' });
  assert.match((await store.load(session.id)).messages.at(-1).content, /User turns saved: 2/);
});

test('provider failure and tool limit roll back persisted and in-memory turns', async t => {
  const { store, session } = await fixture(t);
  for (const provider of [
    { name: 'broken', complete: async () => { throw new Error('offline failure'); } },
    { name: 'loop', complete: async () => ({ role: 'assistant', content: null, tool_calls: [{ id: '1', function: { name: 'clock', arguments: '{}' } }] }) },
  ]) {
    await assert.rejects(runTurn({ store, session, provider, text: 'hi', maxSteps: 2 }));
    assert.deepEqual(session.messages, []);
    assert.deepEqual((await store.load(session.id)).messages, []);
  }
});

test('unknown tools return observable errors without executing anything', async t => {
  const { store, session } = await fixture(t);
  const provider = { name: 'fake', complete: async messages => messages.at(-1).role === 'tool'
    ? { role: 'assistant', content: messages.at(-1).content }
    : { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'shell', arguments: '{}' } }] } };
  await runTurn({ store, session, provider, text: 'test' });
  assert.equal(session.events.find(e => e.type === 'tool_result').success, false);
  assert.match(session.messages.at(-1).content, /Unknown tool/);
});

test('storage refuses path traversal and concurrent writers', async t => {
  const { store, session } = await fixture(t);
  assert.throws(() => store.path('../escape'), /Invalid session/);
  const release = await store.lock(session.id);
  await assert.rejects(store.lock(session.id), /Session in use/);
  await release();
  await (await store.lock(session.id))();
});

test('CLI subprocess saves, lists and resumes a conversation', async t => {
  const { root } = await fixture(t);
  const cli = (...args) => spawnSync(process.execPath, ['dist/cli.js', '--data-dir', root, ...args], { input: 'hello\n/quit\n', encoding: 'utf8' });
  const first = cli();
  assert.equal(first.status, 0, first.stderr);
  const id = first.stdout.match(/session ([0-9a-f-]{36})/)[1];
  assert.match(cli('sessions').stdout, new RegExp(id));
  const resumed = cli('--session', id);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /User turns saved: 2/);
  assert.equal(JSON.parse(await readFile(join(root, `${id}.json`))).messages.length, 4);
  assert.equal(cli('--typo').status, 1);
});

test('live configuration is explicit; runtime preserves history across selected provider switches', async t => {
  assert.throws(() => liveProvider({}), /requires/);
  assert.throws(() => liveProvider({ STAF_API_KEY: 'test', STAF_MODEL: 'test', STAF_BASE_URL: 'http://example.com' }), /HTTPS/);
  const { store, session } = await fixture(t);
  await runTurn({ store, session, provider: demoProvider, text: 'hi' });
  await runTurn({ store, session, provider: { ...demoProvider, name: 'other' }, text: 'hi' });
  assert.deepEqual(session.turns.map(turn=>turn.provider),['demo','other']);
  assert.equal(session.messages.length,4);
});

test('missing, corrupt and structurally incomplete sessions fail clearly without modifying data', async t => {
  const { root, store, session } = await fixture(t);
  const { writeFile } = await import('node:fs/promises');
  await assert.rejects(store.load('00000000-0000-0000-0000-000000000000'), /Session not found/);
  for (const value of ['{', 'null', JSON.stringify({ ...session, messages: [null] }),
    JSON.stringify({ ...session, messages: [{ role: 'user', content: 'unfinished' }] }),
    JSON.stringify({ ...session, events: [null] }),
    JSON.stringify({ ...session, provider: 'demo', messages: [
      { role: 'user', content: 'time' },
      { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'clock', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'wrong', content: 'x' },
      { role: 'assistant', content: 'done' },
    ] })]) {
    await writeFile(store.path(session.id), value);
    await assert.rejects(store.load(session.id), /damaged/);
    assert.equal(await readFile(store.path(session.id), 'utf8'), value);
    const result = spawnSync(process.execPath, ['dist/cli.js', '--data-dir', root, '--session', session.id], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /damaged/);
    // CLI releases the lock even when loading fails.
    await (await store.lock(session.id))();
  }
});

test('invalid tool arguments and throwing tools report failure back to provider', async t => {
  const { store, session } = await fixture(t);
  for (const args of ['{', '{"unexpected":true}', '{}']) {
    const provider = { name: 'fake', complete: async messages => messages.at(-1).role === 'tool'
      ? { role: 'assistant', content: messages.at(-1).content }
      : { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'clock', arguments: args } }] } };
    await runTurn({ store, session, provider, text: 'test', clock: () => { throw new Error('clock failed'); } });
    assert.equal(session.events.filter(e => e.type === 'tool_result').at(-1).success, false);
    assert.match(session.messages.at(-1).content, /Tool error/);
  }
});

test('loop limit bounds exact provider calls and malformed responses cannot commit', async t => {
  const { store, session } = await fixture(t);
  let calls = 0;
  const provider = { name: 'loop', complete: async () => {
    calls++;
    return { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'clock', arguments: '{}' } }] };
  } };
  await assert.rejects(runTurn({ store, session, provider, text: 'hi', maxSteps: 3 }), /iteration limit/);
  assert.equal(calls, 3);
  for (const message of [null, { role: 'assistant', tool_calls: [null] }, { role: 'assistant', tool_calls: Array(9).fill({}) }]) {
    await assert.rejects(runTurn({ store, session, provider: { name: 'bad', complete: async () => message }, text: 'hi' }));
  }
  assert.deepEqual((await store.load(session.id)).messages, []);
});

test('save failure does not announce success or alter conversation', async t => {
  const { session } = await fixture(t);
  const events = [];
  await assert.rejects(runTurn({ session, provider: demoProvider, text: 'hi',
    store: { save: async () => { throw new Error('disk full'); } }, emit: e => events.push(e.type) }), /disk full/);
  assert.deepEqual(session.messages, []);
  assert.ok(!events.includes('assistant'));
  assert.equal(events.at(-1), 'error');
});

test('offline CLI remains offline even with live environment settings', async t => {
  const { root } = await fixture(t);
  const guard = 'data:text/javascript,' + encodeURIComponent("globalThis.fetch = () => { throw new Error('NETWORK ATTEMPT'); };");
  const result = spawnSync(process.execPath, ['--import', guard, 'dist/cli.js', '--data-dir', root], {
    input: 'time\nhello\n/quit\n', encoding: 'utf8',
    env: { ...process.env, STAF_API_KEY: 'fake-test-value', STAF_MODEL: 'fake', STAF_BASE_URL: 'https://invalid.example/' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DEMO — offline/);
  assert.match(result.stdout, /tool_result/);
  assert.doesNotMatch(result.stdout + result.stderr, /NETWORK ATTEMPT/);
});

test('pre-TypeScript version-1 snapshot resumes without migration', async t => {
  const { root, store } = await fixture(t);
  const { writeFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('./fixtures/session-v1.json', import.meta.url), 'utf8');
  const legacy = JSON.parse(raw);
  await writeFile(store.path(legacy.id), raw);
  const result = spawnSync(process.execPath, ['dist/cli.js', '--data-dir', root, '--session', legacy.id], {
    input: 'hello\n/quit\n', encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /User turns saved: 2/);
  const resumed = await store.load(legacy.id);
  assert.equal(resumed.version, 1);
  assert.deepEqual(resumed.messages.slice(0, legacy.messages.length), legacy.messages);
  assert.deepEqual(resumed.events.slice(0, legacy.events.length), legacy.events);
});

test('runtime rejects malformed provider content and persisted event payloads', async t => {
  const { store, session } = await fixture(t);
  const { writeFile } = await import('node:fs/promises');
  for (const message of [
    { role: 'assistant', content: 42 },
    { role: 'assistant', tool_calls: [{ id: 'x', type: 'invalid', function: { name: 'clock', arguments: '{}' } }] },
    { role: 'assistant', tool_calls: [{ id: 'x', function: { name: 'clock', arguments: 42 } }] },
  ]) {
    await assert.rejects(runTurn({ store, session, provider: { name: 'invalid', complete: async () => message }, text: 'hi' }), /Invalid assistant/);
  }
  await writeFile(store.path(session.id), JSON.stringify({ ...session, events: [{ type: 'tool_result', success: 'yes' }] }));
  await assert.rejects(store.load(session.id), /damaged/);
});
