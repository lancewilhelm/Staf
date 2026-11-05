import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const actionJournalSchema = `
CREATE TABLE action_journal (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  identity TEXT NOT NULL UNIQUE,
  task_attempt_id TEXT REFERENCES task_attempts(id),
  command_id TEXT REFERENCES commands(id),
  state TEXT NOT NULL CHECK (state IN ('prepared','started','succeeded','failed','uncertain','cancelled')),
  summary TEXT NOT NULL,
  result TEXT,
  CHECK ((task_attempt_id IS NOT NULL) != (command_id IS NOT NULL))
);
CREATE INDEX action_journal_task ON action_journal(task_attempt_id);
CREATE INDEX action_journal_command ON action_journal(command_id);
`;

export type WorkRef = { kind: 'task'; id: string } | { kind: 'command'; id: string };
export type ActionState = 'prepared' | 'started' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
export type ActionRecord = {
  id: string;
  fingerprint: string;
  work: WorkRef;
  state: ActionState;
  summary: string;
  result: string | null;
};
declare const startPermitBrand: unique symbol;
export type StartPermit = { readonly [startPermitBrand]: true };
export type PrepareResult = { kind: 'created'; action: ActionRecord; permit: StartPermit } | { kind: 'existing'; action: ActionRecord };

export class ActionConflict extends Error {}

// All text inputs must already be safe to persist. The fingerprint must be keyed
// by the caller and must cover the complete original action, including work ID.
export class ActionJournal {
  private readonly permits = new WeakMap<StartPermit, { id: string; identity: string; fingerprint: string }>();
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ActionRecord | null {
    const row = this.db.prepare('SELECT * FROM action_journal WHERE id = ?').get(id);
    if (!row) return null;
    if (typeof row.id !== 'string' || typeof row.fingerprint !== 'string' || typeof row.summary !== 'string' ||
      (row.result !== null && typeof row.result !== 'string') ||
      (row.state !== 'prepared' && row.state !== 'started' && row.state !== 'succeeded' && row.state !== 'failed' && row.state !== 'uncertain' && row.state !== 'cancelled')) throw new Error('Invalid action journal record');
    let work: WorkRef;
    if (typeof row.task_attempt_id === 'string' && row.command_id === null) work = { kind: 'task', id: row.task_attempt_id };
    else if (typeof row.command_id === 'string' && row.task_attempt_id === null) work = { kind: 'command', id: row.command_id };
    else throw new Error('Invalid action journal work reference');
    return { id: row.id, fingerprint: row.fingerprint, work, state: row.state, summary: row.summary, result: row.result };
  }

  prepare(input: { id: string; fingerprint: string; work: WorkRef; summary: string }): PrepareResult {
    this.requireAutocommit();
    return this.prepareRecord(input);
  }

  prepareInInstanceTransaction(input: { id: string; fingerprint: string; work: WorkRef; summary: string }, db: DatabaseSync): PrepareResult {
    if (db !== this.db || db.isTransaction !== true) throw new ActionConflict('Instance-owned transaction required');
    return this.prepareRecord(input);
  }

  private prepareRecord(input: { id: string; fingerprint: string; work: WorkRef; summary: string }): PrepareResult {
    if (!input.id || !input.fingerprint || !input.work.id || !input.summary) throw new Error('Action fields must be nonempty');
    const identity = randomUUID();
    const inserted = this.db.prepare(`INSERT INTO action_journal (id,fingerprint,identity,task_attempt_id,command_id,state,summary)
      VALUES (?,?,?,?,?, 'prepared',?) ON CONFLICT(id) DO NOTHING`).run(input.id, input.fingerprint, identity,
      input.work.kind === 'task' ? input.work.id : null, input.work.kind === 'command' ? input.work.id : null, input.summary);
    const action = this.get(input.id);
    if (!action) throw new Error('Action journal insert failed');
    if (action.fingerprint !== input.fingerprint || action.work.kind !== input.work.kind || action.work.id !== input.work.id || action.summary !== input.summary) throw new ActionConflict('Action ID already identifies a different action');
    if (inserted.changes !== 1) return { kind: 'existing', action };
    const permit = Object.freeze({}) as StartPermit;
    this.permits.set(permit, { id: action.id, identity, fingerprint: action.fingerprint });
    return { kind: 'created', action, permit };
  }

  start(permit: StartPermit): ActionRecord {
    const claim = this.permits.get(permit);
    if (!claim) throw new ActionConflict('Start permit is invalid or already used');
    this.permits.delete(permit);
    this.requireAutocommit();
    const changed = this.db.prepare("UPDATE action_journal SET state = 'started' WHERE id = ? AND identity = ? AND fingerprint = ? AND state = 'prepared'").run(claim.id, claim.identity, claim.fingerprint);
    if (changed.changes !== 1) throw new ActionConflict('Action no longer matches its start permit');
    const action = this.get(claim.id);
    if (!action) throw new Error('Action journal transition failed');
    return action;
  }
  // The instance owns the surrounding synchronous transaction. The database
  // identity prevents a permit from being claimed on a different connection.
  startInInstanceTransaction(permit: StartPermit, db: DatabaseSync, expected: {id:string;fingerprint:string;work:WorkRef}): ActionRecord {
    if (db !== this.db || db.isTransaction !== true) throw new ActionConflict('Instance-owned transaction required');
    const claim = this.permits.get(permit);
    if (!claim) throw new ActionConflict('Start permit is invalid or already used');
    const record=this.get(claim.id);
    if(claim.id!==expected.id || claim.fingerprint!==expected.fingerprint || !record || record.work.kind!==expected.work.kind || record.work.id!==expected.work.id) throw new ActionConflict('Start permit does not match expected action');
    const changed = db.prepare("UPDATE action_journal SET state = 'started' WHERE id = ? AND identity = ? AND fingerprint = ? AND state = 'prepared'").run(claim.id, claim.identity, claim.fingerprint);
    if (changed.changes !== 1) throw new ActionConflict('Action no longer matches its start permit');
    const action = this.get(claim.id);
    if (!action) throw new Error('Action journal transition failed');
    return action;
  }
  finalizeInstanceStart(permit: StartPermit): void { this.permits.delete(permit); }
  cancel(id: string): ActionRecord { return this.transition(id, 'prepared', 'cancelled', null); }
  finish(id: string, state: 'succeeded' | 'failed' | 'uncertain', safeResult: string): ActionRecord {
    return this.transition(id, 'started', state, safeResult);
  }

  private requireAutocommit(): void {
    if (this.db.isTransaction !== false) throw new ActionConflict('Action journal requires an autocommit connection');
  }

  private transition(id: string, from: ActionState, to: ActionState, result: string | null): ActionRecord {
    this.requireAutocommit();
    const changed = this.db.prepare('UPDATE action_journal SET state = ?, result = ? WHERE id = ? AND state = ?').run(to, result, id, from);
    if (changed.changes !== 1) throw new ActionConflict(`Cannot transition action ${id} from ${from} to ${to}`);
    const action = this.get(id);
    if (!action) throw new Error('Action journal transition failed');
    return action;
  }

  // Call only after exclusive ownership of execution has been established.
  recoverStarted(): number {
    this.requireAutocommit();
    return Number(this.db.prepare("UPDATE action_journal SET state = 'uncertain', result = NULL WHERE state = 'started'").run().changes);
  }
}
