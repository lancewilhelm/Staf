# Implementation contracts and verification seams

Status: owner-approved architecture checkpoint for [issue 79](https://github.com/lancewilhelm/Staf/issues/79). Implementation depends on the common foundation in [issue 80](https://github.com/lancewilhelm/Staf/issues/80). These contracts describe target behavior, not a claim that any capability is implemented.

## Common dependency and ownership

The foundation owns captured `WorkContext`, mode-based offers, the capability registration interface, work admission, action identity, private action records, approval and execution bookkeeping, the worker bridge, and the stable agent working-folder binding. It provides a test fixture that creates real accepted work through the paired API and exposes controlled provider responses, not a mutation-only back door. Each capability owns its input schema, result schema, resource identity, current authority and feature-specific preconditions. It supplies one operation to the registration. Neither caller path executes capability effects directly.

The parallel tickets may add separate capability modules and focused tests. They do not independently modify the journal schema, provider loop, work context, mode defaults, shared admission, process registry, or GUI action model. Coordinate shared registrations and documentation during integration. An implementation encountering a missing common API proposes a foundation change instead of copying another ticket's dispatcher. Ticket 86 can integrate task binding against clock and task-control registrations before the other capability tickets land. Ticket 85 follows 84 for interactive and retained process controls; 87 joins the slices.

| Ticket | Owns and consumes | Required behavior at the seam |
| --- | --- | --- |
| [81](https://github.com/lancewilhelm/Staf/issues/81) | Adapters for existing web read, search, scratch, and skill selection. Consume common registration and dispatch. | Preserve existing eligibility, policy, scratch environment, URL and query limits, skill revision and selection invalidation. Provide the same underlying result and approval through both routes. The native terminal is not a scratch replacement. |
| [82](https://github.com/lancewilhelm/Staf/issues/82) | Host file read, write, edit, and search. Consume captured working folder, invocation identity, and common dispatcher. | Relative paths resolve against the agent folder; absolute paths use ordinary service-account host access. Read/search expose bounds and continuation. Edit exposes conflicts or failed matches rather than claiming success. A recovery retry uses the original invocation or reports the overlap. |
| [83](https://github.com/lancewilhelm/Staf/issues/83) | Memory capability adapter over the existing `MemoryStore` and proposal workflow. | Bind agent scope from accepted work. Reads return IDs, versions, and scope. Require current versions on update/forget. Shared creation returns a proposal for owner confirmation; a model cannot confirm it. Preserve existing shared update and deletion behavior, helper restrictions, and conflicts. |
| [84](https://github.com/lancewilhelm/Staf/issues/84) | Native command start, process registry and cross-client status/output/Stop, with an interface extensible by 85. | Spawn the ordinary host shell using captured cwd and service environment. Separate stdout/stderr in pipe mode; record exit only when observed. Process ownership survives guest completion. Stop and restart never assert a process exited without observation. No Docker dependency or command allowlist. |
| [86](https://github.com/lancewilhelm/Staf/issues/86) | Task and helper binding into the existing turn and common dispatcher. | Capture the executing agent's own mode and actual task attempt. Preserve directions, owner questions, collaboration/disclosure, pending-input gates, checkpoints, usage, cancellation, and live restrictions. Offer task controls only where actually eligible, and validate the same set at dispatch. |

## Acceptance seam

The primary proof is a disposable, paired Staf instance using controlled provider responses, the actual QuickJS worker, host processes, filesystem, existing SQLite memory and action records. Inspect normal API results and events. The GUI and CLI journeys are thin clients of that same instance. No real credentials, live or billable providers, Docker, or production data are required for this proof.

During implementation, exercise these distinct cases:

1. Assert the exact Direct, Hybrid, and Code Mode offers and reject an unoffered name even if the provider returns it. Test old missing configuration and captured profiles as Direct, new defaults as Hybrid, invalid explicit values, direct file edits, stale saves, and exact-ID retry conflicts.
2. Hold chat and task execution while another client changes ordinary settings. The accepted profile and executing agent remain fixed. Independently revoke actual authority or stop work and prove subsequent queued, direct, and guest calls cannot start.
3. Run the same capability through both routes with real effects and a single action/approval outcome. Test ordinary guest errors before and after a completed effect, cross-route recovery, an explicitly new repeated command, a different overlapping effect, denial, exhausted budgets, and uncertain effects. Verify no automatic replay after restart.
4. Run deterministic native fixtures for separate stdout and stderr, exit code, interactive TTY input and output, retained process after guest return, later interaction, cross-client Stop, cleanup, shutdown, and restart with unknown state. For a PTY, assert combined terminal output rather than invent separate streams.
5. Read, write, edit, and search real disposable files using relative and explicit paths. Test failed edits, bounded continuation, and preservation through settings publication and restart. Inspect action records and actual file content.
6. Search and read both memory scopes, create agent memory, propose shared memory, confirm only as owner, update and forget with versions, and exercise stale, wrong-scope, cross-client and restart behavior. Compare existing owner interfaces with both calling styles.
7. Cover task directions, questions, helper-specific captured mode, disclosure, task restrictions, progress and Stop. Verify streaming, private replay, usage, skill invalidation, retained-memory recall and persisted history in mixed turns.
8. Run the repository-required `pnpm run check`, `pnpm test`, affected served GUI and CLI journeys, and distribution checks for the worker and native process dependency. Record actual platform skips and keep synthetic-provider, native-process, client, Docker, remote, and live-provider evidence separate.

Fixtures must terminate the processes they start, including on assertion failure. Tests must inspect real service records and actual process/file/memory outcomes, not only mocks of those components. The experiment's earlier tests are historical evidence and must not be reported as runs of this design.

## Concrete clock bridge handoff

The accepted command seam is `instance.workActions().open({kind:'command',id},
signal)` and must dispose the handle when the attempt settles. `startInstance` registers `clockCapability` once; `runTurn` consumes
`WorkActions.offers`, `invoke`, `beginRecovery` and the real
`src/code-mode/bridge.ts` runner. `WorkActionService.inspect` and
`inspectActions` back paired command inspection and chat details. The reusable
paired fixture is `test/chat-code-bridge.test.js` (`startInstance` with a
controlled `providerFactory`), and `test/browser/held-instance.mjs` supports
`Scripted clock fixture` for the served client. Neither fixture uses credentials
or live inference.

For #81, reserve `_staf` outside direct capability input and the guest's second
argument for recovery intent; preserve the current web, search, scratch and
skill restrictions when registering them. #82 and #84 consume
`actions.context.workingDirectory` and feature-owned overlap/reconciliation;
#83 derives memory scope from `actions.context.botId`. #86 must open the actual
task attempt with its live signal and retain pause/resume of approval timers,
questions and task restrictions. These later adapters must expand the guest
catalog and provider offers together; no second journal or provider loop is
needed. The current registered catalog includes clock, memory, host files, native processes, configured search, and eligible task controls. Web, scratch, and skill selection still require their #81 adapters.

## Task lifecycle handoff

The task caller opens the real attempt through `workActions.open` and installs attempt-keyed task-control callbacks for the lifetime of `runTurn`. Clock and configured-search registrations resolve that attempt's `taskTimers` pause/resume functions for approval. The existing `skillAccess` callback remains responsible for selected-skill validation; the shared adapter migration must preserve it and use the same attempt context and timer hooks for approval waits. Pending inbox input defers new action admission without closing recovery or discarding completed results.

### Interactive process adoption

The process registry now offers pipe/PTY mode, explicit retention, write/EOF/resize and existing read/Stop. `WorkContext.workSignal` is accepted-work cancellation; `signal` additionally fences admission. Keep them distinct in new adapters. Process input is a changing action with its own identity, byte budget and recovery receipt. `finishWork` releases nonretained processes; retained ownership remains bound to the originating agent/work/action. See the usage and process contract for limits and platform evidence.
