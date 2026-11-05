# Accepted-work action service

`src/work-actions.ts` implements the internal action service. Normal chat does not
call it yet. The QuickJS worker is not connected to this service or to the chat
turn. The clock registration in `src/clock-action.ts` is executable through the
service, but is not yet the clock path used by chat.

## Open accepted work

`instance.workActions()` returns the one registry and coordinator owned by the
instance. Register each capability once. Call `open(work, signal)` with the
actual command ID or task attempt ID and the service's live controller signal.
The returned `WorkActions.context` contains the accepted bot, conversation,
mode, absolute working directory, and signal. The directory is
`agents/<bot-id>/work` beside the revisioned configuration. Acceptance stores
the path with the work. Migration 32 backfills the same path for older work; a
legacy command without a captured profile cannot open an action context.
Missing captured modes still mean Direct.

`WorkActions.offers('direct' | 'guest')` returns eligible registered definitions
for that route and captured mode. The chat bridge must add `code_mode` to its
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

// In a future guest bridge, after the command has been accepted:
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
