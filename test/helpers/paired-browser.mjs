import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile, mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {api, until} from './recovery.mjs';

export async function withPairedBrowser({origin, code, directory}, journey) {
  const cached = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  const chrome = process.env.CHROME_PATH || (existsSync(cached) ? cached : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(existsSync(chrome), 'Set CHROME_PATH to a local Chrome/Chromium executable');
  await mkdir(directory, {recursive: true, mode: 0o700});
  const proxy = createServer(connection => connection.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  let browser, socket;
  const pending = new Map(); let sequence = 0;
  try {
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    browser = spawn(chrome, [
      '--headless=new', '--no-first-run', '--disable-background-networking', '--disable-extensions',
      `--proxy-server=http://127.0.0.1:${proxy.address().port}`, '--proxy-bypass-list=127.0.0.1',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
      `--user-data-dir=${directory}`, '--remote-debugging-port=0', origin,
    ], {env: {PATH: process.env.PATH, HOME: directory, TMPDIR: directory}, stdio: 'ignore'});
    let spawnError;
    browser.on('error', error => {spawnError = error;});
    const debug = await until(async () => {
      if (spawnError) throw spawnError;
      try {return (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0];} catch {return null;}
    }, Boolean, 'Chrome DevTools');
    const pages = await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
    const page = pages.find(page => page.type === 'page');
    assert.ok(page, 'Chrome page is available');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open');
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), resolve = pending.get(message.id);
      if (resolve) {pending.delete(message.id); resolve(message);}
    });
    async function cdp(method, params = {}) {
      const id = ++sequence;
      let timeout;
      try {
        const result = await Promise.race([
          new Promise(resolve => {pending.set(id, resolve); socket.send(JSON.stringify({id, method, params}));}),
          new Promise((_, reject) => {timeout = setTimeout(() => reject(Error(`DevTools timeout: ${method}`)), 10000);}),
        ]);
        assert.ok(!result.error, result.error?.message);
        return result.result;
      } finally {clearTimeout(timeout); pending.delete(id);}
    }
    async function evaluate(expression) {
      const result = await cdp('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await until(() => evaluate("document.body?.innerText.includes('Pair this browser')"), Boolean, 'current pairing screen');
    const input = (selector, value) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`;
    await evaluate(`${input('input', code)};[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Pair').click()`);
    await until(() => evaluate("!!document.querySelector('[aria-label=Message]')"), Boolean, 'paired chat workspace');
    const token = await evaluate("localStorage.getItem('staf-token')");
    assert.ok(token, 'paired browser saved its token');
    await journey({
      token, evaluate,
      send: text => evaluate(`${input('[aria-label=Message]', text)};document.querySelector('[aria-label=Send]').click()`),
      reload: () => cdp('Page.reload'),
    });
  } finally {
    socket?.close();
    if (browser?.pid && browser.exitCode === null) {const exited = once(browser, 'exit'); browser.kill(); await exited;}
    await new Promise(resolve => proxy.close(resolve));
  }
}

export async function pairedClientJourney({origin, code, directory, cli, bot, call}) {
  let revokedToken;
  await withPairedBrowser({origin, code, directory}, async browser => {
    revokedToken = browser.token;
    await browser.send('Hello from the container browser');
    await until(() => cli('read', bot.id), text => text.includes('Demo (offline): Hello from the container browser'), 'CLI sees browser response');
    const sent = await cli('send', bot.id, 'Hello from the paired CLI');
    const commandId = sent.match(/Command ID: (\S+)/)?.[1]; assert.ok(commandId);
    await until(() => call(`/api/commands/${commandId}`), value => value.state === 'completed', 'CLI response completes');
    await until(() => browser.evaluate("document.body.innerText.includes('Demo (offline): Hello from the paired CLI')"), Boolean, 'browser sees CLI response');
    const browserClient = (await api(origin, browser.token)('/api/clients')).find(client => client.current);
    await cli('revoke', browserClient.id);
    assert.equal((await fetch(origin + '/api/bots', {headers: {Authorization: `Bearer ${browser.token}`}})).status, 401);
    await browser.reload();
    await until(() => browser.evaluate("document.body?.innerText.includes('Pair this browser')"), Boolean, 'revoked browser loses access');
  });
  return revokedToken;
}
