# Basic tools architecture checkpoint

Status: approved by the owner in the implementation conversation with "yes approved". This completes the architecture checkpoint in [issue 79](https://github.com/lancewilhelm/Staf/issues/79) and authorizes dependent implementation work. Approval fixes the design direction; it does not claim runtime implementation or verification. [Specification 78](https://github.com/lancewilhelm/Staf/issues/78) fixes the product scope. [Grounding](grounding.md) separates current behavior from the design; [implementation contracts](implementation-contracts.md) define the parallel work.

## Problem

Staf needs three per-agent tool modes without splitting its conversation lifecycle or duplicating actions. The accepted work already has a command or task identity, an executing agent, a captured profile, and live restrictions. Code Mode must enter that same lifecycle while allowing native host processes to outlive a QuickJS invocation. Cross-style recovery must account for prior effects without pretending that arbitrary shell intent can be inferred from command text.

## Usage first

The owner selects Direct, Hybrid, or Code Mode in the agent's existing settings; the CLI and API use the same authoritative configuration. New agents receive Hybrid at creation. Existing configurations and saved profiles without a mode mean Direct. An invalid explicit value blocks new work with an actionable error. Updating a mode affects later accepted work; it does not change an active turn.

The following proposed call sites illustrate the service boundary, not runnable production code:

```ts
// Chat and task acceptance bind the work before provider execution.
const actions = service.openActions({ kind: 'command', commandId });
await runTurn({ session, provider, actions });

// Both presentations resolve to the same registered action.
await actions.invoke({ name: 'file_read', input: { path: 'notes.txt' }, intent });
await actions.runCode({ source: 'return await tools.file_read({path: "notes.txt"})' });

// A later accepted work item can inspect and interact with an owned process.
await actions.invoke({ name: 'terminal_read', input: { processId, cursor }, intent });
await actions.invoke({ name: 'terminal_input', input: { processId, data: 'yes\n' }, intent });
```

`runTurn` remains the only normal provider turn. It derives offers from the captured mode and the currently eligible registrations: Direct offers eligible individual actions; Hybrid offers those actions plus `code_mode`; Code Mode offers only `code_mode`. The guest catalog contains eligible individual capabilities, never `code_mode`. Task-control actions, including questions and delegation, are registered only where existing task and collaboration rules permit. Text-only providers continue normal text chat; an unavailable tool-capable provider or executor produces an explicit error without switching mode or model. The service checks the offer at dispatch as well as when constructing it.

## Shape and ownership

The examples above derive the following conceptual interface. Names are proposed. Implementations, schemas, error mapping, and transactions are deliberately omitted. IDs are parsed and branded at trusted boundaries. No guest receives a service object, database handle, permission decision, or wire type.

```ts
type Mode = 'direct' | 'hybrid' | 'code';
type WorkRef = { kind: 'command'; commandId: CommandId }
              | { kind: 'task'; attemptId: AttemptId };
type WorkContext = Readonly<{
  work: WorkRef;
  agentId: AgentId;
  conversation: { kind: 'chat'; conversationId: ConversationId }
              | { kind: 'task'; capturedContext: TaskContext };
  mode: Mode;
  workingDirectory: HostPath;
  signal: AbortSignal;
}>;

type Intent = { kind: 'new'; intentId: IntentId }
            | { kind: 'resume'; actionId: ActionId }
            | { kind: 'repeat'; prior: ActionId; challenge: RepeatChallenge; intentId: IntentId };
type ActionOutcome<T> =
  | { kind: 'completed'; actionId: ActionId; value: T }
  | { kind: 'failed'; actionId: ActionId; error: SafeError }
  | { kind: 'denied' | 'stopped' | 'limited' | 'uncertain'; actionId: ActionId; detail: string };

interface WorkActions {
  offers(): readonly ToolDefinition[];
  invoke(input: { name: CapabilityName; input: unknown; intent: Intent }): Promise<ActionOutcome<unknown>>;
  runCode(input: { source: string; executionId: ExecutionId }): Promise<CodeOutcome>;
}
interface Capability<I, O> {
  parse(input: unknown): I;
  describe(input: I, work: WorkContext): ActionDescription;
  authorizeAtStart(input: I, work: WorkContext): AuthorityClaim;
  recovery?: RecoverySemantics<I>; // feature-owned overlap and reconciliation
  execute(input: I, work: WorkContext): Promise<O>;
}
interface TerminalProcesses {
  start(work: WorkContext, input: TerminalStart, action: ActionId): Promise<ProcessSnapshot>;
  read(work: WorkContext, input: ProcessRead): Promise<OutputPage>;
  input(work: WorkContext, input: ProcessInput): Promise<ProcessSnapshot>;
  endInput(work: WorkContext, id: ProcessId): Promise<ProcessSnapshot>;
  resize(work: WorkContext, input: ProcessResize): Promise<ProcessSnapshot>;
  stop(request: OwnerOrAuthorizedWork, id: ProcessId): Promise<ProcessSnapshot>;
}
```

The registry owns each capability's schemas, description, feature preconditions and implementation. A capability supplies overlap and reconciliation semantics where meaningful; simple reads do not implement empty recovery hooks. For opaque changes, use a conservative work-scoped fence. The instance binds one `WorkActions` to a service-owned accepted context. The service checks eligibility and input, establishes a logical invocation, prepares the existing action journal, applies the existing approval and live authority checks, atomically claims the start permit with service-owned revision checks, executes once, then records the observed outcome. External filesystem state can change after that transaction; feature checks and errors must account for that race instead of claiming SQLite makes shell or file effects atomic. Direct provider calls and guest bridge messages both enter this path. Calling `code_mode` records an execution and its source, but does not add an approval for each already-authorized child. A child receives the same applicable underlying approval and journal action it would receive directly.

The action journal owns actions and private ownership even if the guest fails before publishing a child record. A separate guest execution record links retained source, execution ID, provider call ID, child action IDs, and bounded visible results; it is not the authority for whether an action started or finished. The service creates the action and its execution link durably before dispatch. It records a recovery epoch after an ordinary script failure with possible or completed effects. An explicitly retried task attempt carries unresolved predecessor effects and their fence, rather than bypassing them with a new attempt ID. Inspection joins those records by accepted work; missing guest records cannot erase an action. Existing task actions reference their task attempt, never a synthetic command. Resume returns the recorded action rather than re-executing it. A retry with the same identity and different canonical input is a conflict.

Capture the executing agent, actual command or task attempt, conversation context, mode and stable working folder at acceptance, together with provider settings and existing cancellation state. Agent folders use the stable agent ID and a work subdirectory outside revision publication. Capture does not turn that directory into a filesystem boundary. A helper uses its own accepted profile and mode. Persist the captured IDs and settings with accepted work; reconstruct the in-memory cancellation signal from its live controller, rather than trying to serialize the signal. Exact submission retry loads the original capture. New work validates current agent configuration; malformed files remain intact. At dispatch and immediately before effect start, the service checks actual work state, live restrictions, scope, approval/grant and feature revisions. A name, instruction, mode, or model edit is not revocation. Archive, Stop, task restrictions, applicable permission changes and grant revocation remain live. Preserve existing helper and scheduled-work restrictions rather than inferring access from mode.

## Module map

- `src/runtime.ts` retains `runTurn` and asks the work-bound action interface for offers and dispatch. Existing replay, streaming, usage, skills and persistence remain there.
- `src/instance.ts` and `src/instance-service.ts` accept command or task work, bind captured context, manage live cancellation and open the action interface. They retain transaction and authority ownership.
- A private `src/actions/` registry and work coordinator own registration, common admission, invocation mapping, budgets and recovery; the existing `src/action-journal.ts` remains the starting point for the single action record owner. Capability modules own their schemas, effects and resource preconditions.
- A `src/code-mode/` bridge owns worker protocol, source/guest limits and execution records. It calls the same work-bound actions and has no independent provider loop or action journal.
- A service-owned `src/terminal/` process manager owns native handles, output and lifecycle. File and memory adapters use the common action service and their existing domain stores. Client APIs expose shared process and action views.

These proposed paths are ownership boundaries, not existing modules. Prevent external imports of private worker and journal internals during implementation.

## Recovery and repeated commands

The service assigns a durable action ID to each accepted logical invocation, independent of provider call ID and route. It durably maps an exact provider-call delivery or guest execution plus sequence to that action before dispatch. A repeated transport delivery resolves to that ID; a new call ID alone never proves a new intention during recovery. Ordinary guest calls receive a service-created new intent, while recovery can refer explicitly to an action in the manifest. Guest input and provider-supplied identifiers do not mint authoritative action IDs. On ordinary code failure the service supplies the same work a bounded recovery manifest of completed, failed, and uncertain actions, their safe results, and explicit continuation instructions. Hybrid may continue with eligible direct tools; Code Mode stays in its selected style. Known completed actions can be inspected or resumed by action ID, never re-executed as a retry. Uncertain effects fence potentially overlapping changes until inspection and explicit resolution. Denial, Stop, live restriction, expired work, and exhausted shared budgets close admission across both routes, including already queued calls and subsequent scripts.

The `intent` field is an action-call envelope outside the capability input, for both direct and guest routes. A new ordinary command is a new invocation even if its text exactly matches a previous successful command. During recovery, an apparent repeat must declare whether it refers to a prior action or is a deliberate new invocation. The service compares registered capability identity, scope and safe canonical input with the recovery manifest. It returns the prior result for a resume. For a matching completed change, the service returns the prior result and a single-use repeat challenge bound to the work, canonical action, recovery epoch, and complete set of relevant prior actions. An explicit repeat intent referencing that challenge creates a distinct action only after atomic challenge consumption and renewed authority checks. If the matching set changed, issue a fresh challenge. This is a model-visible recovery decision, not an additional approval or proof of human intent. The recovery epoch includes effects of the failed script or response before the epoch began and relevant recovery lineage. Uncertain effects remain blocked until authoritative evidence reconciles them; a declaration of novelty cannot clear uncertainty.

Exact matching catches known duplicates, but arbitrary commands and different inputs may have the same external effect. No string, hash, model declaration, or call ID can prove semantic intent or exactly-once external behavior. For an opaque shell change whose overlap cannot be determined during recovery, use a conservative work-scoped change fence and ask for explicit reconciliation rather than guessing. This trades some unattended recovery for honest accounting. The owner approved this ambiguity policy at the checkpoint; it must not be quietly relaxed by an implementer.

## Native terminal and process lifetime

Use Node's [`child_process.spawn`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) with the configured ordinary host shell for noninteractive commands and separate stdout/stderr pipes. For programs needing a real TTY, use the native [node-pty](https://github.com/microsoft/node-pty) binding and its `spawn`, `write`, `resize`, `onData`, `onExit`, and `kill` API. A PTY merges terminal output; it cannot truthfully separate stdout and stderr. Expose the stream kind in every output page. Node-pty supports Linux and macOS; Linux is the first native deployment target. Validate the selected pinned version, Node ABI, packaged native binary/build prerequisites, license and supported platforms in distribution checks before implementation is accepted. Do not claim Windows support until tested. Pipe mode and PTY mode are two I/O backends of one service process registry, not two action implementations.

The process manager creates an opaque service-generated process ID and records its originating agent, accepted command or task attempt, action ID, cwd, process mode, start observation and output cursors before reporting it. A process is a service resource, not a QuickJS child. A foreground start may await its exit or return an observable running handle; a retained start returns a handle while it runs. Script completion alone never stops a retained process. Subsequent work from the same executing agent can read or interact with the handle after live authorization; paired clients can observe and explicitly stop it through the service. Stop control remains available independently of a completed provider or guest call.

The manager records a starting process ID and originating action before spawn. If the instance crashes between spawn and observing the handle, the action is uncertain and is not retried automatically. Process input is itself a changing action with its own identity, because retrying input can repeat an effect. The manager owns live OS handles and event listeners. Serialize input, EOF, resize and Stop per process; give each input a separate action identity. Pipe input supports EOF and output reports its encoding or decoding error. Input and output are ordered per process; reads return a cursor, stream label, bounds and explicit truncation or expiry. Bound the retained output buffer and active handles with visible admission errors. Do not silently kill a retained process when its output buffer fills: apply backpressure where available or drop old bytes with a visible gap. Guest budgets limit guest execution and guest-held receipts, not the lifetime of an independently retained process. The service accounts separately for worker memory/time, number of active processes, queued input and retained output; published limits and their units are observable. Do not describe these limits as a total OS memory ceiling.

Stop of active accepted work closes admission, interrupts its guest, and requests termination of every process started by that work, including retained ones. Once work has completed, a retained process remains a separately observable resource until explicit process Stop, applicable revocation, or instance shutdown. A stop request records `stopping` and sends the backend's termination request; report `exited` only upon observed exit and exit status. Shell children can create other process groups or detach, and a signal is not proof of their termination. Where supported, signal the owned process group and escalate within documented bounds; report remaining or unobserved descendants as uncertain. Never signal a remembered PID after restart without a verified live handle. Node documents that a sent signal does not prove termination and that a reused PID can target another process ([Node process documentation](https://nodejs.org/api/child_process.html#subprocesskillsignal)).

On graceful shutdown, close admission, request termination of owned processes, flush observed output and exit states, and record any process lacking an observed exit as unknown. On crash or restart, mark formerly running records observation-lost/uncertain. Do not reattach on PID alone, claim stopped, or rerun commands. Owners can inspect recorded ownership and last output and deliberately investigate the host. A deliberately detached OS descendant may survive and is not automatically manageable after observation is lost. Process interaction, input and Stop after restart fail explicitly for lost handles rather than targeting a reused PID.

## Memory, files, and retained results

The memory adapter has one interface shared by both presentation routes. Its scope is a discriminated choice, not an arbitrary agent ID:

```ts
type MemoryScope = { kind: 'agent' } | { kind: 'user' };
type MemoryItem = { id: MemoryId; scope: MemoryScope; version: number; text: string };
interface MemoryCapabilities {
  search(input: { scope: MemoryScope; query: string; cursor?: Cursor }): Promise<Page<MemoryItem>>;
  read(input: { scope: MemoryScope; id: MemoryId }): Promise<MemoryItem>;
  remember(input: { scope: MemoryScope; text: string }): Promise<MemoryItem | SharedProposal>;
  update(input: { scope: MemoryScope; id: MemoryId; version: number; text: string }): Promise<MemoryItem>;
  forget(input: { scope: MemoryScope; id: MemoryId; version: number }): Promise<void>;
}
// Registration binds these operations to WorkContext and the existing service.
// Implementations are intentionally not provided at this checkpoint.
```

Memory tools call the existing scoped store and shared-memory proposal flow. `search` and `read` expose scope, ID, version and bounded content; agent scope derives from `WorkContext.agentId`, not a model-supplied agent ID. `remember` in shared scope creates the existing owner-confirmed proposal, never self-confirms. Agent updates and deletion, and shared update/deletion, retain existing scope, version and owner-interface semantics. A conflict returns current-state guidance rather than silently overwriting. No new memory backend, harvesting, compaction or cross-agent access is introduced.

File tools and terminal use the same host paths and service-account authority. Reads and search return explicit byte or item bounds, truncation and a continuation cursor or offset; a follow-up is a new deliberate read. Edits report no-match or ambiguity and use an appropriate expected-content or revision precondition. Writes and external effects have a recorded start and an honest failure or uncertain state; they are not promised atomic merely because an action is journaled.

Before execution, the service verifies source can be retained faithfully under existing privacy and redaction rules. If not, it rejects source rather than executing a modified copy. Retain the exact accepted source and selected safe results needed for inspection, with actual source/output limits. Keep intermediate read receipts bounded to the accepted work and discard them when that work ends. The user-visible result names any truncation, expired cursor or omitted content. Do not silently compact, truncate or synthesize conversation history or replay private state from another conversation.

## Experiment integration

Do not merge PR 75 wholesale or assume it landed. After checkpoint approval, selectively port its worker, validated message protocol, QuickJS dependency/build packaging and useful tests from the exact open-PR head. Review each port against current integration and document its provenance. Adapt the host and contract around the common work-bound action service and actual `WorkRef`. Replace the command-only store, broad configuration revision check, separate experiment turn, normalized-argument completed-change guard, and fixed numeric defaults where they conflict with this proposal. Preserve historical experimental names and records as read-only history if those records exist; do not rewrite them to `code_mode` or reinterpret outcomes. Add migration/compatibility tests for any persisted lab records actually adopted. Keep the separate experiment only if its build and entry points cannot become a second production path; otherwise retire it after its useful tests are migrated. Do not merge, cherry-pick, or adopt PR 72 contracts.

## Synthesis decision

Use [candidate A](alternatives/candidate-a.md) as the base: its work-bound gateway concentrates dispatch, durable invocation mapping, admission and outcome ownership behind a small interface. The [independent judge](alternatives/judgment.md) found its single-use repeat challenge and invocation namespaces more complete. Adapt [candidate B](alternatives/candidate-b.md) for feature-owned overlap and reconciliation, independently identified and ordered process input, pipe EOF and encoding behavior. Keep recovery hooks optional for capabilities that do not need them.

Both candidates converge on the shared turn, service action path, memory and process ownership, but differ on how much recovery semantics live in the gateway versus the capability. The chosen shape puts shared state, policy and durable records in the gateway and resource meaning in capability modules. Reject independent direct and guest dispatchers because they duplicate approval and recovery, and reject using QuickJS for every direct call because it couples ordinary actions to the guest. The red-flag review also rejected command text as a permanent identity, a broad profile-revision fence, and an override that treats an unknown outcome as reconciled. The recorded judgment applies to the candidates; the final edits have not had another independent review.

## Accepted tradeoffs and checkpoint decisions

- We accept a single common admission/recording owner in exchange for one observable action and one authorization path across both calling styles. Capability modules retain their own domain preconditions.
- We accept a native build dependency for real TTY semantics. PTY output is combined, while pipe mode retains distinct stdout and stderr.
- We accept that a service crash can lose process observation and that detached descendants can survive. Durable records explain the loss; they cannot reconstruct an OS handle.
- The owner approved the repeat challenge for known completed effects and conservative reconciliation and fencing for uncertain or opaque terminal effects. A fully automatic distinction between a retry and a deliberate repeated command is not available from raw command text.
- The owner approved stopping all processes started by active work when that work is stopped, including a process already marked retained. Both candidates instead left retained processes for a separate process Stop; the approved synthesis uses the active-work rule. On shutdown, request termination of all service-owned processes, retain last observed output and mark any unobserved exit uncertain. Retained processes live across guest and work completion, not guaranteed across service shutdown.
- The owner approved selective PR 75 integration, existing helper and scheduled-work restrictions, and a pinned `node-pty` dependency for interactive programs on Linux and macOS, subject to actual packaging and platform tests. If its native packaging fails, implementation must revisit the technical design rather than silently substitute pipes for PTY behavior.

## Next implementation step

Implement issue 80's captured mode, common registration, action admission and clock path with disposable paired-instance tests, then integrate the independent ticket contracts. Routine concrete type and API names may be refined while preserving the approved ownership and behavior.
