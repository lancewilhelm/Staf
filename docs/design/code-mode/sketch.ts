/**
 * APPROVED EXPERIMENT SKETCH. Every body is a placeholder. This file is not
 * imported by Staf and does not implement a runtime, storage, or feature API.
 *
 * 1. The service captures bot/session/command/signal at acceptance:
 * const work = await instance.acceptCodeWork(ownerCommand);
 * const report = await codeMode.execute({
 *   work, providerCallId: parsedCall.id, source: parsedCall.code,
 * });
 * messages.push(codeToolResult({providerCallId: parsedCall.id, report}));
 * // Typed results survive until this final provider-string encoding boundary.
 *
 * 2. Generated async JavaScript uses capabilities from one registry:
 * const hits = await staf.web.search({query: 'example'});
 * const pages = await Promise.all(hits.items.slice(0, 2).map(hit =>
 *   staf.web.read({url: hit.url})));
 * await staf.emit({sources: pages.map(page => page.url)});
 * return {answerData: pages.map(page => page.excerpt)};
 * // All actual calls cross the host gate; emit selects durable partial output.
 *
 * 3. Existing owner Stop fences work, not merely a catchable guest promise:
 * await instance.stopCommand({commandId});
 * const record = await codeMode.inspect({work});
 * // Fresh read-recovery scripts can use current-work result receipts. Recovery
 * // state is derived by the host on EVERY execute, never supplied optionally.
 */

import type {
  ApplicationCapabilities, BotId, CapturedCapabilityContext, ChildId,
  CommandId, ConversationSessionId, ExecutionId, Json, OperationId,
} from './capability-registration.js';

type Brand<Value, Name extends string> = Value & { readonly __brand: Name };
type ProviderCallId = Brand<string, 'ProviderCallId'>;
type PublishedOutputId = Brand<string, 'PublishedOutputId'>;
type ReadReceiptId = Brand<string, 'ReadReceiptId'>;
type ApprovalId = Brand<string, 'ApprovalId'>;
type SafeText = Brand<string, 'SafeText'>;
type SubmittedCode = Brand<string, 'SubmittedCode'>;
type WorkEpoch = Brand<number, 'WorkEpoch'>;
type CapabilityCatalogRevision = Brand<string, 'CapabilityCatalogRevision'>;

declare const acceptedWorkBrand: unique symbol;
export interface AcceptedCodeWork { readonly [acceptedWorkBrand]: true }

/** PRIVATE service binding; capture once, never resolve a mutable active-session
 * pointer during child dispatch. Authority/configuration checks remain live.
 * The signal is the accepted work's real cancellation signal, never guest data. */
interface WorkBinding extends CapturedCapabilityContext {
  readonly epoch: WorkEpoch;
  readonly acceptedProfileRevision: number;
  readonly catalogRevision: CapabilityCatalogRevision;
}

interface ExecuteCode {
  readonly work: AcceptedCodeWork;
  readonly providerCallId: ProviderCallId;
  readonly source: SubmittedCode;
}

export interface ParsedModelCodeCall {
  readonly providerCallId: ProviderCallId;
  readonly source: SubmittedCode;
}

/** Bounds and validates the ordinary code-string function call. Source that
 * cannot be retained faithfully under current privacy rules is rejected before
 * execution. Syntax failure is a separate pre-action outcome, not authority. */
export function parseModelCodeCall(_raw: unknown): ParsedModelCodeCall {
  throw new Error('not implemented');
}

/** One execution call hides supervision, timers, policy, queues and persistence.
 * Existing owner Stop remains the service operation. Inspection is read-only. */
export interface CodeMode {
  execute(input: ExecuteCode): Promise<RunReport>;
  inspect(input: { readonly work: AcceptedCodeWork }): Promise<WorkInspection>;
}

interface PublishedOutput {
  readonly id: PublishedOutputId;
  readonly value: Json;
  readonly origin: 'explicit-partial' | 'final-return';
}

interface ReadReceipt {
  readonly id: ReadReceiptId;
  readonly childId: ChildId;
  readonly description: SafeText;
}

/** Selected outputs are durable, redacted, bounded and delivered identically to
 * the model/client. Raw successful-read receipts are bounded temporary data for
 * this accepted request, not implicit context from prior sessions. */
export interface RunReport {
  readonly executionId: ExecutionId;
  readonly end: ExecutionEnd;
  readonly outputs: readonly PublishedOutput[];
  readonly actions: readonly ActionView[];
  readonly reusableReads: readonly ReadReceipt[];
}

type ExecutionEnd =
  | { readonly kind: 'completed'; readonly returned: PublishedOutput }
  | { readonly kind: 'invalid-before-action'; readonly diagnostic: SafeText; readonly correctionsLeft: number }
  | { readonly kind: 'read-failure'; readonly failed: readonly ChildId[]; readonly diagnostic: SafeText }
  | { readonly kind: 'denied'; readonly childId: ChildId }
  | { readonly kind: 'expired'; readonly approvalId: ApprovalId }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'blocked'; readonly reason: SafeText }
  | { readonly kind: 'uncertain'; readonly children: readonly [ChildId, ...ChildId[]] }
  | { readonly kind: 'limit'; readonly limit: LimitName }
  | { readonly kind: 'failed'; readonly diagnostic: SafeText }
  | { readonly kind: 'storage-unavailable' };

type LimitName = 'source' | 'guest-running-time' | 'active-time' | 'memory'
  | 'child-calls' | 'pending-calls' | 'result-bytes' | 'output-bytes' | 'executions';

/** A projection joins execution metadata with the one authoritative action
 * journal. It is not a second mutable copy of effect state. */
interface ActionView {
  readonly childId: ChildId;
  readonly operationId: OperationId;
  readonly name: string;
  readonly summary: SafeText;
  readonly state: 'prepared' | 'awaiting-approval' | 'started' | 'succeeded'
    | 'failed' | 'denied' | 'expired' | 'cancelled' | 'uncertain' | 'result-reused';
}

interface WorkInspection {
  readonly context: {
    readonly botId: BotId;
    readonly sessionId: ConversationSessionId;
    readonly commandId: CommandId;
  };
  readonly executions: readonly {
    readonly executionId: ExecutionId;
    readonly source: SafeText;
    readonly end: ExecutionEnd;
    readonly outputs: readonly PublishedOutput[];
    readonly actions: readonly ActionView[];
  }[];
}

type ProviderContinuation = 'normal' | 'correct-code' | 'recover-reads' | 'final-text-only' | 'none';

/** The actual formatter includes selected final/partial VALUES, action outcomes
 * and receipt descriptions on every outcome. A reference alone is not an answer.
 * The bounded formatter must not drop required data or summarize old sessions. */
export function codeToolResult(_input: {
  readonly providerCallId: ProviderCallId;
  readonly report: RunReport;
}): { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string } {
  throw new Error('not implemented');
}

export function continuationAfter(_report: RunReport): ProviderContinuation {
  // TODO: denial/expiry/uncertainty/limits close later tool dispatch for this
  // accepted work. Owner Stop/restart permit no later provider continuation.
  // Pre-action corrections and safe failed-read recovery consume shared budgets.
  throw new Error('not implemented');
}

export function createCodeMode(_input: {
  readonly capabilities: ApplicationCapabilities;
  readonly instance: InstanceAuthority;
}): CodeMode {
  throw new Error('not implemented');
}

/** INTERNAL domain authority, not an exported worker/IPC/storage interface.
 * The instance remains the single durable writer and atomic ordering point. */
interface InstanceAuthority {
  binding(work: AcceptedCodeWork): WorkBinding;
  beforeExecution(work: AcceptedCodeWork): Promise<WorkAdmission>;
  claimChild(input: { readonly work: AcceptedCodeWork; readonly parsed: ParsedChild }): Promise<ChildPermit>;
  fence(input: { readonly work: AcceptedCodeWork; readonly reason: TerminalReason }): Promise<void>;
}

type WorkAdmission =
  | { readonly kind: 'allowed'; readonly mode: 'normal' | 'read-recovery' }
  | { readonly kind: 'closed'; readonly reason: TerminalReason };
type TerminalReason = 'denied' | 'expired' | 'stopped' | 'interrupted' | 'uncertain' | 'blocked' | 'limit';
declare const parsedChildBrand: unique symbol;
interface ParsedChild { readonly [parsedChildBrand]: true }
declare const permitBrand: unique symbol;
interface ChildPermit { readonly [permitBrand]: true }

/** Parse the private size/version-bounded bridge message and registered input
 * schema. Guest-provided IDs/scopes/signals cannot create accepted work. */
function parseChild(_value: unknown): ParsedChild {
  throw new Error('not implemented');
}

/** Reserve work budget and result space before effect. In one instance-owned
 * transaction recheck work/session binding, epoch/fence, live permissions,
 * selected skill and configuration, exact approval and prior uncertain scopes.
 * Invoke the registered method only after a one-use permit is claimed. */
async function dispatchChild(_input: {
  readonly work: AcceptedCodeWork;
  readonly request: unknown;
}): Promise<Json> {
  throw new Error('not implemented');
}

/** Never rerun a completed action to resolve a receipt. Release only a result
 * from this accepted command/session after live origin-authority checks. */
async function reuseRead(_input: {
  readonly work: AcceptedCodeWork;
  readonly receipt: ReadReceiptId;
}): Promise<Json> {
  throw new Error('not implemented');
}

/** Commit an intentional partial output before acknowledging it to guest code;
 * auto-publish the final return through the same path. This is not general KV. */
async function publish(_input: {
  readonly work: AcceptedCodeWork;
  readonly value: unknown;
  readonly origin: 'explicit-partial' | 'final-return';
}): Promise<PublishedOutput> {
  throw new Error('not implemented');
}

/** On normal return close invocation admission; cancel unstarted children and
 * settle started calls within a bounded grace. Unknown changes become uncertain.
 * Late observations amend the original action, never reopen dispatch. */
async function finishInvocation(_input: {
  readonly work: AcceptedCodeWork;
  readonly executionId: ExecutionId;
  readonly returned: unknown;
}): Promise<RunReport> {
  throw new Error('not implemented');
}
