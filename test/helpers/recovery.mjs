import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

export function api(origin, token) {
  return async (path, body) => {
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000), redirect: 'error',
    });
    assert.ok(response.ok, `${path}: HTTP ${response.status}`);
    return response.json();
  };
}

export async function until(read, predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(100);
  }
  throw Error(`Timed out: ${label}`);
}

export async function seedRecovery(call) {
  const bot = await call('/api/bots', {name: 'Recovery agent', instructions: 'Keep this recovery fixture.', provider: 'demo'});
  const archived = await call('/api/bots', {name: 'Retained archive', provider: 'demo'});
  await call(`/api/bots/${archived.id}/archive`, {revision: archived.revision});
  await call('/api/commands', {id: 'recovery-chat', botId: bot.id, content: 'Retain this conversation'});
  await until(() => call('/api/commands/recovery-chat'), value => value.state === 'completed', 'demo chat');
  await call('/api/tasks', {id: 'recovery-history', botId: bot.id, objective: 'Retain existing operational history'});
  await until(() => call('/api/tasks/recovery-history'), value => value.state === 'completed', 'existing task history');
  await call('/api/approval-settings/instance', {mode: 'ask-every-time', clockEnabled: true});
  const defaults = await call('/api/creation-defaults');
  await call('/api/creation-defaults', {...defaults, provider: 'demo', model: null, reasoning: null});
  // A synthetic credential is stored and recovered, but never used for a request.
  await call('/api/openrouter-connection', {key: 'synthetic-recovery-only'});
  return bot;
}

export async function recoverySnapshot(call, botId) {
  const bots = (await call('/api/bots')).map(({configDir, ...bot}) => bot);
  return {
    bots,
    messages: await call(`/api/bots/${botId}/messages`),
    command: await call('/api/commands/recovery-chat'),
    task: await call('/api/tasks/recovery-history'),
    defaults: await call('/api/creation-defaults'),
    settings: await call('/api/approval-settings/instance'),
    connection: await call('/api/openrouter-connection'),
    clients: await call('/api/clients'),
  };
}

// Reconstruct the supported version-29 schema, rather than just changing its version tag.
export const prepareMigration = `
  const {DatabaseSync} = await import('node:sqlite');
  const db = new DatabaseSync(process.argv[1]);
  if (db.prepare('PRAGMA user_version').get().user_version !== 30) throw Error('Update the recovery migration fixture for this schema');
  db.exec('ALTER TABLE command_runtime_events DROP COLUMN detail; PRAGMA user_version=29');
  db.close();
`;

export const inspectMigration = `
  const {DatabaseSync} = await import('node:sqlite');
  const {readdirSync, statSync} = await import('node:fs');
  const {dirname, basename, join} = await import('node:path');
  const path = process.argv[1];
  const backups = readdirSync(dirname(path)).filter(name => name.startsWith(basename(path) + '.before-'));
  if (backups.length !== 1) throw Error('Expected exactly one migration backup');
  const backup = join(dirname(path), backups[0]);
  if (statSync(backup).mode & 0o077) throw Error('Migration backup is not private');
  for (const [file, version, hasDetail] of [[backup, 29, false], [path, 30, true]]) {
    const db = new DatabaseSync(file, {readOnly: true});
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Unreadable database');
    if (db.prepare('PRAGMA user_version').get().user_version !== version) throw Error('Wrong database version');
    const detailExists = db.prepare("SELECT 1 FROM pragma_table_info('command_runtime_events') WHERE name='detail'").get() !== undefined;
    if (detailExists !== hasDetail) throw Error('Wrong migration schema');
    if (db.prepare("SELECT state FROM commands WHERE id='recovery-chat'").get().state !== 'completed') throw Error('Chat missing');
    if (db.prepare("SELECT state FROM task_attempts WHERE id='recovery-history'").get().state !== 'completed') throw Error('History missing');
    db.close();
  }
`;

export const fileManifest = `
  const {readdirSync, lstatSync, readFileSync, readlinkSync} = await import('node:fs');
  const {join} = await import('node:path');
  const {createHash} = await import('node:crypto');
  const result = {};
  function visit(root, relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (!relative && name.startsWith('instance.sqlite')) continue;
      const child = join(relative, name), path = join(root, child), stat = lstatSync(path);
      if (stat.isSymbolicLink()) result[child] = {target: readlinkSync(path)};
      else if (stat.isDirectory()) visit(root, child);
      else result[child] = {mode: stat.mode & 0o777, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')};
    }
  }
  visit(process.argv[1]);
  console.log(JSON.stringify(result));
`;
