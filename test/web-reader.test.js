import test from 'node:test';
import assert from 'node:assert/strict';
import { readWebSource } from '../dist/web-reader.js';

const address = (address, family = 4) => ({ address, family });
const reply = (body = 'hello', status = 200, headers = { 'content-type': 'text/plain; charset=utf-8' }) => ({
  status, headers,
  body: (async function* () { yield Buffer.from(body); })(),
  close() {},
});
const setup = ({ addresses = [address('8.8.8.8')], response = reply() } = {}) => {
  const calls = [];
  return { calls, dependencies: {
    resolve: async host => { calls.push(['resolve', host]); return addresses; },
    request: async (url, pinned) => { calls.push(['request', url.href, pinned]); return response; },
  } };
};

test('returns source metadata and pins a validated DNS answer', async () => {
  const ctx = setup();
  const result = await readWebSource('https://example.com/a#fragment', ctx);
  assert.equal(result.requestedUrl, 'https://example.com/a');
  assert.equal(result.finalUrl, result.requestedUrl);
  assert.equal(result.contentType, 'text/plain; charset=utf-8');
  assert.equal(result.text, 'hello');
  assert.equal(result.truncated, false);
  assert.ok(!Number.isNaN(Date.parse(result.fetchedAt)));
  assert.deepEqual(ctx.calls[1], ['request', 'https://example.com/a', address('8.8.8.8')]);
});

test('rejects nonpublic, ambiguous and mixed DNS answers before transport', async () => {
  for (const record of [address('127.0.0.1'), address('10.0.0.1'), address('100.64.0.1'), address('169.254.1.2'), address('192.0.2.1'), address('198.18.0.1'), address('203.0.113.1'), address('224.0.0.1'), address('invalid')]) {
    const ctx = setup({ addresses: [address('8.8.8.8'), record] });
    await assert.rejects(readWebSource('https://example.com', ctx));
    assert.equal(ctx.calls.length, 1, record.address);
  }
  await assert.rejects(readWebSource('http://127.0.0.1/', setup()));
  await assert.rejects(readWebSource('https://user:pass@example.com/', setup()));
  await assert.rejects(readWebSource('file:///etc/passwd', setup()));
});

test('uses only validated IPv4 answers for dual-stack hosts', async () => {
  const ctx = setup({ addresses: [address('2001:4860:4860::8888', 6), address('8.8.8.8'), address('::1', 6)] });
  await readWebSource('https://example.com', ctx);
  assert.deepEqual(ctx.calls[1], ['request', 'https://example.com/', address('8.8.8.8')]);
  const mixed = setup({ addresses: [address('8.8.8.8'), address('10.0.0.1'), address('2001:4860:4860::8888', 6)] });
  await assert.rejects(readWebSource('https://example.com', mixed), /public address/);
  assert.equal(mixed.calls.length, 1);
  const ipv6Only = setup({ addresses: [address('2001:4860:4860::8888', 6)] });
  await assert.rejects(readWebSource('https://example.com', ipv6Only), /public address/);
  assert.equal(ipv6Only.calls.length, 1);
  await assert.rejects(readWebSource('https://[::ffff:808:808]/', setup()), /public address/);
});

test('validates and pins each redirect independently', async () => {
  const seen = [];
  const ctx = { dependencies: {
    resolve: async host => { seen.push(host); return host === 'one.example' ? [address('8.8.8.8')] : [address('127.0.0.1')]; },
    request: async () => reply('', 302, { location: 'http://two.example/path' }),
  } };
  await assert.rejects(readWebSource('https://one.example', ctx), /public address/);
  assert.deepEqual(seen, ['one.example', 'two.example']);
  await assert.rejects(readWebSource('https://one.example', { ...ctx, maxRedirects: 0 }), /redirect/);
});

test('bounds bytes and rejects unsafe or unsupported responses', async () => {
  assert.deepEqual((await readWebSource('http://example.com', { ...setup({ response: reply('abcdef') }), maxBytes: 3 })).text, 'abc');
  assert.equal((await readWebSource('http://example.com', { ...setup({ response: reply('abcdef') }), maxBytes: 3 })).truncated, true);
  for (const response of [reply('', 500), reply('data', 200, { 'content-type': 'application/pdf' }), reply('data', 200, { 'content-type': 'text/plain; charset=iso-8859-1' }), reply('data', 200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }), reply(Buffer.from([0xff]))]) {
    await assert.rejects(readWebSource('http://example.com', setup({ response })));
  }
});

test('cancels stalled DNS and honors a prior abort', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(readWebSource('http://example.com', { ...setup(), signal: controller.signal }), /cancelled/);
  await assert.rejects(readWebSource('http://example.com', { timeoutMs: 10, dependencies: { resolve: () => new Promise(resolve => setTimeout(() => resolve([address('8.8.8.8')]), 30)), request: async () => reply() } }));
});


test('closes a response that arrives after request cancellation', async () => {
  let deliver, started, closed = 0;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const controller = new AbortController();
  const pending = readWebSource('https://example.com', { signal: controller.signal, dependencies: {
    resolve: async () => [address('8.8.8.8')],
    request: () => { started(); return new Promise(resolve => { deliver = resolve; }); },
  } });
  await requestStarted;
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  deliver({ ...reply(), close: () => { closed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
});

test('closes a stalled response on cancellation and handles fragmented bodies', async () => {
  let started, closed = 0;
  const reading = new Promise(resolve => { started = resolve; });
  const controller = new AbortController();
  const response = { ...reply(), close: () => { closed++; }, body: { async *[Symbol.asyncIterator]() {
    started(); await new Promise(() => {}); yield Buffer.from('late');
  } } };
  const pending = readWebSource('https://example.com', { ...setup({ response }), signal: controller.signal });
  await reading;
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, /cancelled/);
  assert.equal(closed, 1);
  const fragmented = { ...reply(), body: { async *[Symbol.asyncIterator]() {
    for (const byte of Buffer.from('abcdef')) yield Uint8Array.of(byte);
  } } };
  const result = await readWebSource('https://example.com', { ...setup({ response: fragmented }), maxBytes: 3 });
  assert.equal(result.text, 'abc');
  assert.equal(result.truncated, true);
});

test('web dispatch URL validation rejects embedded newline queries and credentials', async()=>{
 const {checkedOwnerWebUrl}=await import('../dist/web-reader.js');
 for(const input of ['https://example.com/\n?token=synthetic-secret','https://user:synthetic-secret@example.com/path','https://example.com/path?token=synthetic-secret'])assert.throws(()=>checkedOwnerWebUrl(input),/no credentials or query/);
});
