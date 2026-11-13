import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const run = promisify(execFile);
const source = process.cwd();
async function checkoutAt(root) {
  await mkdir(root);
  for (const name of ['src', 'web', 'scripts', 'package.json', 'tsconfig.json', 'vite.config.ts']) await cp(join(source,name),join(root,name),{recursive:true});
  await symlink(join(source,'node_modules'),join(root,'node_modules'),'dir');
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, diagnostic=()=> '') {
  for (let i = 0; i < 600; i++) { const value = await fn(); if (value) return value; await pause(100); }
  throw Error(`Timed out: ${label}\n${diagnostic()}`);
}
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
test('development command serves one persistent instance and releases its ownership', {timeout:120000}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'staf-dev-test-')), dir = join(temp,'data'), connections=join(temp,'existing-staf'), checkout = join(temp,'checkout'), nextCheckout=join(temp,'next-checkout'), port = await freePort();
  await checkoutAt(checkout); await checkoutAt(nextCheckout); await mkdir(join(connections,'auth'),{recursive:true});
  const direct = JSON.stringify({version:1,issuer:'https://auth.openai.com',subject:'synthetic',clientId:'fixture-client',hostId:'fixture-host',accessToken:'synthetic-access',refreshToken:'synthetic-refresh',idToken:'synthetic-id',scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000});
  const host = JSON.stringify({version:1,hostId:'fixture-host'}), router = JSON.stringify({key:'synthetic-openrouter-key'});
  for (const [name, value] of [['codex-direct.json', direct], ['codex-host.json', host], ['openrouter.json', router]]) await writeFile(join(connections,'auth',name),value,{mode:0o600});
  const provider=createHttpServer(async(req,res)=>{for await(const _ of req){} res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'controlled development response'}}]}));});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const env = {PATH:process.env.PATH, HOME:temp, TMPDIR:temp, STAF_DEV_DATA_DIR:dir, STAF_DEV_CONNECTION_DIR:connections, STAF_DEV_PORT:String(port),STAF_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1/`,STAF_API_KEY:'synthetic-key',npm_config_verify_deps_before_run:'false'};
  let output = '';
  const launch = (extra={},cwd=checkout) => { const child = spawn('corepack', ['pnpm', 'dev'], {cwd, env:{...env,...extra}, detached:true, stdio:['pipe','pipe','pipe']}); child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b); return child; };
  const stop = async child => { process.kill(-child.pid, 'SIGINT'); await new Promise(resolve => child.once('exit', resolve)); };
  let child = launch();
  try {
    const code = await until(() => { if (child.exitCode !== null) throw Error(`Launcher exited: ${output}`); return output.match(/Pairing code: (\S+)/)?.[1]; }, 'launcher and pairing code',()=>output);
    const url = `http://127.0.0.1:${port}`;
    const call = async (path, token, body) => { const response = await fetch(url + path, {method:body?'POST':'GET', headers:{...(token?{Authorization:`Bearer ${token}`} : {}), ...(body?{'Content-Type':'application/json'}:{})}, body:body?JSON.stringify(body):undefined}); return [response.status, await response.json()]; };
    assert.match(await (await fetch(url)).text(), /\/src\/main\.ts|\/main\.ts/);
    const token = (await call('/api/pair', '', {code}))[1].token;
    assert.equal((await call('/api/codex-auth/credential', token))[1].signedIn, true);
    assert.equal((await call('/api/openrouter-connection', token))[1].saved, true);
    assert.equal((await fetch(url+'/api/bots', {headers:{Origin:'http://evil.example'}})).status,403);
    const bot = (await call('/api/bots', token, {operationId:'development-test',name:'Development agent',provider:'live',model:'fixture-offline'}))[1];
    assert.equal((await call('/api/commands', token, {id:'development-command',botId:bot.id,content:'hello'}))[1].kind, 'accepted');
    const rival = launch(); await new Promise(resolve => rival.once('exit', resolve));
    assert.notEqual(rival.exitCode, 0); assert.match(output, /active checkout/i);
    await assert.rejects(run(process.execPath,['scripts/dev-data.mjs','reset'],{cwd:checkout,env}),/ownership conflict/i);
    const conflict = launch({STAF_DEV_DATA_DIR:join(temp,'other-data')}); await new Promise(resolve => conflict.once('exit', resolve));
    assert.notEqual(conflict.exitCode, 0); assert.match(output, new RegExp(`Port ${port} is in use. Active checkout:`));
    const client = join(temp,'client.json'); await writeFile(client,JSON.stringify({token}));
    const cli = await run(process.execPath,['dist/cli.js','instance','bots',url,client],{cwd:checkout,env});
    assert.ok(JSON.parse(cli.stdout).some(item => item.id === bot.id));
    await stop(child);
    const old=new DatabaseSync(join(dir,'instance.sqlite'));old.exec('PRAGMA user_version=29');old.close();
    output = ''; child = launch({},nextCheckout); await until(() => output.includes('Pairing code:'), 'restart in another checkout');
    assert.ok(output.includes(nextCheckout));
    const backup=output.match(/Complete pre-upgrade backup: (.+)/)?.[1];assert.ok(backup);
    assert.equal(await readFile(join(backup,'agents',bot.id,'current','soul.md'),'utf8'),await readFile(join(dir,'agents',bot.id,'current','soul.md'),'utf8'));
    const saved=new DatabaseSync(join(backup,'instance.sqlite'),{readOnly:true});assert.equal(saved.prepare('PRAGMA user_version').get().user_version,29);saved.close();
    assert.equal((await call('/api/bots', token))[1].find(item => item.id === bot.id).name, 'Development agent');
    assert.equal((await call('/api/commands/development-command', token))[1].state, 'completed');
    for (const [name, value] of [['codex-direct.json', direct], ['codex-host.json', host], ['openrouter.json', router]]) assert.equal(await readFile(join(connections,'auth',name),'utf8'),value);
    assert.doesNotMatch(output,/synthetic-access|synthetic-refresh|synthetic-openrouter-key/);
  } finally { if (child.exitCode === null && child.signalCode === null) await stop(child); await new Promise(resolve=>provider.close(resolve)); await rm(temp,{recursive:true,force:true}); }
});

test('development startup refuses an interrupted dataset before initializing it', {timeout:30000}, async () => {
  const temp=await mkdtemp(join(tmpdir(),'staf-dev-barrier-')),checkout=join(temp,'checkout'),dir=join(temp,'data');
  try {
    await checkoutAt(checkout);await mkdir(dir);await writeFile(join(dir,'instance.sqlite.maintenance.json'),'{}');
    const child=spawn('corepack',['pnpm','dev'],{cwd:checkout,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temp,STAF_DEV_DATA_DIR:dir,STAF_DEV_PORT:String(await freePort())},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    await new Promise(resolve=>child.once('exit',resolve));assert.notEqual(child.exitCode,0);assert.match(output,/maintenance was interrupted.*dev:recover/i);
    await assert.rejects(readFile(join(dir,'instance.sqlite')),{code:'ENOENT'});
  } finally {await rm(temp,{recursive:true,force:true});}
});

test('development startup rejects a newer schema without changing it', {timeout:30000}, async () => {
  const temp=await mkdtemp(join(tmpdir(),'staf-dev-schema-')), checkout=join(temp,'checkout'), dir=join(temp,'data');
  try {
    await checkoutAt(checkout); await mkdir(dir);
    const path=join(dir,'instance.sqlite'), db=new DatabaseSync(path); db.exec('PRAGMA user_version=999'); db.close();
    const child=spawn('corepack',['pnpm','dev'],{cwd:checkout,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:temp,STAF_DEV_DATA_DIR:dir,STAF_DEV_PORT:String(await freePort())},stdio:['ignore','pipe','pipe']});
    let output=''; child.stdout.on('data',b=>output+=b); child.stderr.on('data',b=>output+=b);
    await new Promise(resolve=>child.once('exit',resolve)); assert.notEqual(child.exitCode,0);
    assert.match(output,/Database version 999 is newer.*select another data directory/i);
    const check=new DatabaseSync(path); assert.equal(check.prepare('PRAGMA user_version').get().user_version,999); check.close();
  } finally {await rm(temp,{recursive:true,force:true});}
});
