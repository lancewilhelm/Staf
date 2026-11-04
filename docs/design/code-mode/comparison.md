# Architecture comparison and synthesis

Two architect runner seats used the configured `gpt-6.1-terra` model at xhigh reasoning in independent contexts. A separate cross-judge used the configured pool. The parent read both complete packages and scored them before reading the judge. No production code, runtime experiment, or live Staf provider was run.

## Independent scores

Scores are rubric judgments on uncorrected drafts, not benchmarks or validation of the final proposal.

| Criterion | Weight | Parent: draft 1 | Parent: draft 2 | Judge: draft 1 | Judge: draft 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Requirement fidelity | 25% | 3 | 3 | 2 | 3 |
| Authority and isolation | 25% | 4 | 4 | 4 | 3 |
| Lifecycle and effects | 20% | 3 | 4 | 3 | 2 |
| Interface depth and ownership | 10% | 2 | 4 | 4 | 4 |
| Integration and migration | 10% | 4 | 4 | 4 | 3 |
| Feasibility and reviewability | 10% | 3 | 3 | 4 | 4 |
| Weighted total | | 3.25 | 3.65 | 3.30 | 3.00 |

Both recommended **draft 2 as the base**, conditionally. The judge's numerical total favored draft 1, but its missing result-resolution path and optional-only partial retention were critical contract gaps. Both drafts needed revision before approval; totals did not override acceptance failures.

## Alternatives actually considered

Both preferred a fresh resident QuickJS/Wasm guest with host promises and a service-owned gateway. Draft 1 also developed a Monty suspension/feed alternative with different interpreter state, worker and snapshot lifecycle. Draft 2 developed a Rust/Wasmtime async-host alternative with a different process/ABI and scheduling structure. The independent preference converged; the two whole execution families were considered rather than treating engine settings as different architectures.

Frozen draft packages are retained for review:

- [Draft 1](alternatives/candidate-1.md): rationale, module map and signature sketch.
- [Draft 2](alternatives/candidate-2.md): rationale, module map and signature sketch.

## Corrections and compatible grafts

Use draft 2's typed final value path, exact retained-source rule, presentation-based approval expiry and service-owned recovery guard. Graft draft 1's explicit cleanup of unawaited children, selected-skill context propagation, and terminal-turn fence.

The parent then corrected the shared contract gaps:

- Final and partial values reach the provider formatter as actual bounded values, alongside action outcomes. A bare result ID is not a substitute for output.
- Every invocation derives prior-effect and work-fence constraints from service-owned state. There is no optional recovery flag that a caller can omit. Denial and uncertainty cannot be bypassed by requesting another outer code call.
- Child, output, correction and time limits are cumulative across the accepted request.
- Temporary successful-read data supports bounded retries within the same accepted request. Selected partial/final outputs are durable; successful full raw pages are not all persisted merely because they crossed into a guest. This lifetime clarification is explicit at the checkpoint.
- The action journal remains the sole externally dispatched effect-state authority; execution metadata and UI projections reference it.
- Per-approval expiry starts at presentation. A bounded non-starving FIFO and finite work call count bound total waiting without introducing a shorter hidden deadline that clips a visible 24-hour window.

The owner-authorized feature coordination arrived after the independent drafts. The parent read local contract commit `3e42d18ce6fdc3258304e6312eb269de08662c82` and issue #67, then bound the final registration contract to immutable `{botId, sessionId, commandId, signal}`. Future feature adapters use the same gateway; no feature implementation, second model tool path, compaction, or implicit old-session replay is included. The independent judge has not reviewed those later parent revisions; do not report that it has.

## Red-flag screen of the synthesis

- **Shallow module:** one execute call hides lifecycle, scheduling, budgets and policy. Inspection is a separate read need; owner Stop remains an existing service operation.
- **Information leakage:** worker protocol, interpreter handles, storage rows and approval-policy internals remain private. Feature methods receive a domain context.
- **Temporal decomposition:** gateway owns a child action from validation through result; callers do not coordinate prepare/authorize/start/save stages.
- **Pass-through wrapper:** the Code Mode boundary owns actual lifetime, fencing, retention and resource behavior.
- **Split ownership:** instance/journal is the durable writer; guest and temporary caches own no persistent policy truth.
- **Two equivalent paths:** migrated main-chat turns expose only the code tool. Existing task-only compatibility is bounded migration debt, not another target interface.
- **Importable internals:** production implementation must enforce the proposed public-module boundary with a failing import check; no such enforcement is claimed by a sketch.
- **Hand-synced lists:** registry keys and schemas derive guest metadata, validation and dispatch. Feature-owned service/storage contracts are adapted rather than copied.

## Verification scope

The synthesized registration contract, sketch and real caller examples are checked together with TypeScript 6.0.3 in strict mode. This establishes signature consistency only. Local links, whitespace, scope and retained file hashes are checked separately. Isolation, interruption, native/Docker resource ceilings, callback races, actual feature integration and model reliability remain gates in [the verification plan](verification.md).

