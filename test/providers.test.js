import {routerStream} from './openrouter-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    return routerStream({message: body.messages.at(-1).role === 'tool'
      ? { role: 'assistant', content: 'The result is ready.' }
      : { role: 'assistant', tool_calls: [{ id: 'clock1', type: 'function', function: { name: 'clock', arguments: '{}' } }] }});
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

test('provider and model validation rejects invalid values without network calls', async () => {
  const { validateSetting } = await import('../dist/settings.js');
  const { selectProvider } = await import('../dist/registry.js');
  assert.throws(() => validateSetting('provider', 'unknown'));
  assert.throws(() => validateSetting('model.demo', 'x'));
  await assert.rejects(selectProvider('unknown', { env: {} }), /Provider must/);
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

test('direct Codex authentication does not borrow isolated CLI credentials', async t => {
  const { root } = await fixture(t);
  const { createCodexContext } = await import('../dist/codex-context.js');
  const { directAuth } = await import('../dist/codex-direct-auth.js');
  const context = await createCodexContext(root);
  await writeFile(join(context.codexHome, 'auth.json'), 'dummy-owned-auth', { mode: 0o600 });
  assert.match(await directAuth('status', root), /not signed in/);
  assert.equal(await readFile(join(context.codexHome, 'auth.json'), 'utf8'), 'dummy-owned-auth');
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
  const { lmStudioProvider } = await import('../dist/providers.js');
  const { demoProvider } = await import('./fixtures/echo-provider.mjs');
  const request = async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'hello' } }] });
  const adapters = [demoProvider, codex, lmStudioProvider({}, 'model', request)];
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
  const { codexAuth } = await import('../dist/codex.js');
  const original = { PATH: process.env.PATH, CODEX_HOME: process.env.CODEX_HOME, HOME: process.env.HOME, OPENAI_API_KEY: process.env.OPENAI_API_KEY, DATABASE_URL: process.env.DATABASE_URL };
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, CODEX_HOME: normal, HOME: root, OPENAI_API_KEY: 'dummy-normal-key', DATABASE_URL: 'dummy-db' });
  try {
    assert.match(await codexAuth('status',data), /not signed in/);
    await codexAuth('login',data);
    assert.match(await codexAuth('status',data), /signed in with ChatGPT/);
    await codexAuth('logout',data);
    assert.match(await codexAuth('status',data), /not signed in/);
  } finally {
    for (const [key,value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
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

test('OpenRouter passes caller cancellation to the HTTP request', async () => {
  const {openRouterProvider}=await import('../dist/providers.js');
  const controller=new AbortController(); let captured; let entered;
  const started=new Promise(resolve=>{entered=resolve});
  const provider=openRouterProvider({OPENROUTER_API_KEY:'test-only'},'test/model',async (_url,options)=>{
    captured=options.signal; entered();
    return new Promise((_resolve,reject)=>{
      if (captured.aborted) reject(Error('aborted'));
      else captured.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
    });
  });
  const completion=provider.complete([{role:'user',content:'hello'}],[],{signal:controller.signal});
  await started; controller.abort();
  const forwarded=captured.aborted;
  if (!forwarded) captured.dispatchEvent(new Event('abort'));
  await assert.rejects(completion);
  assert.equal(forwarded,true,'caller abort must reach the HTTP request');
});

test('OpenRouter cancellation closes an active local HTTP request', async () => {
  const {createServer}=await import('node:http');
  const {openRouterProvider}=await import('../dist/providers.js');
  const {runTurn}=await import('../dist/runtime.js');
  let received, closed;
  const arrival=new Promise(resolve=>{received=resolve});
  const disconnect=new Promise(resolve=>{closed=resolve});
  const server=createServer((req,_res)=>{req.on('close',closed);received();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port, controller=new AbortController();
  const provider=openRouterProvider({OPENROUTER_API_KEY:'test-only'},'test/model',(_url,options)=>fetch(`http://127.0.0.1:${port}/`,options));
  try {
    const session={version:1,id:'test',provider:null,messages:[],events:[]};
    const completion=runTurn({provider,session,store:{save:async()=>{}},text:'hello',signal:controller.signal});
    await arrival; controller.abort(); await assert.rejects(completion); await disconnect;
    assert.deepEqual(session.messages,[]);
  } finally {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
});

test('OpenRouter streams text, fragmented tool calls and reported usage', async () => {
  const events = [
    {choices:[{index:0,delta:{content:'Hello '},finish_reason:null}]},
    {choices:[{index:0,delta:{content:'world',tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'clock',arguments:'{'}}]},finish_reason:null}]},
    {choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'}'}}]},finish_reason:'tool_calls'}]},
    {choices:[],model:'vendor/model',usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}},
  ];
  const request = async (_url, init) => {
    const body=JSON.parse(init.body); assert.equal(body.stream,true); assert.equal(body.stream_options.include_usage,true);
    return new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'vendor/model',request);
  const received=[]; for await (const event of provider.stream([],[])) received.push(event);
  assert.deepEqual(received.slice(0,2),[{type:'text_delta',text:'Hello '},{type:'text_delta',text:'world'}]);
  assert.equal(received[2].message.content,'Hello world');
  assert.deepEqual(received[2].message.tool_calls,[{id:'call-1',type:'function',function:{name:'clock',arguments:'{}'}}]);
  assert.equal(received[2].message.usage.metrics.total,5);
});

test('OpenRouter rejects interrupted and provider-error streams without a final message', async () => {
  for (const suffix of ['', 'data: {"error":{"message":"dummy secret"}}\n\n']) {
    const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy secret'},'vendor/model',async()=>new Response('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n'+suffix));
    const received=[];
    await assert.rejects(async()=>{for await(const event of provider.stream([],[])) received.push(event);},error=>!error.message.includes('dummy secret'));
    assert.deepEqual(received,[{type:'text_delta',text:'partial'}]);
  }
});

test('OpenRouter parses split UTF-8 SSE frames and rejects truncated tool calls and output limits', async () => {
  const payload=': keepalive\r\n\r\ndata: '+JSON.stringify({choices:[{index:0,delta:{content:'café'},finish_reason:'stop'}]})+'\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes=new TextEncoder().encode(payload);
  const provider=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'model',async()=>new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}})));
  const events=[];for await(const event of provider.stream([],[]))events.push(event);
  assert.equal(events.at(-1).message.content,'café');
  for(const choice of [
    {delta:{content:'partial'},finish_reason:'length'},
    {delta:{refusal:'No'},finish_reason:'stop'},
    {delta:{},finish_reason:'stop'},
    {delta:{tool_calls:[{index:0,id:'call',type:'function',function:{name:'clock'}}]},finish_reason:'tool_calls'},
  ]) {
    const p=openRouterProvider({OPENROUTER_API_KEY:'dummy'},'model',async()=>new Response(`data: ${JSON.stringify({choices:[{index:0,...choice}]})}\n\ndata: [DONE]\n\n`));
    const output=[];await assert.rejects(async()=>{for await(const event of p.stream([],[]))output.push(event);});assert.ok(!output.some(event=>event.type==='message'));
  }
});
