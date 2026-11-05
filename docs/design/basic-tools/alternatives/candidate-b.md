# Candidate: capability-owned actions, work-owned admission

**Status:** independent design candidate for the [#79 architecture checkpoint](https://github.com/lancewilhelm/Staf/issues/79), under the accepted [#78 specification](https://github.com/lancewilhelm/Staf/issues/78). This is a proposal, not an implementation, owner approval, or synthesis. Baseline `2886e7b`; experiment inspected at `2da3b8fb`. The owner must approve the final architecture before implementation tickets proceed.

## Usage: callers first

An agent's saved **Tool mode** controls what its existing provider turn can call. `Direct` exposes eligible individual actions; `Hybrid` exposes those actions and `code_mode`; `Code Mode` exposes only `code_mode`. The code tool's catalog contains the same eligible actions and never itself. Text-only responses do not invoke a tool. A new agent copies a default of Hybrid at creation; missing mode on an old agent or captured profile means Direct. Explicit saved mode wins. The GUI, CLI, API, and valid direct edits use the existing authoritative config and conflict behavior.

The following sketches show domain calls, not provider wire formats or existing exports. The service binds work once; providers and guest code cannot choose its owner or construct authority.

```ts
// 1. The existing chat and task callers both run the same provider lifecycle.
const work = service.actions.openAccepted({kind: 'command', id: acceptedCommandId});
// For a task use {kind: 'task', id: acceptedAttemptId}; no synthetic command.
await runTurn({ ...existingConversationInputs, actions: work, signal: work.signal });
// runTurn obtains work.offer(), translates provider calls with work.invoke(),
// and continues its existing streaming, replay, recall, skill and save flow.
```

```ts
// 2. The provider bridge supplies its call ID and input. Work selects the
// registered action; the bridge never calls a file, memory or shell service.
const result = await work.invoke({
  via: 'direct', callId: providerCallId, name: 'terminal_start',
  input: {command: 'printf ready', io: 'pipes', lifetime: 'foreground'},
  intent: {kind: 'new'},
});
// result includes action ID and either completed exit/output or a process handle.
// Code Mode's worker bridge calls exactly this same method with via: 'code',
// a host-assigned child call ID and script-supplied action/intent.
```

```ts
// 3. A controlled continuation after a script error sees action receipts.
// Revisit an earlier action, even with a new provider call ID or calling style:
const prior = await work.invoke({
  via: 'direct', callId: nextCallId, name: 'terminal_start',
  input: {command: 'printf ready', io: 'pipes', lifetime: 'foreground'},
  intent: {kind: 'resume', actionId: receipt.actionId},
}); // returns the recorded result; does not spawn again
// A genuinely new invocation with identical bytes is explicit:
const again = await work.invoke({
  via: 'direct', callId: anotherCallId, name: 'terminal_start',
  input: {command: 'printf ready', io: 'pipes', lifetime: 'foreground'},
  intent: {kind: 'repeat', after: receipt.actionId},
}); // new action ID after recovery checks; may spawn
```

In an ordinary uninterrupted turn a new action uses `new`. During a recovery epoch the service requires a `resume` or `repeat` decision for an operation that a capability identifies as potentially overlapping an earlier action. It provides the relevant receipts and bounded action details in the tool result/context. `repeat` is a positive statement that another effect is intended, not an automatic retry. Unknown effects require reconciliation before any overlapping repeat. A new call ID, different calling style, or regenerated source alone is not that statement.

## Shape: owned data and signatures

```ts
type ToolMode = 'direct' | 'hybrid' | 'code';
type WorkRef = {kind: 'command'; id: CommandId} | {kind: 'task'; id: AttemptId};
type ActionIntent =
  | {kind: 'new'}
  | {kind: 'resume'; actionId: ActionId}
  | {kind: 'repeat'; after: ActionId};
type Route = 'direct' | 'code';
type BoundConversation =
  | {kind: 'main-chat'; chatId: ConversationId}
  | {kind: 'task'; attemptId: AttemptId; capturedContextId: ContextId};

type AcceptedWork = Readonly<{
  ref: WorkRef;
  executingAgent: AgentId;
  conversation: BoundConversation;  // exact captured chat or task context
  profile: CapturedProfile;          // provider, model, reasoning, instructions, mode
  workingDirectory: AbsolutePath;    // derived from stable agent directory at acceptance
  scope: CapturedTaskScope | 'chat';  // assignment/schedule restrictions included
}>;

type ActionOutcome =
  | {state: 'succeeded'; result: SafeResult}
  | {state: 'failed'; error: SafeError}       // effect is known not to have happened or failed as observed
  | {state: 'cancelled'; reason: string}      // never started
  | {state: 'interrupted'; observation: SafeResult} // interruption observed, effect may have happened
  | {state: 'uncertain'; observation: SafeResult};  // effect or process status unknown

type Invocation = Readonly<{
  via: Route; callId: CallId; name: CapabilityName;
  input: unknown; intent: ActionIntent;
}>;
type Receipt = Readonly<{actionId: ActionId; outcome: ActionOutcome}>;
interface WorkActions {
  readonly signal: AbortSignal;
  offer(): OfferedTools; // selected mode + accepted work restrictions; no wire types
  invoke(call: Invocation): Promise<Receipt>;
}
interface ActionService {
  openAccepted(ref: WorkRef): WorkActions; // service resolves persisted accepted context
}
```

`openAccepted` is service-internal: a caller cannot substitute an agent, chat, profile, scope, signal, or working folder. Exactly one coordinator is owned per active work ref, shared by both routes, even if provider calls, scripts, or clients race. Durable records remain authoritative across reconnect and restart; a new service process can inspect but cannot implicitly resume an old running turn. A task attempt is distinct from its predecessor, with explicit lineage and separate captured context; a retry submission with the *same* accepted ID returns its original profile and never reads current selection again.

```ts
// One authoritative registration per capability. Schema and definition are
// authored once; direct provider schemas and the guest catalog are derived.
interface Capability<I, O, Bound> {
  readonly name: CapabilityName;
  readonly description: string;
  readonly input: DomainSchema<I>;   // parse external input at the boundary
  readonly result: DomainSchema<O>;
  bind(work: AcceptedWork, input: I): Bound;
  permission(bound: Bound): ActionBoundary; // existing policy vocabulary
  overlap(bound: Bound): RecoveryKey | null; // capability-specific candidate lookup
  assertCurrent(bound: Bound): void; // live resource/version checks at start
  perform(bound: Bound, execution: ActionExecution): Promise<Observed<O>>;
  reconcile(bound: Bound, record: ActionRecord): Promise<Reconciliation>;
}
interface CapabilityRegistry {
  register<I, O, B>(capability: Capability<I, O, B>): void;
  offerFor(work: AcceptedWork): CapabilityCatalog;
}
type ActionExecution = Readonly<{
  actionId: ActionId; work: AcceptedWork; signal: AbortSignal;
  report(progress: SafeProgress): void;
}>;
// Model, guest and clients do not receive Capability, database or raw process objects.
```

A capability owns parsing, resource binding, its operation preconditions and effect, overlap semantics, safe result projection and reconciliation. One service composition root registers the eligible clock, web, search, existing scratch-shell, skill selection, native terminal, file and memory actions. Domain-specific handlers remain in their owning modules; neither `runtime.ts` nor the QuickJS host maintains a second capability list or performs effects. Work-specific task/collaboration tools retain their existing eligibility and restrictions; inclusion in the catalog depends on their actual eligibility. Offer derivation and dispatch both enforce the selected mode and the same capability eligibility. A provider with no tool support gets an actionable error when an action is required; ordinary supported text chat still works. No provider, model, or mode substitution.

The coordinator performs this single sequence for either route:

1. Parse and bind to the immutable accepted work; verify route is offered, including `code_mode` entry and child eligibility. Acquire a durable per-work invocation mapping from `(work, route, callId)` to action/intent and a keyed fingerprint of the complete canonical request. Reuse of that ID with changed input or intent conflicts. Different child IDs are not proof of new intent.
2. Resolve intent against the work's action ledger and recovery state. A `resume` must name an action from this work or an explicitly linked predecessor recovery lineage, and its capability and canonical input/preconditions must match; return its recorded result, in-progress status, or reconciliation requirement. Never execute it again. A `repeat` must name the overlapping action, pass its capability's reconciliation and current preconditions, and creates a distinct action. Cross-work resolution is allowed only through an explicitly authorized retry lineage, not global content matching or another conversation's records.
3. Reserve action identity, budget and applicable approval once. Enqueue with a work-owned admission gate. On denial, Stop, expiration, exhausted shared work budget, revoked scope, or unknown changing effect, fence affected work and cancel queued starts across both routes; surface the reason. A normal syntax/runtime error fences that script, not otherwise-live Hybrid work. Its completed receipts and unresolved actions establish a recovery epoch before another provider step. Code-only mode surfaces the error through its own offered interface.
4. Immediately before the effect, in the instance-owned transaction check work state, Stop, scope, budgets, current permission/grant/approval and feature-owned resource preconditions; atomically consume the start permit and persist `started`. Recheck after an async approval. Do not hold a DB transaction across a prompt, spawn, I/O, or network request. A capability executes only after that commit. One underlying action has one applicable policy decision; `code_mode` has no extra blanket approval.
5. Commit the observed outcome and safe receipt. A late reliable observation may amend the *same* uncertain action, never reopen fenced work. Read release also rechecks authority where existing behavior requires it. Raw external effects cannot be committed atomically with SQLite: a crash after start is uncertain unless independently observed; no exactly-once promise.

**Identity and recovery details.** The canonical fingerprint is integrity checking, not an identity: include work, action name, normalized input, bound resource and preconditions, keyed so sensitive values are not exposed. `ActionId` is service-issued and durable; provider call and guest child IDs map to it, not the reverse. `RecoveryKey` is a capability-owned *candidate index*, not a uniqueness constraint. For terminal start it can include normalized command, cwd, relevant execution options and environment identity; exact text match is only a prompt to disambiguate during recovery, never a ban on intentional repetition. File edits additionally identify path and expected content/version; memory changes identify scope, memory ID and version. Mismatched preconditions conflict rather than becoming a retry. An identical command twice in a normal script is two `new` actions; after an error the second must explicitly say `repeat` against the receipt. A new unrelated action may proceed once the work gate has established that no unknown effect blocks it; the safe default for an unknown terminal effect is a work-wide changing-action fence until reconciled because arbitrary shell side effects cannot be localized. Reads and process inspection can remain available when policy allows.

Recovery is deliberately not a semantic oracle: an agent can misdescribe a second operation or express an incorrect intention. The service guarantees replay of a named action does not re-execute it, prevents silent overlap during its recovery protocol, and enforces the capability's explicit preconditions. It cannot prove two different shell strings have the same real-world effect or that a model's explicit `repeat` expresses the user's true intent. If an outcome remains uncertain, inspection or a recorded owner reconciliation must precede a new overlapping change; acknowledging uncertainty is not evidence of success or failure. Reconciliation records who/what observed which evidence and whether the effect is observed complete, definitely not applied, or still unknown. If the owner explicitly accepts residual risk, record that decision separately and authorize only a new operation, never rewrite the old unknown as success or failure. Stop, denial and revoked authority remain fences despite such a decision.

## Accepted context and live authority

At acceptance, store the full validated executing agent profile, mode, conversation identity/context, `WorkRef`, task assignment/schedule lineage, and stable working directory. The chat record uses its accepted chat ID; a task uses its real attempt and captured task context. A delegated helper is accepted under the helper's own profile and Tool mode, with the helper attempt as owner and the parent's active assignment/scope as an additional live constraint. Existing restrictions are not widened: for example, current helpers cannot use scratch, search or web and receive no automatic memory recall (`src/instance.ts:372-373,407-408,437-438`; `src/instance-service.ts:250`). New capabilities must explicitly apply equivalent helper/task eligibility; do not infer that a helper gets broad host or shared memory access solely from its mode. Keep the existing clock delegation checks and disclosure rules.

Ordinary name, instructions, provider, model or Tool mode edits affect newly accepted work only. Do not compare a current whole-profile revision with the accepted revision at dispatch. At each effect boundary check active work/attempt, Stop and pending task control, active assignment and parent, archived/deleted agent, schedule scope and revocation, existing instance/agent/task permission and approval/grant state, and capability-specific resource versions/endpoints. An invalid later config blocks new acceptance according to the existing configuration contract; it does not itself retarget or revoke accepted work. Actual permission revocation or archive does block it. Approval waits are interruptible and recheck those live conditions immediately before starting. Updates after an effect has started trigger the capability's defined cancellation/observation path, not a claim the effect never occurred.

The working folder is `<stable agent directory>/work`, a sibling of `current` and `revisions`, never inside the published revision pointer (`src/agent-config.ts:163-165,224-245`). Capture the stable absolute path on acceptance; lazily create it without deleting existing contents. Relative file and terminal paths resolve there; explicit absolute host paths follow the service account's OS permissions. It is a default location, not a sandbox or path allowlist. The same agent folder is shared across its accepted works, so file operations use feature-owned preconditions and report conflicts; terminal effects cannot be serialized into filesystem transactions. Working files survive config saves and restart.

## Terminal: native processes, not the Docker scratch shell

```ts
type ProcessRef = Readonly<{id: ProcessId}>; // opaque service-issued handle
type ProcessState =
  | {kind: 'starting'} | {kind: 'running'; retained: boolean}
  | {kind: 'exited'; code: number | null; signal: string | null}
  | {kind: 'interrupted'; observation: string}
  | {kind: 'unknown'; observation: string};
type StartTerminal = {
  command: string; cwd?: AbsoluteOrRelativePath;
  io: 'pipes' | 'pty'; lifetime: 'foreground' | 'retained';
};
interface TerminalProcesses {
  start(input: StartTerminal, execution: ActionExecution): Promise<ProcessRef>;
  read(ref: ProcessRef, cursor: OutputCursor | null, maxBytes: number): Promise<OutputPage>;
  write(ref: ProcessRef, bytes: Uint8Array, operation: ActionExecution): Promise<WriteObservation>;
  stop(ref: ProcessRef, operation: ActionExecution): Promise<ProcessState>;
  inspect(ref: ProcessRef): Promise<ProcessState>;
}
```

`terminal_start` starts the service account's ordinary host shell and inherits the service-appropriate environment; no command allowlist, mandatory container, or fake terminal. Pipe mode uses actual stdin/stdout/stderr with separately tagged streams and exit/signal; PTY mode allocates a real pseudoterminal, attaches a controlling terminal and combines its output as a PTY does. Provide interactive input and terminal dimensions for PTY and input/EOF for pipes. Do not claim separate stderr for a PTY. Platform-dependent PTY packaging must be tested and unsupported platforms must return actionable errors, not silently switch semantics.

Before spawn, persist action and process handle, originating `WorkRef`, agent, cwd, mode, retention and starting state. After spawn record observed PID/process group and state; never treat PID alone as durable identity after restart or signal a reused PID. Foreground start waits for exit or returns a handle with `running` at a bounded observation deadline; this deadline does not itself kill a retained process. `retained` transfers lifetime to the instance process manager, not the guest/turn. A later authorized accepted work or paired client can inspect, read, input and explicitly stop by handle after ownership/authority checks; originating work attribution remains immutable. A paired client Stop is a shared service operation, not tab-local state. A per-process actor serializes writes, output cursor allocation and stop to order interaction; distinct processes do not share a lock. Backpressure and bounded per-process byte buffers/spooling, process-count and handle quotas are explicit; pages report cursor, stream, dropped/truncated bytes and whether more may arrive. Hitting an output buffer limit must not silently kill a retained process. Inputs are bounded, ordered, and given their own action identities because retrying input can duplicate an effect.

A request/guest cancellation cancels pending calls and non-retained foreground children started by that request; once a retained start has been durably acknowledged, guest completion, normal provider completion and local request cancellation do not implicitly kill it. Work Stop prevents new actions, cancels queued starts and stops active non-retained foreground processes; retained processes remain separately addressable and must be explicitly stopped. Surface this distinction on Stop. A racing retain/Stop is decided atomically at start/retention acknowledgement: before acknowledgement it is stopped; after acknowledgement it is retained and reported. Explicit process Stop sends a graceful signal to the verified process group, waits a bounded interval and escalates if configured, recording observed exit or unknown; do not say stopped merely because a signal was sent. Group handling cannot guarantee termination of independently daemonized descendants; report that limitation.

On orderly instance shutdown request termination of owned process groups, close streams and persist only observations actually obtained; a service crash may leave descendants alive. On restart do not spawn, replay, trust a PID, or claim a vanished process exited successfully. Mark starting/running handles interrupted/unknown unless a separately verifiable durable supervisor identity and terminal observation exist. Expose records and observations for owner inspection/reconciliation; no current durable supervisor is assumed. Files and external side effects may have occurred even when termination is observed. Reconcile before a potentially repeating operation. This design does not claim daemonized descendants are under control after a crash.

## Files and memory

File read/search return bounded pages with explicit byte/result limits, cursor or continuation, encoding/error information and truncation; inspect paths, missing files and permission errors honestly. Write/create/edit return the actual outcome. Edit requires a specific expected version/content or unambiguous match and fails on mismatch; atomic replacement where supported and action journaling protect local changes, but never claim shell/file operations form one transaction. Binary and unsupported encodings have explicit errors or byte interfaces. Host terminal and file tools operate on the same filesystem. No PR #72 document/artifact adapters, session model or storage.

Memory capabilities call the existing `MemoryStore`, not another database. Search/read return IDs, scope and versions; the `agent` scope resolves only to `executingAgent`, never a model-supplied other agent. User/shared is explicit. Agent remember creates an item; update and forget use `(scope, id, version)` and return conflicts on stale or wrong-scope input. For shared remember, create the existing agent-bound pending proposal and expose its exact text, ID and all-agent visibility; only the owner's existing confirmation path activates it. Tool output is `proposal pending`, not `saved`; a model cannot confirm its own proposal. Preserve the existing shared edit/delete owner-interface semantics and optimistic versions, without imposing a new confirmation rule or silently bypassing current confirmation. Shared model changes must use the same service policy and precise scope; expose no implicit cross-agent agent memory. Make proposal creation/confirmation idempotent and transactionally tie memory mutation, journal result and proposal state where the existing SQLite connection permits it. Current exact proposal/confirmation and scoped update/delete behavior is in `src/instance.ts:1000-1027`; storage semantics are `src/memory.ts:43-90`. Do not add compaction, background harvesting, or another memory backend.

## Limits, visibility and privacy

Apply a single per-work admission budget to underlying calls regardless of route; charge each newly started action once and not a replayed receipt. Track source bytes, invocation/child counts, guest CPU/heap/stack, pending calls, script output, cache and active work separately from native process count, duration, buffers, output and I/O. Explicitly report which bound was reached and whether output is incomplete. The experiment's `src/code-mode/protocol.ts:4-10` defaults (e.g. 32 KiB source and 256 KiB output) are starting evidence, not selected production ceilings or proof of total process memory. Guest limits do not impose a terminal process lifetime. No automatic truncation/compaction of conversation or private provider replay.

Check source byte size and privacy/redaction *before* execution: if it cannot be retained faithfully and safely, reject it, never execute a rewritten source. Persist exact accepted source and appropriate selected results in existing safe visibility controls; redact secrets and URLs according to existing policy, reject unsafe-to-retain source rather than silently altering it. Avoid storing all intermediate reads: request-scoped bounded cache/receipts expire at the accepted work boundary. Persist action IDs, metadata, safe results and explicit source references needed for inspection and recovery, with bounded output pages. UI shows understandable start/progress/result/approval/Stop inline, with expandable code and details; CLI/API observe the same service records. Handle UI keyboard, narrow viewport and appearance in implementation, not as a separate state authority.

## Module map and integration sequence

- `src/runtime.ts`: retain one `runTurn`; receive `WorkActions`, derive provider offer and pass normalized provider calls to it. Preserve history, streaming, replay, usage, selected skills and save. No branch-specific code-only provider loop.
- `src/actions/registry.ts` and capability modules: one registration with schemas, bindings, policy boundary, overlap, effect and reconciliation. Existing clock/web/search/scratch/skills move their actual execution behind these registrations; terminal/file/memory add peers. Do not leave a legacy bypass after migrating callers.
- `src/actions/work.ts` and journal/storage under the instance: accepted work binding, per-work coordinator, durable invocation aliases, action records, recovery epoch, budgets, fences and live checks; reuse/extend actual `ActionJournal` and its `WorkRef` union. Exactly one writer owns each state and `start` remains atomic with live policy. Domain capability modules own resource-specific preconditions and reconcile logic.
- `src/code-mode/host.ts`, worker/protocol: QuickJS orchestration and bounded bridge only; delegate child calls to the same `WorkActions.invoke`. Code tool itself does not register as a child capability. Store task and command events against their actual `WorkRef`, preserving existing historical experiment records/names as read-only legacy history.
- `src/terminal/` (or equivalent owned module): instance-owned native process manager, handles, output and restart records; action capability invokes it. Client API and CLI/GUI use the same inspect/stop operations. OS process calls live here, not in QuickJS.
- `src/memory.ts`, `src/instance.ts`, `src/instance-service.ts`, config/settings: retain existing owner operations and durable state, extend shared operations rather than adding another store. Direct config editing, creation defaults and revision conflicts remain authoritative.

**PR #75 strategy:** Treat its open `2da3b8fb` head as a separately reviewed experimental foundation, not as already merged. After this checkpoint is approved, start the single feature integration branch from then-current main, semantically integrate the reviewed PR #75 worker/executor, protocol and tests at that exact known head (merge that PR first only if separately approved/merged; otherwise port the relevant commits into the integration branch with attribution). Resolve against current main by retaining both existing behaviors, never wholesale selecting a conflicted app file. Replace its command-only contract/store/approval IDs with real `WorkRef`; replace its one-owner-per-code-work and broad profile-revision fence with shared work admission and live checks; replace `changeKey` uniqueness with capability-owned recovery as above. Migrate the synthetic-only `execute_code` production exposure to `code_mode`, while preserving historic records. Adapt the experiment host to call the registry rather than copying its action path beside direct tools. Run its real-worker tests and add task, cross-style and native-process tests after migration. Do not merge or import PR #72. Owner review of this strategy and final design is required before production implementation; the strategy does not itself approve a PR merge.

## Grounding: current behavior and constraints

- Staf owns conversations and tool dispatch; its existing provider registry normalizes capabilities (`docs/decisions.md:3-22`). `runTurn` currently constructs tools and dispatches branches (`src/runtime.ts:40-87,135-200`), and both actual task and chat paths call it (`src/instance-service.ts:250,621`). The experiment's separate synthetic loop is not the production lifecycle.
- `src/action-journal.ts:4-21,55-99,115-119` already models command **or** task, stores prepared/started/outcome states, uses one-shot start permits and recovers started effects as uncertain. Extend it; do not fabricate a command ID for tasks.
- `src/instance.ts:600-643,950-998` captures task profiles/context and command profiles; same-ID submissions are fingerprint checked. `src/instance.ts:702-724` accepts helper attempts under the helper. ADRs `docs/adr/0002-copy-bot-creation-defaults.md:3-9` and `docs/adr/0003-editable-agent-configuration.md:15-24,29-36` require captured settings and live revocation, and editable config.
- Current scratch shell is Docker-backed (`src/shell-sandbox.ts:6-20,42-64,98-100`), bounded and independently restricted. It is an existing capability, not the requested normal host terminal. Existing scheduled and helper restrictions matter (`src/instance.ts:267-282,372-373,407-408,437-438`).
- In the experiment, `src/code-mode/contract.ts:3-24` is command/chat-specific; `src/code-mode/store.ts:24-36,43-67,73-103` stores command events, fences uncertain changes and blocks matching completed changes; `src/code-mode/host.ts:85-97,141-168,187-219` records safe source, assigns fresh child IDs, computes a content-based change key, approves and starts child effects. `src/instance.ts:493-507` fences on any profile revision change. Those references in this bullet are to `/Users/lancewilhelm/projects/Staf-code-mode-experiment` at `2da3b8fb`, not this baseline.
- The approved simple-chat decision defers a separate background workflow while preserving existing infrastructure (`docs/decisions.md:231-245`); #78 explicitly requires modes for existing background execution. This does not revive a separate Activity workflow or implement temporary sub-agents.

## Rationale and tradeoffs

**Problem.** Both model calling styles must share real service behavior while task ownership, captured settings, live restrictions and real external effects remain distinguishable. The existing journal has the right work union but the experiment's host treats content equality as completed identity and assumes chat plus a whole-profile revision.

**Why this shape.** Capabilities own meaning; the work coordinator owns admission, budgets, durable lineage, cancellation and the one common policy/start path. This gives callers one deep `offer`/`invoke` surface, prevents a second tool behavior from growing in the guest, and keeps resource versions and overlap knowledge with the only code able to interpret them. It separates per-work and per-process concurrency before introducing locks, while serializing the shared state that is actually invariant. Explicit `resume`/`repeat` makes a recovery decision reviewable and allows ordinary identical commands without pretending command strings encode intent.

**Tradeoffs accepted.** We accept explicit recovery metadata and occasional clarification in exchange for avoiding silent replay; per-capability reconciliation and overlap rules in exchange for avoiding a generic false guarantee; and a small process-manager dependency in exchange for real interactive terminals. We accept that general native commands cannot be proven exactly once, cannot be fully reconciled by Staf alone, and may daemonize outside a process group. We accept an owner-visible unknown state rather than inventing success, failure or a safe replay. A recovery index is conservative and may ask for a repeat decision where none was needed; it is not a permanent deduplication key.

**Alternative considered.** A single global action gateway owning every capability's content key, policy and effect is superficially simpler but exposes every resource's revision and recovery rules to a central module; a new capability requires edits to that gateway and all route-specific cases. A second alternative, independent provider and QuickJS executors that happen to share low-level functions, exposes orchestration/approval/identity to both callers and permits behavior drift. This candidate hides the common lifecycle behind work admission while keeping operation semantics with the capability.

**Synthesis decision.** Pending comparison with the other whole-shape candidate; no synthesis or owner approval is asserted here.

**Open risks for checkpoint.** Can the explicit recovery intent be conveyed reliably across every supported provider's tool schemas and the QuickJS bridge without letting a provider-generated ID stand in for intent? Which PTY package and platform support meet the distribution requirements, and what bounded process/output quotas are acceptable without unexpectedly ending useful commands? How will a paired client present uncertain orphaned native processes and a deliberate residual-risk decision without implying verification? Which existing helper restrictions apply to each new terminal/file/memory capability under current task scope? Resolve these as implementation details within #78's fixed product scope and do not broaden helper authority by default.

**Next implementation step after approval.** Build the work-bound registry and durable intent/receipt contract against the existing journal, then migrate one existing capability through both routes before adding native terminal operations.

## Verification plan (not executed by this design)

Use a disposable real Staf instance and paired API with controlled provider responses, the real QuickJS worker, actual local shell/PTY/pipes, filesystem, memory service and SQLite; clean up all test processes and files. Verify all three offer sets and dispatch rejection; chat/task/helper capture under concurrent ordinary config edits and separate live revocation; same accepted-ID retries; common approval and journal receipt across direct/code; completed action -> script error -> resume without effect -> explicit identical repeat with a second effect; and uncertain spawn/input -> restart -> inspect/reconcile with no automatic replay. Exercise PTY input, pipe stdout/stderr, retained process after guest return, cross-client inspect/Stop, output bounds, and crash/shutdown paths. Verify scoped memory proposals, confirmation, stale versions and shared deletion semantics, plus file preconditions and stable working files. Run required full checks, GUI/CLI journeys and distribution checks when implementing; report synthetic provider, local native execution, Docker, remote, and live provider evidence separately. No authentication, billable inference or Docker is authorized solely to validate the design.
