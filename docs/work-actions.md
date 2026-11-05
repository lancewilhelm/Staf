# Accepted-work action service

`src/work-actions.ts` implements the instance-owned action service. Ordinary
chat opens it once per accepted command; direct and QuickJS clock and memory calls use the
same registrations and authorization. Task runtime and other existing tools
remain on their earlier paths pending their adapters. In ordinary chat, those
other individual tools are available in Direct and Hybrid only; Code Mode offers
only `code_mode`, with clock and scoped memory as guest capabilities. Dispatch rejects
individual calls that were not offered.

## Open accepted work

`instance.workActions()` returns the one registry and coordinator owned by the
instance. Register each capability once. Call `open(work, signal)` with the
actual command ID or task attempt ID and the service's live controller signal.
The returned `WorkActions.context` contains the accepted bot, conversation,
mode, absolute working directory, and signal. Dispose the handle after the work
settles with `actions.dispose()`; shared closure interrupts pending authorization
across all open handles. The directory is
`agents/<bot-id>/work` beside the revisioned configuration. Acceptance stores
the path with the work. Migration 32 backfills the same path for older work; a
legacy command without a captured profile cannot open an action context.
Missing captured modes still mean Direct.

`WorkActions.offers('direct' | 'guest')` returns eligible registered definitions
for that route and captured mode. The chat bridge adds `code_mode` to its
provider offer where appropriate. The action service never registers or invokes
`code_mode` as a child capability.

## Register and invoke clock

The following code belongs in the existing instance service, where
`authorizeClock` and the work's `controller` already exist. Register the clock
once when constructing that service; do not register it for every turn. The
callback uses the existing clock policy and approval path.

```ts
import { clockCapability } from './clock-action.js';

const registry = instance.workActions();
registry.register(clockCapability(instance, work =>
	authorizeClock(work.botId, work.work.kind, work.work.id, work.signal)
));

// In the guest bridge, after the command has been accepted:
const actions = registry.open({kind: 'command', id: commandId}, controller.signal);
const outcome = await actions.invoke({
	source: {kind: 'guest', executionId, sequence: message.seq},
	name: message.name,
	input: message.input,
	intent: {kind: 'new'},
});
```

For a direct provider call, use
`source: {kind: 'provider', responseId, callId}`. Reusing a source with the
same input returns its recorded outcome. Reusing it with changed input or intent
raises `ActionConflict`. Source identifiers never become action IDs. The service
allocates those IDs and commits the invocation and the journal preparation in
one transaction.

A `Capability<I, O>` supplies its tool definition, input and result parsers,
safe description, eligibility and live precondition checks, authorization,
execution, and a safe result for inspection. `execute` returns a JSON-compatible
result. Throw `ActionFailed` only for a definite failure and provide a safe
result. Other execution exceptions produce an uncertain journal outcome. Throw
`ActionDenied` for a denied authorization. The clock adapter translates the
existing clock denial into that error. Feature code must keep `summary`,
`resource`, and `visibleResult` safe for inspection. Inputs and private results
remain in instance-owned records and are not part of the inspection manifest.

The coordinator admits at most 32 new invocations per work item and at most
eight pending invocations. Both routes share those limits. It checks active
work and live feature restrictions after authorization, immediately before the
journal start, and before releasing a result. A completed effect remains
recorded when Stop prevents its result from being released. The journal marks
started effects uncertain on restart and never re-executes them automatically.
These guarantees do not make external effects exactly once.

## Memory adapter

`registerMemoryCapabilities(instance, registry)` registers search, read, remember, update, forget and proposal-status actions for accepted command or task contexts. Task runtime has not yet opened this boundary. The adapter rejects helper attempts and derives agent scope from the captured bot ID. Search is bounded to 20 items and exposes a continuation cursor. Store update and delete perform their version and scope checks at the effect, not in `check`: `check` also runs when releasing a completed retry. `MemoryConflict` becomes `ActionFailed`, so the journal records a definite failure. Shared creation inserts a pending proposal through the existing instance workflow; only the separate owner command confirms it. Reads return private results through the coordinator. The shared-proposal action record shows the proposed text and ID so the owner can review it before confirmation. The generic code capability catalog remains a separate integration slice.

## Recovery

After an ordinary script failure, the bridge calls `beginRecovery()`. It returns
up to 32 safe action records, a `truncated` flag, and continuation instructions.
`manifest()` returns the same inspection shape without starting a new recovery
epoch. Use `invoke` with `{kind: 'resume', actionId}` and the matching
capability and input to retrieve a completed private result without execution.

During recovery, a matching completed change returns `repeat-required` with a
single-use challenge, up to 32 matching actions, and a `truncated` flag. A new invocation with `{kind: 'repeat', challenge}` can
start a separate action after the service consumes the challenge. A changed
matching set produces a fresh challenge. A new ordinary command has a separate
work identity and may make the same change without this recovery challenge.

A started or uncertain change fences potentially overlapping changes. During recovery, a
completed opaque change also fences a different change until reconciliation. A capability can
supply `recovery.overlaps` and `recovery.reconcile`; the latter must verify
feature-owned evidence. `actions.reconcile(actionId, evidence)` clears the
fence for an uncertain action or a completed opaque change only when that hook
succeeds. Opaque changes and uncertain older journal
actions without a registration use a conservative fence. The latter need a
feature adapter and reconciliation path before a later bridge can clear them.
Task retries include unresolved predecessor actions. A declaration that a call
is new does not reconcile an uncertain effect.

The focused disposable-instance checks are in `test/work-actions.test.js`.
They use a real SQLite journal and local fixture effects. They do not establish
paired API, real-worker chat, live-provider, Docker, or remote-host behavior.

## Chat bridge and inspection

`src/code-mode/bridge.ts` exports `runCode({actions,responseId,callId,source,redact})`.
`runTurn` generates the response identity, opens no guest for text, and dispatches
only names in the captured mode's offers. Guest sequence numbers come from the
worker; execution and action IDs are service-generated. A child call returns
`{receipt, actionId, value}`; `staf.reuse(receipt)` retrieves that guest's safe
cached value, and `staf.emit(value)` selects visible output. The optional second
argument to `capabilities.clock(input, intent)` carries `new`, `resume` or
`repeat` intent. Direct calls use an optional `_staf` intent field outside the
capability input. A recovery result contains the manifest and instructions.

Before starting a worker, the service records exact safe source, SHA-256 identity,
work and provider call. Child mapping and action preparation are committed by
the action service before the effect. `WorkActionService.inspect(work)` and
`inspectActions(work)` feed the paired command API and chat work details. The
journal owns child outcomes, including after a failure or restart. Selected
results are redacted and retained; unused receipts are discarded at guest end.

Per accepted command: at most four guest executions and 32 action invocations,
with eight pending actions. Each source is at most 32 KiB, selected output at
most 256 KiB, guest CPU time at most 5,000 ms per execution, QuickJS heap at most
32 MiB and stack at most 512 KiB. A worker message is bounded to 256 KiB.
Ordinary `Error` messages, including words such as `interrupted` or `limit`,
remain recoverable. Exception values, including guest-created `InternalError`
objects, do not establish that a shared budget was exhausted. The worker tracks
actual interrupt and bridge-limit events instead of interpreting exception text
or prototypes.

The [approved recovery contract](design/basic-tools/checkpoint.md#recovery-and-repeated-commands)
closes admission across both styles for exhausted **shared work budgets**.
QuickJS's allocation and stack guards apply to each program. A program may catch
an allocation or stack exception and continue within those guards and its
remaining work budget. An uncaught exception enters ordinary recovery; it does
not imply that the shared action or execution allowance has been consumed.
Observed host stack, CPU, bridge and output limit events, shared budget exhaustion, denial,
Stop and live restrictions close admission. Hybrid can use direct calls after
ordinary failures; Code Mode remains selected. These are QuickJS and protocol
bounds, not OS/container isolation or a total host RSS limit.
