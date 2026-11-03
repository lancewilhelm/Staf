import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('the offline review fixture keeps sign-in local and simulates a saved connection', {timeout: 15000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'staf-review-auth-'));
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['test/browser/held-instance.mjs', join(root, 'instance.sqlite'), String(port)], {stdio: ['pipe', 'pipe', 'pipe']});
  t.after(async () => {
    if (server.exitCode === null) { server.kill(); await once(server, 'exit'); }
    await rm(root, {recursive: true, force: true});
  });
  let output = '';
  const code = await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.on('exit', () => reject(Error('Review fixture exited before pairing')));
    server.stdout.on('data', data => {
      output += data;
      const match = output.match(/Pairing code: (\S+)/);
      if (match) resolve(match[1]);
    });
  });
  const pair = await fetch(origin + '/api/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code})});
  const {token} = await pair.json();
  const headers = {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'};
  const response = await fetch(origin + '/api/codex-auth/start', {method: 'POST', headers, body: '{}'});
  assert.equal(response.status, 200);
  const attempt = await response.json();
  const signIn = new URL(attempt.url);
  assert.equal(signIn.protocol, 'http:');
  assert.equal(signIn.hostname, '127.0.0.1', 'synthetic credentials must not be sent to a real authorization endpoint');
  assert.equal(signIn.pathname, '/sign-in');
  const page = await fetch(signIn);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /simulat|synthetic/i);
  assert.doesNotMatch(html, /auth\.openai\.com/);
  const state = signIn.searchParams.get('state');
  assert.ok(state);
  const link = html.match(/href="([^"]+)"/);
  assert.ok(link, 'the simulated sign-in page offers completion');
  const target = new URL(link[1].replaceAll('&amp;', '&'));
  assert.equal(target.origin, origin);
  assert.equal(target.searchParams.get('state'), state);
  const callback = await fetch(target);
  assert.equal(callback.status, 200);
  const credential = await (await fetch(origin + '/api/codex-auth/credential', {headers})).json();
  assert.equal(credential.signedIn, true);
});
