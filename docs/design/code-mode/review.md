# Code Mode experiment review resolutions

The fixed base is `9eb427232a44c3bc947caf79e0ad4cbd31fa8ea3`. Two independent
reviewers examined implementation commit `2c5caa8`, against issue #74, the owner
ADR, the approved design and repository standards. They used the configured
`gpt-6.1-terra` model at xhigh reasoning. Reviewers did not edit files or use live
providers. Standards reproduced its scope-wait finding; Spec performed a static
review.

## Standards

One documented-standard finding. An asynchronous scope check could keep a
resident guest outside the active-time budget, contradicting the documented
approval-only pause rule. No additional material heuristic smells were reported.

Resolution: async scope checks count as active work. The active deadline kills
the guest and closes admission. Settlement cancels an unstarted action even when
its feature guard never resolves. The focused stalled-scope test failed before
the fix and now passes.

## Spec

Four findings, including the shared scope-wait finding.

- Completed changes could repeat in a new recovery script. The host now derives
  a durable keyed identity from accepted work and normalized action arguments.
  Journal checks block matching successful changes before approval and inside
  the start transaction. Reports retain observed change identities. The recovery
  test failed before the fix and now proves one invocation.
- Async feature scope validation left a gap before permit claim. `checkScope`
  now returns an opaque `ScopeClaim` with a synchronous current-authority
  assertion. The host runs that assertion in the permit transaction and before
  releasing data. A regression revokes scope at the final assertion and proves
  that neither the action nor an alternative route starts.
- Final policy revocation cancelled only its child. The host now persists a
  request fence after the failed transaction rolls back. A regression proves
  that caught errors and new outer invocations cannot resume dispatch.
- A stalled scope check could wait indefinitely. The active-budget correction
  described under Standards resolves this finding too.

The parent made these corrections and ran their focused checks. No second
independent review is claimed. Hard native isolation, the total process ceiling,
Docker enforcement and named live models remain adoption gates, as both reviews
recognized.

## Current-main integration

Main advanced to `d8d5efd143bd6f083cd0dc3576142d2ffaa93574` during delivery.
The parent merged its memory settings, persistent development-data workflow and
agent-image changes, preserving both sides of the documentation, dependency and
service conflicts. Maintenance checks, `finishUpgrade`, public-origin options
and agent-image behavior remain present.

The combined branch passed type checking and the full suite on 2026-11-04:
515 tests, 512 passed and three Docker skips because the daemon was unavailable.
The served GUI and agent-image smoke journeys also passed with synthetic
fixtures and no live provider requests. This integration check does not change
the uncompleted adoption gates.
