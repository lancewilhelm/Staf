# Code Mode verification plan

This is the adoption verification plan from the architecture checkpoint. The [execution experiment](experiment.md) records the implemented subset and its evidence limits. The owner-confirmed [product decisions](../../adr/0005-service-owned-code-mode.md) are the acceptance boundary. Numeric limits in the design are proposed defaults until the local experiment measures their cost.

## First end-to-end slice

Drive a shared main-chat command through a synthetic provider, the real candidate executor, a host capability, an exact owner approval, persisted child progress, and a returned result. Use a disposable instance and synthetic source data. The initial slice must also demonstrate Stop from a second paired client and an interrupted restart without replay.

## Required observable cases

| Case | Required result |
| --- | --- |
| Ordinary chat | A response that does not use tools starts no guest execution. |
| Simple and dependent work | Clock-like work and a source-search/read/filter chain return the expected values, with actual child actions attributed to the outer execution. |
| Constructed unsafe request | A URL or argument assembled inside the guest still passes the normal host validation and policy boundary. Source-text scanning is insufficient. |
| Unauthorized service access | Guest code cannot obtain credentials, mutate owner-only memory or settings, call arbitrary instance methods, or use an unregistered capability. |
| Denial caught by guest code | Denial ends the execution even if the guest catches its error. No later child is dispatched, and the agent cannot use a new route to perform the denied action. Already observed outcomes remain visible. |
| Long approval wait | A controlled clock advances to the agreed 24-hour boundary. Approval wait does not consume active execution time, stale decisions cannot dispatch, and expiry retains completed results. |
| Parallel reads and ordered changes | Host concurrency bounds hold, changing actions do not overlap within a script, and each agent has at most one presented approval request. |
| Revocation while queued | Current permissions, scope, grants, selected-skill availability, and work state are checked again before dispatch and before releasing a retained result. |
| Stop during computation or waiting | Guest computation is terminated, pending approvals close, and later child requests cannot dispatch. Host operations receive cancellation where supported; late or unknown effects remain accurately recorded. |
| Unawaited child calls | An outer result does not hide unfinished host effects. Every accepted child reaches an observed or explicitly uncertain outcome, and no orphan continues with untracked authority. |
| Worker or service failure | Kill a worker at the effect/recording boundary and restart a disposable service. The record distinguishes completed and uncertain effects and does not automatically rerun the program. |
| Invalid code and repair | Pre-action errors use a fixed correction budget with the selected model. Exhaustion is clear; neither the model nor the old tool interface is silently substituted. |
| Partial recovery | A failed read can be retried using preserved successful results without repeating completed reads. Uncertain changes block blind retry. Recovery access remains scoped, bounded, and revocable. |
| Retention and privacy | Generated code, actual actions, and returned full or partial results remain inspectable after a later provider failure. Unused temporary payloads are discarded. Known credential redaction and existing URL/privacy restrictions remain intact. |
| Malformed bridge traffic | Unknown names, extra fields, oversized values, duplicate or stale identities, invalid prototypes, and late responses cannot acquire host authority or corrupt another execution. |
| Existing product behavior | Pairing, captured profiles, one response per agent, GUI/CLI continuity, historical transcripts, owner-controlled operations, and deferred background-task APIs/history retain their documented behavior. |
| Accepted session binding | A later client selection cannot redirect running work, child calls, result receipts, or event writes. Every application method receives the accepted bot/session/command/signal and rechecks active work. |
| Extension contract | A synthetic scoped application read and revisioned change register through the same schema/gateway contract without a new provider tool. Feature storage, extraction and rendering remain outside the executor. |
| Fresh-session context | No old-session messages, summaries, replay, or temporary receipts enter a fresh session implicitly. Older-session material requires explicit authorized operations or selected references. |

## Evidence stages

1. Type-check the design sketch and caller examples. This establishes signature consistency only.
2. Run the real local executor with deterministic capability fixtures and controlled time. Use fault injection for denial, expiry, worker death, Stop, and recording gaps.
3. Run shared-service and paired-client integration checks. A synthetic provider exercises the production request/result shape but does not establish live model behavior.
4. With an agreed model list and budget, evaluate actual target connection/model pairs on the same simple and compound tasks. Record success, corrections, failures, context, latency, and cost separately. Set thresholds before the runs.
5. Demonstrate installation, cleanup, bounded resources, restart behavior, and updates on the supported native and Docker paths.

Any authority bypass, silent repeated uncertain change, lost required result, or inability to stop dispatch is an adoption blocker. A successful fixture or type check does not prove production isolation, live provider compatibility, or model reliability.

## Checkpoint checks already run

The three proposal TypeScript files passed strict type checking with Node
22.22.3 and TypeScript 6.0.3. The checked examples exercise the registration and
execution signatures; no placeholder implementation was executed. Local design
links and whitespace were checked. Existing dirty-file hashes showed only the
intentional decision-record updates from the owner-authorized coordination.

To repeat the signature check from the repository root, with the repository
dependencies already installed, run:

```sh
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --skipLibCheck docs/design/code-mode/capability-registration.ts docs/design/code-mode/sketch.ts docs/design/code-mode/usage.ts
```

Expect no output and exit status 0. This does not run Staf, a sandbox, feature
services, or provider inference. Those checks remain the proposed experiment.


## Runtime experiment

The focused commands and current evidence are in [experiment status](experiment.md)
and [the developer review procedure](../../development.md#review-the-code-mode-experiment).
Uncompleted gates in this plan still block production migration.
