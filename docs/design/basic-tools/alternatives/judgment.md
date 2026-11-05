# Independent candidate judgment

The independent cross-judge compared [candidate A](candidate-a.md) and [candidate B](candidate-b.md) against issues 78 and 79 and the architect design red flags. The judge used `gpt-6.1-terra` at `xhigh`, read both candidates, and did not edit the synthesis. Scores are relative design assessments, not test results.

| Criterion | A | B |
| --- | ---: | ---: |
| One turn and action lifecycle, captured work, and live authority | 4 | 4 |
| Recovery identity and intentional repeated commands | 4 | 3 |
| Native process lifecycle and uncertainty | 4 | 4 |
| Memory, privacy, result bounds, and PR 75 integration | 5 | 5 |
| Interface depth, extensibility, and implementation seams | 4 | 5 |

The judge recommends A as the base. Its service-issued invocation namespaces and atomic single-use repeat challenge address changed provider IDs, concurrent repeated calls, and the set of matching earlier actions more concretely. Graft B's capability-owned overlap and reconciliation semantics, ordered per-process input with distinct action IDs, pipe EOF, and explicit encoding behavior. Do not require trivial reads to implement empty recovery hooks.

The judge identified corrections needed before synthesis:

- A describes a task `capturedChatId`, but current task acceptance stores a captured context array and an isolated helper can have an empty context. Use an explicit captured task context without claiming a current context ID.
- A's recovery epoch wording says to match actions since the epoch began, although the failed script's actions precede the epoch. Include those actions and relevant recovery lineage in the atomic matching set.
- A places the repeat declaration in capability input in its example but outside that input in its signature. Specify one envelope for both routes.
- B's route/call ID mapping omits a provider response or guest execution namespace, and its repeat decision lacks an atomic single-use challenge over all matching actions. Neither source text nor an arbitrary model declaration proves distinct intent.
- B's suggested residual-risk authorization must not silently clear an unknown effect. Reconcile uncertain effects before a potentially overlapping retry.
- A service transaction can atomically claim a permit and check database authority, but cannot make arbitrary filesystem or shell effects atomic with SQLite. Preserve feature-specific version checks and report external races and unknown outcomes.

Both candidates agree on one normal turn, one common admission path, scoped memory, process ownership independent of QuickJS, no PR 72, and no automatic replay. Both propose that a previously retained process can survive a work Stop; the synthesis recommends stopping processes originating from active work and leaves that choice visible at the owner checkpoint. The judge did not review the final synthesized edits, so this record does not claim a second review of them. No production behavior or runtime verification is claimed.
