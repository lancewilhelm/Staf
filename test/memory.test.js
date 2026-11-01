import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryConflict, MemoryStore, memorySchema } from '../dist/memory.js';

function setup(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY); INSERT OR IGNORE INTO bots VALUES (\'a\'), (\'b\');');
  db.exec(memorySchema);
  return { db, store: new MemoryStore(db) };
}
const user = { kind: 'user' }, a = { kind: 'bot', botId: 'a' }, b = { kind: 'bot', botId: 'b' };

test('correction, scope isolation and optimistic deletion', () => {
  const { db, store } = setup();
  try {
    const saved = store.create({ scope: a, text: 'Prefers tea' });
    store.create({ scope: b, text: 'Prefers coffee' });
    store.create({ scope: user, text: 'Prefers walking' });
    const corrected = store.update({ id: saved.id, scope: a, version: saved.version, text: 'Prefers coffee' });
    assert.equal(corrected.version, 2);
    assert.equal(corrected.id, saved.id);
    assert.throws(() => store.update({ id: saved.id, scope: a, version: 1, text: 'stale' }), MemoryConflict);
    assert.throws(() => store.delete({ id: saved.id, scope: b, version: 2 }), MemoryConflict);
    assert.throws(() => store.delete({ id: saved.id, scope: a, version: 1 }), MemoryConflict);
    assert.deepEqual(store.list(a).map(m => m.text), ['Prefers coffee']);
    store.delete({ id: saved.id, scope: a, version: 2 });
    assert.deepEqual(store.list(a), []);
    assert.equal(store.list(b).length, 1);
    assert.equal(store.list(user).length, 1);
  } finally { db.close(); }
});

test('retrieval is bounded, stable, lexical and limited to the bot and user', () => {
  const { db, store } = setup();
  try {
    store.create({ scope: a, text: 'Tea and walking' });
    store.create({ scope: a, text: 'Tea' });
    store.create({ scope: b, text: 'Tea walking private' });
    store.create({ scope: user, text: 'Walking is preferred' });
    store.create({ scope: a, text: 'ÉLISE enjoys tea' });
    const input = { botId: 'a', query: 'tea walking', limit: 2 };
    const result = store.retrieve(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'Tea and walking');
    assert.deepEqual(store.retrieve(input), result);
    assert.ok(store.retrieve({ ...input, limit: 50 }).every(m => m.scope.kind === 'user' || m.scope.botId === 'a'));
    assert.deepEqual(store.retrieve({ ...input, query: 'unmatched' }), []);
    assert.deepEqual(store.retrieve({ ...input, query: 'élise' }).map(m => m.text), ['ÉLISE enjoys tea']);
    assert.throws(() => store.retrieve({ ...input, limit: 51 }));
  } finally { db.close(); }
});

test('rejects invalid scopes and empty inputs', () => {
  const { db, store } = setup();
  try {
    for (const scope of [null, {}, { kind: 'user', botId: 'a' }, { kind: 'bot', botId: '' }, { kind: 'bot', botId: 'missing' }]) {
      assert.throws(() => store.create({ scope, text: 'x' }));
    }
    assert.throws(() => store.create({ scope: a, text: '  ' }));
    assert.throws(() => store.retrieve({ botId: 'a', query: ' ', limit: 1 }));
  } finally { db.close(); }
});

test('survives closing and reopening a file-backed database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'staf-memory-'));
  try {
    const path = join(dir, 'memory.sqlite');
    const first = setup(path);
    const saved = first.store.create({ scope: user, text: 'Persisted preference' });
    first.db.close();
    const second = setup(path);
    try { assert.deepEqual(second.store.list(user), [saved]); } finally { second.db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
