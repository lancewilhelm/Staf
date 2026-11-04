import {createHmac} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {ActionJournal, type StartPermit, type ActionRecord} from '../action-journal.js';
import {z} from 'zod';
import {jsonValue, type CapturedCapabilityContext, type Json} from './contract.js';

const reason = z.enum(['completed', 'error', 'syntax', 'denied', 'expired', 'stopped', 'interrupted', 'limit', 'blocked', 'uncertain', 'worker-failed']);
export type EndReason = z.infer<typeof reason>;
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('execution'), id: z.string(), providerCallId: z.string(), source: z.string(), botId: z.string(), sessionId: z.string()}),
  z.strictObject({kind: z.literal('child'), executionId: z.string(), childId: z.string(), operationId: z.string(), name: z.string(), effect: z.enum(['read', 'change']), resource: jsonValue}),
  z.strictObject({kind: z.literal('output'), executionId: z.string(), value: jsonValue, final: z.boolean()}),
  z.strictObject({kind: z.literal('end'), executionId: z.string(), reason}),
  z.strictObject({kind: z.literal('fence'), reason}),
  z.strictObject({kind: z.literal('decision'), childId: z.string(), answer: z.enum(['approve', 'deny', 'expired', 'cancelled'])}),
]);
export type CodeEvent = z.infer<typeof eventSchema>;
/** Uses the instance's existing event and action tables; no feature migration slot. */
export class CodeModeStore {
  readonly journal: ActionJournal;
  private closed = false;
  private owned = false;
  constructor(private readonly db: DatabaseSync, readonly context: CapturedCapabilityContext, private readonly authority: () => void) {
    this.journal = new ActionJournal(db);
    this.assertLive();
    if (this.events().some(event => event.kind === 'execution')) throw Error('Code work already owned; programs are never replayed');
  }
  claimOwner(): void {if (this.owned) throw Error('Code work already owned'); this.owned = true;}
  events(): CodeEvent[] {
    return this.db.prepare("SELECT detail FROM command_runtime_events WHERE command_id=? AND name='code_mode_record' ORDER BY seq").all(this.context.commandId)
      .map(row => eventSchema.parse(JSON.parse(z.string().parse(row.detail))));
  }
  record(event: CodeEvent): void {
    if (this.closed) throw Error('Code store closed');
    this.db.prepare("INSERT INTO command_runtime_events(command_id,type,name,success,detail) VALUES (?,'tool_result','code_mode_record',1,?)").run(this.context.commandId, JSON.stringify(eventSchema.parse(event)));
  }
  fingerprint(value: Json): string {
    const key = this.db.prepare("SELECT value FROM instance_secrets WHERE name='command-fingerprint'").get()?.value;
    if (!(key instanceof Uint8Array)) throw Error('Missing instance identity key');
    return createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  }
  assertLive(): void {
    if (this.closed) throw Error('Code store closed');
    this.context.signal.throwIfAborted();
    this.authority();
    if (this.events().some(event => event.kind === 'fence')) throw Error('Code work fenced');
    const children = this.events().filter(event => event.kind === 'child' && event.effect === 'change');
    if (children.some(event => event.kind === 'child' && this.journal.get(event.childId)?.state === 'uncertain')) throw Error('A changing outcome requires reconciliation');
  }
  assertRunOpen(executionId: string): void {
    this.assertLive();
    if (this.events().some(event => event.kind === 'end' && event.executionId === executionId)) throw Error('Code execution closed');
  }
  /** No hook or await occurs between this check, the permit claim and dispatch. */
  start(executionId: string, permit: StartPermit, expected: {id: string; fingerprint: string; work: {kind: 'command'; id: string}}, livePolicy: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertRunOpen(executionId); livePolicy();
      this.journal.startInInstanceTransaction(permit, this.db, expected);
      this.db.exec('COMMIT'); this.journal.finalizeInstanceStart(permit);
    } catch (error) {this.db.exec('ROLLBACK'); throw error;}
  }
  fence(end: EndReason): void {
    if (!this.closed && !this.events().some(event => event.kind === 'fence')) this.record({kind: 'fence', reason: end});
  }
  finishChild(id: string, state: 'succeeded' | 'failed' | 'uncertain', safeResult: string): ActionRecord | null {
    if (this.closed) return null;
    const record = this.journal.get(id);
    if (record?.state === 'started') return this.journal.finish(id, state, safeResult);
    if (record?.state === 'uncertain' && state !== 'uncertain') {
      // A late observed result amends the same action; it never reopens work.
      this.db.prepare("UPDATE action_journal SET state=?,result=? WHERE id=? AND command_id=? AND state='uncertain'").run(state, safeResult, id, this.context.commandId);
      return this.journal.get(id);
    }
    return record;
  }
  inspect(): {context: Omit<CapturedCapabilityContext, 'signal'>; events: CodeEvent[]; actions: ActionRecord[]} {
    const {botId, sessionId, commandId} = this.context;
    const events = this.events();
    return {context: {botId, sessionId, commandId}, events, actions: events.flatMap(event => {
      if (event.kind !== 'child') return [];
      const action = this.journal.get(event.childId); return action ? [action] : [];
    })};
  }
  close(): void {this.closed = true;}
}

export function readCodeModeHistory(db: DatabaseSync, commandId: string) {
  const events = db.prepare("SELECT detail FROM command_runtime_events WHERE command_id=? AND name='code_mode_record' ORDER BY seq").all(commandId)
    .map(row => eventSchema.parse(JSON.parse(z.string().parse(row.detail))));
  const journal = new ActionJournal(db);
  const state = db.prepare('SELECT state FROM commands WHERE id=?').get(commandId)?.state;
  return {events, actions: events.flatMap(event => {
    if (event.kind !== 'child') return [];
    const action = journal.get(event.childId); return action ? [action] : [];
  }), interrupted: state === 'interrupted' && events.some(event => event.kind === 'execution' && !events.some(end => end.kind === 'end' && end.executionId === event.id))};
}
