# Proposed Code Mode architecture

The [execution experiment](experiment.md) records current implementation and remaining gates. This document preserves the approved target design.

Status: the owner approved the architecture checkpoint on 2026-11-03 as the basis
for the bounded experiment, including its retention clarification and proposed
starting limits. This is not implemented behavior or a production isolation claim. The
[confirmed product decisions](../../adr/0005-service-owned-code-mode.md) remain
the acceptance boundary.

## Usage (caller's view)

The shared turn offers one ordinary function tool, `run_code({code})`. Normal
text responses do not start an executor. Generated code is an async JavaScript
function body using schema-described `staf` methods:

```js
const hits = await staf.web.search({query: 'example'});
const pages = await Promise.all(hits.items.slice(0, 2).map(hit =>
  staf.web.read({url: hit.url})));
await staf.emit({sources: pages.map(page => page.url)});
return {answerData: pages.map(page => page.excerpt)};
```

The service captures the agent, session, command and cancellation signal when
accepting work. The turn passes that opaque accepted-work handle and the parsed
provider call to `CodeMode.execute`. The result contains actual bounded final or
partial output values, actual action outcomes, and descriptions of reusable
current-work read results. Only the provider boundary converts it to a paired
tool-result string. Owner Stop remains the existing service operation.

The [type sketch](sketch.ts), [registration contract](capability-registration.ts),
and [checked caller examples](usage.ts) define the approved experiment design.
All implementation bodies are placeholders. Registration is an approved design
contract, not a production import path or a committed dependency for feature
branches. Concrete feature exports still need mapping during implementation.

## Problem

The current turn and service callbacks mostly exchange strings. That loses
denial and uncertainty distinctions needed to stop generated code safely. Their
deadlines include approval waits, while the new requirement allows 24 hours.
The journal records safe action summaries rather than complete read payloads,
and current work events lack execution/child correlation. Meanwhile, the
parallel session, document and artifact work needs one extensible bridge bound
to the accepted session, not a mutable active-session pointer. See
[grounding](grounding.md) and [coordination](coordination.md).

## Shape

Use a fresh **JavaScript QuickJS/Wasm guest in a supervised local process** for
each code invocation. Do not execute generated source in Node itself. The
worker receives bounded source and data plus a narrow call/result channel; it
receives no service object, credential, filesystem, network or module loader.
Use ordinary guest promises and explicit pending-job pumping, not Asyncify.
The documented API supports this shape, but its security and resource behavior
must pass the real local experiment. The process launcher must provide a
verified native or Docker isolation/resource profile; an unrestricted Node
subprocess is not a substitute. If that profile cannot be demonstrated on a
required deployment, adoption is blocked.

The service owns a deep `CodeMode.execute` operation and read-only inspection.
It hides worker scheduling, the capability gateway, budgets, approval queues,
result handling and cleanup. The core path is turn → Code Mode → registered
capability. Existing broker, journal and instance storage remain private owners
of policy and durable state. This follows boundary discipline and minimizes
caller coordination rather than adding wrappers for each execution stage.

| Owner | Responsibility |
| --- | --- |
| Existing turn runtime | Ordinary messages, one code tool, selected model, provider pairing, bounded corrections, and existing request-only context. |
| Code Mode service | Accepted-work lifecycle, cumulative limits, fresh guests, terminal fences, temporary recovery data, selected outputs, and bounded cleanup. |
| Capability registry/gateway | One definition of each name, input/output schemas, descriptions, effect/resource metadata, scoped feature guards and invocation. Derive guest declarations and dispatch from these entries. |
| Instance and action journal | One durable writer and atomic permit/fence ordering point. Execution metadata references the authoritative action state instead of copying it into another state machine. |
| Private worker | QuickJS/Wasm context, guest promise handles, job pump and bounded private protocol. No database writes or policy decisions. |
| Existing client projections | Actual progress, exact approvals, selected results, expandable source and child details, including late observations. |

### Scoped application methods

Use the exact captured context required by the feature contract observed at
local commit `3e42d18ce6fdc3258304e6312eb269de08662c82` (see
[coordination evidence](coordination.md)):
`{botId, sessionId, commandId, signal}`. IDs and the signal come from accepted
work, never guest arguments. Permission, active-work and resource checks remain
live. A later session selection cannot redirect an execution, its results, or
its child writes. Replace the sketch's ID aliases with feature-owned exported
types when those implementations land.

Capture the offered capability catalog revision with the work as well. Later
availability and permission revocations remain live checks; they do not silently
replace a running script's method contracts or add new authority to its catalog.

The registration factory accepts schema-described methods of the form
`invoke(call, input)`, where `call.context` is immutable and host-supplied.
`checkScope` is a feature-owned non-effect guard, used before dispatch and before
releasing retained read data. It supplements the common host gate; it cannot
grant permission. If a feature has not exported a separate guard yet, the
coordinator must adapt its actual active-work/resource checks rather than call
the read or mutation again to test access. Mutation operation IDs are minted
and recorded by Staf before effects, then passed into feature idempotency APIs.
The guest cannot choose an operation ID or clear uncertainty.

Session, document and artifact capabilities plug into this same registry when
their owning branches provide concrete contracts. Code Mode does not implement
their storage, extraction, UI, citations, rendering, downloads or revisions.
Structured references remain JSON/schema payloads. First-version binary data
stays behind feature-owned authenticated methods or references. There is no
second direct-model-tool route. A fresh session receives no implicit old-session
history, summary, truncation or replay; older material requires explicit
authorized capabilities or selected references.

### Action lifecycle and terminal fences

For every child, parse the private envelope and registered input schema, reserve
budget and result capacity, assign a host identity, and prepare the action.
Before claiming a one-use start permit, atomically recheck the accepted work,
session binding, generation/fence, current permissions and scope, selected-skill
validity, configuration, exact approval, and unresolved effect constraints.
The external effect runs outside the transaction. Validate and bound its output;
preserve typed outcomes until the provider boundary. Unknown exceptions from a
started changing operation cannot be assumed safe to retry.

Stop, denial, expiry, blocked authority, uncertainty and exhausted limits close
subsequent tool dispatch for the affected accepted work, not merely one guest.
The next outer code call cannot omit a recovery flag to bypass this decision;
every call derives its guard from service-owned state. Denial cannot be caught
and routed around. Denial/expiry can produce a final text explanation without
tools; owner Stop or restart causes no further provider work. Opening denied
work again requires new owner direction and normal policy.

A permit claimed before a fence is in flight and may still take effect. Request
cancellation and preserve observed or uncertain outcomes. Never promise rollback.
On normal script return, close invocation admission, cancel unstarted children,
and allow a five-second settlement grace for started work. A still-unknown change
is reported as uncertain even if the script returned a value. Late observations
amend the original action without reopening dispatch. Restart interrupts live
executions, invalidates pending approvals, cancels prepared work and preserves
started unknown effects as uncertain. It restores no interpreter or program.

### Approvals, concurrency and time

Present one exact approval at a time per agent, including the preserved task
paths. Its 24-hour clock starts when it is presented. Queued requests use a
bounded, non-starving FIFO and are cancelled with their work. Do not introduce a
shorter whole-script timeout that silently clips a presented approval's window.
The finite work call budget and bounded FIFO bound total waiting; successive
approvals can make one request last longer than 24 hours. That is an explicit
consequence of the per-approval choice, not an additional promise of unattended
background execution.

Allow three independent permitted reads in flight. Changing operations are
exclusive and ordered within the script. Active wall time is the union of
periods when the guest runs or an effect is dispatched, including reads running
while another call awaits approval. Pause it only when the work is solely
approval-blocked. Start capability I/O deadlines after dispatch; retain any
existing tighter limit. Guest-running elapsed time is a separate proposed limit,
not a claim to measure true CPU time.

### Results, repair and recovery

Persist the exact accepted source before running it. Reject source before
execution if existing privacy checks would require changing it; do not retain
different code from what executed. Apply access controls and known-secret
redaction separately to arguments, logs, outputs and errors. Unknown secrets
cannot be reliably detected.

Keep successful read data in a bounded **temporary cache for the accepted
request**, allowing a fresh script to reuse it without fetching again. Expose
opaque current-work receipts, not arbitrary result-store access. Releasing a
receipt rechecks the origin scope and current work/skill authority. Every new
execution derives completed and uncertain change guards from service records;
there is no optional caller-provided recovery context. Reconciliation uses
feature-owned resource/operation knowledge or informed owner review, never a
model-authored claim or guessed equivalence of shell commands.

`staf.emit` selects an intentional partial JSON output for durable history;
final returns use the same publication path. Persist selected values before
acknowledging them and include those actual values in terminal provider results,
even after a later failure. Keep source, action outcomes and returned values
independently of the old failed-turn message rollback. Safe journal summaries
are not used as substitutes for returned data. A storage failure after a change
must not be reported as an unrecorded success.

**Retention clarification for this checkpoint:** script variables are fresh per
invocation, but temporary read data may span bounded retry invocations within
the same accepted request. Discard that cache when the request finishes, stops,
expires or is interrupted. Persist only selected partial/final outputs, not
every raw page delivered to a guest. After cleanup, a summary does not imply
that an unreturned raw payload is still available. This interpretation preserves
in-request read recovery without a persistent interpreter or cross-session cache.

Allow at most two code corrections after the original invalid program, only
before any action starts in the accepted work. Failed-read recovery is a fresh
invocation using current-work receipts and normal authorization, not a replay
of the failed program. All invocations consume the same work budgets.

## Synthesis decision

Use candidate 2 as the base for its usable typed result path, source-integrity
rule, presentation-based approval expiry and per-work effect guards. The parent
and independent judge agree on that base; their criterion scores and required
corrections are in [the comparison](comparison.md).

Graft candidate 1's explicit unawaited-child settlement, selected-skill context
propagation, and terminal turn fence. Skill selection must update service-owned
turn context so the model receives the untrusted skill body on its next request,
with validity rechecked before later requests and actions. Replace both drafts'
retention extremes with temporary current-work read receipts and intentional
published outputs. Derive recovery guards and quotas on every execution, and
bind the feature contract's accepted session throughout. No candidate's claims
are treated as runtime proof.

## Tradeoffs accepted for the experiment

- Retain a bounded resident guest during approval waits to avoid replay and
  preserve ordinary JavaScript promises. Idle memory and admission capacity are
  real costs to measure.
- Keep a small deep execution interface while the host implementation owns
  scheduling, policy, storage and recovery complexity.
- Use conservative change blocking where effect status cannot be established.
- Carry a bounded task-only compatibility seam while main-chat capabilities
  migrate. Existing task APIs and history remain available; do not expose both
  equivalent interfaces to the same main-chat turn.

## Alternatives considered

A Monty suspension/feed design moves Python execution into its worker pool and
can represent host-call suspension explicitly. It could improve idle-resource
handling, but adds a Python subset, snapshot/future semantics and binding-specific
questions. A Rust/Wasmtime asynchronous host provides another distinct execution
and ABI structure, with additional interpreter integration and packaging work.
All can hide behind the same service contract; those are alternatives to test
if the JavaScript candidate fails its gates, not parallel production backends.
Reject raw Node evaluation, `node:vm`, unrestricted subprocesses, automatic
program replay, arbitrary service RPC, and a permanent duplicate main-chat tool
architecture. [Runtime source evidence](../../research/code-mode-adoption.md).

## Proposed starting limits

These are unmeasured defaults for the experiment. Existing tighter capability
limits win. Exhaustion is explicit; it does not silently truncate required
results or compact conversation history.

| Scope | Proposed limit |
| --- | --- |
| Accepted request | 4 code invocations, 6 provider requests, 32 child calls including redirects and reuse requests, 2 pre-action corrections |
| Running work | 5 minutes aggregate active wall time and 5 seconds aggregate guest-running elapsed time |
| Guest | 32 KiB source, 32 MiB heap, 512 KiB stack, independently enforced 128 MiB process ceiling |
| Scheduling | 3 reads, 1 exclusive change, 8 pending child calls, 1 presented approval per agent |
| Admission | 1 live guest per main-chat command, 8 resident guests per instance; reject excess before acceptance instead of evicting a waiting guest |
| Data | 256 KiB per child value, 2 MiB temporary read cache, 256 KiB aggregate published output, 32 KiB logs per accepted request |
| Waiting/cleanup | 24 hours per presented approval; bounded FIFO; 5 seconds settlement grace, then explicit uncertainty |

Reserve cache/output capacity before an effect. Required data that cannot fit
must produce a clear limit error or an explicit feature-owned bounded reference,
not an invented answer or silent truncation. The resource experiment may require
revising these numbers before choosing production defaults.

## Open questions and risks

- Can the exact pinned QuickJS/Wasm build and process profile demonstrate the
  required isolation, hard memory ceiling, interruption and cleanup on native
  Linux and Docker, with a usable development path on macOS? Plain subprocess
  supervision or a QuickJS heap setting is insufficient evidence.
- Does the current-request lifetime for temporary recovery data match the
  owner's retention intent? This is the explicit clarification at this checkpoint.
- Can the shared database and approval arbiter preserve fence/permit ordering,
  live revocation, task compatibility and late results under injected failures?
- Which named model/connection pairs meet agreed reliability and cost thresholds
  under a separately authorized evaluation budget?

## Next implementation step

After this checkpoint is approved, build the isolated local executor and
scoped-capability experiment in a dedicated issue branch, using the
[verification plan](verification.md), before migrating production capabilities.
