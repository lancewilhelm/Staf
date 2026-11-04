import {containsUnsafeWebUrl} from '../web-reader.js';
import {randomUUID} from 'node:crypto';
import {CodeApprovals} from './approvals.js';
import {CapabilityRegistry, ids, json, type CapabilityCall, type Json} from './contract.js';
import {startNativeLabGuest, type GuestRequest, type GuestRun} from './executor.js';
import {limits, type HostMessage} from './protocol.js';
import {CodeModeStore, CompletedChange, type EndReason} from './store.js';

export type ExperimentLimits = {-readonly [Key in keyof typeof limits]: number};
export interface CapabilityRequest {
  readonly name: string;
  readonly input: Json;
  readonly effect: 'read' | 'change';
  readonly resource: Json;
}
export interface CodeModeOptions {
  readonly registry: CapabilityRegistry;
  readonly store: CodeModeStore;
  readonly approvals: CodeApprovals;
  /** Trusted service policy, re-evaluated after waiting and inside permit claim. */
  readonly policy: (call: CapabilityCall, request: CapabilityRequest) => 'allow' | 'prompt' | 'block';
  readonly redact: (text: string) => string;
  /** Tests may tighten limits, never loosen the approved starting ceilings. */
  readonly limits?: Partial<ExperimentLimits>;
}
interface Receipt {id: string; name: string; input: Json; value: Json; resource: Json}
export interface RunReport {
  readonly executionId: string;
  readonly reason: EndReason;
  readonly outputs: Json[];
  readonly actions: {id: string; name: string; state: string; result: string | null}[];
  readonly receipts: {id: string; name: string}[];
  readonly priorChanges: {id: string; operationId: string; name: string; state: string; resource: Json}[];
}
class PolicyUnavailable extends Error {}
let residents = 0;
export class CodeModeWork {
  readonly limits: ExperimentLimits;
  private invocations = 0;
  private children = 0;
  private corrections = 0;
  private activeMs = 0;
  private guestMs = 0;
  private outputBytes = 0;
  private cacheBytes = 0;
  private readonly receipts = new Map<string, Receipt>();
  private current: Promise<RunReport> | undefined;
  private disposed = false;
  constructor(private readonly options: CodeModeOptions) {
    options.store.claimOwner();
    this.limits = {...limits};
    for (const [key, value] of Object.entries(options.limits ?? {})) {
      if (key === 'approvalMs') throw Error('Approval lifetime is configured by the service queue');
      if (!(key in limits) || !Number.isSafeInteger(value) || value <= 0) throw Error('Invalid experiment limit');
    }
    for (const key of Object.keys(limits)) {
      // Key narrowed against the canonical limit object, not guest input.
      if (isLimit(key)) {
        const value = options.limits?.[key];
        if (value !== undefined) {if (value > limits[key]) throw Error('Cannot loosen experiment limits'); this.limits[key] = value;}
      }
    }
  }
  catalog(): Json {return this.options.registry.catalog();}
  private safe(value: Json): Json {return json(JSON.parse(this.options.redact(JSON.stringify(value)).replace(/https?:\/\/[^\s<>"']+/gi, value => containsUnsafeWebUrl(value) ? '[redacted URL]' : value)), this.limits.childBytes);}
  private report(id: string, fallback: EndReason): RunReport {
    const inspection = this.options.store.inspect();
    const end = inspection.events.find(event => event.kind === 'end' && event.executionId === id);
    const children = inspection.events.filter(event => event.kind === 'child' && event.executionId === id);
    return {executionId: id, reason: end?.kind === 'end' ? end.reason : fallback,
      outputs: inspection.events.flatMap(event => event.kind === 'output' && event.executionId === id ? [event.value] : []),
      actions: children.flatMap(event => {
        if (event.kind !== 'child') return [];
        const action = inspection.actions.find(action => action.id === event.childId);
        return action ? [{id: action.id, name: event.name, state: action.state, result: action.result}] : [];
      }), receipts: [...this.receipts.values()].map(({id, name}) => ({id, name})),
      priorChanges: inspection.events.flatMap(event => {
        if (event.kind !== 'child' || event.effect !== 'change') return [];
        const action = inspection.actions.find(action => action.id === event.childId);
        return action && ['succeeded', 'uncertain'].includes(action.state) ? [{id: action.id, operationId: event.operationId, name: event.name, state: action.state, resource: event.resource}] : [];
      })};
  }
  execute(input: {providerCallId: string; source: string}): Promise<RunReport> {
    if (this.disposed || this.current) return Promise.reject(Error('Code work unavailable or already running'));
    this.options.store.assertLive();
    if (!input.providerCallId.trim() || Buffer.byteLength(input.providerCallId) > 256) return Promise.reject(Error('Invalid provider call identity'));
    if (Buffer.byteLength(input.source) > this.limits.sourceBytes || this.options.redact(input.source) !== input.source || containsUnsafeWebUrl(input.source)) return Promise.reject(Error('Source cannot be executed and retained faithfully'));
    const previous = this.options.store.events().find(event => event.kind === 'execution' && event.providerCallId === input.providerCallId);
    if (previous?.kind === 'execution') {
      if (previous.source !== input.source) return Promise.reject(Error('Provider call identity conflict'));
      return Promise.resolve(this.report(previous.id, 'interrupted'));
    }
    if (++this.invocations > this.limits.invocations || this.guestMs >= this.limits.guestMs || this.activeMs >= this.limits.activeMs || residents >= this.limits.resident) {
      this.options.store.fence('limit'); return Promise.reject(Error('Code request limit'));
    }
    const executionId = ids.execution.parse(randomUUID());
    this.options.store.record({kind: 'execution', id: executionId, providerCallId: input.providerCallId, source: input.source, botId: this.options.store.context.botId, sessionId: this.options.store.context.sessionId});
    const running = this.run(executionId, input.source);
    this.current = running;
    void running.finally(() => {this.current = undefined;}).catch(() => {});
    return running;
  }
  private async run(executionId: CapabilityCall['executionId'], source: string): Promise<RunReport> {
    const {store, registry, approvals, policy} = this.options;
    const controller = new AbortController();
    const signal = AbortSignal.any([store.context.signal, controller.signal]);
    let open = true, end: EndReason = 'completed', guest: GuestRun | undefined;
    let reads = 0, changing = false, effects = 0, checking = 0, busy = false, lastTick = performance.now(), measuredGuestMs = 0;
    const queue: {kind: 'read' | 'change'; execute(): Promise<void>; cancel(): void}[] = [];
    const pending = new Set<Promise<void>>();
    const started = new Map<string, 'read' | 'change'>();
    const tick = () => {
      const now = performance.now(); if (busy || effects > 0 || checking > 0) this.activeMs += now - lastTick; lastTick = now;
      if (open && this.activeMs >= this.limits.activeMs) terminate('limit', true);
    };
    const terminate = (reason: EndReason, fence: boolean) => {
      if (end === 'completed') end = reason;
      if (fence) store.fence(reason);
      open = false; guest?.stop(); controller.abort();
      for (const item of queue.splice(0)) item.cancel();
    };
    const guard = () => {if (!open || signal.aborted) throw Error('Code execution closed'); store.assertRunOpen(executionId);};
    const abort = () => terminate('stopped', true);
    store.context.signal.addEventListener('abort', abort, {once: true});
    const timer = setInterval(tick, 10);
    const pump = () => {
      if (!open) return;
      while (queue.length && !changing) {
        const item = queue[0]; if (!item) return;
        if (item.kind === 'change' && reads || item.kind === 'read' && reads >= this.limits.reads) return;
        queue.shift();
        if (item.kind === 'change') changing = true; else reads++;
        const running = item.execute().finally(() => {
          if (item.kind === 'change') changing = false; else reads--;
          pending.delete(running); pump();
        });
        pending.add(running);
        if (changing) return;
      }
    };
    const publish = (value: Json, final: boolean) => {
      const safe = this.safe(value), bytes = Buffer.byteLength(JSON.stringify(safe));
      if (this.outputBytes + bytes > this.limits.outputBytes) {terminate('limit', true); throw Error('Published output limit');}
      this.outputBytes += bytes; store.record({kind: 'output', executionId, value: safe, final});
    };
    const request = async (request: GuestRequest): Promise<Extract<HostMessage, {type: 'response'}>['result']> => {
      try {
        guard();
        if (request.type === 'emit') {publish(json(request.value, this.limits.childBytes), false); return {ok: true, value: null};}
        if (++this.children > this.limits.children || pending.size + queue.length >= this.limits.pending) {terminate('limit', true); throw Error('Child call limit');}
        let name: string, input: Json, receipt: Receipt | undefined;
        if (request.type === 'reuse') {
          receipt = this.receipts.get(request.receipt); if (!receipt) throw Error('Read receipt unavailable in this request');
          name = receipt.name; input = receipt.input;
        } else {name = request.name; input = json(request.input, this.limits.childBytes);}
        const definition = registry.get(name);
        const call: CapabilityCall = Object.freeze({context: store.context, signal, executionId, childId: ids.child.parse(randomUUID()), operationId: ids.operation.parse(randomUUID())});
        const bound = definition.bind(call, input);
        if (bound.resource.identity.owner !== call.context.botId) throw Error('Capability resource owner differs from accepted work');
        const detail = Object.freeze({name, input: bound.input, effect: definition.kind, resource: json(bound.resource.identity)} satisfies CapabilityRequest);
        if (receipt && JSON.stringify(receipt.resource) !== JSON.stringify(detail.resource)) throw Error('Read receipt scope changed');
        if (JSON.stringify(this.safe(json(detail))) !== JSON.stringify(detail)) throw Error('Action cannot be retained faithfully');
        const changeKey = definition.kind === 'change' ? store.fingerprint(json({botId: call.context.botId, sessionId: call.context.sessionId, commandId: call.context.commandId, ...detail})) : null;
        const fingerprint = store.fingerprint(json({context: {botId: call.context.botId, sessionId: call.context.sessionId, commandId: call.context.commandId}, executionId, childId: call.childId, operationId: call.operationId, ...detail}));
        const expected = {id: call.childId, fingerprint, work: {kind: 'command', id: store.context.commandId} satisfies {kind: 'command'; id: string}};
        const prepared = store.journal.prepare({...expected, summary: `${name}: ${JSON.stringify(detail.input)}`});
        if (prepared.kind !== 'created') throw Error('Child identity conflict');
        store.record({kind: 'child', executionId, childId: call.childId, operationId: call.operationId, name, effect: definition.kind, resource: detail.resource, changeKey});
        return await new Promise(resolve => {
          const cancel = () => {
            if (store.journal.get(call.childId)?.state === 'prepared') store.journal.cancel(call.childId);
            resolve({ok: false, error: 'Code execution closed'});
          };
          const decide = () => {
            try {
              const value: unknown = policy(call, detail);
              if (value !== 'allow' && value !== 'prompt' && value !== 'block') throw new PolicyUnavailable();
              return value;
            } catch {throw new PolicyUnavailable('Host policy unavailable');}
          };
          const scope = async () => {
            tick(); checking++;
            try {guard(); const claim = await bound.checkScope(); guard(); claim.assertCurrent(); return claim;}
            catch {if (open) terminate('blocked', true); throw Error('Feature scope unavailable');}
            finally {tick(); checking--;}
          };
          queue.push({kind: definition.kind, cancel, execute: async () => {
            try {
              await scope();
              store.assertChangeFresh(changeKey, call.childId);
              let decision = decide(), ownerApproved = false;
              if (decision === 'block') {terminate('blocked', true); throw Error('Capability unavailable');}
              if (decision === 'prompt') {
                const answer = await approvals.request({botId: call.context.botId, sessionId: call.context.sessionId, commandId: call.context.commandId, childId: call.childId, ...detail}, signal);
                store.record({kind: 'decision', childId: call.childId, answer});
                if (answer === 'approve') ownerApproved = true;
                if (answer !== 'approve') {terminate(answer === 'deny' ? 'denied' : answer === 'expired' ? 'expired' : 'stopped', true); throw Error('Approval ended');}
              }
              const currentScope = await scope();
              try {
                store.start(executionId, prepared.permit, expected, () => {
                  guard(); decision = decide();
                  if (decision === 'block' || decision === 'prompt' && !ownerApproved) throw Error('Capability revoked or approval changed');
                  currentScope.assertCurrent();
                }, changeKey);
              } catch (error) {
                // Persist the terminal fence after the failed start transaction rolls back.
                if (!(error instanceof CompletedChange)) terminate('blocked', true);
                throw error;
              }
              started.set(call.childId, definition.kind); tick(); effects++;
              let value: Json;
              try {
                value = receipt ? receipt.value : await bound.invoke();
                value = this.safe(json(value, this.limits.childBytes));
                store.finishChild(call.childId, 'succeeded', receipt ? 'Cached read released' : 'Action completed');
              } catch {
                store.finishChild(call.childId, definition.kind === 'change' ? 'uncertain' : 'failed', definition.kind === 'change' ? 'Outcome unknown; inspect before retrying' : 'Read failed');
                if (definition.kind === 'change') terminate('uncertain', true);
                throw Error('Capability failed');
              } finally {tick(); effects--; started.delete(call.childId);}
              const releaseScope = await scope();
              if (decide() === 'block') {terminate('blocked', true); throw Error('Capability revoked');}
              try {releaseScope.assertCurrent();} catch {terminate('blocked', true); throw Error('Feature scope revoked');}
              if (definition.kind === 'read' && !receipt) {
                const bytes = Buffer.byteLength(JSON.stringify(value));
                if (this.cacheBytes + bytes > this.limits.cacheBytes) {terminate('limit', true); throw Error('Temporary read limit');}
                this.cacheBytes += bytes; const id = randomUUID(); this.receipts.set(id, {id, name, input: bound.input, value, resource: detail.resource});
              }
              resolve({ok: true, value});
            } catch (error) {
              if (error instanceof PolicyUnavailable) terminate('blocked', true);
              if (store.journal.get(call.childId)?.state === 'prepared') store.journal.cancel(call.childId);
              resolve({ok: false, error: error instanceof CompletedChange ? 'Matching change already completed; inspect priorChanges before continuing' : 'Capability not completed; inspect the action history'});
            }
          }});
          pump();
        });
      } catch {return {ok: false, error: 'Invalid or unavailable capability call'};}
    };
    try {
      residents++;
      guest = startNativeLabGuest({source, names: registry.names(), heapBytes: this.limits.heapBytes, stackBytes: this.limits.stackBytes, guestMs: this.limits.guestMs - this.guestMs, request, phase: (running, elapsed) => {
        tick(); busy = running; measuredGuestMs = elapsed;
      }});
      if (signal.aborted) guest.stop();
      const result = await guest.finished;
      tick(); busy = false;
      this.guestMs += Math.max(measuredGuestMs, result.guestMs);
      if (end === 'completed') {
        if (result.outcome === 'return') publish(result.value, true);
        else if ((result.outcome === 'syntax' || result.outcome === 'error') && !store.inspect().events.some(event => event.kind === 'child' && event.executionId === executionId)) {
          end = result.outcome === 'syntax' ? 'syntax' : 'error';
          if (++this.corrections > this.limits.corrections) {end = 'limit'; terminate('limit', true);}
        }
        else end = result.outcome === 'stopped' ? 'stopped' : result.outcome === 'worker-failed' ? 'worker-failed' : 'error';
      }
    } catch {
      if (end === 'completed') terminate('error', false);
    } finally {
      residents--; open = false; guest?.stop(); controller.abort();
      for (const item of queue.splice(0)) item.cancel();
      let settlement: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...pending]), new Promise<void>(resolve => {settlement = setTimeout(resolve, this.limits.settleMs);})]);
      clearTimeout(settlement); tick(); clearInterval(timer);
      for (const [id, effect] of started) {
        store.finishChild(id, effect === 'change' ? 'uncertain' : 'failed', effect === 'change' ? 'Outcome unknown after settlement deadline' : 'Read ended without an observed result');
        if (effect === 'change') {end = 'uncertain'; store.fence('uncertain');}
      }
      for (const event of store.events()) if (event.kind === 'child' && event.executionId === executionId && store.journal.get(event.childId)?.state === 'prepared') store.journal.cancel(event.childId);
      store.context.signal.removeEventListener('abort', abort);
      store.record({kind: 'end', executionId, reason: end});
    }
    return this.report(executionId, end);
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.current;
    this.receipts.clear(); this.cacheBytes = 0;

  }
}
function isLimit(key: string): key is keyof typeof limits {return Object.hasOwn(limits, key);}
