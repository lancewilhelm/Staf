import { createHmac } from 'node:crypto';
import { ActionBroker } from './action-broker.js';
import type { BrokerPolicy, CanonicalAction } from './action-broker.js';
import { ActionJournal } from './action-journal.js';
import type { ActionRecord, WorkRef } from './action-journal.js';
import { checkedUrl, readWebSource } from './web-reader.js';
import type { Dependencies, WebSource } from './web-reader.js';

export interface WebActionOptions {
  journal: ActionJournal;
  key: Uint8Array;
  work: WorkRef;
  callId: string;
  signal: AbortSignal;
  // The host must abort this signal when any applicable permission is revoked.
  permissionSignal: AbortSignal;
  policy: (action: CanonicalAction) => BrokerPolicy;
  approve: (action: CanonicalAction, signal: AbortSignal) => Promise<'approve' | 'deny'>;
  // Persist only this keyed identity; the approval UI may display the exact URL temporarily.
  recordDecision: (identity: { id: string; fingerprint: string; work: WorkRef }, decision: 'approve' | 'deny') => Promise<void>;
  dependencies?: Dependencies;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}
export type WebActionResult = { kind: 'source'; source: WebSource } | { kind: 'stopped'; action: ActionRecord; reason: string };
class Stopped extends Error {
  constructor(readonly action: ActionRecord, readonly reason: string) { super('Web action stopped'); }
}

/** One owner-authorized, journaled GET per hop. No query-bearing URLs are accepted. */
export async function readWebAction(input: string, options: WebActionOptions): Promise<WebActionResult> {
  if (options.key.byteLength < 32 || !options.work.id || !options.callId) throw Error('Invalid web action identity');
  const signal = AbortSignal.any([options.signal, options.permissionSignal]);
  const work: WorkRef = { kind: options.work.kind, id: options.work.id };
  const callId = options.callId, key = Buffer.from(options.key);
  const timeoutMs = options.timeoutMs ?? 10000, maxBytes = options.maxBytes ?? 1024 * 1024, maxRedirects = options.maxRedirects ?? 3;
  const digest = (value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  try {
    const source = await readWebSource(input, { signal, timeoutMs, maxBytes, maxRedirects, dependencies: options.dependencies,
      runHop: async <T>(target: string, hop: number, read: () => Promise<T>): Promise<T> => {
        signal.throwIfAborted();
        const url = checkedUrl(target);
        if (url.href.includes('?')) throw Error('Query-bearing URLs are not supported');
        const action: CanonicalAction = {
          id: digest(['web-hop', work.kind, work.id, callId, hop]),
          fingerprint: digest(['web-read', work.kind, work.id, callId, hop, url.href, timeoutMs, maxBytes, maxRedirects]),
          work, summary: 'Read web source',
          action: { capability: 'web.read', operation: 'GET', resource: url.href, effect: 'read', limits: { timeoutMs, maxBytes, maxRedirects }, risk: 'unknown' },
        };
        let value: T | undefined;
        let received = false;
        const broker = new ActionBroker(options.journal, {
          canonicalize: () => action,
          policy: a => ({ ...options.policy(a), modes: ['ask-every-time'], grants: [], ownerRequest: null }),
          approve: (a, _decision, approvalSignal) => new Promise(resolve => {
            const active = approvalSignal ?? signal;
            if (active.aborted) { resolve('interrupted'); return; }
            const abort = () => resolve('interrupted');
            active.addEventListener('abort', abort, { once: true });
            options.approve(a, active).then(value => { active.removeEventListener('abort', abort); resolve(value); }, () => { active.removeEventListener('abort', abort); resolve('interrupted'); });
            if (active.aborted) abort();
          }),
          recordDecision: (a, decision) => options.recordDecision({id:a.id,fingerprint:a.fingerprint,work:a.work},decision),
          effect: async () => { value = await read(); received = true; return { state: 'succeeded', safeResult: 'Web hop completed' }; },
        });
        const result = await broker.execute(null, signal);
        if (result.kind !== 'completed' || result.action.state !== 'succeeded' || !received) throw new Stopped(result.action, result.kind);
        return value as T;
      },
    });
    return { kind: 'source', source };
  } catch (error) {
    if (error instanceof Stopped) return { kind: 'stopped', action: error.action, reason: error.reason };
    throw error;
  }
}
