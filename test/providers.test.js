import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openRouterProvider } from '../dist/providers.js';
import { codexProvider } from '../dist/codex.js';
import { loadEnvironment, redactor } from '../dist/config.js';
import { Store } from '../dist/store.js';
import { runTurn } from '../dist/runtime.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'staf-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root);
  return { root, store, session: await store.create() };
}

test('OpenRouter mock routes model, auth and tools, then resumes local history', async t => {
  const { store, session } = await fixture(t);
  const requests = [];
  const request = async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer dummy-secret');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body); requests.push(body);
    return Response.json({ choices: [{ message: body.messages.at(-1).role === 'tool'
      ? { role: 'assistant', content: 'The result is ready.' }
      : { role: 'assistant', tool_calls: [{ id: 'clock1', type: 'function', function: { name: 'clock', arguments: '{}' } }] } }] });
  };
  const provider = openRouterProvider({ OPENROUTER_API_KEY: 'dummy-secret' }, 'vendor/model', request);
  await runTurn({ store, session, provider, text: 'time' });
  assert.equal(requests[0].model, 'vendor/model');
  assert.equal(requests[0].tools[0].function.name, 'clock');
  assert.equal(requests.length, 2);
  assert.equal((await store.load(session.id)).provider, 'openrouter:vendor/model');
  assert.doesNotMatch(await readFile(store.path(session.id), 'utf8'), /dummy-secret/);
});

test('OpenRouter config, auth, credits and malformed response errors are actionable and do not echo bodies', async () => {
  assert.throws(() => openRouterProvider({}), /OPENROUTER_API_KEY/);
  assert.throws(() => openRouterProvider({ OPENROUTER_API_KEY: 'dummy' }), /--model/);
  for (const [status, message] of [[401, /API key/], [402, /credits/], [429, /rate limit/]]) {
    const provider = openRouterProvider({ OPENROUTER_API_KEY: 'dummy' }, 'model', async () => new Response('secret server body', { status }));
    await assert.rejects(provider.complete([], []), message);
  }
  const provider = openRouterProvider({ OPENROUTER_API_KEY: 'dummy' }, 'model', async () => Response.json({ choices: [{ message: { role: 'assistant', content: 42 } }] }));
  await assert.rejects(provider.complete([], []), /Invalid provider/);
});

test('Codex fake CLI performs structured clock round trip and resumes via Staf history', async t => {
  const { store, session } = await fixture(t);
  let generations = 0;
  const runner = async (args, input) => {
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    if (args[0] === 'mcp') return '[]';
    generations++;
    assert.ok(args.includes('--ignore-user-config'));
    assert.ok(args.includes('--ephemeral'));
    assert.ok(args.includes('read-only'));
    assert.ok(args.includes('shell_tool'));
    assert.ok(args.includes('unified_exec'));
    assert.ok(args.includes('approval_policy="never"'));
    assert.equal(args[args.indexOf('--model') + 1], 'test-model');
    const dir = args[args.indexOf('--cd') + 1];
    const schema = JSON.parse(await readFile(args[args.indexOf('--output-schema') + 1], 'utf8'));
    assert.equal(schema.additionalProperties, false);
    const data = JSON.parse(input.slice(input.indexOf('\n') + 1));
    const kind = data.messages.at(-1).role === 'tool' || data.messages.filter(m => m.role === 'user').length > 1 ? 'text' : 'clock';
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ kind, text: 'hello' }));
    assert.match(dir, /staf-codex-/);
    return '';
  };
  const provider = await codexProvider('test-model', runner);
  await runTurn({ store, session, provider, text: 'time' });
  await runTurn({ store, session: await store.load(session.id), provider, text: 'hello again' });
  assert.equal(generations, 3);
  assert.equal((await store.load(session.id)).messages.filter(m => m.role === 'user').length, 2);
});

test('Codex rejects API-key mode, missing login, subprocess failures and malformed output without committing', async t => {
  await assert.rejects(codexProvider(undefined, async () => 'Logged in using an API key'), /ChatGPT sign-in/);
  await assert.rejects(codexProvider(undefined, async () => { throw new Error('login unavailable'); }), /login unavailable/);
  const { store, session } = await fixture(t);
  for (const broken of [false, true]) {
    const provider = await codexProvider(undefined, async args => {
      if (args[0] === 'login') return 'Logged in using ChatGPT';
    if (args[0] === 'mcp') return '[]';
      if (broken) throw new Error('mock execution failure');
      await writeFile(args[args.indexOf('--output-last-message') + 1], '{}');
      return '';
    });
    await assert.rejects(runTurn({ store, session, provider, text: 'hi' }));
    assert.deepEqual((await store.load(session.id)).messages, []);
  }
});

test('.env is literal, allowlisted, shell-first and symlink safe; errors omit values', async t => {
  const { root } = await fixture(t);
  const path = join(root, '.env');
  await writeFile(path, "OPENROUTER_API_KEY='dummy-key'\nSTAF_MODEL=vendor/model\nPATH=bad\n", { mode: 0o600 });
  const env = await loadEnvironment(path, { STAF_MODEL: 'shell-model', PATH: 'original' });
  assert.equal(env.OPENROUTER_API_KEY, 'dummy-key');
  assert.equal(env.STAF_MODEL, 'shell-model');
  assert.equal(env.PATH, 'original');
  const linked = join(root, 'linked'); await symlink(path, linked);
  await assert.rejects(loadEnvironment(linked, {}), /symlinks/);
  assert.deepEqual(await loadEnvironment(join(root, 'missing'), { STAF_MODEL: 'x' }), { STAF_MODEL: 'x' });
  await writeFile(path, 'OPENROUTER_API_KEY="do-not-print');
  await assert.rejects(loadEnvironment(path, {}), error => !error.message.includes('do-not-print'));
});

test('known credentials redact from model input, output, exceptions, events and saved JSON', async t => {
  const { store, session } = await fixture(t);
  const redact = redactor({ OPENROUTER_API_KEY: 'dummy-secret' });
  const provider = { name: 'mock', complete: async messages => {
    assert.doesNotMatch(JSON.stringify(messages), /dummy-secret/);
    return { role: 'assistant', content: 'echo dummy-secret' };
  } };
  await runTurn({ store, session, provider, text: 'my key dummy-secret', redact });
  assert.doesNotMatch(await readFile(store.path(session.id), 'utf8'), /dummy-secret/);
  await assert.rejects(runTurn({ store, session, provider: { name: 'mock', complete: async () => { throw new Error('dummy-secret'); } }, text: 'hi', redact }), /REDACTED/);
});

test('CLI model and provider validation fail without network calls', () => {
  for (const args of [['--provider', 'unknown'], ['--provider', 'demo', '--model', 'x'], ['--live', '--provider', 'codex']]) {
    const result = spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
  }
});

test('LM Studio defaults to localhost, omits auth, accepts configured auth and clock calls', async t => {
  const { lmStudioProvider } = await import('../dist/providers.js');
  const { store, session } = await fixture(t);
  assert.throws(() => lmStudioProvider({}), /LOADED_MODEL/);
  let count = 0;
  const provider = lmStudioProvider({}, 'loaded-model', async (url, init) => {
    assert.equal(String(url), 'http://localhost:1234/v1/chat/completions');
    assert.equal(init.headers.Authorization, undefined);
    count++;
    return Response.json({ choices: [{ message: count === 1
      ? { role: 'assistant', tool_calls: [{ id: 'local-clock', function: { name: 'clock', arguments: '{}' } }] }
      : { role: 'assistant', content: 'local reply' } }] });
  });
  await runTurn({ store, session, provider, text: 'time' });
  assert.equal(count, 2);
  const authenticated = lmStudioProvider({ LMSTUDIO_API_KEY: 'dummy-local-key', LMSTUDIO_BASE_URL: 'http://127.0.0.1:1235/v1' }, 'model', async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:1235/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer dummy-local-key');
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
  });
  await authenticated.complete([], []);
  const down = lmStudioProvider({}, 'model', async () => { throw new Error('private network details'); });
  await assert.rejects(down.complete([], []), /check endpoint and server/);
  assert.throws(() => lmStudioProvider({ LMSTUDIO_BASE_URL: 'http://remote.example/v1' }, 'model'), /HTTPS/);
});

test('direct CLI never borrows credentials created by the explicit legacy auth command', async t => {
  const { root } = await fixture(t);
  const { chmod, mkdir } = await import('node:fs/promises');
  const bin = join(root, 'bin'); await mkdir(bin);
  const executable = join(bin, 'codex');
  await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (Object.keys(process.env).some(k => /KEY|TOKEN|SECRET|PASSWORD/i.test(k)) || process.env.DATABASE_URL || process.env.NODE_OPTIONS) process.exit(8);
if (process.cwd() === ${JSON.stringify(process.cwd())}) process.exit(9);
if (args[0] === 'mcp') { console.log('[]'); process.exit(0); }
if (!args.includes('cli_auth_credentials_store="file"') || !args.includes('forced_login_method="chatgpt"')) process.exit(10);
if (process.env.HOME === process.env.ORIGINAL_HOME || !process.env.CODEX_HOME.includes('codex-context')) process.exit(11);
const auth = require('node:path').join(process.env.CODEX_HOME, 'auth.json');
if (args[0] === 'login') {
 if (args[1] === 'status') {
  if (!fs.existsSync(auth)) process.exit(1);
  console.error('Logged in using ChatGPT');
 } else fs.writeFileSync(auth, 'dummy-owned-auth', {mode:0o600});
 process.exit(0);
}
if (args[0] === 'logout') { fs.unlinkSync(auth); process.exit(0); }
let input=''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
 const data=JSON.parse(input.slice(input.indexOf('\\n')+1));
 const kind=data.messages.at(-1).role === 'tool' || data.messages.filter(m=>m.role==='user').length > 1 ? 'text' : 'clock';
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1], JSON.stringify({kind,text:'fake Codex response'}));
});
`);
  await chmod(executable, 0o700);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPENROUTER_API_KEY: 'dummy-secret', DATABASE_URL: 'dummy-db-secret' };
  const run = (...args) => spawnSync(process.execPath, ['dist/cli.js', '--provider', 'codex', '--model', 'fake-model', '--data-dir', join(root, 'sessions'), ...args], { env, input: 'hello\n/quit\n', encoding: 'utf8' });
  const missing = run(); assert.equal(missing.status, 0); assert.match(missing.stderr, /auth codex login/);
  const login = spawnSync(process.execPath, ['dist/cli.js', 'auth', 'codex-legacy', 'login', '--data-dir', join(root, 'sessions')], { env, encoding: 'utf8' });
  assert.equal(login.status, 0, login.stderr);
  const first = run(); assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr,/direct Codex|auth codex login/);
  assert.ok(!first.stdout.includes('tool_result')); // legacy login is never a direct credential source

});

test('registry adapters share normalized event contract and explicitly reject unsupported streaming', async t => {
  const { providerEvents } = await import('../dist/provider-events.js');
  const { selectProvider, providerRegistry } = await import('../dist/registry.js');
  assert.deepEqual(Object.keys(providerRegistry), ['demo', 'openrouter', 'codex', 'lmstudio', 'live']);
  await assert.rejects(selectProvider('constructor', { env: {} }), /Provider must/);
  const codex = await codexProvider(undefined, async args => {
    if (args[0] === 'login') return 'Logged in using ChatGPT';
    if (args[0] === 'mcp') return '[]';
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ kind: 'text', text: 'hello' }));
    return '';
  });
  const { lmStudioProvider, demoProvider } = await import('../dist/providers.js');
  const request = async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'hello' } }] });
  const adapters = [demoProvider, codex, openRouterProvider({ OPENROUTER_API_KEY: 'dummy' }, 'model', request), lmStudioProvider({}, 'model', request)];
  for (const provider of adapters) {
    const events = [];
    for await (const event of providerEvents(provider, [{ role: 'user', content: 'hi' }], [])) events.push(event);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'message');
    assert.equal(events[0].message.role, 'assistant');
    assert.equal(provider.capabilities.incrementalText, false);
    await assert.rejects(async () => { for await (const unused of providerEvents(provider, [], [], true)) void unused; }, /incremental text streaming/);
  }
  const { store, session } = await fixture(t);
  const noTools = { name: 'no-tools', capabilities: { toolCalls: false, incrementalText: false, transport: 'demo' }, complete: async (_, tools) => {
    assert.deepEqual(tools, []);
    return { role: 'assistant', tool_calls: [{ id: 'bad', function: { name: 'clock', arguments: '{}' } }] };
  } };
  await assert.rejects(runTurn({ store, session, provider: noTools, text: 'hi' }), /does not support tool requests/);
  assert.deepEqual((await store.load(session.id)).messages, []);
});

test('resume redacts known keys in old history and events before provider replay and successful persistence', async t => {
  const { store, session } = await fixture(t);
  const secret = 'dummy-"quoted-secret';
  session.provider = 'mock';
  session.messages = [{ role: 'user', content: `old ${secret}` }, { role: 'assistant', content: 'done' }];
  session.events = [{ type: 'assistant', text: `old ${secret}` }];
  await store.save(session);
  const redact = redactor({ OPENROUTER_API_KEY: secret });
  const provider = { name: 'mock', complete: async messages => {
    assert.ok(!JSON.stringify(messages).includes('quoted-secret'));
    return { role: 'assistant', content: secret };
  } };
  await runTurn({ store, session: await store.load(session.id), provider, text: 'continue', redact });
  assert.doesNotMatch(await readFile(store.path(session.id), 'utf8'), /quoted-secret/);
});

test('Staf-owned auth lifecycle never borrows or changes a dummy normal Codex home', async t => {
  const { root } = await fixture(t);
  const { chmod, mkdir } = await import('node:fs/promises');
  const normal = join(root, 'normal-codex'); await mkdir(normal);
  await writeFile(join(normal, 'auth.json'), 'normal-dummy-auth');
  await writeFile(join(normal, 'config.toml'), '[mcp_servers.inherited]\ncommand="must-not-run"');
  const bin = join(root, 'bin'); await mkdir(bin);
  const fake = join(bin, 'codex');
  await writeFile(fake, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args=process.argv.slice(2), home=process.env.CODEX_HOME;
if (!home.includes('codex-context') || !process.env.HOME.includes('codex-context')) process.exit(9);
for (const setting of ['cli_auth_credentials_store="file"','forced_login_method="chatgpt"','apps','hooks','plugins','remote_plugin']) if (!args.includes(setting)) process.exit(10);
if (process.env.OPENAI_API_KEY || process.env.DATABASE_URL) process.exit(11);
const auth=path.join(home,'auth.json');
if(args[0]==='login' && args[1]==='status') {
 if(!fs.existsSync(auth)) process.exit(1);
 console.error('Logged in using ChatGPT'); process.exit(0);
}
if(args[0]==='login') { fs.writeFileSync(auth,'staf-dummy-auth',{mode:0o600}); process.exit(0); }
if(args[0]==='logout') { fs.unlinkSync(auth); process.exit(0); }
process.exit(12);
`); await chmod(fake, 0o700);
  const data = join(root, 'data');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: normal, HOME: root, OPENAI_API_KEY: 'dummy-normal-key', DATABASE_URL: 'dummy-db' };
  const command = action => spawnSync(process.execPath, ['dist/cli.js', 'auth', 'codex-legacy', action, '--data-dir', data], { env, encoding: 'utf8' });
  assert.match(command('status').stdout, /not signed in/);
  const login=command('login'); assert.equal(login.status,0,login.stderr);
  assert.match(command('status').stdout, /signed in with ChatGPT/);
  const logout=command('logout'); assert.equal(logout.status,0,logout.stderr);
  assert.match(command('status').stdout, /not signed in/);
  assert.equal(await readFile(join(normal, 'auth.json'), 'utf8'), 'normal-dummy-auth');
  assert.equal(await readFile(join(normal, 'config.toml'), 'utf8'), '[mcp_servers.inherited]\ncommand="must-not-run"');
});

test('isolated context rejects symlinked directories/auth and custom config without reading credentials', async t => {
  const { createCodexContext } = await import('../dist/codex-context.js');
  const { root } = await fixture(t);
  const { lstat, mkdir } = await import('node:fs/promises');
  const data = join(root, 'data');
  const context = await createCodexContext(data);
  assert.equal((await lstat(context.codexHome)).mode & 0o777, 0o700);
  assert.equal((await lstat(context.userHome)).mode & 0o777, 0o700);
  const outside=join(root,'outside');await mkdir(outside);
  await symlink(outside,join(root,'linked-data'));
  await assert.rejects(createCodexContext(join(root,'linked-data')),/symlink/);
  const fakeAuth=join(root,'fake-auth'); await writeFile(fakeAuth,'dummy');
  await symlink(fakeAuth,join(context.codexHome,'auth.json'));
  await assert.rejects(createCodexContext(data),/symlink/);
  await rm(join(context.codexHome,'auth.json'));
  await writeFile(join(context.codexHome,'config.toml'),'dummy config');
  await assert.rejects(createCodexContext(data),/unsupported custom configuration/);
});

test('Codex preflight rejects configured MCP or invalid MCP response before generation', async () => {
  for (const output of ['[{"name":"managed-server"}]', '{}', 'invalid-json']) {
    let generations=0;
    await assert.rejects(codexProvider(undefined,async args=> {
      if(args[0]==='login') return 'Logged in using ChatGPT';
      if(args[0]==='mcp') return output;
      generations++;return '';
    }));
    assert.equal(generations,0);
  }
});
