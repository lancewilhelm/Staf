import type { DatabaseSync } from 'node:sqlite';
import type { Message } from './types.js';

export function appendTaskInputs(messages:Message[],inputs:string[]):Message[] {
  if(!inputs.length) return messages;
  const result=structuredClone(messages), last=result.at(-1), content=inputs.join('\n');
  if(last?.role === 'user') last.content += `\n\n${content}`;
  else result.push({role:'user',content});
  return result;
}

// Install through the caller's versioned migration, in the same transaction as its version update.
export const taskInboxSchema = `
CREATE TABLE task_questions (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES task_attempts(id),
  text TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','answered','cancelled'))
);
CREATE UNIQUE INDEX task_one_open_question ON task_questions(attempt_id) WHERE state='open';
CREATE TABLE task_inbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, command_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL REFERENCES task_attempts(id),
  kind TEXT NOT NULL CHECK(kind IN ('direction','answer')),
  question_id TEXT REFERENCES task_questions(id), text TEXT NOT NULL, digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','claimed','applied','rejected','cancelled')),
  CHECK ((kind='direction' AND question_id IS NULL) OR (kind='answer' AND question_id IS NOT NULL))
);
CREATE UNIQUE INDEX task_one_answer ON task_inbox(question_id) WHERE kind='answer';
CREATE INDEX task_inbox_order ON task_inbox(attempt_id,seq);
`;

type Scope = { botId: string; attemptId: string };
type Input = Scope & { commandId: string; text: string; digest: string } &
  ({ kind: 'direction' } | { kind: 'answer'; questionId: string });
export class TaskInboxError extends Error {}

// Text must already be redacted and digest must be keyed over the original request by the caller.
function bounded(value: string, name: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) throw new TaskInboxError(`Invalid ${name}`);
}
export class TaskInbox {
  constructor(private readonly db: DatabaseSync) {}
  private atomic<T>(operation: () => T): T {
    this.db.exec('SAVEPOINT task_inbox_operation');
    try { const result = operation(); this.db.exec('RELEASE task_inbox_operation'); return result; }
    catch (error) { this.db.exec('ROLLBACK TO task_inbox_operation'); this.db.exec('RELEASE task_inbox_operation'); throw error; }
  }
  private active(scope: Scope) {
    const row = this.db.prepare('SELECT state FROM task_attempts WHERE id=? AND bot_id=?').get(scope.attemptId, scope.botId);
    if (!row) throw new TaskInboxError('Task attempt not found');
    if (row.state !== 'queued' && row.state !== 'running') throw new TaskInboxError('Task attempt is not active');
  }
  private scoped(scope: Scope) {
    if (!this.db.prepare('SELECT 1 FROM task_attempts WHERE id=? AND bot_id=?').get(scope.attemptId, scope.botId)) throw new TaskInboxError('Task attempt not found');
  }
  enqueue(input: Input) {
    bounded(input.commandId, 'command ID', 256); bounded(input.attemptId, 'attempt ID', 256); bounded(input.botId, 'bot ID', 256);
    bounded(input.text, 'redacted text', 16384); bounded(input.digest, 'keyed digest', 256);
    if (input.kind !== 'direction' && input.kind !== 'answer') throw new TaskInboxError('Invalid input kind');
    if (input.kind === 'answer') bounded(input.questionId, 'question ID', 256);
    return this.atomic(() => {
      this.scoped(input);
      const existing = this.db.prepare('SELECT * FROM task_inbox WHERE command_id=?').get(input.commandId);
      if (existing) {
        if (existing.attempt_id !== input.attemptId || existing.digest !== input.digest || existing.kind !== input.kind || existing.question_id !== (input.kind === 'answer' ? input.questionId : null)) throw new TaskInboxError('Command ID conflict');
        return { kind: 'existing' as const, input: this.db.prepare('SELECT seq,command_id,attempt_id,kind,question_id,text,status FROM task_inbox WHERE command_id=?').get(input.commandId) };
      }
      this.active(input);
      if (input.kind === 'answer') {
        const result = this.db.prepare("UPDATE task_questions SET state='answered' WHERE id=? AND attempt_id=? AND state='open'").run(input.questionId, input.attemptId);
        if (!result.changes) throw new TaskInboxError('Question is not open');
      }
      this.db.prepare("INSERT INTO task_inbox(command_id,attempt_id,kind,question_id,text,digest,status) VALUES(?,?,?,?,?,?,'accepted')").run(input.commandId,input.attemptId,input.kind,input.kind === 'answer' ? input.questionId : null,input.text,input.digest);
      return { kind: 'accepted' as const, input: this.db.prepare('SELECT seq,command_id,attempt_id,kind,question_id,text,status FROM task_inbox WHERE command_id=?').get(input.commandId) };
    });
  }
  createQuestion(scope: Scope & { questionId: string; text: string }) {
    bounded(scope.questionId, 'question ID', 256); bounded(scope.text, 'redacted question', 16384);
    return this.atomic(() => { this.active(scope); this.db.prepare("INSERT INTO task_questions(id,attempt_id,text,state) VALUES(?,?,?,'open')").run(scope.questionId,scope.attemptId,scope.text); });
  }
  inspect(scope: Scope) {
    this.scoped(scope);
    return { inputs: this.db.prepare('SELECT seq,command_id,attempt_id,kind,question_id,text,status FROM task_inbox WHERE attempt_id=? ORDER BY seq').all(scope.attemptId), questions: this.db.prepare('SELECT * FROM task_questions WHERE attempt_id=? ORDER BY rowid').all(scope.attemptId) };
  }
  // A single attempt executor may claim at a safe boundary. A prior claim is returned
  // again after interruption; the caller must establish safe continuation before use.
  claimNext(scope: Scope) {
    return this.atomic(() => {
      this.active(scope);
      const row = this.db.prepare("SELECT * FROM task_inbox WHERE attempt_id=? AND status IN ('accepted','claimed') ORDER BY seq LIMIT 1").get(scope.attemptId);
      if (!row) return undefined;
      if (typeof row.seq !== 'number' && typeof row.seq !== 'bigint') throw new TaskInboxError('Invalid inbox sequence');
      if (row.status === 'accepted') this.db.prepare("UPDATE task_inbox SET status='claimed' WHERE seq=? AND status='accepted'").run(row.seq);
      return this.db.prepare('SELECT * FROM task_inbox WHERE seq=?').get(row.seq);
    });
  }
  mark(scope: Scope & { commandId: string; status: 'applied' | 'rejected' | 'cancelled' }) {
    return this.atomic(() => {
      this.scoped(scope);
      if (scope.status === 'applied') this.active(scope);
      const first = this.db.prepare("SELECT command_id,status FROM task_inbox WHERE attempt_id=? AND status IN ('accepted','claimed') ORDER BY seq LIMIT 1").get(scope.attemptId);
      if (!first || first.command_id !== scope.commandId || (scope.status === 'applied' && first.status !== 'claimed')) throw new TaskInboxError('Invalid inbox transition');
      this.db.prepare('UPDATE task_inbox SET status=? WHERE command_id=?').run(scope.status,scope.commandId);
    });
  }
  hasPending(scope: Scope) {
    this.scoped(scope);
    return !!this.db.prepare("SELECT 1 FROM task_inbox WHERE attempt_id=? AND status IN ('accepted','claimed') LIMIT 1").get(scope.attemptId);
  }
  cancelQuestion(scope: Scope & { questionId: string }) {
    return this.atomic(() => { this.scoped(scope); const r = this.db.prepare("UPDATE task_questions SET state='cancelled' WHERE id=? AND attempt_id=? AND state='open'").run(scope.questionId,scope.attemptId); if (!r.changes) throw new TaskInboxError('Question is not open'); });
  }
}
