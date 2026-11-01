import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSearxng } from '../dist/searxng-search.js';

const item = (index = 1) => ({ title: `Title ${index}`, url: `https://example.test/${index}`, content: `Snippet ${index}` });
const input = { origin: 'http://127.0.0.1:8888', query: 'simple query', timeoutMs: 1000 };
const reply = (data = { results: [item()] }, overrides = {}) => ({
  status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
  body: (async function* () { yield Buffer.from(JSON.stringify(data)); })(), close() {}, ...overrides,
});
const transport = (response, calls = []) => async request => { calls.push(request); return response; };
async function withinDeadline(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic timeout test exceeded its deadline')), 1000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

test('posts a bounded literal query to the fixed backend and returns untrusted previews', async () => {
  const calls = [];
  const output = await searchSearxng(input, transport(reply(), calls));
  assert.deepEqual(output, { results: [{ title: 'Title 1', url: 'https://example.test/1', snippet: 'Snippet 1' }], truncated: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin, input.origin);
  assert.deepEqual([...new URLSearchParams(calls[0].body)], [['q', 'simple query'], ['format', 'json']]);
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('rejects model-selected backend destinations and engine or redirect operators', async () => {
  let count = 0;
  const fake = async () => { count++; return reply(); };
  for (const origin of ['http://localhost:8888', 'http://127.1:8888', 'https://127.0.0.1:8888',
    'http://127.0.0.1:8888/search', 'http://user@127.0.0.1:8888', 'http://127.0.0.1:0']) {
    await assert.rejects(searchSearxng({ ...input, origin }, fake), /backend/);
  }
  for (const query of ['!google cats', 'cats !!', '!!w cats', ':fr cats', 'cats%21google', '', 'x'.repeat(1025)]) {
    await assert.rejects(searchSearxng({ ...input, query }, fake), /query/);
  }
  assert.equal(count, 0);
});

test('rejects redirects, unsupported response formats and oversized bodies without fetching URLs', async () => {
  for (const response of [reply({}, { status: 302, headers: { location: 'http://127.0.0.1:1/', 'content-type': 'application/json' } }),
    reply({}, { status: 429 }), reply({}, { headers: { 'content-type': 'text/html' } }),
    reply({}, { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } }),
    reply({}, { body: (async function* () { yield Buffer.alloc(256 * 1024 + 1); })() })]) {
    const calls = []; let closed = false;
    await assert.rejects(searchSearxng(input, transport({ ...response, close: () => { closed = true; } }, calls)));
    assert.equal(calls.length, 1); assert.equal(closed, true);
  }
});

test('validates every result URL, bounds output and does not silently rewrite unsafe URLs', async () => {
  for (const url of ['https://user:pass@example.test/', 'https://example.test/?token=secret', 'https://example.test/?',
    'javascript:alert(1)', 'http://127.0.0.1/', 'http://localhost/', 'https://example.test/#token', 'not a url']) {
    await assert.rejects(searchSearxng(input, transport(reply({ results: [item(), { ...item(), url }] }))), /URL/);
  }
  const many = Array.from({ length: 12 }, (_, index) => item(index));
  const result = await searchSearxng(input, transport(reply({ results: many })));
  assert.equal(result.results.length, 10); assert.equal(result.truncated, true);
  await assert.rejects(searchSearxng(input, transport(reply({ results: [...many, { ...item(), url: 'https://example.test/?secret=1' }] }))), /URL/);
});

test('handles cancellation, stalled responses and late delivery without leaking a response', async () => {
  const aborted = new AbortController(); aborted.abort(); let called = false;
  await assert.rejects(searchSearxng({ ...input, signal: aborted.signal }, async () => { called = true; return reply(); }), /cancelled/);
  assert.equal(called, false);
  let closed = false;
  await withinDeadline(assert.rejects(searchSearxng({ ...input, timeoutMs: 5 }, transport(reply({}, {
    body: { async *[Symbol.asyncIterator]() { await new Promise(() => {}); } }, close: () => { closed = true; },
  })))));
  assert.equal(closed, true);
  let deliver, lateClosed = false;
  const pending = searchSearxng({ ...input, timeoutMs: 5 }, () => new Promise(resolve => { deliver = resolve; }));
  await withinDeadline(assert.rejects(pending));
  deliver(reply({}, { close: () => { lateClosed = true; } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateClosed, true);
});

test('accepts a fragmented response while retaining only the response byte budget', async () => {
  const bytes = Buffer.from(JSON.stringify({ results: [item()] }));
  const response = reply({}, { body: { async *[Symbol.asyncIterator]() {
    for (const byte of bytes) yield Uint8Array.of(byte);
  } } });
  const result = await searchSearxng(input, transport(response));
  assert.equal(result.results[0].title, 'Title 1');
});

test('rejects empty chunks and yields to cancellation during an immediate stream', async () => {
  let emptyCount = 0, closed = false;
  const empty = reply({}, { body: { async *[Symbol.asyncIterator]() {
    while (true) { emptyCount++; yield new Uint8Array(); }
  } }, close: () => { closed = true; } });
  await assert.rejects(searchSearxng(input, transport(empty)), /chunk/);
  assert.equal(emptyCount, 1); assert.equal(closed, true);

  let count = 0;
  const controller = new AbortController();
  const stream = reply({}, { body: { async *[Symbol.asyncIterator]() {
    while (true) { count++; yield Uint8Array.of(32); }
  } } });
  const pending = searchSearxng({ ...input, signal: controller.signal }, transport(stream));
  setImmediate(() => controller.abort());
  await assert.rejects(pending, /cancelled|interrupted/);
  assert.ok(count < 256 * 1024);
});
