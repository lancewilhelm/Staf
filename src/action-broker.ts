import { evaluateApproval } from './approval-policy.js';
import type { Action, ApprovalGrant, PolicyDecision, PolicyInput } from './approval-policy.js';
import { ActionJournal } from './action-journal.js';
import type { ActionRecord, WorkRef, StartPermit } from './action-journal.js';

// The trusted adapter must bind the complete effect payload in the keyed fingerprint
// and permitted boundary, and execute only the bound snapshot. It owns redaction.
// Integration requires Node >=22.16.0 for DatabaseSync.isTransaction.
export interface CanonicalAction {
  id: string;
  fingerprint: string;
  work: WorkRef;
  summary: string;
  action: Action;
}
export type BrokerPolicy = Omit<PolicyInput, 'action' | 'grants'> & {
  grants: readonly { grant: ApprovalGrant; cumulative: boolean }[];
};
export type BrokerResult =
  | { kind: 'status'; action: ActionRecord }
  | { kind: 'blocked'; reason: string; action: ActionRecord }
  | { kind: 'cancelled'; action: ActionRecord }
  | { kind: 'denied'; action: ActionRecord }
  | { kind: 'completed'; action: ActionRecord };
export type EffectResult = { state: 'succeeded' | 'failed' | 'uncertain'; safeResult: string };
export interface BrokerHooks<Request> {
  canonicalize(request: Request): CanonicalAction;
  policy(action: CanonicalAction): BrokerPolicy;
  approve(action: CanonicalAction, decision: PolicyDecision, signal?: AbortSignal): Promise<unknown>;
  // This must durably record the exact fingerprint, work and boundary before resolving.
  recordDecision(action: CanonicalAction, decision: 'approve' | 'deny'): Promise<void>;
  effect(action: CanonicalAction, signal?: AbortSignal): Promise<EffectResult>;
  // Optional closed instance-owned transaction. No hook is run inside that transaction.
  claimGrant?(permit: StartPermit): void;
}

function decide(action: CanonicalAction, policy: BrokerPolicy): PolicyDecision | { outcome: 'block'; reason: 'unsupported-cumulative-grant' } {
  const supported = policy.grants.filter(g => !g.cumulative).map(g => g.grant);
  const decision = evaluateApproval({ ...policy, action: action.action, grants: supported });
  if (decision.outcome !== 'prompt') return decision;
  const all = evaluateApproval({ ...policy, action: action.action, grants: policy.grants.map(g => g.grant) });
  if (all.outcome === 'allow' && all.reason === 'grant') return { outcome: 'block', reason: 'unsupported-cumulative-grant' };
  return decision;
}

function snapshot(input: CanonicalAction): CanonicalAction {
  const copy = structuredClone(input);
  const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const exactKeys = (value: object, keys: string[]) =>
    Object.keys(value).sort().join(',') === keys.sort().join(',');
  if (!copy || !exactKeys(copy, ['id', 'fingerprint', 'work', 'summary', 'action']) || !nonempty(copy.id) || !nonempty(copy.fingerprint) || !nonempty(copy.summary) ||
      !copy.work || !exactKeys(copy.work, ['kind', 'id']) || (copy.work.kind !== 'task' && copy.work.kind !== 'command') || !nonempty(copy.work.id) ||
      !copy.action || !exactKeys(copy.action, ['capability', 'operation', 'resource', 'effect', 'limits', 'risk']) || !nonempty(copy.action.capability) || !nonempty(copy.action.operation) ||
      !nonempty(copy.action.resource) || !nonempty(copy.action.effect) ||
      !['safe', 'risky', 'unknown'].includes(copy.action.risk) || !copy.action.limits ||
      typeof copy.action.limits !== 'object' || Array.isArray(copy.action.limits) ||
      Object.getPrototypeOf(copy.action.limits) !== Object.prototype ||
      Object.entries(copy.action.limits).some(([key, value]) => !nonempty(key) ||
        !(typeof value === 'string' || typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))))) throw new Error('Invalid canonical action');
  Object.freeze(copy.action.limits);
  Object.freeze(copy.action);
  Object.freeze(copy.work);
  return Object.freeze(copy);
}

export class ActionBroker<Request> {
  constructor(private readonly journal: ActionJournal, private readonly hooks: BrokerHooks<Request>) {}

  status(id: string): ActionRecord | null { return this.journal.get(id); }

  async execute(request: Request, signal?: AbortSignal): Promise<BrokerResult> {
    const action = snapshot(this.hooks.canonicalize(request));
    const identity = JSON.stringify(action);
    const prepared = this.journal.prepare(action);
    if (prepared.kind === 'existing') return { kind: 'status', action: prepared.action };
    const cancel = () => this.journal.cancel(action.id);
    if (signal?.aborted) return { kind: 'cancelled', action: cancel() };
    let initial: ReturnType<typeof decide>;
    try { initial = decide(action, this.hooks.policy(action)); }
    catch { return { kind: 'blocked', reason: 'policy-error', action: cancel() }; }
    if (initial.outcome === 'block') return { kind: 'blocked', reason: initial.reason, action: cancel() };
    let approvedReason: string | null = null;
    if (initial.outcome === 'prompt') {
      let answer: unknown;
      try { answer = await this.hooks.approve(action, initial, signal); }
      catch { return { kind: 'blocked', reason: 'approval-error', action: cancel() }; }
      if (answer !== 'approve' && answer !== 'deny') return { kind: 'blocked', reason: 'invalid-approval-response', action: cancel() };
      try { await this.hooks.recordDecision(action, answer); }
      catch { return { kind: 'blocked', reason: 'decision-record-error', action: cancel() }; }
      if (answer === 'deny') return { kind: 'denied', action: cancel() };
      approvedReason = initial.reason;
    }
    if (signal?.aborted) return { kind: 'cancelled', action: cancel() };
    let current: ReturnType<typeof decide>;
    try { current = decide(action, this.hooks.policy(action)); }
    catch { return { kind: 'blocked', reason: 'policy-error', action: cancel() }; }
    if (current.outcome === 'block') return { kind: 'blocked', reason: current.reason, action: cancel() };
    if (current.outcome === 'prompt' && current.reason !== approvedReason) {
      return { kind: 'blocked', reason: 'approval-changed', action: cancel() };
    }
    if (JSON.stringify(action) !== identity) return { kind: 'blocked', reason: 'action-changed', action: cancel() };
    if (current.outcome === 'allow' && current.reason === 'grant' && approvedReason === null) {
      if (!this.hooks.claimGrant) return { kind:'blocked',reason:'grant-claim-unavailable',action:cancel() };
      try { this.hooks.claimGrant(prepared.permit); }
      catch { return { kind:'blocked',reason:'grant-claim-failed',action:cancel() }; }
    } else this.journal.start(prepared.permit);
    let result: EffectResult;
    try { result = await this.hooks.effect(action, signal); }
    catch { result = { state: 'uncertain', safeResult: 'Outcome unknown' }; }
    return { kind: 'completed', action: this.journal.finish(action.id, result.state, result.safeResult) };
  }
}
