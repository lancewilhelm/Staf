import type { DatabaseSync } from 'node:sqlite';

// Install in the caller's versioned migration. Inputs must already be redacted;
// fingerprints must be keyed over the original command by the trusted caller.
export const collaborationSchema = `
CREATE TABLE collaboration_assignments (
 id TEXT PRIMARY KEY, command_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 parent_attempt_id TEXT NOT NULL REFERENCES task_attempts(id), helper_attempt_id TEXT NOT NULL UNIQUE REFERENCES task_attempts(id),
 requester_bot_id TEXT NOT NULL REFERENCES bots(id), helper_bot_id TEXT NOT NULL REFERENCES bots(id),
 objective TEXT NOT NULL, context TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','completed','failed','cancelled')),
 CHECK(requester_bot_id <> helper_bot_id), CHECK(parent_attempt_id <> helper_attempt_id)
);
CREATE TABLE collaboration_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, command_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 assignment_id TEXT NOT NULL REFERENCES collaboration_assignments(id), kind TEXT NOT NULL CHECK(kind IN ('request','question','answer','result','failure')),
 from_bot_id TEXT NOT NULL REFERENCES bots(id), to_bot_id TEXT NOT NULL REFERENCES bots(id),
 in_reply_to TEXT REFERENCES collaboration_messages(id), body TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0 CHECK(late IN (0,1))
);
CREATE UNIQUE INDEX collaboration_answer_once ON collaboration_messages(in_reply_to) WHERE kind='answer';
CREATE UNIQUE INDEX collaboration_request_once ON collaboration_messages(assignment_id) WHERE kind='request';
CREATE UNIQUE INDEX collaboration_outcome_once ON collaboration_messages(assignment_id) WHERE kind IN ('result','failure');
CREATE INDEX collaboration_message_order ON collaboration_messages(assignment_id,seq);
`;

type Scope = { assignmentId: string; botId: string };
type Assignment = { id: string; commandId: string; fingerprint: string; parentAttemptId: string; helperAttemptId: string; requesterBotId: string; helperBotId: string; objective: string; context: string };
type Message = Scope & { id: string; commandId: string; fingerprint: string; kind: 'request' | 'question' | 'answer' | 'result' | 'failure'; toBotId: string; body: string; inReplyTo?: string; late?: boolean };
export class CollaborationError extends Error {}
function bounded(value: string, label: string, max = 256) {
 if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > max) throw new CollaborationError(`Invalid ${label}`);
}
export class CollaborationStore {
 constructor(private readonly db: DatabaseSync) {}
 private atomic<T>(fn: () => T): T {
  this.db.exec('SAVEPOINT collaboration_operation');
  try { const result = fn(); this.db.exec('RELEASE collaboration_operation'); return result; }
  catch (error) { this.db.exec('ROLLBACK TO collaboration_operation'); this.db.exec('RELEASE collaboration_operation'); throw error; }
 }
 private scoped(scope: Scope) {
  const row = this.db.prepare('SELECT * FROM collaboration_assignments WHERE id=? AND (requester_bot_id=? OR helper_bot_id=?)').get(scope.assignmentId,scope.botId,scope.botId);
  if (!row) throw new CollaborationError('Assignment not found');
  return row;
 }
 private attemptsActive(assignment: Record<string, unknown>) {
  return !!this.db.prepare(`SELECT 1 FROM task_attempts p JOIN task_attempts h ON h.id=? AND h.bot_id=?
   WHERE p.id=? AND p.bot_id=? AND p.state IN ('queued','running') AND h.state IN ('queued','running')`).get(
    String(assignment.helper_attempt_id),String(assignment.helper_bot_id),String(assignment.parent_attempt_id),String(assignment.requester_bot_id));
 }
 create(input: Assignment) {
  for (const [name,value] of Object.entries(input)) bounded(value,name,name === 'objective' || name === 'context' ? 16384 : 256);
  if (input.requesterBotId === input.helperBotId || input.parentAttemptId === input.helperAttemptId) throw new CollaborationError('Self assignment is not allowed');
  return this.atomic(() => {
   if (this.db.prepare('SELECT 1 FROM collaboration_messages WHERE command_id=?').get(input.commandId)) throw new CollaborationError('Command ID conflict');
   const existing=this.db.prepare('SELECT * FROM collaboration_assignments WHERE command_id=? OR id=?').get(input.commandId,input.id);
   if (existing) {
    if (existing.id !== input.id || existing.command_id !== input.commandId || existing.fingerprint !== input.fingerprint || existing.parent_attempt_id !== input.parentAttemptId || existing.helper_attempt_id !== input.helperAttemptId || existing.requester_bot_id !== input.requesterBotId || existing.helper_bot_id !== input.helperBotId || existing.objective !== input.objective || existing.context !== input.context) throw new CollaborationError('Assignment command conflict');
    return existing;
   }
   const parent=this.db.prepare('SELECT bot_id,state FROM task_attempts WHERE id=?').get(input.parentAttemptId);
   const helper=this.db.prepare('SELECT bot_id,state FROM task_attempts WHERE id=?').get(input.helperAttemptId);
   if (!parent || parent.bot_id !== input.requesterBotId || !['queued','running'].includes(String(parent.state))) throw new CollaborationError('Invalid parent attempt');
   if (!helper || helper.bot_id !== input.helperBotId || !['queued','running'].includes(String(helper.state))) throw new CollaborationError('Invalid helper attempt');
   if (this.db.prepare('SELECT 1 FROM collaboration_assignments WHERE helper_attempt_id=? OR helper_attempt_id=? OR parent_attempt_id=?').get(input.parentAttemptId,input.helperAttemptId,input.helperAttemptId)) throw new CollaborationError('Nested or reused helper attempt');
   if (Number(this.db.prepare('SELECT count(*) AS n FROM collaboration_assignments WHERE parent_attempt_id=?').get(input.parentAttemptId)?.n) >= 32) throw new CollaborationError('Assignment limit reached');
   this.db.prepare("INSERT INTO collaboration_assignments VALUES(?,?,?,?,?,?,?,?,?,'active')").run(input.id,input.commandId,input.fingerprint,input.parentAttemptId,input.helperAttemptId,input.requesterBotId,input.helperBotId,input.objective,input.context);
   return this.scoped({assignmentId:input.id,botId:input.requesterBotId});
  });
 }
 append(input: Message) {
  for (const [name,value] of Object.entries({assignmentId:input.assignmentId,botId:input.botId,id:input.id,commandId:input.commandId,fingerprint:input.fingerprint,toBotId:input.toBotId,body:input.body})) bounded(value,name,name === 'body' ? 16384 : 256);
  if (input.inReplyTo !== undefined) bounded(input.inReplyTo,'reply ID');
  if (!['request','question','answer','result','failure'].includes(input.kind) || (input.late !== undefined && typeof input.late !== 'boolean')) throw new CollaborationError('Invalid message');
  return this.atomic(() => {
   const assignment=this.scoped(input);
   if (input.toBotId === input.botId || ![assignment.requester_bot_id,assignment.helper_bot_id].includes(input.toBotId)) throw new CollaborationError('Invalid recipient');
   if (this.db.prepare('SELECT 1 FROM collaboration_assignments WHERE command_id=?').get(input.commandId)) throw new CollaborationError('Command ID conflict');
   const old=this.db.prepare('SELECT * FROM collaboration_messages WHERE command_id=? OR id=?').get(input.commandId,input.id);
   if (old) {
    if (old.id !== input.id || old.command_id !== input.commandId || old.fingerprint !== input.fingerprint || old.assignment_id !== input.assignmentId || old.kind !== input.kind || old.from_bot_id !== input.botId || old.to_bot_id !== input.toBotId || old.body !== input.body || old.in_reply_to !== (input.inReplyTo ?? null) || old.late !== Number(input.late ?? false)) throw new CollaborationError('Message command conflict');
    return old;
   }
   const active=assignment.state === 'active' && this.attemptsActive(assignment);
   if (!active && !input.late) throw new CollaborationError('Assignment or attempt is terminal');
   if (input.late && (active || !['result','failure'].includes(input.kind) || input.botId !== assignment.helper_bot_id)) throw new CollaborationError('Invalid late output');
   if ((input.kind === 'request' && input.botId !== assignment.requester_bot_id) || (['result','failure'].includes(input.kind) && input.botId !== assignment.helper_bot_id)) throw new CollaborationError('Invalid sender');
   const request=this.db.prepare("SELECT id FROM collaboration_messages WHERE assignment_id=? AND kind='request'").get(input.assignmentId);
   if (input.kind === 'request' && (request || input.inReplyTo)) throw new CollaborationError('Invalid request');
   if (input.kind !== 'request' && !request) throw new CollaborationError('Request required');
   if (['result','failure'].includes(input.kind) && (input.inReplyTo !== request?.id || this.db.prepare("SELECT 1 FROM collaboration_messages WHERE assignment_id=? AND kind IN ('result','failure')").get(input.assignmentId))) throw new CollaborationError('Invalid or duplicate outcome');
   if (input.kind === 'answer' && !input.inReplyTo) throw new CollaborationError('Answer requires a question');
   if (input.inReplyTo) {
    const reply=this.db.prepare('SELECT * FROM collaboration_messages WHERE id=? AND assignment_id=?').get(input.inReplyTo,input.assignmentId);
    if (!reply || reply.from_bot_id !== input.toBotId || reply.to_bot_id !== input.botId || (input.kind === 'answer' && reply.kind !== 'question')) throw new CollaborationError('Invalid reply');
    if (input.kind === 'answer' && this.db.prepare("SELECT 1 FROM collaboration_messages WHERE kind='answer' AND in_reply_to=?").get(input.inReplyTo)) throw new CollaborationError('Question already answered');
   }
   if (Number(this.db.prepare('SELECT count(*) AS n FROM collaboration_messages WHERE assignment_id=?').get(input.assignmentId)?.n) >= 1000) throw new CollaborationError('Message limit reached');
   this.db.prepare('INSERT INTO collaboration_messages(id,command_id,fingerprint,assignment_id,kind,from_bot_id,to_bot_id,in_reply_to,body,late) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.id,input.commandId,input.fingerprint,input.assignmentId,input.kind,input.botId,input.toBotId,input.inReplyTo ?? null,input.body,Number(input.late ?? false));
   return this.db.prepare('SELECT * FROM collaboration_messages WHERE id=?').get(input.id);
  });
 }
 inspect(scope: Scope) {
  return this.atomic(() => ({assignment:this.scoped(scope), messages:this.db.prepare('SELECT seq,id,command_id,assignment_id,kind,from_bot_id,to_bot_id,in_reply_to,body,late FROM collaboration_messages WHERE assignment_id=? ORDER BY seq').all(scope.assignmentId)}));
 }
 finish(scope: Scope & { state: 'completed' | 'failed' | 'cancelled' }) {
  if (!['completed','failed','cancelled'].includes(scope.state)) throw new CollaborationError('Invalid terminal state');
  return this.atomic(() => {
   const assignment=this.scoped(scope);
   if (assignment.requester_bot_id !== scope.botId) throw new CollaborationError('Only requester can finish assignment');
   if (assignment.state === scope.state) return assignment;
   if (assignment.state !== 'active') throw new CollaborationError('Assignment is terminal');
   if (scope.state !== 'cancelled' && !this.attemptsActive(assignment)) throw new CollaborationError('Assignment attempt is terminal');
   if (scope.state !== 'cancelled' && !this.db.prepare("SELECT 1 FROM collaboration_messages WHERE assignment_id=? AND kind=? AND late=0").get(scope.assignmentId,scope.state === 'completed' ? 'result' : 'failure')) throw new CollaborationError('Matching outcome required');
   this.db.prepare('UPDATE collaboration_assignments SET state=? WHERE id=?').run(scope.state,scope.assignmentId);
   return this.scoped(scope);
  });
 }
}
