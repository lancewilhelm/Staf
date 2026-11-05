# Candidate: accepted-work action gateway and instance process manager

Status: **independent design candidate**, not an approved architecture or implemented behavior. It addresses [#79](https://github.com/lancewilhelm/Staf/issues/79) under the product scope in [#78](https://github.com/lancewilhelm/Staf/issues/78). No dependency on PR #72. Evidence below is at integration `2886e7b1cb2ec0d784fb131209794606b8fbe0ec` unless explicitly marked `experiment@2da3b8fb`.

## Usage first

Each accepted chat command or task attempt gets exactly one service-owned gateway. `runTurn` retains the ordinary provider conversation lifecycle and asks the gateway for the current offers and to dispatch calls. It never constructs an action journal, approves an action, or owns a terminal process. The gateway is bound by the service to the **actual** accepted work, its executing agent, captured conversation and mode. A helper gets its own gateway, with its own accepted profile and inherited live task/assignment restrictions.

```ts
// instance-service.ts: both chat and task use this same path.
const gateway = instance.openActions(acceptedWork, controller.signal);
await runTurn({ ...existingTurn, actions: gateway });

// runtime.ts: in the existing history, streaming, replay and usage loop.
const offered = actions.offers(provider.capabilities);
const response = await providerTurn(messages, offered);
for (const call of response.toolCalls) {
  // Receives an internal validated provider-call identity, not a raw wire type.
  const result = await actions.dispatch(call);
  appendToolResultAndActivity(call, result);
}

// A code_mode provider call runs a fresh guest. Its capability calls enter the
// very same gateway, with an execution-local call identity and repeat intent.
// Illustrative model-generated code, no ambient service or Node access:
const start = await tools.terminal_start({
  command: 'node server.js', io: { kind: 'pipes' }, lifetime: 'retained'
});
const page = await tools.terminal_read({ process: start.process, cursor: start.cursor });
await staf.emit({ process: start.process, page });
return { process: start.process };

// A later accepted turn by the same agent can inspect or interact, subject to
// current authority; another paired owner client may observe or explicitly stop.
await tools.terminal_input({ process: handle, text: 'status\n' });
await tools.terminal_stop({ process: handle });

// Direct or script call after a failed script: the same command may have run.
// Gateway returns a prior action and a repeat challenge, never silently runs it.
// If the agent deliberately intends a SECOND execution, it reissues using the
// challenge and references that prior action; otherwise it uses the recorded result.
await tools.terminal_start({ command: 'npm test', io: { kind: 'pipes' }, lifetime: 'foreground',
  repeat: { priorAction: priorId, challenge: token, intent: 'run-again' } });
```

`Direct` offers eligible individual capabilities; `Hybrid` offers them and `code_mode`; `Code Mode` offers only `code_mode`. The guest catalog contains the same eligible capability definitions, never `code_mode` itself. Offers are derived from one registration and the captured mode; dispatch rejects an unoffered provider name even if a model fabricates it. Eligibility and authority can narrow live. A provider without tool support can still return ordinary text where its current adapter supports it; it gets a clear failure if tools are required. Never silently change mode, provider, or model.

## Shape and types

This is a contract sketch, not production TypeScript. Brands and parsing are illustrative. The only public service interface used by the provider loop is `WorkActions`; the guest bridge translates its own local protocol into that same interface. Framework, SQLite and worker wire types remain private.

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name };
type ActionId = Brand<string, 'ActionId'>;
type ProcessId = Brand<string, 'ProcessId'>;
type Challenge = Brand<string, 'RepeatChallenge'>;
type ToolMode = 'direct' | 'hybrid' | 'code';
// Reuse the actual src/action-journal.ts WorkRef: task ID means attempt ID.
type WorkRef = { kind: 'command'; id: string } | { kind: 'task'; id: string };

type AcceptedWork = Readonly<{
  work: WorkRef;
  executingAgentId: string;
  conversation: { kind: 'main'; chatId: string } |
                { kind: 'task'; attemptId: string; capturedChatId: string };
  profile: Readonly<{ mode: ToolMode; provider: string; model: string | null;
    reasoning: string | null; instructions: string }>;
  workingDirectory: string; // stable <agent config directory>/work, outside revisions
}>;

type InvocationRef =
  | { kind: 'provider'; responseId: string; callId: string }
  | { kind: 'guest'; executionId: string; sequence: number };
type RepeatIntent = { priorAction: ActionId; challenge: Challenge; intent: 'run-again' };
type DomainCall = Readonly<{ invocation: InvocationRef; name: string; input: unknown;
  repeat?: RepeatIntent }>;
type Outcome =
  | { kind: 'completed'; action: ActionId; value: unknown }
  | { kind: 'failed'; action?: ActionId; error: string }
  | { kind: 'repeat-decision'; prior: ActionId; result: unknown; challenge: Challenge }
  | { kind: 'uncertain'; action: ActionId; explanation: string }
  | { kind: 'stopped' | 'denied' | 'expired' | 'restricted' | 'exhausted'; explanation: string };

interface WorkActions {
  offers(provider: ProviderCapabilities): readonly ToolDefinition[];
  dispatch(call: DomainCall): Promise<Outcome>;
  // Activity/history inspection is service-owned and work-scoped, not replay of
  // another conversation. Source and selected results are inspectable.
  inspect(): WorkActionView;
}
interface Instance {
  openActions(work: WorkRef, signal: AbortSignal): WorkActions; // not implemented
}

// One private registry defines schemas, model descriptions, effect/resource
// binding, operation preconditions, and an implementation for each capability.
interface Capability<I, O> {
  name: string;
  parse(input: unknown): I;
  describe(input: I, work: AcceptedWork): ActionDescription;
  invoke(input: I, context: ActionContext): Promise<O>;
}
// `code_mode` is a provider entry point that uses this registry; it is not a
// registry capability and has no second underlying permission/approval path.
```

The gateway owns the private journal, invocation mapping, offer enforcement, bounded work accounting, policy/approval gate, action state and recovery, and calls feature-owned implementations. Its surface hides those mechanisms; capability authors supply only validated semantics and operation, not their own alternate provider-facing dispatcher. `ActionContext` is constructed internally after admission and carries accepted agent/work, validated resource, process manager access, and cancellation. Neither guest nor model can supply agent identity, authority, an action ID, or a work reference.

### Identity and recovery protocol

There are four distinct identities:

1. **Accepted work** is `(kind, id)` from the existing `WorkRef`; a command's ID is not the task ID. Exact-ID submission retries return the persisted original profile, captured conversation and outcome. Changed submission payload for the same ID conflicts. A newly accepted task retry is a new attempt, with its existing predecessor lineage, not a replay of the old attempt.
2. **Invocation** is a service-namespaced provider-response/call identity, or a guest execution/sequence. Persist the mapping before dispatch, with a keyed canonical digest of validated name, input, resource and accepted work. Same invocation and digest returns/awaits the original outcome; same invocation with different content is a conflict. Never derive idempotency from provider call ID alone, which can change on a model retry.
3. **Logical action** has a service-generated stable `ActionId`, work, operation fingerprint, authorization/decision, state and selected result. Both routes bind to this one record. A `code_mode` execution record links to its children but is not a second approval of the child. Capability-owned revision/operation preconditions remain authoritative; action identity does not replace them.
4. **Process** has an opaque, unguessable `ProcessId` owned by the service, its agent and originating action/work. It is distinct from guest, shell PID, provider call and accepted work lifetime.

A durable recovery epoch starts whenever a script/turn ends abnormally after a possible or completed changing action, or a provider response is retried without a trustworthy continuation. Persist a per-work recovery barrier and an ordered summary of completed, failed and uncertain effects. The next model-visible response contains this summary, with safe prior action IDs and results; it is not implicit replay from another conversation. In that epoch, a proposed equivalent completed change, even with a new call ID, execution, or direct/code route, returns `repeat-decision`, not an effect. Equivalence is the capability's keyed canonical operation/resource fingerprint, including meaningful inputs and preconditions, **not command text alone as identity**. Check all equivalent prior completed actions since the epoch began; the challenge binds the current work, complete action fingerprint, relevant prior action set and epoch. An atomic single-use challenge consumption creates a *new* action only when `intent: 'run-again'` explicitly references the prior record. A fresh challenge is required if the prior set changes. The record contains the repeat linkage and decision. A normal uninterrupted sequence can intentionally issue the same command twice as two distinct invocations without treating text as an identity. During recovery, even that intentional repeat must explicitly acknowledge the matching prior result. This is an explicit model declaration, not proof of human intent; it cannot guarantee semantic deduplication of differently worded shell commands.

For a started effect with unknown outcome, return `uncertain`, retain its record, and fence further **changing** actions for the accepted work across both styles, including new scripts and queued calls; allow bounded, authorized inspection/read-only actions to reconcile. No challenge or model assertion clears uncertainty. A capability can clear it only through an authoritative, recorded reconciliation result (for example, a versioned local transaction proves it committed or did not commit); otherwise an owner-visible review resolves it with evidence and explicit disposition. A verified committed result amends the same action; a verified not-applied result permits a deliberately new action after all live checks; unresolved external effects remain uncertain. In a new task attempt, expose the predecessor's unresolved effects and carry the barrier until reviewed, so a fresh attempt ID is not a bypass. An unrelated later owner command is new work; surface relevant retained process/uncertainty records when explicitly inspected, without importing arbitrary previous conversation history. Never automatically rerun an action or promise exactly-once external effects.

Admission is transactional at the service boundary: validate, bind resource, persist/resolve invocation, evaluate active work and shared terminal fence, await the one applicable approval outside the DB transaction, then atomically recheck live policy, feature preconditions, budget, work state and claim the one-use journal start permit. Only then invoke. A denial, Stop, expiration, blocked policy or shared budget exhaustion fences queued and later calls in that work regardless of route. Cancellation after dispatch is not proof of no effect. Completed, definite pre-start failure, interrupted and uncertain results remain distinct. Parallel reads are bounded; changing actions serialize per work, including simultaneous direct/guest requests; all share budget and gate. Existing `ActionJournal` is the starting point, not a public second store: `src/action-journal.ts:20-32,55-99,115-118` already has true work union, prepare/start permit and restart uncertainty. Extend its schema/owner transaction as needed for logical invocation mapping, repeat challenges, durable fences and action metadata; preserve existing journaled actions and grants. Prepared-but-unstarted records may be cancelled on crash; started external effects become uncertain after exclusive recovery. A late result can amend uncertainty only with evidence from the same actual execution, and never reopen fenced work automatically.

### Accepted state versus live authority

On first acceptance, atomically capture the executing agent ID, correct conversation binding, profile and mode, working-folder path and task attempt/assignment context with the command/attempt. Existing absent mode in configuration **or old captured profile** means Direct; a newly created agent receives a copied explicit Hybrid default; explicit saved choice wins. Reject invalid explicit modes; keep config revision conflicts and direct-edit validation. Retry of the exact submission reads its original captured values, not current UI selection. A later settings, name, instructions, provider/model or mode edit affects newly accepted work, not existing work. `work/` sits beneath the stable agent directory beside configuration, never within a versioned publication directory; normal config publishing and restart must not remove it. It is a default cwd, not a confinement root: absolute/relative host paths are subject to service-account OS access.

Before offer, before approval, immediately before effect in the service-owned transaction, and before releasing sensitive result, re-evaluate active command/attempt state, Stop/cancellation, current instance/agent/task permissions, schedule scope and revocation, active helper assignment and its parent task/authority, resource preconditions, and operation-specific rules. Re-evaluate after approval waits. A client selection or profile revision is not authority. Existing helper restrictions remain: the current code blocks helper web/search/scratch and withholds memory recall; do not enable them accidentally by putting them behind `code_mode`. New capabilities default unavailable to helpers until an existing applicable task/assignment authorization actually permits them; don't invent a new permission policy here. A denied underlying action closes admission across styles; no second code wrapper approval and no re-offer workaround. Feature-owned changes such as a memory version or scratch sandbox revision still require their own preconditions.

### Native processes: real lifecycle, ownership and accounting

`ProcessManager` belongs to the instance, not the guest. Terminal start runs the configured ordinary host shell with a command and accepted default cwd/environment of the service account; no Docker, command allowlist or asserted sandbox. Keep the existing Docker scratch shell as a distinct existing capability with its own restrictions. Proposed domain operations:

```ts
type ProcessIO = { kind: 'pipes' } | { kind: 'pty'; columns: number; rows: number };
type Lifetime = 'foreground' | 'retained';
type ProcessView = { id: ProcessId; ownerAgentId: string; origin: WorkRef;
  state: 'starting' | 'running' | 'exited' | 'stopping' | 'interrupted' | 'unknown';
  exit?: { code: number | null; signal: string | null }; output: OutputPage };
type OutputPage = { chunks: readonly { stream: 'stdout' | 'stderr' | 'terminal'; text: string }[];
  cursor: string; truncated: boolean; lostBeforeCursor: boolean };
interface ProcessManager { // private to the instance/gateway; each method checks ownership and live authority
  start(input: { command: string; cwd: string; io: ProcessIO; lifetime: Lifetime }, ctx: ActionContext): Promise<ProcessView>;
  read(id: ProcessId, cursor: string | null, maxBytes: number, ctx: ActionContext): Promise<ProcessView>;
  input(id: ProcessId, text: string, ctx: ActionContext): Promise<ProcessView>;
  resize(id: ProcessId, columns: number, rows: number, ctx: ActionContext): Promise<void>;
  stop(id: ProcessId, ctx: OwnerOrActionContext): Promise<ProcessView>;
}
```

Pipes use actual separate stdin/stdout/stderr pipes, preserve stream labels, drain both concurrently and apply backpressure; they cannot impersonate a TTY. PTY starts a real OS pseudoterminal via a maintained native dependency with packaging and platform checks, uses its combined terminal stream, and supports input and resize; terminal output cannot honestly be split into stderr/stdout. Foreground start waits for exit or an explicit bounded observation window and returns a still-running handle if the window ends; it does not kill or pretend the command finished. Retained start returns a handle as soon as launch is observed. Guest completion closes guest RPC and temporary guest data, **not** a successfully retained process. Admission, launch, handle association and resulting state are journaled; a crash between spawn and durable observation is uncertain, not a reason to spawn again.

Owner Stop on an active work cancels provider/guest, pending approvals and queued actions, and requests termination of foreground processes launched by that work. It does not silently kill a process explicitly retained before Stop: the UI shows it and provides separate process Stop; if retention was not yet durably established, request termination and report the actual/uncertain result. Explicit process Stop is available from authenticated paired clients and subsequent authorized work of the owning agent; a handle is never sufficient authorization, and other agents cannot interact by guessing it. Stop sends a graceful termination to the owned process group/session, waits a bounded grace period, escalates where supported, and reports `stopping` until exit is actually observed; shell descendants may escape process groups and are not claimed terminated without observation. Work cancellation while launch/input/stop is in flight records observed completion or uncertainty, not fictitious rollback. Permission revocation blocks further input/read as applicable and requests Stop for in-flight non-retained work; stopping already-retained processes is an explicit owner action unless existing policy requires otherwise. Authentication revocation drops that client's access, not instance-owned work.

Track per-instance/agent process slots, launch and input rates, live output buffering, cursors, and maximum retained output independently of QuickJS heap, source, guest CPU and host RPC quotas. Output is a bounded byte-aware ring/spool: keep draining to prevent deadlock, identify dropped ranges and cursor expiration, report bounds and support deliberate subsequent reads of still-retained data. No implicit unlimited disk spool. Long-running processes consume a visible slot until actual exit or control is lost; output limits do not kill them merely because a guest returns. Any admission capacity or timeout must be visible and documented, not mislabeled a total host-process memory limit. Users may choose PTY or pipes based on required behavior.

On orderly shutdown request stop for service-controlled process groups, persist observations; do not wait forever. On crash/restart no command is replayed, no PID alone is trusted as a process identity, and no signal is sent to a potentially recycled PID. Without a separately designed durable supervisor/verified OS process identity, mark previously running or stopping handles `unknown`/interrupted with last observed output and launch identity; do not assert the process exited, do not attach or allow writes based only on stored PID. A process may still exist outside service control, including escaped children; provide evidence and manual inspection rather than a false stop claim. Subsequent Stop for an unverified handle reports control unavailable. Platform support and PTY dependency must be checked in packaged distributions, with explicit unsupported errors rather than silently substituting pipes.

### Files and retained memory

File read/write/edit/search use the same host account and cwd as terminal, explicit paths, validated offsets, and actual errors. Reads/search return bounded pages with byte/line range, completeness and continuation where meaningful; edits require an explicit expected content digest or feature-owned revision and fail on mismatch, preventing stale rewrites. Writes and edits must record effects and use safe same-filesystem atomic replacement when semantics allow; external modifications and non-atomic failures can be uncertain. Do not claim filesystem confinement or silently truncate results.

Memory capabilities invoke the existing `MemoryStore`, not a new backend (`src/memory-types.ts:1-2`, `src/memory.ts:43-78`). Scope input is `agent` (bound internally to `executingAgentId`) or `user`; never accept another agent ID. Search/read return IDs, scope and versions; update/forget require exact ID, scope and observed version, and propagate conflicts. Agent remembers create in that agent's scope. Shared user **creation** makes a durable exact-text proposal bound to the executing agent, visible to the owner; only the existing owner confirmation/cancellation flow commits or removes it, idempotently, including after restart (`src/instance.ts:1000-1016`, `docs/usage.md:473-477`). The model cannot self-confirm a shared proposal. Shared edits/deletes retain current exact scope, ID and version semantics and applicable approval; do not silently impose creation confirmation on them or remove existing confirmations. Store mutation and journal outcome should commit together where the shared SQLite transaction permits, or record uncertainty and reconcile by operation ID; never claim durable success before commit. Deletion removes active memory and future retrieval, not prior chat, backups or provider input. Helper access remains restricted until specifically permitted through existing authority, including shared scope.

### Source, output and conversations

Persist exact executable source before launching, only if size/encoding and privacy/redaction checks permit faithful retention; reject altered source, do not run a redacted substitute. Maintain source and action detail as inspectable collapsed records, routine progress and meaningful failures as ordinary activity. Redact selected outputs under existing rules; account for byte limits and expose truncation/cursors rather than imply completeness. Intermediate read receipts are bounded, scoped to this accepted work, and discarded when it ends; they are not a cross-conversation cache. Preserve full existing conversation, private provider replay, streaming, skill invalidation, usage and memory recall; result bounds never authorize history truncation, compaction or hidden replay. QuickJS runs fresh with no ambient Node/service access; explicit guest/host RPC, correction, source, output, parallelism, time and memory budgets apply across all scripts in the work. Experiment defaults (`experiment@2da3b8fb:src/code-mode/protocol.ts:4-10`) are starting evidence to measure, not production capacity or proof of an overall OS memory ceiling.

## Integration and module map

**Proposed integration strategy:** start at current integration main and selectively port the independently useful PR #75 worker/protocol, QuickJS executor, validation, bounded temporary receipts, action/approval tests and source-retention mechanics from `2da3b8fb`; integrate them into the same feature branch with explicit conflict review. Preserve experiment history and old `execute_code` names/outcomes as historical records, but expose production tool only as `code_mode`. Do not merge the whole experiment unchanged: its `turn.ts` is a separate experimental provider loop, its store writes command-only events, its host hardcodes command `WorkRef`, its fingerprint guard forbids legitimate repeated commands, and its `Instance.codeModeStore` rejects any profile revision change. Replace these with the work-scoped gateway, journal and live checks above. Port the approved useful pieces, retire the experiment-only branch in the production execution path, and retain or migrate old records without renaming past events. Resolve dependencies, worker packaging and migration against current main; avoid PR #72 files, contracts and data model entirely. Preserve unrelated current-main changes instead of wholesale selecting either side.

| Owner / proposed file | Responsibility |
| --- | --- |
| `src/runtime.ts` | One provider lifecycle; ask gateway for offers and dispatch; retain history, events, usage, replay and task behavior. |
| `src/instance.ts`, `src/instance-service.ts` | Accept/capture real command or task context, open gateway, owner client observation/Stop, authorization and transaction ownership. |
| `src/actions/` (private gateway, registry and journal) | One capability registration, admission, identities, approval, work fence, safe retention, recovery, event views and adapters for existing capability implementations. Extend or move `src/action-journal.ts`; do not leave two journal writers. |
| `src/code-mode/` | Supervised QuickJS guest, protocol and direct bridge to gateway; guest-specific budgets and temporary receipts, no separate policy, journal or provider loop. |
| `src/process-manager.ts` | Instance-owned native process lifecycle, handle ownership, PTY/pipes and output buffering; journal effects via gateway. |
| `src/memory.ts`, file capability module | Existing scoped store and feature operations; no bypass of gateway for model-initiated work. Existing owner interfaces retain their semantics. |
| Configuration, clients and docs | Agent mode across settings/API/CLI, stable work directory and action/process views; configuration validation/defaults and shared service are authoritative. |

Current grounding: `src/runtime.ts:40-80,95-140,158-235` owns normal turn history, tool offers, replay/usage, dispatch and failure behavior. Both task and command service paths already call it (`src/instance-service.ts:250,621`). `src/instance.ts:608-640,948-980` persists task and command accepted profiles; helper acceptance binds the helper's own agent (`src/instance.ts:708-723`), while task context differs from main chat (`src/instance.ts:635,816-820,898`). Helper and schedule authorization are real live restrictions (`src/instance.ts:267-282,400-408,437-441`). Existing scratch uses configured Docker, exact action and approval, not native terminal (`src/instance-service.ts:88-105`, `src/runtime.ts:80-83,170-172`). ADRs 0001–0003 and `docs/decisions.md:231-250,315-342` establish instance-owned work, copied defaults, captured settings and direct-editable configuration; issue #78 explicitly requires mode behavior for already-existing background tasks, without restoring their deferred UI workflow.

Experiment grounding: `experiment@2da3b8fb:src/code-mode/turn.ts:8-25` declares a separate experimental loop and `execute_code`; `src/instance-service.ts:630-645` switches to it. `src/code-mode/host.ts:83-97,150-168,187-219` validates exact source, creates new child IDs, derives a change key and hardcodes command work; `src/code-mode/store.ts:20-36,43-68,95-103` stores command-only events and blocks matching completed changes; `src/instance.ts:493-506` compares the full profile revision. `src/code-mode/executor.ts:30-39,72-77` controls the guest worker, not a durable host terminal. `docs/adr/0005-service-owned-code-mode.md:3-56` revises the earlier experiment scope; that ADR is evidence from the unmerged experiment, not a current-main implementation claim.

## Rationale, alternatives and risks

The shared-instance contract and recorded scope require captured work identity but live revocation, one action/approval path, and independently managed terminal processes. A deep gateway gives the turn loop only offers, dispatch and inspection while centralizing identity, authority and recovery. The private process manager concentrates process lifecycle rather than leaking PTY/PID handling into either calling style. This is intentionally one candidate; synthesis and owner approval remain for the coordinator.

Alternative: each capability owns its own direct and scripted adapters and action logs. This hides local execution but exposes approval, recovery, identity and work fencing to every feature and makes bypasses likely. Alternative: make the QuickJS host the only action owner and translate every direct call into a script. This hides a dispatcher but forces simple direct work through guest lifecycle and makes real processes and retries depend on an interpreter. Neither supplies a smaller reliable interface across chat, tasks and direct calls.

Accepted tradeoffs: recovery may require a deliberate repeat declaration even when two commands are byte-identical; this avoids automatic repeat on a changed provider call ID without prohibiting intentional repeats. A process may become uncontrollable and unknown after crash instead of being falsely reported stopped; restart-safe reattachment requires a separately designed supervisor and verified identity. Bounded output can discard older bytes and must say so. Generic shell effects cannot be perfectly deduplicated or reconciled from command text, and no mechanism can prove a model's stated intent.

Questions for checkpoint: Are the explicit repeat challenge and work-wide uncertainty fence sufficiently understandable in routine Hybrid recovery? Is keeping already-retained processes alive on work Stop, with a separate process Stop, the desired owner control? Which supported native platforms and PTY implementation meet packaging and lifecycle needs? What resource budgets and retention windows are appropriate after measurement? What existing policy permits each new capability for helpers and scheduled tasks? These are architecture/implementation decisions, not authorization to broaden policy or revise #78's scope.

## Verification and first implementation step

Before production work, compare whole-shape candidates and obtain the owner's explicit #79 architecture approval. Then integrate the worker and build the accepted-work gateway against the real disposable instance and paired API. Use controlled provider responses but real QuickJS, native shell, pipes/PTY, processes, filesystem, existing memory and SQLite. Verify exact offers and rejected names; chat/task/helper binding and mode capture across settings edits and exact-ID retries; live revocation, helper restrictions and one approval; same-effect cross-route recovery, explicit same-command repeats, uncertainty and denied/Stop fences; version conflicts and owner-only shared-memory confirmation; retained process input/output, other-client Stop, guest completion, cancellation, and honest restart; source/output bounds, privacy, conversation replay and usage; GUI/CLI access and packaged platform behavior. Run required `pnpm run check` and `pnpm test` plus relevant GUI/distribution checks during implementation. Distinguish synthetic provider and native local-process evidence from Docker, remote and live-model evidence. This document itself makes no execution or test claims.
