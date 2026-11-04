# Coordination with the overnight feature work

Owner-authorized coordination received during the architecture checkpoint on 2026-11-03. These are integration constraints. Code Mode does not implement the coordinated features in this scope.

The concrete contract was read from local commit
`3e42d18ce6fdc3258304e6312eb269de08662c82` on
`feature/sessions-documents-artifacts`, using `git show` in the supplied
worktree. The [local contract](/Users/lancewilhelm/.t3/worktrees/Staf/feature-sessions-documents-artifacts/docs/design/workspace-feature-contracts.md)
and published [specification #67](https://github.com/lancewilhelm/Staf/issues/67)
are the integration pointers. The commit is not assumed to have been pushed or
to exist at a public GitHub blob URL. Concrete service exports are still being
implemented on the feature branches.

The separate feature work owns storage, service APIs, UI, tests, and narrow typed capability contracts for:

- Fresh agent conversation sessions and explicit search, read, and reference operations over older sessions.
- Document uploads, extraction, search, and citations.
- Revisioned text and table artifacts with previews and downloads.

## Required boundary

Capture the selected conversation session and capability context when a work item is accepted. Every execution, child action, output, retained result, recovery reference, and event remains bound to that accepted work and session. A later session selection in any client must not redirect running work or its writes. Current permissions remain live checks; the selected session is an immutable part of the work context.

Feature-owned capability contracts enter the same registry and host gateway used by Code Mode. Feature APIs remain deterministic service operations for clients, with Code Mode adapters as another authorized caller. Do not create a second direct-model-tool path, expose arbitrary instance methods, or duplicate feature storage and authorization in the executor. Concrete contract pointers will be supplied by the feature work; this design need not wait for their implementations.

The bridge must handle schema-described structured inputs and results, including references to documents, citations, artifact IDs, and revisions. These are typed payloads owned by the feature, not reasons to add binary uploads, extraction, rendering, or artifact storage to Code Mode. The worker protocol and public execution API must remain independent of feature-specific types.

## No compaction or implicit old-session replay

Fresh sessions must not silently summarize, truncate, compact, or replay older sessions. Older-session material enters model context only through explicit authorized search, read, or reference capabilities. Code Mode's temporary current-work result reuse does not become an implicit old-session memory or replay mechanism.

Keep limits on individual capability payloads and explicit output bounds separate from conversation-history behavior. A too-large result or context must be reported clearly; limits do not authorize silent removal or summarization of conversation history.

## Consequences for the sketch

Use one service-minted accepted-work context instead of looking up an agent's mutable current-session pointer during dispatch. Use the feature-owned session identifier type once its contract lands; any local type in the design sketch is a placeholder, not a competing implementation. Scope temporary read receipts to the current accepted work and session, and recheck their origin capability's current authorization before release. A newly selected session cannot read prior-session temporary results by implication.

This constraint is incorporated by the parent synthesis after the independent draft review. It does not require another production feature or a second executor architecture.


## Executable experiment contract

Issue #74 provides [the actual registration contract](../../../src/code-mode/contract.ts)
and [its integration reference](experiment.md#integration-contract). The checkpoint
sketch remains historical. Adapters retain the exact accepted context and can use
the additional `call.signal` to cancel an individual execution. No feature-owned
services are implemented here. The integration commit is supplied with the PR.

`checkScope` now returns a `ScopeClaim`, created with `scopeClaim`. Its callback
must synchronously assert current feature authority and return `undefined`.
This closes the gap between async scope validation and the atomic start permit.
It checks authorization, not whether the feature's content revision still has its
pre-change value. The feature operation remains responsible for its own revision
preconditions and `operationId` handling. The exact public types and the
synthetic examples are in the executable contract and tests.
