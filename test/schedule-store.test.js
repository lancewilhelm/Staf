import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScheduleStore, scheduleStoreSchema, ScheduleConflict } from '../dist/schedule-store.js';

const at = s => Date.parse(s);
const input = (overrides = {}) => ({ botId: 'bot', objective: 'Prepare report', recurrence: { kind: 'daily', timeZone: 'UTC', hour: 12, minute: 0 }, maxLatenessMs: 300000, cursor: at('2024-03-01T00:00Z'), enabled: true, authorization: { action: 'send-report', resource: 'alex', limits: { count: 1 } }, ...overrides });
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'staf-schedule-')); const path = join(dir, 'test.db');
  let db = new DatabaseSync(path); db.exec(scheduleStoreSchema); db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY)');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store: () => new ScheduleStore(db), task: id => () => { db.prepare('INSERT INTO tasks VALUES (?)').run(id); return id; }, reopen: () => { db.close(); db = new DatabaseSync(path); }, db: () => db };
}
test('first due, atomic task link, retry and restart', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  assert.equal(s.tick({ id: a.id, now: at('2024-03-01T11:59Z'), createTask: f.task('early') }), undefined);
  const occurrence = s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: f.task('task') });
  assert.equal(occurrence.status, 'claimed'); assert.equal(occurrence.task_id, 'task');
  f.reopen(); assert.equal(f.store().tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: f.task('again') }), undefined);
  assert.equal(f.store().occurrences(a.id).length, 1);
});
test('catch-up summarizes older due times; stale and busy occurrences are skipped', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  const o = s.tick({ id: a.id, now: at('2024-03-04T12:04Z'), createTask: f.task('one') });
  assert.equal(o.due_at, at('2024-03-04T12:00Z')); assert.equal(o.skipped_from, at('2024-03-01T12:00Z')); assert.equal(o.skipped_through, at('2024-03-03T12:00Z'));
  const busy = s.tick({ id: a.id, now: at('2024-03-05T12:00Z'), createTask: f.task('two') }); assert.equal(busy.reason, 'busy');
  s.transition({ scheduleId: a.id, dueAt: o.due_at, from: 'claimed', to: 'uncertain' });
  assert.equal(s.tick({ id: a.id, now: at('2024-03-06T12:00Z'), createTask: f.task('three') }).reason, 'busy');
  s.transition({ scheduleId: a.id, dueAt: o.due_at, from: 'uncertain', to: 'completed' });
  assert.equal(s.tick({ id: a.id, now: at('2024-03-07T12:06Z'), createTask: f.task('late') }).reason, 'late');
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
});
test('task insertion rollback and outer transaction rollback keep cursor consistent', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  assert.throws(() => s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: () => { f.task('bad')(); throw Error('fail'); } }));
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM tasks').get().n, 0); assert.equal(s.occurrences(a.id).length, 0);
  f.db().exec('BEGIN'); s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: f.task('rolled') }); f.db().exec('ROLLBACK');
  assert.equal(s.occurrences(a.id).length, 0); assert.equal(f.db().prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
});
test('edits enforce versions, disabled state, and cannot replace authorization', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  const edit = { id: a.id, version: a.version, recurrence: a.recurrence, maxLatenessMs: a.maxLatenessMs, cursor: a.cursor, enabled: false, authorization: { action: '*', resource: '*', limits: { count: 999 } } };
  const changed = s.edit(edit); assert.deepEqual(changed.authorization, a.authorization);
  assert.throws(() => s.edit(edit), ScheduleConflict);
  assert.equal(s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: f.task('no') }), undefined);
  assert.throws(() => s.edit({ ...edit, version: changed.version, maxLatenessMs: changed.maxLatenessMs + 1 }));
  const revoked = s.revoke({ id: a.id, version: changed.version });
  assert.throws(() => s.edit({ ...edit, version: revoked.version, enabled: true }), ScheduleConflict);
  assert.equal(s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: f.task('revoked') }), undefined);
});
test('DST gap skipped and fold produces only its first instant', t => {
  const f = fixture(t), s = f.store();
  const gap = s.create(input({ botId: 'gap', recurrence: { kind: 'daily', timeZone: 'America/New_York', hour: 2, minute: 30 }, cursor: at('2024-03-09T07:30Z') }));
  assert.equal(s.tick({ id: gap.id, now: at('2024-03-10T12:00Z'), createTask: f.task('gap') }), undefined);
  const fold = s.create(input({ botId: 'fold', recurrence: { kind: 'daily', timeZone: 'America/New_York', hour: 1, minute: 30 }, cursor: at('2024-11-02T05:30Z'), maxLatenessMs: 3600000 }));
  assert.equal(s.tick({ id: fold.id, now: at('2024-11-03T06:30Z'), createTask: f.task('fold') }).due_at, at('2024-11-03T05:30Z'));
  assert.equal(s.tick({ id: fold.id, now: at('2024-11-03T06:30Z'), createTask: f.task('repeat') }), undefined);
});

test('reentrant revocation rolls back the task and occurrence', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  assert.throws(() => s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: () => {
    f.task('reentrant')();
    s.revoke({ id: a.id, version: a.version });
    return 'reentrant';
  } }), ScheduleConflict);
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM tasks').get().n, 0);
  assert.equal(s.occurrences(a.id).length, 0);
  assert.equal(s.get(a.id).cursor, a.cursor);
  assert.equal(s.get(a.id).revoked, false);
});

test('nested ticks for the same bot observe the reserved occurrence', t => {
  const f = fixture(t), s = f.store(), a = s.create(input()), b = s.create(input());
  const first = s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: () => {
    const nested = s.tick({ id: b.id, now: at('2024-03-01T12:00Z'), createTask: f.task('nested') });
    assert.equal(nested.reason, 'busy');
    return f.task('first')() || 'first';
  } });
  assert.equal(first.status, 'claimed');
  assert.equal(f.db().prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
  assert.equal(s.occurrences(b.id)[0].status, 'skipped');
});

test('a missing task ID rolls back the claim and leaves the cursor untouched', t => {
  const f = fixture(t), s = f.store(), a = s.create(input());
  assert.throws(() => s.tick({ id: a.id, now: at('2024-03-01T12:00Z'), createTask: () => null }), /Invalid task ID/);
  assert.equal(s.occurrences(a.id).length, 0);
  assert.equal(s.get(a.id).cursor, a.cursor);
});
