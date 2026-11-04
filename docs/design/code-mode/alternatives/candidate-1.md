# Frozen architecture draft 1

This is an independent pre-synthesis draft, not an approved design or implementation. See [the comparison](../comparison.md) for gaps and corrections. Later feature coordination was incorporated by the parent synthesis.


## Rationale


### Usage (caller's view; written first)

The main-chat turn exposes exactly one model tool, `run_code`, whose argument is `{ code: string }`. The code is an async JavaScript function body with a fresh `staf` capability object; its JSON-compatible return value is the result. It cannot import modules, access Node, make network requests, or reach Staf service objects. `staf.search`, `staf.read`, `staf.clock`, `staf.scratch`, and `staf.skill` are typed, bounded host calls; `staf.keep` and `staf.retained` store and retrieve authorized conversation results. The service supplies their descriptions and schemas from the same registry that validates and executes them. This is a proposed contract, not an implemented API.

```ts
// 1. Shared main-chat provider loop, after parsing the model's tool arguments.
const outcome = await codeMode.run({ work, providerCallId: call.id, code: args.code, signal });
// Store/format the discriminated outcome as the paired tool result; continue only
// for completed or eligible pre-action correction. No model switch or direct fallback.
```

```js
// 2. Model-generated function body. Each host call may complete or wait for approval.
const matches = await staf.search({ query: "orbital launch history" });
const pages = await Promise.all(matches.urls.slice(0, 2).map(url => staf.read({ url })));
return { sources: pages.map(p => ({ url: p.url, title: p.title })) };
```

```ts
// 3. Stop and partial recovery: an owner client uses existing Stop; a later turn
// gets a service-created recovery view, not a restored program or guessed payload.
await service.stopCommand({ commandId });
const recovery = await codeMode.recovery({ work });
// recovery distinguishes retained returned data, summary-only completed actions,
// failures, and unknown changes requiring reconciliation before any retry.
```

No guest exception handler can undo a service-side terminal fence. A successful `run` gives the turn its bounded result; `denied`, `expired`, `stopped`, `interrupted`, `blocked`, `uncertain`, and `failed` remain distinguishable. The guest does not receive an approval control API or durable action ID it can choose.

### Problem

[ADR-0005](../../../adr/0005-service-owned-code-mode.md) establishes service-owned history and authorization, fresh execution state, owner approvals, no replay on restart, and preservation of partial work. Current [`runTurn`](https://github.com/lancewilhelm/Staf/blob/9eb427232a44c3bc947caf79e0ad4cbd31fa8ea3/src/runtime.ts#L12) and [`instance-service`](https://github.com/lancewilhelm/Staf/blob/9eb427232a44c3bc947caf79e0ad4cbd31fa8ea3/src/instance-service.ts#L86) pass mostly strings; existing wrappers erase distinctions and their five-minute callback timers include approvals. [`ActionBroker`](https://github.com/lancewilhelm/Staf/blob/9eb427232a44c3bc947caf79e0ad4cbd31fa8ea3/src/action-broker.ts#L72) already binds policy and permits to actions, but the safe action journal is neither a payload cache nor an interpreter checkpoint. Existing command events do not form a child-action graph. Live authorization and selected skill validity remain service obligations. The accepted simple-chat decision preserves deferred task APIs and history even though main-chat task creation is deferred.

### Shape

**Data first.** One service-owned execution record links work and provider-call identity to immutable generated source, terminal state, child records, approval records and bounded retained outputs. Each child has a service-assigned ID, sequence, capability, immutable validated payload fingerprint, effect classification, lifecycle, safe summary and optional retained-result reference. The action journal remains the authority for permits and effects; execution records reference it instead of maintaining a second effect-status truth. A projection joins them for chat and recovery. The service owns the records and terminal fence; the untrusted guest owns only ephemeral variables and opaque host-promise handles. Storage schemas and IPC stay private.

**Flow.** A provider adapter emits its existing function call; `runTurn` parses `unknown` at the boundary and calls the service's single `run`. The supervisor creates a new QuickJS/Wasm runtime and guest context in a separately constrained worker, without ambient host functions or module loader. A synchronous host-function shim creates a guest promise, emits a bounded child request over a narrow IPC channel and returns; the service validates its envelope and the capability-specific schema, creates a child record, and schedules authorization/dispatch. On host completion the supervisor settles the guest promise and pumps pending jobs. The worker holds no credentials or direct access to the service. Its raw messages are untrusted; the service assigns identities and verifies every payload. No Asyncify is required for parallel pending guest promises. The script's returned JSON value is bounded and persisted before success is reported; guest heap and unused page payloads are discarded on termination. When a script returns with unawaited children, close admission first, cancel unstarted children, and wait a bounded cleanup grace for started children. If a started change remains unsettled, report an uncertain outcome with the retained return rather than completed success; journal later settlement.

**Authority and ordering.** A single capability registry owns schemas, descriptions, effect classification, adapters and policy mapping. Clock, search, web including redirects, scratch and skill loading migrate through it while preserving each existing boundary; skill code/body is untrusted data and selected ID/revision/digest validity is rechecked before each subsequent child and provider request. Selecting a skill also updates service-owned turn context and supplies its body to subsequent model requests under existing untrusted-content rules; returning it only to guest code would lose the current main-chat behavior. Memory writes and deterministic owner APIs are absent from the registry. Validate URL and effective configuration per actual action, including redirect hops; recheck current authorization and grants after approval immediately before a permit. A per-execution FIFO scheduler permits at most three independent reads, while an exclusive changing action waits for active reads and blocks new ones; changing actions run serially. A per-agent approval coordinator presents one exact action at a time across executions; queued requests have a bounded lifetime, cannot dispatch early, and are revalidated when presented and again when approved. Existing capability-specific limits remain stricter if applicable.

**Fences and clocks.** `stop`, denial and expiry commit a monotonic terminal fence through the same service-owned transactional/serialized authority that claims start permits. The atomic decision is the linearization point: no permit can be claimed after that fence, including for previously queued IPC messages or a catch-and-continue script. A permit claimed first is in-flight: abort is requested, but it may still take effect; never claim rollback. Stop or denial closes all queued approvals and children; expiry never grants authority. Guest termination is defense in depth, not the policy barrier. Journal actual late completions against the original child even after a terminal result; if the service loses evidence or a change may have occurred, mark uncertain, expose it, and require effect-specific reconciliation before any retry. Late observations may refine unknown to known, never erase history.

Track active wall time whenever guest code or a dispatched child runs, including while another call awaits approval; pause only when no runnable guest work or dispatched child remains and progress is solely approval-blocked. The individual approval clock runs independently of active time, starts at enqueue, never exceeds 24 hours, and cannot be reset by re-presentation; all approvals in an invocation share a 24-hour total wall deadline. Start per-effect I/O deadlines only after permit, rather than reusing the current five-minute signal spanning approval. Keep a bounded resident worker/context and promise handles while waiting; no CPU is charged during a fully quiescent wait. Restart interrupts all such executions, invalidates approvals, marks started changes without known outcome uncertain, cancels unstarted children, and never deserializes or reruns the program. A full worker quota rejects excess runs explicitly rather than evicting an accepted waiting execution; a later approval can have less than 24 hours remaining under the total deadline.

**Recovery.** Commit generated source before execution, append actual child events as they occur, and transactionally persist the final bounded return before acknowledging success. The explicit guest `staf.keep({ value })` stages meaningful JSON partial results into bounded conversation-associated durable storage; each completed keep is associated with its execution and available even if later children fail. The final return is kept automatically. Individual child calls record safe outcomes, but their raw pages/results are ephemeral unless explicitly kept or returned; no inference that a journal summary is a usable read payload. The UI and a later model turn receive a bounded recovery manifest with result references and availability. Recovery never runs old code or automatically repeats completed calls. A later, newly authorized script may load a kept value through `staf.retained({ ref })`, retry a failed read within limits, or reconcile an uncertain change via a specific safe read/owner review. The service checks that the reference belongs to this authorized conversation, applies result and bridge limits, and rejects unknown or unauthorized references; it never exposes an arbitrary storage API. If data was not retained, report it unavailable; do not pretend to reconstruct it. Completed changes are not retried. Capability policy and operation-specific reconciliation, not similar-looking parameters, decide if an uncertain change can ever be retried. Denial ends the script and this model turn without alternative-route continuation; future work needs fresh owner direction, preserving the general independent-work rule outside this denied script.

**Interfaces and types.** `CodeMode.run` and `recovery` hide sandbox supervision, registry dispatch, persistence, approvals and scheduling; callers see domain inputs and exhaustive terminal outcomes, never a wire envelope or interpreter handle. `stopCommand` remains the shared client surface. IDs are nominally distinct, external inputs parse as unknown, and failure/uncertainty are discriminated rather than stringified until provider encoding. `sketch.ts` captures the contract; its result types make retained results explicit. A capability's input and output derive from its runtime schemas in the eventual implementation, not copied lists. The sketch illustrates intent, not a new compile-ready dependency graph.

### Synthesis decision and alternatives considered

This is one independently produced candidate, not the parent’s cross-candidate synthesis. Two complete local shapes were compared:

| | Candidate A: resident QuickJS/Wasm | Candidate B: Monty suspension/feed |
|---|---|---|
| Execution | Fresh JS guest in per-execution constrained process, synchronous promise bridge; context lives across waits. | Fresh restricted Python interpreter, host receives suspension, feeds result; snapshot may retain paused state and potentially release runner resources. |
| Authority | Serialized IPC to trusted service registry; no guest ambient authority. | Suspension host requests enter the same trusted registry; snapshot and feed are untrusted/bounded at boundary. |
| Wait resources | Context plus worker retained, no active execution when quiescent; bounded admissions. | Snapshot could allow releasing worker; snapshot storage, integrity, versioning and cleanup become security-sensitive. The pinned Node binding documents `feedStart`, `FunctionSnapshot.resume`, `resumeFuture` and `FutureSnapshot`; whether Staf can safely release and restore a worker and meet its concurrency requirements is an experiment. |
| Durability and recovery | Service writes journal and selected returned results; worker heap is never a checkpoint or restored. | Same service owns records and partial recovery; snapshots are ephemeral only while service stays up, never automatically resumed after restart. |
| Public depth | Identical two service methods and one capability contract; hidden complexity includes guest promises, job pumping, a resident quota and cleanup. | Also can expose the same deep interface, but hides a host suspension loop, snapshot integrity/compatibility, Python subset and parallel scheduling. Exposing feed/snapshot handles to `runTurn` would be shallower and is rejected. |
| Main unknown | Hard memory ceilings and process isolation across native/Docker, plus model reliability. | Platform packaging, snapshot lifecycle, concurrent in-flight host calls, Python subset and model reliability. |

Choose A for the first gated experiment because a fresh guest, explicit promise handles and host job pump map naturally to concurrent reads and a single service bridge without relying on snapshot integrity. This is not because Staf is TypeScript; the model language is chosen for a concrete API and must still pass the same model-fit tests. If its resource/isolation gates fail, stop adoption and test B, not an unrestricted fallback. No claim that A is production-safe follows from these APIs.

At pinned [`quickjs-emscripten` commit 7b7af98](https://github.com/justjake/quickjs-emscripten/blob/7b7af98e4e69757c64c27aac46a74e1e07229545/README.md), `newRuntime`/`newContext`, `newFunction`, `newPromise`, `executePendingJobs`, `setInterruptHandler`, `setMemoryLimit` and `dispose` are documented; its README says it has not been security audited and warns that host promise completion requires pumping jobs. The [upstream memory-limit issue](https://github.com/justjake/quickjs-emscripten/issues/255) reports that a heap limit can fail to prevent host OOM: treat it as an unresolved risk, not a proven hard cap. At [Monty 1.4.0 binding commit 96c609c](https://github.com/pydantic/monty/blob/96c609c8571bf876e985eaf449a9c3d2adf78290/crates/monty-js/README.md), Node bindings execute a Python subset; its [snapshot API](https://github.com/pydantic/monty/blob/96c609c8571bf876e985eaf449a9c3d2adf78290/docs/snapshots.md) describes host-call suspension and resume, and its [security notes](https://github.com/pydantic/monty/blob/96c609c8571bf876e985eaf449a9c3d2adf78290/docs/security.md) separate host-call waiting from execution limits. Neither proves Staf's isolation. Ordinary `node:vm` explicitly is [not a security mechanism](https://nodejs.org/api/vm.html); an unrestricted Node subprocess adds no adequate boundary. A locally hosted Cloudflare Worker is also not adopted just because it has an RPC shape: [workerd's own security guidance](https://github.com/cloudflare/workerd/blob/main/README.md) calls for sandboxing untrusted code.

### Tradeoffs accepted

- We accept one resident worker per accepted waiting execution in exchange for no program replay and straightforward simultaneous guest promises; admission limits bound idle resource use.
- We accept explicitly retained partial values and unavailable discarded read payloads in exchange for preserving useful work without saving every intermediate page.
- We accept exclusive writes and a single approval presentation per agent in exchange for comprehensible ordering and owner control.
- We accept failed or unsupported model combinations without switching the chosen model in exchange for preserving the owner’s configuration and a single target interface.
- We accept a larger host implementation and an isolation experiment in exchange for a small service interface and no guest authority.

### Initial limits (unmeasured starting points, not production claims)

Per execution: 64 KiB code; 64 child calls including redirects; three concurrent independent reads; one exclusive change; 60 seconds total active time; five seconds cleanup grace for in-flight effects (then report uncertainty and record late settlement); 24 hours total elapsed approval lifetime; two correction attempts after the original invalid program, only before the first child dispatch; 256 KiB final JSON and 256 KiB aggregate explicit partial keeps; 1 MiB per child result into the guest; 2 MiB aggregate bridge traffic. At most two resident executions per agent and eight per instance, with one presented approval per agent. Cap guest heap at 32 MiB and require an independently enforced 128 MiB worker-process ceiling where the platform can prove it. Limits are starting hypotheses to bound storage, CPU, waiting and denial of service; if native or Docker cannot enforce a hard outer ceiling, the experiment fails rather than substituting the QuickJS heap setting. Keep existing stricter limits. Output overflow is explicit failure, never silent truncation of required returned data; safe display summaries may be truncated and marked. Five minutes is an initial *per-dispatched-effect* ceiling only if its existing capability limit permits it. Distinguish rejected admission from expiry of an already accepted approval.

### Red-flag screen

- **Shallow module:** revised to `run` plus `recovery`; no public authorize/start/finish choreography or runtime configuration stages.
- **Information leakage:** revised to keep IPC, persistence and interpreter objects private; only validated domain outcomes cross the service interface.
- **Temporal decomposition:** rejected separate load/validate/dispatch/save public modules; the registry owns capability semantics and the instance owns lifecycle together.
- **Pass-through method:** rejected a service facade that merely relays callbacks; the proposed service actually owns lifecycle, limits and dispatch.
- **Split ownership:** rejected guest-side action status and separate event state machines; one instance/journal writer owns records and the read projection joins them. Permit and fence must share one atomic authority.
- **Two ways to do one task:** reject parallel permanent direct model tools; migrate equivalents out of main chat as each replacement is complete, while retaining owner controls and the separate background-task compatibility path.
- **Importable internals:** require package export boundaries and an import-restriction check; only domain interface and generated guest declarations are public.
- **Hand-synced list:** require one typed registry and derive model descriptions, guest declarations, parsing and dispatch; fail the build for missing exhaustive adapters rather than maintain parallel lists.

### Open questions and risks

- Can the specific pinned runtime and deployment actually enforce no ambient authority and a hard worker resource ceiling on all supported native and Docker platforms, including malicious Wasm/engine cases? If not, the candidate cannot meet the accepted boundary.
- Can the selected pin reliably settle multiple promises, interrupt infinite loops, release every handle and survive OOM under the actual Node and OS versions? What independently enforced OS isolation and distribution mechanism works on macOS and Linux?
- Can persisted output limits preserve all product-required results without silent loss, and is an explicit `keep` understandable enough for models? Test partial failures and owner expectations; do not equate safe summaries with kept data.
- Which named model/connection combinations pass a pre-registered comparison with a direct-tool baseline on simple and compound tasks, correction rate, cost and latency? Which remain untested? Transport schema support is not model reliability.
- Which current operations really have sufficient read-only reconciliation, and how should owners resolve those that do not? An uncertain change must remain blocked absent proof or explicit informed owner action.
- Can the agent-level approval coordinator remain responsive when several executions or deferred tasks contend, without weakening each existing approval and expiry rule?

### Next implementation step

After the checkpoint, implement only a separately scoped, synthetic isolation-and-recovery experiment around the service-owned contract, and stop adoption if any gate fails; see the staged plan in `module-map.md`.


## Module map


This is a proposed ownership map, not a claim about files already implemented. Keep the primary flow traceable: `runTurn` -> `CodeMode.run` -> capability authority; worker IPC, journal, projection and registry live behind those owners, not as caller-visible orchestration stages.

| Owner | Owns | Boundary and existing integration |
|---|---|---|
| Shared turn (`src/runtime.ts`) | Normal text, provider tool declaration and paired result, bounded pre-dispatch correction counter, selected-model continuity. | Main-chat Code Mode calls only `run` and formats the domain result for current string-based provider messages. Validate `unknown` tool JSON. Never switch provider/model or fall back to direct tools after Code Mode failure. Preserve skill revalidation before provider calls. |
| Instance Code Mode service (new private module, composed by `instance-service.ts`) | Execution lifecycle, service-assigned parent/child IDs, quiescence-based active timer, pending/in-flight supervisor, terminal fences, cancellation and partial result policy. | `run`, `recovery`; existing `stopCommand` invokes fence. Atomic fence/permit decision and durable record coordination live with the instance's authoritative transaction/serialization point; no second writer for that decision. Resolve or reject all guest promises on termination; drain and record late effects. |
| Instance storage + existing action journal (`instance.ts`, `action-journal.ts`) | Durable execution/source, child-to-parent correlation, bounded kept/final results, decision records, action status and immutable event history. | Journal is authoritative for effect state; store record references and join on reads. Persist source and child request before effect; persist permit before dispatch, result before acknowledgment. Never use the journal as a full result cache or VM checkpoint. Repeated IDs return observed status, not redispatch. |
| Capability registry + broker (private extension of `action-broker.ts` and adapters) | Single authoritative schemas, descriptions, effect classes, policy mapping, live permission/skill/config checks, fingerprints, actual capability adapters and safe outcomes. | One typed contract for clock, web including each redirect, search, scratch, skills; no direct service method exposure. Keep owner-only memory writes and deterministic APIs outside. Evolve string wrappers into typed blocked, denied, expired, failed, cancelled and uncertain results before provider formatting. |
| Approval coordinator (instance-owned) | One presented approval per agent, per-request expiration and queued exact-action decisions across executions and work kinds. | Recheck authority and payload after wait. Stop/denial/expiry close queued requests; a queued approval can expire without being presented. Timers and permit claim serialize with fence. |
| Guest supervisor (private) | Constrained process lifecycle, fresh Wasm/context, minimal host promise bridge, job pump, input/output/CPU/memory limits, disposal. | Versioned bounded IPC is parsed as `unknown` by service; no credential, file, network, process, module loader or service handle. Worker termination does not establish remote effect cancellation. |
| Client projections (GUI, CLI, service status) | Human-readable action progress, exact approval, outcome, expandable code and child detail. | Stable parent/child IDs, action start/outcome and late result updates across parallel reads; result references are authorized and redacted; never require code reading to approve. Existing history remains readable. |

### Timing and lifecycle

1. Admission checks quota; save source, work, outer call ID and creation time before running. Preflight parses the async function body before any child dispatch. The shared turn owns a counter across attempts, so only invalid programs before first child dispatch qualify for at most two model corrections total; persist all attempts and diagnostics. Other pre-action runtime faults may qualify only when classified as invalid code and no permit was ever claimed; no retries after any child is dispatched. Retain the selected model.
2. Guest submits child calls; the service assigns sequence and IDs, validates boundaries and computes immutable payload fingerprints. Schedule three independent reads or one exclusive change; queued calls remain bounded. The registry decides live policy. Exact action approval is presented fairly one at a time per agent and expires at most 24 hours after enqueue; invocation has a 24-hour total wall cap. Recheck action, permissions, grant, skills and fence at the atomic permit decision. Redirects are separately authorized children.
3. A fully approval-blocked execution consumes no active budget; if any guest work is runnable or any child is dispatched, the active wall clock runs, regardless of other waiting calls. Resume it on activity. Approval waits do not use the old callback five-minute timer. Each dispatch gets its own post-permit capability I/O deadline and cancellation signal.
4. A terminal fence wins against all subsequent permit claims; requests that claimed first are in-flight even if their host effect starts later. Abort them best-effort, record settlement or uncertainty, including late completions; do not allow new IPC or guest exception recovery to dispatch. If a runner vanishes, fence, cancel queued children, classify started but unsettled effects uncertain and destroy resources.
5. A normal return is bounded, persisted and paired with the outer call. `staf.keep` persists a bounded partial JSON result and returns a reference before continuing; `staf.retained` can retrieve that value in a later authorized script under the same conversation and size limits. On return, close admission, cancel unstarted children, and give started children a bounded cleanup grace; if a change remains unsettled, retain the return but report uncertainty rather than completed success. At any end, free all guest state and unkept data, close approval rows and expose a joined recovery manifest. Durable late-result updates remain possible after the turn has stopped. On service restart, mark outstanding executions interrupted and pending approvals invalid; journal records for dispatched unknown effects remain uncertain. No worker, promise or program is restored.

### Background compatibility and migration

`runTurn` currently serves both main chat and background tasks, including task-specific `ask_owner`, helpers, lifecycle and history, while main-chat background creation is deferred. Do not replace its universal tool list in one switch. Introduce an explicit work-kind-specific tool exposure strategy: migrate main chat's five target capabilities behind `run_code`; leave existing background-task declarations, callbacks, approval timers, stored tool messages, task-specific tools and finish semantics functional until a separately tested migration. Share policy primitives where safe without forcing old task callback string outcomes through new semantics. Existing session/tool-call history must continue to deserialize and replay to its provider as historical messages, without executing historical calls. Contract tests cover old in-flight/restarted tasks and paired history across release upgrades. When tasks eventually migrate, perform a bounded per-capability migration with task parity tests and retire the corresponding legacy exposure for that work kind; keep task APIs and records. No background capability is silently dropped or newly enabled in main chat.

### Staged gates (design only)

1. **Contract and offline synthetic slice.** In an isolated implementation worktree, specify schemas, versioned records, retention, supervisor and a synthetic read/change; no production migration. Pin the exact runtime, transitive sources, OS, Node and artifact hashes; perform licensing and update review.
2. **Isolation and operation gate, release-blocking.** Attack no-import/no-network/no-filesystem/no-credentials/no ambient service references, forged or malformed IPC and result size; exercise CPU loops, deep recursion, allocation bombs, worker kill, OOM, disposal, fair admission and 24-hour simulated wait on actual supported macOS/Linux native and Docker installations. Prove an independent hard process ceiling and isolation mechanism for each supported target. Any escape, unbounded resource, unsupported platform or handle leak fails; do not replace the gate with `node:vm`, a plain Node subprocess, or heap settings alone.
3. **Recovery and ordering gate, release-blocking.** Deterministic fake clock and controllable synthetic effects interleave permit/fence races, delayed/ignored cancellation, caught guest exceptions, denial, approval expiry, revocation, changed skill, unawaited calls, simultaneous approvals, crash before/after each journal commit, restart, effect-success-before-result crash and late settlement. Assert zero permits after a terminal fence, complete actual action attribution, no duplicate automatic effect, explicit uncertain classification and durable bounded keeps/final output; check partial reads and unknown-result unavailability. The passing criteria are exact behavioral invariants, not simulated proof of remote cancellation.
4. **Function and connection gate.** Prove every original main-chat capability and existing permission including redirects through the same registry; retain normal text and deterministic owner APIs. Test all adapters with synthetic transports and old background/history compatibility. Separately obtain authorization and pre-register live model/connection pairs, dataset, simple/compound baselines, correction and success thresholds, costs and token budget. A schema-compatible adapter alone does not prove a model can use code. Report tested and untested pairs plainly.
5. **Incremental adoption only after gates pass.** Migrate one capability at a time behind feature-gated main chat with documented rollback before retirement, and remove equivalent direct declarations when each complete path is proven. Finish with one model-facing code tool, current connections, unchanged selected model on failure, full chat/client and docs checks, and no implicit background-task migration. Failure of a mandatory gate blocks adoption and triggers redesign, not weaker policy or fallback.


## Signature sketch

```ts
/**
 * Caller usage FIRST. This file is a standalone design sketch, not an implementation.
 *
 * // Main-chat runTurn: one declared model function, run_code({code}).
 * const outcome = await codeMode.run({ work, providerCallId: call.id, code: args.code, signal });
 * // Encode outcome as the paired provider result, retaining the selected model.
 *
 * // Model-generated async function body, using only the guest API:
 * const matches = await staf.search({ query: "orbital launch history" });
 * const pages = await Promise.all(matches.urls.slice(0, 2).map(url => staf.read({ url })));
 * await staf.keep({ value: { found: pages.map(p => p.title) } });
 * return { sources: pages.map(p => ({ url: p.url, title: p.title })) };
 * // Each capability can pause at an exact-action approval. Approval is not a guest API.
 *
 * // Client Stop is still service-owned; a later turn inspects durable partial work.
 * await service.stopCommand({ commandId });
 * const recovery = await codeMode.recovery({ work });
 * // A manifest says which result data survives and which changes need reconciliation.
 * // In a new script, await staf.retained({ ref }) retrieves an authorized kept value.
 */

// Validated and minted at service/provider boundaries; never chosen by the guest.
type AgentId = string & { readonly __brand: 'AgentId' };
type CommandId = string & { readonly __brand: 'CommandId' };
type TaskId = string & { readonly __brand: 'TaskId' };
type ExecutionId = string & { readonly __brand: 'ExecutionId' };
type ChildId = string & { readonly __brand: 'ChildId' };
type ProviderCallId = string & { readonly __brand: 'ProviderCallId' };
type ResultRef = string & { readonly __brand: 'ResultRef' };
type ApprovalId = string & { readonly __brand: 'ApprovalId' };
type Fingerprint = string & { readonly __brand: 'Fingerprint' };
type IsoTime = string & { readonly __brand: 'IsoTime' };
type WorkRef = { kind: 'command'; agent: AgentId; id: CommandId } | { kind: 'task'; agent: AgentId; id: TaskId };
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Public domain contract, called only for the migration-enabled work kind. */
interface CodeMode {
  run(input: { work: WorkRef; providerCallId: ProviderCallId; code: string; signal: AbortSignal }): Promise<ExecutionOutcome>;
  recovery(input: { work: WorkRef }): Promise<RecoveryView>;
}

type ExecutionOutcome =
  | { kind: 'completed'; execution: ExecutionId; result: ResultRef }
  | { kind: 'invalid_before_dispatch'; execution: ExecutionId; diagnostic: string }
  | { kind: 'denied'; execution: ExecutionId; child: ChildId }
  | { kind: 'expired'; execution: ExecutionId; approval: ApprovalId }
  | { kind: 'stopped' | 'interrupted'; execution: ExecutionId }
  | { kind: 'blocked'; execution: ExecutionId; reason: string }
  | { kind: 'uncertain'; execution: ExecutionId; children: readonly ChildId[] }
  | { kind: 'failed'; execution: ExecutionId; reason: string };

// References resolve through existing authorized conversation/client access; availability
// is explicit because a journal summary is not a stored payload or a checkpoint.
type RecoveryView = { executions: readonly ExecutionRecovery[] };
type ExecutionRecovery = {
  execution: ExecutionId;
  source: string; // authorized, redacted for presentation; bounded and inspectable
  outcome: ExecutionOutcome;
  returned: readonly ResultRef[]; // includes completed keeps and successful final return
  children: readonly ChildRecovery[];
};
type ChildRecovery = {
  id: ChildId;
  sequence: number;
  capability: CapabilityName;
  summary: string;
  result: { kind: 'retained'; ref: ResultRef } | { kind: 'not_retained' };
  state:
    | { kind: 'queued' | 'awaiting_approval' | 'started' | 'cancelled' }
    | { kind: 'succeeded' }
    | { kind: 'failed'; reason: string }
    | { kind: 'denied' | 'expired' | 'blocked' }
    | { kind: 'uncertain'; reconciliation: 'required' };
};

// Model-facing guest API. Concrete runtime schemas are the eventual single source
// for these signatures and corresponding descriptions; shown explicitly for review.
interface GuestStaf {
  clock(input: Record<string, never>): Promise<{ utc: string }>;
  search(input: { query: string }): Promise<{ urls: string[] }>;
  read(input: { url: string }): Promise<{ url: string; title: string; text: string }>;
  scratch(input: { command: string }): Promise<{ output: string; exitCode: number }>;
  skill(input: { id: string; revision: number }): Promise<{ id: string; revision: number; digest: string; body: string }>;
  keep(input: { value: Json }): Promise<{ ref: ResultRef }>;
  retained(input: { ref: ResultRef }): Promise<Json>; // same authorized conversation only
}
type CapabilityName = Exclude<keyof GuestStaf, 'keep' | 'retained'>;
type CapabilityRequest = {
  [K in CapabilityName]: { kind: K; input: Parameters<GuestStaf[K]>[0] }
}[CapabilityName];

// Internal contract: no IPC types or interpreter handles exported to turn callers.
// The capability registry defines validation, effect class, policy and dispatch as
// one unit. Actual implementations infer Input/Output from their runtime schemas.
type EffectClass = 'read' | 'change';
interface CapabilityDefinition<Input, Output> {
  readonly description: string;
  readonly effect: EffectClass;
  parse(input: unknown): Input;
  authorize(input: Input, context: DispatchContext): Promise<Authorization>;
  perform(input: Input, context: DispatchContext): Promise<EffectOutcome<Output>>;
}
type DispatchContext = { work: WorkRef; execution: ExecutionId; child: ChildId; fingerprint: Fingerprint; signal: AbortSignal };
type Authorization =
  | { kind: 'allow' }
  | { kind: 'approval_required'; approval: ApprovalId; expiresAt: IsoTime }
  | { kind: 'blocked'; reason: string };
type EffectOutcome<T> =
  | { kind: 'succeeded'; value: T; safeSummary: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'uncertain'; reason: string };
type Admission =
  | { kind: 'allowed' }
  | { kind: 'fenced'; reason: 'stopped' | 'denied' | 'expired' | 'interrupted' }
  | { kind: 'blocked'; reason: string };

/** Owned inside the service. Terminal fence and permit claim share one serialized
 * durable decision; allow means this child is now in-flight, not that it completed. */
interface ExecutionAuthority {
  dispatch(input: { context: DispatchContext; request: CapabilityRequest }): Promise<EffectOutcome<Json> | Admission>;
  fence(input: { execution: ExecutionId; reason: 'completed' | 'stopped' | 'denied' | 'expired' | 'interrupted' }): Promise<void>;
  keep(input: { execution: ExecutionId; value: Json }): Promise<ResultRef>;
  retained(input: { work: WorkRef; ref: ResultRef }): Promise<Json>;
}

/** Proposed composition only. The eventual implementation must not return or expose
 * a worker, snapshot, raw schema, action journal handle, or IPC object here. */
function createCodeMode(): CodeMode {
  // TODO: compose per-instance authority, durable records, bounded supervisor,
  // service-owned registry, approval coordinator, and authorized result store.
  throw new Error('not implemented');
}

function parseCapabilityRequest(input: unknown): CapabilityRequest {
  // TODO: parse versioned size-bounded IPC envelope and registry input schema;
  // mint child identity in service and reject unknown fields/capabilities.
  throw new Error('not implemented');
}

function encodeProviderOutcome(outcome: ExecutionOutcome, recovery: RecoveryView): string {
  // TODO: encode bounded/redacted domain result for the existing string transport;
  // preserve typed reason internally and pair exactly once with provider call ID.
  throw new Error('not implemented');
}

```
