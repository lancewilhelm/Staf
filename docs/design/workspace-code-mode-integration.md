# Workspace capability integration

Workspace services are independent of model calling style. The owner selected
Direct, Hybrid, and Code Mode on 2026-11-04. Both individual tools and script
capabilities must call the same service-owned operations with the same accepted
context, authority checks, and action records. This supersedes the earlier
blanket prohibition on a second model-facing calling style.

The [revised checkpoint](https://github.com/lancewilhelm/Staf/blob/02637da8552fcf65de85872f165943ff11ea7786/docs/design/code-mode/tool-modes.md)
records the three modes. Hybrid for new agents, legacy Direct, and an initial
chat-only scope are proposals awaiting that checkpoint. PR #72 adds no mode
selector or model-tool registration. PR #75 remains a separate synthetic
execution experiment; neither its historical sketches nor its runtime are
imported here.

## Existing service boundary

`workspaceCapabilities(instance, scope)` takes the service-owned
`{botId, sessionId, commandId, signal}` captured for an accepted command. It copies
those values, checks the pending command's audience and session, and returns
session, document, and artifact adapters. Every call checks authority again.
Stop or an aborted signal blocks further calls. Neither calling style may
replace this context with guest input or a mutable current-session selection.
Existing comparisons to the current session reject stale work; they do not
retarget it. The entry point is [workspace-capabilities.ts](../../src/workspace-capabilities.ts).

Fresh sessions preserve originals without compaction, summarization, truncation,
or implicit old-session replay. Only explicit source reads and selections cross
that boundary. Artifact operations retain their identities, input fingerprints,
provenance, expected revision, and immutable saved revisions.

| Suggested capability | Application method | Effect |
| --- | --- | --- |
| `sessions.list` | `sessions.list(offset, limit)` | Read session metadata. |
| `sessions.search` | `sessions.search(query)` | Read bounded matching excerpts. |
| `sessions.read` | `sessions.read(sessionId, offset, limit)` | Read an explicit original session page. |
| `sessions.resolve` | `sessions.resolve(reference)` | Read an original message excerpt. |
| `documents.list` | `documents.list(offset)` | Read active source metadata. |
| `documents.search` | `documents.search(query)` | Read matching passages. |
| `documents.resolve` | `documents.resolve(documentId, excerptId)` | Read an active passage. |
| `artifacts.read` | `artifacts.read(id, revision)` | Read one immutable revision. |
| `artifacts.create` | `artifacts.create(input)` | Create a deliverable. |
| `artifacts.revise` | `artifacts.revise(id, input)` | Append an immutable revision. |
| `sources.resolve` | `resolve(reference)` | Read an explicit source excerpt. |

These are scoped application methods, not registered model tools. Later adapters
for either calling style must enter one common action service for validation,
approval, denial, expiry, uncertainty, dispatch, and recorded outcomes. Feature
methods recheck their own authority and retain feature data; they do not create
a second approval or action journal. A denial or completed-change guard must
apply across both calling styles.

## Executable-contract compatibility

Static comparison used PR #75 at `02637da8552fcf65de85872f165943ff11ea7786`.
Its executable [contract](https://github.com/lancewilhelm/Staf/blob/02637da8552fcf65de85872f165943ff11ea7786/src/code-mode/contract.ts),
[host](https://github.com/lancewilhelm/Staf/blob/02637da8552fcf65de85872f165943ff11ea7786/src/code-mode/host.ts),
and [protocol limits](https://github.com/lancewilhelm/Staf/blob/02637da8552fcf65de85872f165943ff11ea7786/src/code-mode/protocol.ts)
retain the capability contract published at `617cb72e79455fe302012b49102ddac2314932fa`.
The design sketch is not the executable contract. The following gaps remain for
adoption, rather than blockers for the independently usable workspace:

- `applicationCapability` requires input and output `DataSchema` codecs, effect
  and `ResourceScope` declarations, and asynchronous `checkScope` and `invoke`
  callbacks. The workspace exports ordinary typed methods and feature parsers.
  Registration must adapt those methods, validate their JSON inputs and outputs,
  and derive resource ownership from accepted work. Do not duplicate feature logic.
- `checkScope` returns a `ScopeClaim` whose synchronous `assertCurrent` runs again
  at dispatch and receipt release. Constructing the workspace factory checks
  active work without fetching source content, but it exports no reusable claim
  or target-specific revision assertion. Adoption needs metadata-only assertions
  for source retirement and target ownership or revisions. Calling `resolve`,
  `read`, or a mutation to manufacture a scope check would fetch content or
  repeat effects and is incorrect.
- `CapabilityCall` retains the accepted `context.signal` and adds an execution
  `signal`. Existing factories bind only the accepted signal. Adapters must
  check the additional signal at scope assertions and invocation, including
  after waits. Future asynchronous operations must also honor execution
  cancellation without replacing or mutating the accepted context.
- The executable JSON boundary limits inputs and outputs to 256 KiB. Workspace
  artifact revisions allow 1 MiB, and history pages can exceed that JSON budget.
  Registration needs explicit smaller input bounds, paged or excerpt read
  contracts, and bounded mutation receipts. Reject unsupported sizes before
  dispatch. A successful
  artifact write followed by an oversized return cannot be treated as a safe
  retry. Preserve the original and saved revision; do not silently truncate
  history or artifact content to fit the executor.
- Artifact writes require the host-minted `call.operationId`, not a guest-chosen
  replacement. The experiment mints UUIDs, which satisfy the feature's
  1–100-character word-or-hyphen rule. Its general operation-ID type allows up to
  256 characters, so the registration must preserve the narrower feature rule.
  Exact retries must retain the operation ID and `expectedRevision`. Cross-style
  completed-change and uncertain-outcome handling belong to the common action
  service; the artifact operation table is the durable feature receipt.

The experiment's `Instance.codeModeStore` also rejects every agent-profile
revision change. The revised checkpoint already calls for replacing that broad
comparison during adoption. Workspace adapters retain accepted work and recheck
live authority without adopting that broader profile-revision rule.

## Review sequence and evidence

Review and land PR #72 only with owner authorization. Then update and review
PR #75 against the combined main. The selector and common action-service adoption
belong to a separate tracked feature after the architecture checkpoint and both
PR reviews. No selector, terminal access, file editing, or executor integration
is part of this alignment.

Prior offline integration tests invoke real scoped methods with a pending
command, mutate the caller's original context, and request Stop. The audience
stays captured and later calls stop. Prior service and browser checks exercise
explicit references without an executor. This coordination adds static contract
comparison and documentation/link checks only. It does not refresh those test
runs or prove host registration, combined execution, Docker, or live providers.

Fresh alignment checks passed: `git diff --check`, 55 local links including
anchors, four commit-pinned source or design targets, and 17 GitHub issue or PR
targets across seven changed Markdown files. No runtime code changed, so the
prior offline and browser checks were not rerun. No Docker access or live or
billable provider requests were used for this coordination.
