# Code Mode execution experiment

Issue [#74](https://github.com/lancewilhelm/Staf/issues/74) implements the first
local experiment from the approved [architecture checkpoint](rationale.md).
Normal Staf chat still uses its existing tools. There is no Code Mode setting,
CLI switch, model substitution, or automatic fallback.

## Implemented boundary

`startInstance` accepts an internal `codeModeLab` option only alongside an injected
provider factory. Tests and the developer demo use synthetic providers. A lab
turn offers one provider tool, `execute_code`, instead of the normal tools.
Ordinary assistant text starts no guest. Background-task execution keeps its
existing runtime.

`CodeModeWork` owns a request's budgets and temporary read receipts. Each
`execute` starts a fresh QuickJS/Wasm runtime in a supervised Node subprocess.
The worker pumps ordinary promise jobs explicitly. It does not use Asyncify,
Node evaluation, `node:vm`, a guest module loader, or replay.

The subprocess receives an empty environment and a temporary working directory.
The guest receives `capabilities`, `staf.emit`, and `staf.reuse`. It does not
receive Node APIs, a service object, credentials, filesystem APIs, or networking
APIs. These guest restrictions do not establish an operating-system boundary
against a compromised worker.

The host parses strict bridge messages and validates every application input and
output. Registered methods enter a bounded queue. Up to three reads overlap;
changes run exclusively in arrival order within an execution. An exact approval
includes the capability, arguments, resource, effect, accepted work and expiry.
The Code Mode approval queue presents one request per agent and starts its
24-hour timer when presented. Expiry never approves an action.

The instance uses its existing event table for execution metadata and its action
journal for child states. The synchronous start transaction checks current work,
configuration, policy, terminal fences and the one-use start permit together.
No database migration number is consumed. Slots 31 through 33 remain reserved
for the coordinated feature work.

Denial, expiry, Stop and budget exhaustion close admission. A normal return also
closes admission, cancels unstarted calls and allows up to five seconds for
started operations to settle. An unobserved change becomes uncertain. A late
observed result amends that same action without reopening the work. Restart
interrupts the command and marks started actions uncertain. It never reruns code.

Source is retained verbatim or rejected before execution if known-secret or URL
privacy rules would change it. Selected partial values and the final JSON value
are durable, with a cumulative size limit. Unused read payloads stay in a bounded
request-local cache. Receipts require fresh scope and policy checks, and disappear
when the accepted request ends. The journal retains action arguments and outcome
summaries, not every intermediate read result. Existing credential redaction
cannot detect every unknown secret.

## Integration contract

The executable contract is [src/code-mode/contract.ts](../../../src/code-mode/contract.ts).
The older TypeScript sketches are historical checkpoint artifacts.

A feature supplies `applicationCapability({description, input, output, effect,
checkScope, invoke})`, keyed once in `ApplicationCapabilities`.
`dataSchema(zodSchema)` derives parsing and JSON Schema from one codec. Inferred
input and output types stay inside the registered closure. `CapabilityRegistry`
derives the guest method names, capability catalog, validation and dispatch from
those registrations. The guest calls `await capabilities['documents.search'](input)`;
there is no separate direct provider tool for a registered method.

`checkScope(call, input)` checks feature-owned authority without fetching the
payload or changing anything. It returns `scopeClaim(() => { ...; return
undefined; })`, whose synchronous assertion rechecks the captured authorization
revision or current permissions. The host runs that assertion again inside the
start transaction and immediately before result release. Async scope validation
consumes active time, so a stalled guard cannot retain a worker indefinitely.
`invoke(call, input)` runs after the common host checks and start permit. A changing method should use the host-minted `call.operationId` for its
idempotent service operation. An unexplained changing exception is uncertain.

The host derives a keyed change identity from the accepted work, capability,
resource and schema-normalized arguments. Object key order does not change that
identity. Before asking for approval and again inside the permit transaction,
it checks the action journal for a matching successful change. An identical
change runs at most once per accepted request, including across fresh scripts.
A new owner request has a new command identity. Distinct revisions or genuinely
different changes have different arguments. `RunReport.priorChanges` exposes
observed change identities and states for inspection and feature-owned
reconciliation. The guest cannot clear those guards with a recovery flag.

`call.context` contains the immutable accepted `{botId, sessionId, commandId,
signal}`. `call.signal` additionally cancels this execution's outstanding
operations. The accepted context and its signal never change between scripts.
Adapters can honor the additional cancellation signal where their operation API
supports it. A service that ignores cancellation still receives a tracked outcome
or explicit uncertainty.

The current instance adapter binds its existing captured chat ID. The future
session implementation must pass the session selected at command acceptance.
It must not look up a mutable current-session pointer. Session, document and
artifact implementations remain owned by [#67](https://github.com/lancewilhelm/Staf/issues/67).
No old-session context, summaries, compaction, or implicit replay is added here.

The experiment catalog contains schemas and descriptions. Producing ergonomic
TypeScript declarations for model prompts remains an adoption follow-up; the
current guest executes JavaScript.

## Limits and evidence

The implementation defaults are in [protocol.ts](../../../src/code-mode/protocol.ts)
and match the approved numeric bounds that this lab can enforce. Request budgets
span scripts. Approval-only waiting pauses active-wall accounting. Guest-running
elapsed time has its own cumulative budget; it is not measured CPU time.

The lab sets QuickJS heap and stack limits and a Node old-generation heap limit.
**It does not enforce the proposed 128 MiB total process ceiling.** It does not
apply OS filesystem or network restrictions to Node. These are adoption blockers,
not limits that this experiment silently relaxes for production.

The focused tests use the real worker, disposable SQLite instances, synthetic
application methods and synthetic providers. They cover dependent reads, selected
outputs, exact approval, denial caught by guest code, expiry with controlled time,
revocation at the final permit, completed-change recovery guards, stalled scope
checks, read concurrency, exclusive changes, Stop from another paired client,
unawaited effects, late outcomes, bounded correction and output budgets, scoped
read reuse, unsafe constructed arguments, malformed bridge messages and interrupted
restart. They also retain results after a later provider failure.

Named live connection/model combinations, provider cost and reliability,
Docker enforcement, native hard isolation, installation upgrades on both supported
platforms, selected-skill propagation through the new registry, and arbitration
with legacy task approvals remain unverified. Existing clock, search, web, shell
and skill adapters are not migrated by this issue. Their migration requires these
gates and their capability-specific permission, URL, redirect, grant and skill
checks. A passing local fixture does not authorize adoption.

See [development](../../development.md#review-the-code-mode-experiment) to repeat
the demo and checks. The [original verification plan](verification.md) remains the
complete adoption checklist, including the uncompleted gates above.

## Review record

Independent Standards and Spec reviews ran against commit `2c5caa8`. Standards
found an unbounded scope wait. Spec found that wait, repeated completed changes,
a missing atomic feature-scope assertion and a missing work fence after final
policy revocation. The implementation now has regression tests for each finding.
The parent made and checked those corrections; the corrected diff was not sent
through another independent review. See [review resolutions](review.md).
