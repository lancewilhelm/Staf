// Actual-container acceptance. This is opt-in, uses Demo only, and owns unique projects.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {api, until, seedRecovery, recoverySnapshot, prepareMigration, inspectMigration, fileManifest} from '../helpers/recovery.mjs';
import {pairedClientJourney} from '../helpers/paired-browser.mjs';

const root = resolve(import.meta.dirname, '../..'), run = promisify(execFile);
const origin = 'http://127.0.0.1:3210';
const temp = await mkdtemp(join(tmpdir(), 'staf-container-acceptance-'));
const source = `staf-check-${Date.now()}-${process.pid}`, restored = `${source}-restored`;
const credential = join(temp, 'client.json');
const limitations = 'NOT VERIFIED: separate-machine SSH access, replacement-host restore, released-image upgrade, live providers';
const evidence = [limitations];
// The acceptance run must never inherit a user's custom mounts or external volumes.
const env = {...process.env, COMPOSE_FILE: join(root, 'compose.yaml'), COMPOSE_DISABLE_ENV_FILE: 'true', COMPOSE_ENV_FILES: '', COMPOSE_PROFILES: ''};
const execute = async (command, args, options = {}) => (await run(command, args, {cwd: root, env, timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options})).stdout.trim();
const compose = (project, ...args) => execute('docker', ['compose', '-f', join(root, 'compose.yaml'), '-p', project, ...args]);
const data = (action, project, path) => execute('sh', [join(root, 'deploy/docker-data.sh'), action, project, path]);
const cli = (...args) => execute(process.execPath, ['dist/cli.js', 'instance', ...args]);
const node = (project, script, path) => compose(project, 'run', '--rm', '-T', '--no-deps', '--pull', 'never', '--entrypoint', 'node', 'staf', '--input-type=module', '-e', script, path);
const pass = label => {evidence.push(label); console.log(`PASS ${label}`);};
async function ready(project) {
  await until(async () => {
    try {return (await fetch(origin, {signal: AbortSignal.timeout(1000)})).ok;} catch {return false;}
  }, Boolean, 'container workspace');
  const logs = await compose(project, 'logs', '--no-color', 'staf');
  const code = [...logs.matchAll(/Pairing code: (\S+)/g)].at(-1)?.[1];
  assert.ok(code, 'container printed a pairing code');
  return code;
}
async function rejectsStatus(token, status) {
  assert.equal((await fetch(origin + '/api/bots', {headers: token ? {Authorization: `Bearer ${token}`} : {}})).status, status);
}
let dockerReady = false, evidenceReserved = false;
try {
  if (process.env.STAF_DOCKER_EVIDENCE) {
    // Reserve the output before creating resources; never overwrite earlier evidence.
    await writeFile(process.env.STAF_DOCKER_EVIDENCE, '', {mode: 0o600, flag: 'wx'});
    evidenceReserved = true;
  }
  // Fail on an occupied port; never stop an owner's existing instance.
  const probe = createServer();
  await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(3210, '127.0.0.1', () => probe.close(resolve));});
  const environment = await execute('docker', ['version', '--format', '{{json .}}']);
  dockerReady = true;
  evidence.push(`Started ${new Date().toISOString()}; host ${process.platform}/${process.arch}; Docker ${environment}`);
  evidence.push(`Source ${await execute('git', ['rev-parse', 'HEAD'])}; working-tree diff ${await execute('git', ['diff', '--stat'])}`);
  await execute('docker', ['compose', '-f', join(root, 'compose.yaml'), '-p', source, 'build'], {timeout: 600000});
  await compose(source, 'up', '-d', '--no-build');
  const code = await ready(source);
  await cli('pair', origin, credential, code);
  const {token} = JSON.parse(await readFile(credential, 'utf8'));
  const call = api(origin, token), bot = await seedRecovery(call);
  await rejectsStatus(undefined, 401); await rejectsStatus('unrecognized', 401);
  assert.equal((await fetch(origin + '/api/bots', {headers: {Authorization: `Bearer ${token}`, Origin: 'https://untrusted.example'}})).status, 403);
  assert.equal((await fetch(origin + '/api/bots', {headers: {Authorization: `Bearer ${token}`, Host: 'untrusted.example'}})).status, 403);
  await assert.rejects(api(origin, '')('/api/pair', {code}), /HTTP 403/);
  await compose(source, 'restart', 'staf');
  const browserCode = await ready(source);
  const revokedToken = await pairedClientJourney({origin, code: browserCode, directory: join(temp, 'browser'), cli: (action, ...args) => cli(action, origin, credential, ...args), bot, call});
  pass('actual container: browser/CLI pairing, shared Demo chat, invalid authorization/origin/host and browser revocation');
  const expected = await recoverySnapshot(call, bot.id);
  const originalId = await compose(source, 'ps', '-q', 'staf');
  await compose(source, 'up', '-d', '--force-recreate', '--no-build'); await ready(source);
  assert.notEqual(await compose(source, 'ps', '-q', 'staf'), originalId);
  assert.deepEqual(await recoverySnapshot(call, bot.id), expected); await rejectsStatus(revokedToken, 401);
  pass('actual container replacement retains configuration, credentials, chat, settings, history and revocation');
  await assert.rejects(data('backup', source, join(temp, 'backups')), /Stop every container/);
  await compose(source, 'stop', 'staf');
  const files = await node(source, fileManifest, '/data');
  const backup = (await data('backup', source, join(temp, 'backups'))).split('Backup created: ')[1]; assert.ok(backup);
  // Change only disposable source data to a reconstructed prior schema, then upgrade.
  await node(source, prepareMigration, '/data/instance.sqlite');
  await compose(source, 'up', '-d', '--force-recreate', '--no-build'); await ready(source);
  assert.deepEqual(await recoverySnapshot(call, bot.id), expected);
  await compose(source, 'stop', 'staf');
  await node(source, inspectMigration, '/data/instance.sqlite');
  assert.equal(await node(source, fileManifest, '/data'), files);
  pass('actual container schema 29→30 upgrade creates a readable private pre-migration database backup');
  await execute('docker', ['compose', '-f', join(root, 'compose.yaml'), '-p', restored, 'build'], {timeout: 600000});
  await data('restore', restored, backup);
  await assert.rejects(data('restore', restored, backup), /Destination data volume must be empty/);
  assert.equal(await node(restored, fileManifest, '/data'), files);
  await compose(restored, 'up', '-d', '--no-build'); await ready(restored);
  assert.deepEqual(await recoverySnapshot(call, bot.id), expected); await rejectsStatus(revokedToken, 401);
  await rejectsStatus(undefined, 401);
  pass('actual same-host replacement-project restore retains full data and rejects a nonempty destination');
  console.log(limitations);
} catch (error) {
  evidence.push(`FAILED: ${error.message}`);
  throw error;
} finally {
  try {
    if (dockerReady) {
      for (const project of [source, restored]) {
        try {await compose(project, 'down', '--volumes', '--remove-orphans', '--rmi', 'local');}
        catch {evidence.push(`Cleanup incomplete: ${project}`); console.error(`Cleanup incomplete: docker compose -f ${join(root, 'compose.yaml')} -p ${project} down --volumes --rmi local`);}
      }
    }
    if (evidenceReserved) await writeFile(process.env.STAF_DOCKER_EVIDENCE, evidence.join('\n') + '\n', {mode: 0o600});
  } finally {
    await rm(temp, {recursive: true, force: true});
  }
}
