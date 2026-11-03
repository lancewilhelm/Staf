import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startInstance} from '../dist/instance-service.js';
import {api, seedRecovery, recoverySnapshot, prepareMigration, inspectMigration, fileManifest} from './helpers/recovery.mjs';

const run = promisify(execFile);
test('stopped full-data archive recovers configuration, authorizations, chat and operational history through migration', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'staf-recovery-'));
  const source = join(temp, 'source'), restored = join(temp, 'restored'), archive = join(temp, 'data.tar');
  await mkdir(source); await mkdir(restored);
  const node = async (script, path) => (await run(process.execPath, ['--input-type=module', '-e', script, path])).stdout;
  let app;
  try {
    app = startInstance(join(source, 'instance.sqlite'), 0, {env: {}});
    let origin = `http://127.0.0.1:${await app.listen()}`;
    const {token} = await api(origin, '')('/api/pair', {code: app.code});
    let call = api(origin, token);
    const bot = await seedRecovery(call);
    const revoked = await call('/api/pair', {code: app.issueCode()});
    const revokedClient = (await api(origin, revoked.token)('/api/clients')).find(client => client.current);
    await call(`/api/clients/${revokedClient.id}/revoke`, {});
    const expected = await recoverySnapshot(call, bot.id);
    await app.close(); app = undefined;
    const files = await node(fileManifest, source);
    await node(prepareMigration, join(source, 'instance.sqlite'));
    await run('tar', ['-C', source, '-cf', archive, '.']);
    await run('tar', ['-C', restored, '-xf', archive]);
    assert.equal(await node(fileManifest, restored), files, 'agent revisions, symlinks and credential bytes survive');
    app = startInstance(join(restored, 'instance.sqlite'), 0, {env: {}});
    origin = `http://127.0.0.1:${await app.listen()}`;
    call = api(origin, token);
    assert.deepEqual(await recoverySnapshot(call, bot.id), expected);
    assert.equal((await fetch(origin + '/api/bots', {headers: {Authorization: `Bearer ${revoked.token}`}})).status, 401);
    assert.equal((await fetch(origin + '/api/bots')).status, 401);
    await app.close(); app = undefined;
    await node(inspectMigration, join(restored, 'instance.sqlite'));
    assert.equal(await node(fileManifest, restored), files);
  } finally {
    if (app) await app.close();
    await rm(temp, {recursive: true, force: true});
  }
});
