import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const cli = resolve('dist/cli.js');
const preloadSource = String.raw`
import { appendFileSync } from 'node:fs';
let codexRequests = 0;
if (process.env.STAF_TEST_DELAY_METADATA) {
  process.once('SIGINT', () => process.send({ type: 'interrupt-received' }));
}
globalThis.fetch = async (url, init = {}) => {
  const endpoint = String(url);
  if (endpoint === 'https://openrouter.ai/api/v1/models') {
    if (process.env.STAF_TEST_DELAY_METADATA) {
      process.send({ type: 'metadata-pending' });
      await new Promise(resolve => process.once('message', message => {
        if (message.type !== 'release-metadata') throw new Error('Unexpected offline fixture message');
        resolve();
      }));
      process.disconnect();
      delete process.env.STAF_TEST_DELAY_METADATA;
    }
    return Response.json({ data: ['before-model', 'after-model'].map(id => ({
      id, name: id, reasoning: { supported_efforts: ['low', 'high'] },
    })) });
  }
  if (endpoint === 'https://openrouter.ai/api/v1/chat/completions' && init.method === 'POST') {
    appendFileSync(process.env.STAF_TEST_REQUESTS, JSON.stringify(JSON.parse(init.body)) + '\n');
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'Offline reply' } }] });
  }
  if (endpoint === 'https://api.openai.com/v1/responses' && init.method === 'POST') {
    const body = JSON.parse(init.body);
    appendFileSync(process.env.STAF_TEST_REQUESTS, JSON.stringify(body) + '\n');
    const turn = ++codexRequests;
    const items = [
      ...(turn === 1 ? [{ type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-first-turn' }] : []),
      { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Codex reply ' + turn }] },
    ];
    const events = items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item }));
    events.push({ type: 'response.completed', response: { status: 'completed', model: body.model, output: [] } });
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  throw new Error('Offline fixture blocked unexpected request');
};
`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'staf-cli-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  const preload = join(root, 'fetch.mjs');
  const requests = join(root, 'requests.jsonl');
  await mkdir(data);
  await writeFile(preload, preloadSource);
  await writeFile(requests, '');
  return {
    root, data, requests,
    args: ['--import', preload, cli, '--data-dir', data, '--provider', 'openrouter', '--model', 'before-model'],
    env: { HOME: root, NO_COLOR: '', TERM: 'dumb', OPENROUTER_API_KEY: 'offline-dummy-key', STAF_TEST_REQUESTS: requests },
  };
}

async function requestsAt(path) {
  return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

for (const scope of ['session', 'default']) {
  for (const setting of ['model', 'reasoning']) {
    for (const syntax of ['shortcut', 'set']) {
      test(`CLI ${syntax} ${setting} ${scope} controls the actual next request after a completed turn`, async t => {
        const setup = await fixture(t);
        const value = setting === 'model' ? 'after-model' : 'high';
        const command = syntax === 'shortcut' ? `${setting} ${scope} ${value}` : `set ${scope} ${setting}.openrouter ${value}`;
        const result = spawnSync(process.execPath, setup.args, {
          cwd: setup.root, env: setup.env, encoding: 'utf8', timeout: 10000,
          input: `first message\n/settings ${command}\nsecond message\nthird message\n/quit\n`,
        });
        assert.equal(result.status, 0, result.stderr || String(result.error));
        assert.equal(result.stderr, '');
        const requests = await requestsAt(setup.requests);
        assert.equal(requests.length, 3, result.stdout);
        assert.equal(requests[0].model, 'before-model');
        assert.equal(requests[0].reasoning, undefined);
        assert.equal(requests[1].model, setting === 'model' ? value : 'before-model');
        assert.deepEqual(requests[1].reasoning, setting === 'reasoning' ? { effort: value } : undefined);
        assert.deepEqual(requests[1].messages.filter(message => message.role !== 'system').map(message => message.content), [
          'first message', 'Offline reply', 'second message',
        ]);
        assert.equal(requests[2].model, requests[1].model);
        assert.deepEqual(requests[2].reasoning, requests[1].reasoning);
        assert.deepEqual(requests[2].messages.filter(message => message.role !== 'system').map(message => message.content), [
          'first message', 'Offline reply', 'second message', 'Offline reply', 'third message',
        ]);
        if (scope === 'default') {
          const saved = JSON.parse(await readFile(join(setup.data, 'config', 'settings.json'), 'utf8'));
          assert.equal(saved.defaults[`${setting}.openrouter`], value);
        } else {
          assert.equal((await readdir(setup.data)).includes('config'), false);
        }
        assert.equal((result.stdout.match(/Provider: OPENROUTER/g) || []).length, 2, result.stdout);
        assert.equal((result.stdout.match(/\[provider_start\]/g) || []).length, 3, result.stdout);
      });
    }
  }
}

test('CLI Codex turns keep one session, complete reasoning replay and cache identity with one provider announcement', async t => {
  const setup = await fixture(t);
  await mkdir(join(setup.data, 'auth'), { mode: 0o700 });
  await writeFile(join(setup.data, 'auth', 'codex-direct.json'), JSON.stringify({
    version: 1, issuer: 'https://auth.openai.com', subject: 'offline-subject', clientId: 'oaiapp_offline',
    hostId: 'urn:uuid:offline', accessToken: 'offline-access', refreshToken: 'offline-refresh', idToken: 'offline-id',
    scopes: ['chatgpt.tokens.use.direct', 'resource.invoke'], expiresAt: Date.now() + 3600000,
  }), { mode: 0o600 });
  const args = [...setup.args.slice(0, -4), '--provider', 'codex', '--model', 'offline-codex'];
  const run = input => spawnSync(process.execPath, args, {
    cwd: setup.root, env: setup.env, encoding: 'utf8', timeout: 10000, input,
  });
  const result = run('first message\nsecond message\nthird message\n/quit\n');
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stderr, '');
  const requests = await requestsAt(setup.requests);
  assert.equal(requests.length, 3, result.stdout);
  const user = text => ({ role: 'user', content: [{ type: 'input_text', text }] });
  const assistant = turn => ({ type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: `Codex reply ${turn}` }] });
  const reasoning = { type: 'reasoning', id: 'reasoning-1', encrypted_content: 'opaque-first-turn' };
  assert.deepEqual(requests[0].input, [user('first message')]);
  assert.deepEqual(requests[1].input, [user('first message'), { ...reasoning, summary: [] }, assistant(1), user('second message')]);
  assert.deepEqual(requests[2].input, [user('first message'), { ...reasoning, summary: [] }, assistant(1), user('second message'), assistant(2), user('third message')]);
  assert.equal(requests.every(request => request.model === 'offline-codex' && request.reasoning === undefined), true);
  assert.match(requests[0].prompt_cache_key, /^pck_[a-f0-9]{24}$/);
  assert.equal(new Set(requests.map(request => request.prompt_cache_key)).size, 1);
  const files = (await readdir(setup.data)).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const session = JSON.parse(await readFile(join(setup.data, files[0]), 'utf8'));
  assert.equal(files[0], `${session.id}.json`);
  assert.deepEqual(session.messages.map(message => message.content), [
    'first message', 'Codex reply 1', 'second message', 'Codex reply 2', 'third message', 'Codex reply 3',
  ]);
  assert.equal(session.turns.length, 3);
  assert.deepEqual(session.messages[1].responseReplay, { provider: 'codex-direct', model: 'offline-codex', items: [reasoning, assistant(1)] });
  assert.equal((result.stdout.match(/Staf \| session /g) || []).length, 1, result.stdout);
  assert.ok(result.stdout.includes(`Staf | session ${session.id}`), result.stdout);
  assert.equal((result.stdout.match(/\[provider_start\]/g) || []).length, 3, result.stdout);
  const fresh = run('first message\n/quit\n');
  assert.equal(fresh.status, 0, fresh.stderr || String(fresh.error));
  assert.equal(fresh.stderr, '');
  const freshRequests = await requestsAt(setup.requests);
  assert.equal(freshRequests.length, 4);
  assert.notEqual(freshRequests[3].prompt_cache_key, requests[0].prompt_cache_key, 'A different session must have its own cache identity');
  assert.equal((result.stdout.match(/Provider: CODEX DIRECT/g) || []).length, 1, result.stdout);
});

test('CLI settings changes reverted before the next request keep the provider announcement unchanged', async t => {
  const setup = await fixture(t);
  const result = spawnSync(process.execPath, setup.args, {
    cwd: setup.root, env: setup.env, encoding: 'utf8', timeout: 10000,
    input: 'first message\n/settings model session after-model\n/settings model session before-model\nsecond message\n/quit\n',
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stderr, '');
  const requests = await requestsAt(setup.requests);
  assert.deepEqual(requests.map(request => request.model), ['before-model', 'before-model']);
  assert.equal((result.stdout.match(/Provider: OPENROUTER/g) || []).length, 1, result.stdout);
});

function waitForMessage(child, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Missing offline fixture message: ${type}`)), 5000);
    const onMessage = message => { if (message.type === type) finish(); };
    const onExit = () => finish(new Error(`CLI exited before offline fixture message: ${type}`));
    function finish(error) {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error); else resolve();
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

test('SIGINT during first provider metadata prevents generation, queued turns, persisted messages and leaked locks', { timeout: 10000 }, async t => {
  const setup = await fixture(t);
  const child = spawn(process.execPath, [...setup.args, '--reasoning', 'high'], {
    cwd: setup.root, env: { ...setup.env, STAF_TEST_DELAY_METADATA: '1' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const pending = waitForMessage(child, 'metadata-pending');
  child.stdin.write('cancel this request\nqueued request must not run\n');
  await pending;
  const interrupted = waitForMessage(child, 'interrupt-received');
  assert.equal(child.kill('SIGINT'), true);
  await interrupted;
  child.send({ type: 'release-metadata' });
  const result = await exited;
  assert.equal(result.code, 0, output);
  assert.equal(result.signal, null, output);
  assert.deepEqual(await requestsAt(setup.requests), [], output);
  const names = await readdir(setup.data);
  assert.equal(names.some(name => name.endsWith('.lock')), false, 'Session lock must be released');
  const conversations = names.filter(name => name.endsWith('.json'));
  assert.equal(conversations.length, 1);
  const session = JSON.parse(await readFile(join(setup.data, conversations[0]), 'utf8'));
  assert.deepEqual(session.messages, []);
  assert.deepEqual(session.events, []);
});

for (const explicitClose of [true, false]) {
  test(`ChatInput ${explicitClose ? 'explicit close discards queued lines' : 'ordinary EOF drains queued lines'}`, async t => {
    const setup = await fixture(t);
    const source = `
      import { ChatInput } from ${JSON.stringify(new URL('../dist/chat-input.js', import.meta.url).href)};
      const input = new ChatInput('');
      if (${explicitClose}) process.stdin.once('data', () => input.close());
      const lines = [];
      for await (const line of input) lines.push(line);
      console.log(JSON.stringify(lines));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: setup.root, env: setup.env, encoding: 'utf8', timeout: 5000, input: 'first\nsecond\n',
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.deepEqual(JSON.parse(result.stdout), explicitClose ? [] : ['first', 'second']);
  });
}
