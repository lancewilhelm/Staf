import {demoProvider} from './fixtures/echo-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';
import { runTurn } from '../dist/runtime.js';
import { liveProvider } from '../dist/providers.js';

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

test('store saves, lists and resumes a conversation', async t => {
  const { root, store, session } = await fixture(t);
  await runTurn({ store, session, provider: demoProvider, text: 'hello' });
  assert.ok((await store.list()).includes(session.id));
  const resumed = await store.load(session.id);
  await runTurn({ store, session: resumed, provider: demoProvider, text: 'hello' });
  assert.match(resumed.messages.at(-1).content, /User turns saved: 2/);
  assert.equal(JSON.parse(await readFile(join(root, `${session.id}.json`))).messages.length, 4);
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
    const release = await store.lock(session.id);
    try { await assert.rejects(store.load(session.id), /damaged/); }
    finally { await release(); }
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

test('injected fixture stays offline with live environment settings', async t => {
  const { store, session } = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NETWORK ATTEMPT'); });
  const provider = demoProvider;
  const events = [];
  await runTurn({ store, session, provider, text: 'time', clock: () => 'fixed', emit: event => events.push(event) });
  await runTurn({ store, session, provider, text: 'hello' });
  assert.ok(events.some(event => event.type === 'tool_result'));
  assert.match((await store.load(session.id)).messages.at(-1).content, /User turns saved: 2/);
});

test('pre-TypeScript version-1 snapshot resumes without migration', async t => {
  const { root, store } = await fixture(t);
  const { writeFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('./fixtures/session-v1.json', import.meta.url), 'utf8');
  const legacy = JSON.parse(raw);
  await writeFile(store.path(legacy.id), raw);
  const resumed = await store.load(legacy.id);
  await runTurn({ store, session: resumed, provider: demoProvider, text: 'hello' });
  assert.match((await store.load(legacy.id)).messages.at(-1).content, /User turns saved: 2/);
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

test('denied clock records exactly one outcome in chat and task execution', async t => {
 for(const isTask of [false,true]){
  const {store,session}=await fixture(t),events=[];
  await assert.rejects(runTurn({store,session,text:'Read time',provider:demoProvider,emit:event=>events.push(event),authorizeClock:async()=>{throw Error('Clock approval denied')},...(isTask?{task:{drain:()=>[],hasPending:()=>false,finish:()=>true,clarify:async()=>''}}:{})}),/Clock approval denied/);
  assert.equal(events.filter(event=>event.type==='tool_result').length,1);
  assert.equal(events.find(event=>event.type==='tool_result').success,false);
 }
});

test('registered action outcomes that do not complete are reported as unsuccessful', async t => {
  for (const result of [
    {kind:'status',action:{id:'a',state:'failed'}},
    {kind:'status',action:{id:'b',state:'uncertain'}},
    {kind:'blocked',reason:'Opaque prior change requires reconciliation'},
    {kind:'repeat-required',actions:[],truncated:false,challenge:'c'},
  ]) {
    const {store,session}=await fixture(t);
    const definition={type:'function',function:{name:'fixture_action',description:'Fixture',parameters:{type:'object',properties:{},additionalProperties:false}}};
    const actions={context:{mode:'direct'},closedReason:()=>null,offers:route=>route==='direct'?[structuredClone(definition)]:[],recognizes:name=>name==='fixture_action',invoke:async()=>result};
    const provider={name:'fixture',complete:async messages=>messages.at(-1).role==='tool'?{role:'assistant',content:'done'}:{role:'assistant',content:null,tool_calls:[{id:'call',function:{name:'fixture_action',arguments:'{}'}}]}};
    await runTurn({store,session,provider,actions,text:'exercise'});
    assert.equal(session.events.find(event=>event.type==='tool_result').success,false);
  }
});
