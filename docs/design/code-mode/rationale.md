# Code Mode architecture checkpoint

The [execution experiment](experiment.md) records current implementation and remaining gates. This document preserves the approved target design.

Approved by the owner on 2026-11-03 as the basis for the bounded execution experiment, including the current-request recovery-cache lifetime and proposed starting limits. This is not implemented behavior or approval to adopt an unverified production executor. [Full design and limits](design.md).

## Problem

Staf needs one model-facing code interface while retaining service-owned permissions, approvals, history and recovery. Existing string callbacks lose important outcomes, and their deadlines include approval waiting. The new application features also require an accepted session context instead of an agent-wide current-session pointer.

## Usage (caller's view)

The shared turn makes one call:

```ts
const report = await codeMode.execute({work, providerCallId, source});
const result = codeToolResult({providerCallId, report});
```

A fresh guest calls registered methods and returns JSON. It can select durable partial output with `staf.emit`. Owner Stop stays on the existing shared-service route. [Three type-checked caller examples](usage.ts) cover the turn, scoped application registration, and Stop.

## Shape

Run generated **JavaScript in QuickJS/Wasm inside a supervised local process**. The guest gets a narrow call/result bridge, no Node evaluation, service object, credentials, filesystem, network or module loader. Exact platform isolation and hard resource limits must pass the experiment.

One capability registry derives names, schemas, descriptions and dispatch. The host validates each call, rechecks live authority, presents exact approvals and atomically orders start permits against terminal fences. The instance/journal remains the durable writer; the worker owns only temporary state. The interface hides scheduling, persistence, timers and cleanup behind `execute` and read-only inspection.

Capture immutable `{botId, sessionId, commandId, signal}` at acceptance. Future session, document and artifact methods use the same [registration contract](capability-registration.ts); their implementations remain separately owned. No new direct-model-tool path or implicit old-session compaction/replay is introduced. [Pinned integration evidence](coordination.md).

## Synthesis decision

Both independent drafts preferred resident QuickJS/Wasm. The parent and cross-judge chose draft 2 as the base for its usable typed result flow. Graft draft 1's unawaited-child settlement, selected-skill propagation and terminal-turn fence. Correct both with cumulative work budgets, mandatory effect/recovery guards, and bounded read-result reuse. [Scores, rejected ideas and red-flag checks](comparison.md) retain the decision trail; the final revisions have not been independently re-reviewed.

## Tradeoffs accepted by this proposal

- Retain a bounded guest during approval waits to avoid program replay.
- Keep host complexity behind a small interface and conservatively block uncertain changes.
- Preserve a task-only compatibility seam while migrating main chat; never offer equivalent direct tools alongside code in the same migrated turn.

## Alternatives considered

Monty's suspension/feed interpreter and a Rust/Wasmtime async host offer different state/ABI/resource structures but add unverified integration and packaging work. They remain alternatives if the JavaScript experiment fails, not parallel production backends. Raw Node evaluation, `node:vm`, unrestricted subprocesses and automatic script replay are rejected.

## Open questions and risks

The checkpoint explicitly clarifies temporary-data lifetime: **successful read data may be reused across fresh scripts within the same accepted request, then is discarded when that request ends**. Only selected partial/final outputs are durable. There is no cross-session result cache.

Each presented approval has its own 24-hour window; several approvals may make a request last longer than 24 hours. Finite call budgets and a bounded non-starving queue constrain waiting.

Native/Docker isolation, resource ceilings, cancellation/recording races, real feature bindings and named model reliability remain unproven. Exact limits are proposed, unmeasured starting points in the full design.

## Next implementation step

After checkpoint approval, create the scoped execution experiment in a dedicated issue branch and exercise the [verification gates](verification.md) before migrating production capabilities.

