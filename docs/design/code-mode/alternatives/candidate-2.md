# Frozen architecture draft 2

This is an independent pre-synthesis draft, not an approved design or implementation. See [the comparison](../comparison.md) for gaps and corrections. Later feature coordination was incorporated by the parent synthesis.


## Rationale


### Problem

The shared service must add one model-facing code tool without moving credentials, decisions, or history into generated code. ADR-0005 is accepted future behavior, not an implementation. `runTurn` and the service currently exchange mostly strings; the broker has richer results but wrappers collapse them, callback deadlines include approval, journal summaries are not checkpoints or read caches, and command events lack parent/child IDs. `runTurn` also serves existing background tasks. See [grounding](../grounding.md) and [ADR-0005](../../../adr/0005-service-owned-code-mode.md). The user's assignment fixes a proposal-only checkpoint; the cross-candidate synthesis is for the parent.

### Usage (caller's view)

**Guest contract:** The only model-facing function is `run_code({code})`. Its code is the body of an async JavaScript function. It sees only the documented `staf` methods and ordinary JavaScript data. For example:

```js
const [time, hits] = await Promise.all([
  staf.clock(), staf.search({query: "example"})
]);
const page = await staf.web({url: hits.items[0].url});
return {time, page};
```

The model sees the returned, bounded result and can respond in ordinary prose. Calls can pause on owner approval without special guest syntax. `sketch.ts` begins with three concrete consumer call sites: the turn loop, a capability path through the broker, and Stop/partial recovery. Its definitions are derived from those sites. No guest function receives a credential, host object, filesystem, network, Node global, import loader or generic service RPC.

### Shape

A per-invocation supervisor owns an ephemeral QuickJS-in-Wasm runtime and its guest promises; a fresh runtime and global scope are created for every invocation. A service-owned execution aggregate identifies the command, provider tool call and execution; each child call has a unique, monotonic service-assigned ID and one immutable canonical payload/fingerprint. Its durable ledger stores state transitions, the exact executed code, bounded **delivered** results, and parent-child correlations. If secret-safety checks would alter the code before retention, reject the invocation before execution and report why rather than retain a misleading script. Each result is persisted before the corresponding promise is resolved. Journal safe summaries are not substituted for returned data. Read payloads that never cross to guest/model and intermediate guest values remain transient. To protect secrets, safe redaction applies before persistence and delivery; the persisted result is exactly the redacted value delivered. Capacity for each bounded result is reserved before effect dispatch. A storage failure after an effect is recorded as uncertain if possible, fences execution, and never delivers an unrecorded success; if durable storage itself is unavailable, surface a degraded recovery state and reconcile on restart, never assert success.

The supervisor uses `context.newPromise()` and a host-controlled queue: every guest method marshals bounded data, returns a guest promise, and asks the same capability gateway for a typed outcome. On settlement, it resolves/rejects the promise and schedules `runtime.executePendingJobs()` under the active budget. `quickjs-emscripten` [v0.31.0 documents](https://github.com/justjake/quickjs-emscripten/blob/v0.31.0/README.md#promises) these APIs; it also documents `setMemoryLimit`, `setMaxStackSize`, and `setInterruptHandler` [in its runtime example](https://github.com/justjake/quickjs-emscripten/blob/v0.31.0/README.md#runtime). This candidate uses normal promises, **not Asyncify**: the same [version's documentation](https://github.com/justjake/quickjs-emscripten/blob/v0.31.0/README.md#asyncify) limits an asyncified module to one suspended call. API existence does not prove sandbox security, CPU accounting accuracy, or compatibility with Staf's build.

The runtime alone is not the policy boundary. Run it in a disposable, supervised host process whose exposed IPC accepts only bounded call/result messages; no credentials or inherited privileged handles, environment scrubbed. The outer process boundary must be supplemented by a proven platform isolation profile denying filesystem, network, process creation and privilege escalation on every supported native and Docker platform. An ordinary Node subprocess alone is unrestricted, and [Node 22.16's `vm` documentation](https://github.com/nodejs/node/blob/v22.16.0/doc/api/vm.md) says `node:vm` is not a security mechanism. If a supported platform cannot enforce and demonstrate the profile, Code Mode remains disabled there; neither platform support nor sandbox safety is assumed. IPC validation, Wasm isolation and process restriction form defense in depth; only the instance service holds authority.

The gateway derives capability definitions, validation schemas, display descriptions, risk class and handlers from one registry. Each call is parsed and bounded at ingress; constructed URLs get the same checks, including redirects. It makes a durable prepared record, checks current agent permission and selected-skill validity, queues an exact action approval if required, then **atomically** checks execution generation/fence, current authority, approval binding and starts the permit before dispatch. The external effect is outside the transaction. A single per-agent approval arbiter presents one request at a time across executions and existing work; each request has its own 24-hour expiry measured from presentation, not queue entry. Queued requests are bounded and cancelled if their execution ends. An approval cannot resurrect a stopped execution. Concurrent permission changes share the same instance transaction/serialization point as permit issuance, so revocation cannot race past the last check. After permit issuance an effect can already be in flight: Stop is not rollback.

Independent registered read operations can have up to 3 effects in flight; all changes are FIFO serial within a script. A change is an exclusive barrier against other changes; reads are permitted alongside it only when the registry proves independence, otherwise the conservative default is exclusive. A cap of 32 total calls and 8 pending host calls prevents an unlimited queue. Results and child statuses remain independently attributed. If an approval is waiting while unrelated reads run, only guest CPU time is excluded from waiting, **not** execution time used by concurrent reads: account active wall time as the union of periods with guest running or an effect in flight, never the sum, and pause only when no work is active and the guest is solely awaiting approval. A separate post-approval effect deadline starts at actual dispatch. The existing five-minute wrappers must be refactored, not reused unchanged.

Stop, denial, expiry, blocked live authorization, invalidated selected skill, and resource limit atomically advance the execution fence before cancelling queues and signalling effects. The bridge rejects all later calls even if guest code catches exceptions; destroy the guest and stop pumping jobs. Settle already dispatched calls: persist confirmed success/failure even if late, otherwise mark `uncertain`; audit late outcomes as amendments, without changing the terminal fence or triggering dispatch. Approval expiry and Stop are terminal distinct reasons. No claim of exactly-once external effects is made. On restart mark live executions interrupted, pending approvals nonactionable, prepared children cancelled and started-but-unsettled effects uncertain. Never restore a heap or replay a program.

Recovery is a **new**, explicit execution with fresh variables, informed by a bounded inspection manifest of prior child states and the retained delivered results; no automatic script replay. The manifest is evidence, not a general interpreter checkpoint or proof that a similar new call is a duplicate. Enforce a service-side recovery guard on prior canonical action identities and protected resources: known completed changes cannot be reissued by a recovery execution; uncertain changes require owner investigation and explicit resolution before any new potentially overlapping change. This is a conservative capability-specific overlap rule, not semantic deduplication of arbitrary shell commands; where overlap cannot be proven safe, block further changes to that scope until owner resolution. Failed reads may be reissued within normal policy/limits. Completed read results can be supplied explicitly from retained output, but if not retained as delivered data the model must not infer their contents. A denied action remains forbidden for the affected script; no automatic retry, route substitution or new continuation around it. A new owner instruction is required to reopen denied work, subject to live policy.

The public turn interface is one `execute` operation with a typed terminal result; lifecycle control and inspection are service operations. It hides guest scheduling, policy, durable events, timers and reconciliation while exposing only the provider's call identity and code. At the guest boundary, five capability methods are derived from one contract; that is deliberate task-domain surface, not transport leakage. The model sees one tool rather than parallel tool APIs. A typed discriminated outcome survives through service control flow and is serialized to a provider tool-result string only at the transport edge. Ordinary text and selected model remain intact on failure.

### Synthesis decision

Candidate selection within this package: promise-driven QuickJS/Wasm is the proposed base, conditional on experiment gates. This is not the parent's cross-judge synthesis. It uses actual guest promises to permit independent parallel host calls while approval waits hold only bounded guest heap/process resources. No candidate is production-approved without native and Docker isolation evidence.

### Alternatives considered

1. **Resident QuickJS/Wasm guest with promise-fed host calls (selected).** Guest executes in disposable supervised worker, state stays in a bounded in-memory heap while promises await approval; the instance writes all durable state. Gateway arbitrates concurrent calls, approvals and side effects. Interface is one `execute`, hiding runner scheduling and authority. It retains resources for up to 24 hours and requires a platform isolation profile plus careful promise/handle cleanup.
2. **Wasm interpreter in a separate Wasmtime host with synchronous guest imports suspended via async host calls.** A Rust helper embeds a script interpreter compiled to Wasm; the service handles authority over IPC; its Wasmtime store/future and native async stack remain resident while a host request waits. `Linker::func_wrap_async` / async guest execution and store fuel, epochs, and resource limiter are documented in [Wasmtime v36.0.2 source](https://github.com/bytecodealliance/wasmtime/blob/v36.0.2/crates/wasmtime/src/runtime/store.rs) and [v36.0.2 async linker API](https://github.com/bytecodealliance/wasmtime/blob/v36.0.2/crates/wasmtime/src/runtime/linker.rs). As with the selected shape, only the service writes durable state; recovery means a new invocation with explicit prior results. This is a genuinely separate host/runtime and bridge architecture, but a synchronous guest import naturally blocks that guest's progression, so concurrent independent reads require a specifically designed asynchronous guest API or batching, with no proven interpreter integration here. Its top-level `execute` can be equally deep; the lower-level host/guest ABI and additional Rust delivery/packaging burden are larger and unverified. Retain as fallback if the selected runtime fails isolation or resource gates.
3. **Plain Node `vm` or unrestricted child process:** rejected as the isolation boundary. The former explicitly disclaims security; the latter inherits the host user's authority. Wrapping either in a timer or assuming Docker always supplies sufficient isolation does not fix that.

### Tradeoffs accepted

- We accept a bounded resident guest and process during up-to-24-hour approval waits for retaining live local variables without durable program replay.
- We accept conservative refusal of ambiguous follow-up changes for avoiding repetition of an effect whose status cannot be established.
- We accept an additional tightly restricted process and platform packaging work for separating untrusted interpreter execution from service credentials.
- We accept a temporary task-mode compatibility seam for preserving existing background-task history and control flows while main chat migrates.
- We accept JavaScript as an experiment candidate, not a product guarantee: evidence for model generation and provider/model combinations remains absent.

### Finite initial limits (unmeasured proposals)

Per invocation: source 32 KiB; result delivered to guest per child 64 KiB, total retained delivered child results plus final result 1 MiB; 32 child calls, 8 queued/in-flight calls, 3 concurrent reads, 1 changing effect; guest memory 32 MiB, stack 512 KiB, maximum worker memory 128 MiB; 30 seconds aggregate guest CPU plus 5 minutes active wall time; 5-minute per-effect wall deadline **starting at dispatch**; maximum 2 pre-action correction requests after the original program; approval window 24 hours from presentation; at most 4 live executions/agent and 16 per instance including waiting; admission rejects excess rather than discarding an existing approval. These are hypotheses, not measured safe capacities. Each capability's existing tighter limits win. Truncation, where capability permits, is explicit in the value *before* delivery; never silently truncate a delivered value in storage. Reject admission/dispatch before consuming an unreservable result allowance. Bound queued approvals by pending calls and execution caps. Validate actual OS-enforced memory and CPU behavior; count process and engine overhead, IPC and pending results, not only QuickJS heap.

### Migration and experiment gates

1. Add the durable execution/child schema, transactional fences, typed broker outcomes, capability registry and correlated projections behind an internal disabled flag; retain existing history and owner deterministic commands. Add exact redaction and atomic partial persistence before any migration.
2. Offline isolated experiment with fake capabilities: prove sandbox breakout denial (filesystem, env, network, process, native handles/imports), loop/memory/stack termination, process cleanup, IPC size checks, 24-hour-equivalent clock-controlled approval, approval arbitration, parallel calls and revocation races on each supported native/Docker profile. Verify service remains responsive; kill/restart at every prepared/started/result/commit boundary and check late/unknown outcomes. If any platform fails, do not enable it.
3. Synthetic end-to-end clock then search/web/scratch/skill through the same gateway; exercise redirects, denial/catch/fence, Stop while pending and in flight, permissions and skill changes, partial outcomes, result retention, one-at-a-time approval and separate timers. Test app clients and SQLite recovery, including disk-failure cases. Preserve existing direct tools until each experiment gate passes; do not offer equivalent direct tools alongside code to migrated main-chat turns.
4. Preserve `runTurn` task behavior as a separately typed `task` mode during the bounded main-chat migration: task-only ask-owner/discovery/delegation/answer, timers, APIs, task records and old transcripts stay readable and behaviorally unchanged. A mode-specific offer/dispatch registry may temporarily keep old tools **only for task turns**; never expose both equivalent paths in main chat. Add cross-mode regression tests. Migrate task capabilities under a later explicit plan, then delete task legacy tool dispatch after parity and data compatibility are proven. This is a temporary implementation seam, not a second long-term target.
5. Before enabling for each connection, run a separately authorized, budgeted live matrix naming selected model + connection (ChatGPT, OpenRouter, LM Studio, generic compatible), code-string transport, syntax/corrections, parallel/approval and realistic task success; document exact results, untested combinations and cost. Do not silently choose another model or fall back when a model fails. Existing connections remain selectable.

### Open questions and risks

- Can every supported native and Docker deployment actually provide the proposed OS restrictions without making the product unusable? If not, how will the unsupported platform be surfaced while retaining existing connections?
- Can the selected pinned build provide a side-effect-free syntax/compile preflight with accurate diagnostics, interrupt reliably, and account CPU during synchronous Wasm jobs? These must be demonstrated; do not infer a compile-only API from `evalCode`.
- Can the bridge drain multiple promise settlements fairly without reentrant QuickJS access, leaked handles, or output exceeding reservations, especially during revocation and concurrent approval?
- How much delivered page and shell output should existing capability boundaries permit, and can retention/redaction meet owner expectations without keeping unused data? Limits above are a proposal.
- How can each changing capability establish overlap or safe idempotency for recovery, especially arbitrary shell commands? Default scope blocking may require owner resolution and can be restrictive.
- Which specific model/connection pairs and budget will the owner authorize for reliability testing? Provider schema acceptance is not model reliability.

### Next implementation step

After checkpoint approval, build an offline disposable-runtime and broker-fence experiment before migrating any production capability.


## Module map


The paths below are proposed ownership boundaries, not existing files. Keep the three-file trace **turn → Code Mode → capability gateway**; execution storage and runtime adapters are private collaborators, not a chain every caller must understand. A single service database is the source of durable truth; per-execution queues/heaps are separate ephemeral state. No child process writes SQLite.

| Owner / proposed location | Owns | Public boundary and dependencies |
| --- | --- | --- |
| Existing `src/runtime.ts` turn loop | Provider request/response, code tool declaration, bounded **pre-action** correction budget, selected model, ordinary chat, typed `main` versus `task` mode | Calls Code Mode `execute` once per generated invocation. Convert typed terminal outcomes to provider strings only at the provider boundary. Two corrections after initial invalid program; no correction after any child permit has started; no direct main-chat fallback. Preserve provider call/message IDs and replay format. |
| `src/code-mode/index.ts` | Execution aggregate, single terminal fence, lifecycle, resource/admission budgets, active-time accounting, supervisor control, recovery guards | `execute`, `stop`, `inspect` (`sketch.ts`). Transactionally claims monotonically increasing fence/generation; serializes Stop/denial/expiry with child permit issuance. Keeps guest workers private. |
| `src/code-mode/guest-worker.*` | Fresh QuickJS/Wasm context, no-authority guest facade, handle lifecycle, pending-job scheduling, guest memory/CPU accounting | Private bounded IPC. Supervisor creates restricted process; no secrets, network, files, loader or host object. Host promise completion schedules jobs, never reenters runtime concurrently. Destroy runtime on every terminal state. Runtime package/version remains experiment-pinned, not a public interface. |
| `src/capabilities/index.ts` | One registry and gateway: typed boundary parsing, capability classification, original limits, policy and skill validity, action fingerprint, approval and permit, execution, typed results | `invoke(execution, unknown)` for guest bridge. Owns actual capability implementations/adapters and migrations; calls instance transaction for live fence + authority + permit. Clock and skills enter this same policy contract; skill metadata/content remain untrusted. Owner-only service/memory APIs never registered. |
| Instance state (`src/instance.ts`, action journal) | Durable command/execution/child/approval records; atomic permit/fence/permission serialization; correlation, exact executed code and retained redacted results, late amendments, owner resolution | Existing service reads/writes through one database owner; use migrations preserving old records. One durable record per `(work, provider call, execution, child)`, unique child ID and immutable payload fingerprint. Persist result before guest delivery. Durable summaries remain separate from bounded exact delivered values. |
| Approval arbiter, owned by instance service | One presented approval per agent shared across code, task and existing paths, FIFO bounded queue, expiry at 24h after presentation, exact fingerprint | Instance service owns decision and expiry lifecycle; every decision checks current fence and authorization. Existing approval APIs remain usable and clients reconnect to canonical state. Waiters are in memory only; restart interrupts and invalidates persisted pending approvals. |
| Existing GUI/CLI projections | Readable execution progress, action approvals and results, expandable source and correlated children | Read projections only; include parent execution/child IDs and late outcomes. Do not depend on code for understanding approval. Preserve old command/task event rendering and history. |

### Atomicity and data lifecycle

- On start, reserve finite result space and persist the exact source plus execution identity; reject before execution if secret-safety checks require altering the source. Each call is parsed and recorded prepared; after approval, one transaction checks the live fence, current permission and selected-skill revision/validity, validates the exact approval, claims the permit and records started. The transaction is the ordering point shared with Stop and revocation. If Stop wins no subsequent dispatch; if permit wins, effect may already occur and must be reconciled.
- An effect completion transaction persists the redacted bounded actual result and child state before guest delivery. Storage failure fences the execution; a started action with no confirmed durable result is uncertain, not failed or safe to replay. In-flight completions after terminal status append observations without reopening execution. No database transaction spans a host call or 24-hour wait.
- Pending approvals count from presentation, not queueing, and are cancelled on terminal transitions. A stopped/expired/denied guest is destroyed, not simply sent a catchable exception. Persist approved/denied/expired decisions. Agent-wide approval arbitration also covers preserved task flows; change their implementation behind existing APIs rather than allow two arbiters.
- Parent/child IDs attach source, action request, progress, approval, start, result, late result and final outcome. The guest may compute and discard arbitrary intermediate data inside its bounded heap; only results actually passed back to guest plus final return are durable. A child completion delivered before a later failure remains available even if the old turn implementation would roll back messages.
- Recovery is explicitly invoked from a new owner-authorized work item with a service-owned recovery reference; caller cannot edit the safety manifest. The gateway derives relevant prior completed/uncertain change scopes. An explicit owner resolution is evidence, not an automatic retry permission; normal authorization still applies. No model-authored assertion can clear an uncertain effect.

### Red-flag screen

- **Shallow module:** Rejected a start/poll/approve/resume caller choreography. `execute` hides scheduling, callbacks and persistence; `stop` and `inspect` are independent service needs. The internal gateway deliberately hides policy and effects behind one call.
- **Information leakage:** Rejected exposing QuickJS handles, IPC messages, storage rows or provider wire objects from Code Mode. `unknown` is parsed at the gateway and outcomes are domain unions. Worker internals stay private.
- **Temporal decomposition:** Rejected separate public prepare/authorize/dispatch/result modules with replicated action state. Gateway owns the full action invariant; instance owns durability throughout.
- **Pass-through method:** Rejected a second tool-service wrapper that forwards the same args to broker. Gateway adds parsing, live policy, fencing, approval, durable effects and typed outcome; supervisor adds isolation and scheduling.
- **Split ownership:** Only instance transaction owner writes durable records and serializes fence/permissions; each execution supervisor owns its own ephemeral heap. Instance-wide approval arbiter is sole presenter, including task mode. A late effect appends evidence through the same owner.
- **Two ways to do one task:** Main chat exposes only `run_code` after each migration gate. Temporary task-only legacy path preserves existing behavior; explicit later retirement gate removes it, and mode separation prevents a model from choosing between equivalent paths in a turn. Owner deterministic commands are a different authority surface.
- **Importable internals:** Use package exports and lint/build boundary so `guest-worker`, registry handlers, raw journal writes and IPC types cannot be imported by clients or turn code; verify with a failing import fixture in implementation.
- **Hand-synced list:** One registry derives facade method names, request schemas, descriptions, risk/read classification and dispatch. Build verifies any separately maintained provider schema/docs agree with registry and runtime capability tests.

### Deliberate migration seam

The existing shared turn loop also handles background tasks (`src/instance-service.ts:248`), with owner questions, task input, delegation, progress and checkpoints. Introduce explicit mode-specific tool offers and keep task legacy dispatch and transcript replay intact during main-chat rollout; existing task APIs and history remain available throughout. Each main-chat capability is migrated behind a gate, and a feature cannot be offered through both interfaces in the same main-chat turn. Task parity and history compatibility are required before retiring the legacy task path. Owner memory commands remain deterministic service operations, never model-callable.


## Signature sketch

```ts
/**
 * Caller usage comes first. This is a standalone architecture sketch, not an
 * implementation. The examples are pseudocode; all bodies below throw.
 *
 * 1. Shared provider turn after validating its one run_code tool call:
 *
 * const outcome = await codeMode.execute({
 *   work: commandWork, providerCall: parsedCall.id, source: parsedCall.code,
 * });
 * // serialize only here for provider transport; persist typed state separately
 * messages.push(toolResult(parsedCall.id, renderOutcome(outcome)));
 * // Plain assistant messages bypass codeMode. Never change selected model.
 *
 * 2. A resident guest calls staf.web({url}); the supervisor receives an
 *    untrusted request. Gateway owns validation, approval and dispatch:
 *
 * const result = await gateway.invoke({execution, request: guestMessage});
 * // invoke can remain pending while an approval is presented; after a decision
 * // it rechecks the live fence, skill and policy before starting the effect.
 * // Only a durably saved returned result is delivered to the guest promise.
 * supervisor.deliver({execution, result});
 *
 * 3. Stop or partial recovery from the service, not from guest code:
 *
 * await codeMode.stop({execution});  // terminal fence before signal/cancel
 * const report = await codeMode.inspect({execution});
 * // report retains completed results and distinguishes failed/uncertain/denied.
 * // A later explicitly authorized continuation is a fresh execution:
 * const next = await codeMode.execute({work: nextCommand, providerCall,
 *   source: newSource, recovery: report.recovery});
 * // The gateway rejects reissue of completed changes and overlapping uncertain
 * // changes until explicit owner resolution; it may retry failed reads.
 */

/** Proposed model-facing facade. Request/result schemas must ultimately derive
 * from the capability registry and preserve existing bounded capability data.
 * These shapes are illustrative pending schema parity, not current APIs. */
interface GuestStaf {
  clock(): Promise<{ readonly utc: string }>;
  search(input: { readonly query: string }): Promise<{
    readonly items: readonly { readonly title: string; readonly url: string; readonly snippet: string }[];
  }>;
  web(input: { readonly url: string }): Promise<{ readonly text: string; readonly truncated: boolean }>;
  scratch(input: { readonly command: string }): Promise<{ readonly output: string; readonly truncated: boolean }>;
  skill(input: { readonly id: string; readonly revision: number }): Promise<{ readonly body: string }>;
}

// Distinct semantic identifiers are parsed at service/provider boundaries.
type Brand<T, Name extends string> = T & { readonly __brand: Name };
type AgentId = Brand<string, 'AgentId'>;
type CommandId = Brand<string, 'CommandId'>;
type TaskId = Brand<string, 'TaskId'>;
type ProviderCallId = Brand<string, 'ProviderCallId'>;
type ExecutionId = Brand<string, 'ExecutionId'>;
type ChildId = Brand<string, 'ChildId'>;
type ApprovalId = Brand<string, 'ApprovalId'>;
type RecoveryRef = Brand<string, 'RecoveryRef'>;
type Source = Brand<string, 'Source'>;
type SafeText = Brand<string, 'SafeText'>;
type Fingerprint = Brand<string, 'Fingerprint'>;
type Instant = Brand<string, 'Instant'>;

type Work =
  | { readonly kind: 'command'; readonly id: CommandId; readonly agent: AgentId }
  | { readonly kind: 'task'; readonly id: TaskId; readonly agent: AgentId };

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Guest request is unknown until parsed through the single capability registry. */
type GuestRequest = unknown;
type ChildOutcome =
  | { readonly kind: 'returned'; readonly child: ChildId; readonly value: Json }
  | { readonly kind: 'failed'; readonly child: ChildId; readonly message: SafeText }
  | { readonly kind: 'blocked'; readonly child: ChildId; readonly reason: SafeText }
  | { readonly kind: 'denied'; readonly child: ChildId }
  | { readonly kind: 'expired'; readonly child: ChildId }
  | { readonly kind: 'stopped'; readonly child: ChildId }
  | { readonly kind: 'uncertain'; readonly child: ChildId; readonly summary: SafeText };

type ExecutionEnd =
  | { readonly kind: 'returned'; readonly value: Json }
  | { readonly kind: 'invalid-before-action'; readonly diagnostic: SafeText }
  | { readonly kind: 'failed'; readonly diagnostic: SafeText }
  | { readonly kind: 'blocked'; readonly reason: SafeText }
  | { readonly kind: 'denied'; readonly child: ChildId }
  | { readonly kind: 'expired'; readonly approval: ApprovalId }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'limit'; readonly reason: SafeText }
  | { readonly kind: 'storage-unavailable' };

type RunOutcome = { readonly execution: ExecutionId; readonly end: ExecutionEnd };
type ChildRecord = {
  readonly child: ChildId;
  readonly execution: ExecutionId;
  readonly fingerprint: Fingerprint;
  readonly summary: SafeText;
  readonly effect: 'read' | 'change';
  readonly state:
    | { readonly kind: 'prepared' }
    | { readonly kind: 'awaiting-approval'; readonly approval: ApprovalId; readonly expiresAt: Instant }
    | { readonly kind: 'started' }
    | { readonly kind: 'returned'; readonly value: Json }
    | { readonly kind: 'failed'; readonly detail: SafeText }
    | { readonly kind: 'uncertain'; readonly detail: SafeText }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'denied' }
    | { readonly kind: 'expired' };
};

type Inspection = {
  readonly execution: ExecutionId;
  readonly work: Work;
  readonly source: SafeText;
  readonly end: ExecutionEnd;
  readonly children: readonly ChildRecord[];
  /** Opaque reference to service-owned recovery guard and bounded results. */
  readonly recovery: RecoveryRef;
};

type StartExecution = {
  readonly work: Work;
  readonly providerCall: ProviderCallId;
  readonly source: Source;
} & ({ readonly recovery: RecoveryRef } | { readonly recovery?: never });

/** One call hides guest lifecycle, deadlines, persistence and policy; callers
 * never coordinate steps or pass capabilities, privileges or runtime options. */
interface CodeMode {
  execute(input: StartExecution): Promise<RunOutcome>;
  stop(input: { readonly execution: ExecutionId }): Promise<void>;
  inspect(input: { readonly execution: ExecutionId }): Promise<Inspection>;
}

/** Service-internal single authority entry; invoke returns only after the
 * action has settled, possibly after waiting for an owner. The gateway owns
 * parsing, policy, approval, the fence/permit transaction, and persistence. */
interface CapabilityGateway {
  invoke(input: { readonly execution: ExecutionId; readonly request: GuestRequest }): Promise<ChildOutcome>;
}

/** Process bridge is private to Code Mode; no transport messages are public API. */
interface Supervisor {
  deliver(input: { readonly execution: ExecutionId; readonly result: ChildOutcome }): void;
}

// Actual registry is schema-derived and owns handler/effect/risk metadata.
// Model declarations, guest facade, policy validation, and docs are derived.
// Checked registration enforces action-specific overlap and retention rules.

declare const codeMode: CodeMode;
declare const gateway: CapabilityGateway;
declare const supervisor: Supervisor;

/** Owner approval is a service request, not a guest callback or a grant by code. */
async function decideApproval(_input: {
  readonly approval: ApprovalId;
  readonly decision: 'approve' | 'deny';
}): Promise<void> {
  throw new Error('not implemented');
}

/** Recovery resolution records owner investigation; it never executes an effect. */
async function resolveUncertainChange(_input: {
  readonly execution: ExecutionId;
  readonly child: ChildId;
  readonly finding: 'occurred' | 'did-not-occur' | 'still-unknown';
  readonly note: SafeText;
}): Promise<void> {
  throw new Error('not implemented');
}

export type { CodeMode, StartExecution, RunOutcome, Inspection, CapabilityGateway };

```
