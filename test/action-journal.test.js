import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionJournal, ActionConflict, actionJournalSchema } from '../dist/action-journal.js';

function setup(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS task_attempts (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS commands (id TEXT PRIMARY KEY)');
  return db;
}
function input(id = 'a') { return { id, fingerprint: 'keyed-digest', work: { kind: 'task', id: 'attempt' }, summary: 'safe description' }; }

test('duplicate IDs identify one action and changes conflict', () => {
  const db = setup(); db.exec(actionJournalSchema); db.exec("INSERT INTO task_attempts VALUES ('attempt')");
  const journal = new ActionJournal(db);
  assert.equal(journal.prepare(input()).kind, 'created');
  assert.equal(journal.prepare(input()).kind, 'existing');
  assert.throws(() => journal.prepare({ ...input(), fingerprint: 'other' }), ActionConflict);
  assert.throws(() => journal.prepare({ ...input(), summary: 'other' }), ActionConflict);
  assert.equal(journal.get('a').state, 'prepared');
  db.close();
});

test('transitions guard cancellation, dispatch, and terminal outcomes', () => {
  const db = setup(); db.exec(actionJournalSchema); db.exec("INSERT INTO task_attempts VALUES ('attempt')");
  const journal = new ActionJournal(db);
  const a = journal.prepare(input());
  assert.throws(() => journal.finish('a', 'succeeded', 'safe'), ActionConflict);
  journal.cancel('a');
  assert.throws(() => journal.start(a.permit), ActionConflict);
  const b = journal.prepare(input('b')); journal.start(b.permit);
  assert.throws(() => journal.cancel('b'), ActionConflict);
  assert.throws(() => journal.start(b.permit), ActionConflict);
  assert.equal(journal.finish('b', 'succeeded', 'redacted result').result, 'redacted result');
  assert.throws(() => journal.finish('b', 'failed', 'safe'), ActionConflict);
  db.close();
});

test('restart preserves outcomes and makes unfinished dispatch uncertain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'staf-action-')); const path = join(dir, 'db');
  try {
    let db = setup(path); db.exec(actionJournalSchema); db.exec("INSERT INTO task_attempts VALUES ('attempt')");
    let journal = new ActionJournal(db);
    const a = journal.prepare(input()); journal.start(a.permit);
    const b = journal.prepare(input('b')); journal.start(b.permit); journal.finish('b', 'failed', 'safe failure');
    journal.prepare(input('c'));
    db.close();
    db = setup(path); journal = new ActionJournal(db);
    assert.equal(journal.recoverStarted(), 1);
    assert.equal(journal.recoverStarted(), 0);
    assert.equal(journal.get('a').state, 'uncertain');
    assert.equal(journal.prepare(input()).kind, 'existing');
    assert.throws(() => journal.start(a.permit), ActionConflict);
    assert.equal(journal.get('b').result, 'safe failure');
    assert.equal(journal.get('c').state, 'prepared');
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('foreign keys and transactions protect work references and transitions', () => {
  const db = setup(); db.exec(actionJournalSchema); const journal = new ActionJournal(db);
  assert.throws(() => journal.prepare(input()));
  assert.equal(journal.get('a'), null);
  db.exec("INSERT INTO commands VALUES ('cmd')");
  const a = journal.prepare({ ...input(), work: { kind: 'command', id: 'cmd' } });
  db.exec('BEGIN');
  assert.throws(() => journal.start(a.permit), ActionConflict);
  assert.throws(() => journal.prepare({ ...input('b'), work: { kind: 'command', id: 'cmd' } }), ActionConflict);
  db.exec('ROLLBACK');
  assert.equal(journal.get('a').state, 'prepared');
  assert.throws(() => journal.start(a.permit), ActionConflict);
  db.close();
});


test('a stale permit cannot start a replacement row, even with the same fingerprint', () => {
  const db = setup(); db.exec(actionJournalSchema); db.exec("INSERT INTO task_attempts VALUES ('attempt')");
  const journal = new ActionJournal(db);
  db.exec('BEGIN');
  assert.throws(() => journal.prepare(input()), ActionConflict);
  db.exec('ROLLBACK');
  const original = journal.prepare(input());
  db.exec("DELETE FROM action_journal WHERE id = 'a'");
  const replacement = journal.prepare(input());
  assert.throws(() => journal.start(original.permit), ActionConflict);
  assert.equal(journal.get('a').state, 'prepared');
  assert.equal(journal.start(replacement.permit).state, 'started');
  db.close();
});
