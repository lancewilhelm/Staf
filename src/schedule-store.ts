import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { calculateRecurrence, type Recurrence } from './schedule-recurrence.js';

/** Install through a versioned, backed-up migration owned by the caller. */
export const scheduleStoreSchema = `
CREATE TABLE schedules (
 id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, objective TEXT NOT NULL,
 recurrence TEXT NOT NULL, max_lateness_ms INTEGER NOT NULL,
 cursor INTEGER NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 authorization TEXT NOT NULL, revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), version INTEGER NOT NULL CHECK(version > 0)
);
CREATE TABLE schedule_occurrences (
 schedule_id TEXT NOT NULL REFERENCES schedules(id), due_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('skipped','claimed','started','completed','uncertain','reviewed')),
 reason TEXT, task_id TEXT UNIQUE, skipped_from INTEGER, skipped_through INTEGER,
 PRIMARY KEY(schedule_id,due_at)
);
CREATE INDEX schedule_occurrences_status ON schedule_occurrences(status);
`;

/** Explicit owner-selected boundaries; this record alone does not grant tool permission. */
export type ScheduleAuthorization = { action: string; resource: string; limits: Record<string, string | number | boolean> };
export type ScheduleInput = { botId: string; objective: string; recurrence: Recurrence; maxLatenessMs: number; cursor: number; enabled: boolean; authorization: ScheduleAuthorization };
export class ScheduleConflict extends Error {}

function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 4096 || /[\u0000-\u001f*]/u.test(value)) throw new Error(`Invalid ${label}`);
}
function validate(input: ScheduleInput): void {
  text(input.botId, 'bot ID'); text(input.objective, 'objective');
  if (typeof input.enabled !== 'boolean') throw new Error('Invalid enabled state');
  calculateRecurrence({ recurrence: input.recurrence, cursor: input.cursor, now: input.cursor, maxLatenessMs: input.maxLatenessMs });
  const a = input.authorization;
  if (!a || typeof a !== 'object' || Object.keys(a).sort().join(',') !== 'action,limits,resource') throw new Error('Invalid authorization');
  text(a.action, 'action'); text(a.resource, 'resource');
  if (!a.limits || typeof a.limits !== 'object' || Array.isArray(a.limits)) throw new Error('Invalid limits');
  const entries = Object.entries(a.limits);
  if (!entries.length || entries.length > 20) throw new Error('Invalid limits');
  for (const [key, value] of entries) {
    text(key, 'limit');
    if (typeof value === 'string') text(value, 'limit value');
    else if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid limit value');
  }
}
function parsed(row: Record<string, unknown>) {
  if (typeof row.id !== 'string' || typeof row.bot_id !== 'string' || typeof row.objective !== 'string' || typeof row.recurrence !== 'string' || typeof row.max_lateness_ms !== 'number' || typeof row.cursor !== 'number' || typeof row.authorization !== 'string' || typeof row.version !== 'number' || (row.enabled !== 0 && row.enabled !== 1) || (row.revoked !== 0 && row.revoked !== 1)) throw new Error('Invalid stored schedule');
  const input: ScheduleInput = { botId: row.bot_id, objective: row.objective, recurrence: JSON.parse(row.recurrence), maxLatenessMs: row.max_lateness_ms, cursor: row.cursor, enabled: row.enabled === 1, authorization: JSON.parse(row.authorization) };
  validate(input);
  return { id: row.id, version: row.version, revoked: row.revoked === 1, ...input };
}

export class ScheduleStore {
  constructor(private readonly db: DatabaseSync) {}
  private atomic<T>(fn: () => T): T {
    this.db.exec('SAVEPOINT schedule_store');
    try { const value = fn(); this.db.exec('RELEASE schedule_store'); return value; }
    catch (error) { this.db.exec('ROLLBACK TO schedule_store'); this.db.exec('RELEASE schedule_store'); throw error; }
  }
  create(input: ScheduleInput) {
    validate(input);
    const id = randomUUID();
    this.db.prepare('INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?,0,1)').run(id, input.botId, input.objective, JSON.stringify(input.recurrence), input.maxLatenessMs, input.cursor, Number(input.enabled), JSON.stringify(input.authorization));
    return this.get(id)!;
  }
  get(id: string) { text(id, 'schedule ID'); const row = this.db.prepare('SELECT * FROM schedules WHERE id=?').get(id); return row ? parsed(row) : undefined; }
  list() { return this.db.prepare('SELECT * FROM schedules ORDER BY id').all().map(parsed); }
  /** Authorization, bot and objective are immutable: changing them requires a new owner-created schedule. */
  edit(input: { id: string; version: number; recurrence: Recurrence; maxLatenessMs: number; cursor: number; enabled: boolean }) {
    return this.atomic(() => {
      const prior = this.get(input.id);
      if (!prior || prior.revoked || prior.version !== input.version) throw new ScheduleConflict('Schedule changed, was revoked, or was not found');
      if (JSON.stringify(input.recurrence) !== JSON.stringify(prior.recurrence) || input.maxLatenessMs > prior.maxLatenessMs) throw new Error('Changing recurrence or widening lateness requires a new schedule');
      if (input.cursor < prior.cursor) throw new Error('Cursor cannot move backward');
      const next = { ...prior, recurrence: input.recurrence, maxLatenessMs: input.maxLatenessMs, cursor: input.cursor, enabled: input.enabled };
      validate(next);
      const result = this.db.prepare('UPDATE schedules SET recurrence=?, max_lateness_ms=?, cursor=?, enabled=?, version=version+1 WHERE id=? AND version=?').run(JSON.stringify(next.recurrence), next.maxLatenessMs, next.cursor, Number(next.enabled), input.id, input.version);
      if (!result.changes) throw new ScheduleConflict('Schedule changed or was not found');
      return this.get(input.id)!;
    });
  }
  revoke(input: { id: string; version: number }) {
    const result = this.db.prepare('UPDATE schedules SET revoked=1, enabled=0, version=version+1 WHERE id=? AND version=? AND revoked=0').run(input.id, input.version);
    if (!result.changes) throw new ScheduleConflict('Schedule changed, was revoked, or was not found');
    return this.get(input.id)!;
  }
  occurrences(id: string) { text(id, 'schedule ID'); return this.db.prepare('SELECT * FROM schedule_occurrences WHERE schedule_id=? ORDER BY due_at').all(id); }
  /** createTask must synchronously insert its task into this database; rollback includes both records. */
  tick(input: { id: string; now: number; createTask: (schedule: ReturnType<ScheduleStore['get']> & {}, dueAt: number) => string; isBusy?: (botId: string) => boolean }) {
    return this.atomic(() => {
      const schedule = this.get(input.id);
      if (!schedule) throw new Error('Schedule not found');
      if (!schedule.enabled || schedule.revoked) return undefined;
      const r = calculateRecurrence({ recurrence: schedule.recurrence, cursor: schedule.cursor, now: input.now, maxLatenessMs: schedule.maxLatenessMs });
      if (r.latestDue === null) return undefined;
      const first = calculateRecurrence({ recurrence: schedule.recurrence, cursor: schedule.cursor, now: schedule.cursor, maxLatenessMs: schedule.maxLatenessMs }).nextDue;
      const previous = calculateRecurrence({ recurrence: schedule.recurrence, cursor: schedule.cursor, now: r.latestDue - 1, maxLatenessMs: schedule.maxLatenessMs }).latestDue;
      const busy = !!this.db.prepare("SELECT 1 FROM schedule_occurrences o JOIN schedules s ON s.id=o.schedule_id WHERE s.bot_id=? AND o.status IN ('claimed','started','uncertain') LIMIT 1").get(schedule.botId);
      const reason = !r.eligible ? 'late' : busy || input.isBusy?.(schedule.botId) ? 'busy' : null;
      // Reserve the bot before invoking caller code, including nested ticks on this connection.
      this.db.prepare('INSERT INTO schedule_occurrences VALUES (?,?,?,?,?,?,?)').run(schedule.id, r.latestDue, reason ? 'skipped' : 'claimed', reason, null, previous === null ? null : first, previous);
      if (reason === null) {
        const taskId = input.createTask(schedule, r.latestDue);
        text(taskId, 'task ID');
        this.db.prepare('UPDATE schedule_occurrences SET task_id=? WHERE schedule_id=? AND due_at=?').run(taskId, schedule.id, r.latestDue);
      }
      const updated = this.db.prepare('UPDATE schedules SET cursor=?,version=version+1 WHERE id=? AND version=? AND enabled=1 AND revoked=0').run(r.latestDue, schedule.id, schedule.version);
      if (!updated.changes) throw new ScheduleConflict('Schedule changed or was revoked during task creation');
      return this.db.prepare('SELECT * FROM schedule_occurrences WHERE schedule_id=? AND due_at=?').get(schedule.id, r.latestDue);
    });
  }
  /** Recovery must explicitly resolve uncertain work; this method never dispatches it. */
  transition(input: { scheduleId: string; dueAt: number; from: 'claimed' | 'started' | 'uncertain'; to: 'started' | 'completed' | 'uncertain' | 'reviewed' }) {
    const valid = (input.from === 'claimed' && (input.to === 'started' || input.to === 'uncertain')) || (input.from === 'started' && (input.to === 'completed' || input.to === 'uncertain')) || (input.from === 'uncertain' && (input.to === 'completed' || input.to === 'reviewed'));
    if (!valid) throw new Error('Invalid occurrence transition');
    const result = this.db.prepare('UPDATE schedule_occurrences SET status=? WHERE schedule_id=? AND due_at=? AND status=?').run(input.to, input.scheduleId, input.dueAt, input.from);
    if (!result.changes) throw new ScheduleConflict('Occurrence changed or was not found');
  }
}
