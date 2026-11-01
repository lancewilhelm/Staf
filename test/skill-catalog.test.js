import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillCatalog, SkillConflict, skillCatalogSchema } from '../dist/skill-catalog.js';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'staf-skills-'));
  const db = new DatabaseSync(join(dir, 'db'));
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE bots (id TEXT PRIMARY KEY); INSERT INTO bots VALUES ('a'),('b');");
  db.exec(skillCatalogSchema);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { catalog: new SkillCatalog(db), dir };
}
const entry = (body = 'Read the instructions') => ({ name: 'Research', description: 'Find sources', bytes: Buffer.from(body), provenance: 'Owner import' });

test('revisions are immutable, bot availability is isolated, and disable takes effect', t => {
  const { catalog } = setup(t);
  const first = catalog.import(entry());
  assert.equal(first.digest, createHash('sha256').update(entry().bytes).digest('hex'));
  catalog.setBotAvailability({ id: first.id, botId: 'a', available: true });
  assert.equal(catalog.availableToBot('a').length, 1);
  assert.equal(catalog.availableToBot('b').length, 0);
  const next = catalog.update({ ...entry('Revised instructions'), id: first.id, expectedRevision: 1 });
  assert.equal(next.revision, 2);
  assert.equal(catalog.inspect({ id: first.id, revision: 1 }).body, first.body);
  assert.throws(() => catalog.update({ ...entry('stale'), id: first.id, expectedRevision: 1 }), SkillConflict);
  assert.equal(catalog.inspect({ id: first.id }).body, next.body);
  catalog.setEnabled({ id: first.id, enabled: false });
  assert.deepEqual(catalog.availableToBot('a'), []);
  assert.equal(catalog.list()[0].enabled, false);
  catalog.setEnabled({ id: first.id, enabled: true });
  catalog.setBotAvailability({ id: first.id, botId: 'a', available: false });
  assert.deepEqual(catalog.availableToBot('a'), []);
});

test('rejects malformed input and duplicate names without partial records', t => {
  const { catalog } = setup(t);
  catalog.import(entry());
  assert.throws(() => catalog.import({ ...entry(), name: 'research' }));
  for (const invalid of [
    { ...entry(), name: '  ' }, { ...entry(), description: 'bad\nvalue' },
    { ...entry(), provenance: '' }, { ...entry(), bytes: Buffer.from([0xff]) },
    { ...entry(), bytes: Buffer.alloc(256 * 1024 + 1, 65) }, { ...entry(), bytes: Buffer.from('a\0b') },
  ]) assert.throws(() => catalog.import(invalid));
  assert.equal(catalog.list().length, 1);
});

test('imported content is stored as data and is never executed', t => {
  const { catalog, dir } = setup(t);
  const marker = join(dir, 'executed');
  const body = `#!/bin/sh\ntouch ${marker}\n`;
  const skill = catalog.import(entry(body));
  assert.equal(catalog.inspect({ id: skill.id }).body, body);
  assert.equal(existsSync(marker), false);
});
