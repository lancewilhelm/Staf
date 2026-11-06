import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {seedDemoTerminal} from './fixtures/demo-terminal.mjs';

const cli = (root, input) => spawnSync(process.execPath, ['dist/cli.js', '--data-dir', root], {input, encoding:'utf8', timeout:20000, env:{...process.env,NO_COLOR:''}});
const descriptor = root => JSON.parse(readFileSync(join(root,'terminal-service.json'),'utf8'));
async function stop(root) {try {process.kill(descriptor(root).pid,'SIGTERM');await new Promise(resolve=>setTimeout(resolve,300));} catch {}}

test('shared profile changes persist between clients without modifying legacy files', async () => {
 const root=mkdtempSync(join(tmpdir(),'staf-cli-profile-'));seedDemoTerminal(root);
 const legacy=join(root,'legacy-session.json');writeFileSync(legacy,'legacy conversation');
 try {
  let result=cli(root,'hello\n/set provider codex\n/confirm-provider\n/set model example-model\n/set reasoning high\n/settings show\n/quit\n');
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Saved provider: ChatGPT/);assert.doesNotMatch(result.stdout,/Command ID:/);assert.doesNotMatch(result.stdout,/user> hello/);assert.match(result.stdout,/Model: example-model/);assert.match(result.stdout,/Reasoning: high/);
  result=cli(root,'/settings show\n/set provider demo\n/confirm-provider\nhello again\n/quit\n');
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Provider: ChatGPT/);assert.match(result.stdout,/user> hello/);assert.match(result.stdout,/hello again/);assert.match(result.stdout,/User turns saved: 2/);
  assert.equal(readFileSync(legacy,'utf8'),'legacy conversation');
 } finally {await stop(root);rmSync(root,{recursive:true,force:true});}
});

test('an unresolved submission preserves the next draft until explicitly retried', async () => {
 const root=mkdtempSync(join(tmpdir(),'staf-cli-pending-'));seedDemoTerminal(root);
 try {
  const first=cli(root,'/quit\n');assert.equal(first.status,0,first.stderr);
  const botId=first.stdout.match(/shared main chat ([\w-]+)/)?.[1];assert.ok(botId);
  const id=randomUUID();mkdirSync(join(root,'terminal-pending'),{recursive:true});writeFileSync(join(root,'terminal-pending',`${id}.json`),JSON.stringify({scope:'local',botId,content:'possibly submitted'}));
  let result=cli(root,`/status ${id}\nnew message\n/quit\n`);assert.equal(result.status,0,result.stderr);const draft=result.stdout.match(/Unsent draft ([\w-]+): new message/)?.[1];assert.ok(draft);assert.match(readFileSync(join(root,'terminal-pending',`${draft}.json`),'utf8'),/new message/);assert.doesNotMatch(result.stdout,/User turns saved/);assert.match(readFileSync(join(root,'terminal-pending',`${id}.json`),'utf8'),/possibly submitted/);
  result=cli(root,`/discard ${id}\n/retry ${draft}\n/quit\n`);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/does not cancel a command/);assert.match(result.stdout,/User turns saved: 1/);
 } finally {await stop(root);rmSync(root,{recursive:true,force:true});}
});


test('one-shot commands update shared bot and future bot defaults independently', async () => {
 const root=mkdtempSync(join(tmpdir(),'staf-cli-oneshot-'));seedDemoTerminal(root);
 const run=(...args)=>spawnSync(process.execPath,['dist/cli.js',...args,'--data-dir',root],{encoding:'utf8',timeout:20000,env:{...process.env,NO_COLOR:''}});
 try {
  let result=run('settings','set','provider','chatgpt','--confirm-provider-change');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Saved provider: ChatGPT/);
  result=run('settings','set-defaults','openrouter','fixture-model');assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).provider,'openrouter');
  result=run('settings','show');assert.match(result.stdout,/Provider: ChatGPT/);
  result=run('settings','defaults');assert.match(result.stdout,/Provider: openrouter/);
  result=run('auth','chatgpt','status');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ChatGPT:.*not signed in/);
  result=run('auth','codex','status');assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/ChatGPT:.*not signed in/);
 } finally {await stop(root);rmSync(root,{recursive:true,force:true});}
});
