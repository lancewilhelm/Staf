# Workspace implementation review

Reviewed base `30b8ea3a57a06e6134db9f7a385ee271356ca0bb` through
`7e67a0feb5932d3a379788881e188b9b3272769e`. The Standards and Spec reviews are
independent. Static review evidence is separate from the execution checks below.

## Standards

The reviewer reported two findings and no separate maintainability judgments:

1. **P1: Fresh sessions can receive results from older work.** Session creation
   blocked pending chat commands but allowed active background tasks. Their later
   notices could be assigned to the fresh session. This violates the original-
   history isolation decision. Fix: refuse session creation while the agent has
   queued, running, stopping, or waiting background work.
2. **P2: Upgrade recovery for verifiable older drafts was removed.** The new
   session-scoped loader stopped recovering earlier keys even when the stored
   command proved the originating agent. This contradicted the retained-draft
   decision and development documentation. Fix: recover older keys when the
   command also proves the current session, submitted text, and captured source
   identities. Keep foreign, unverifiable, and older-session records for copying.

Both fixes are implemented. Before the fixes, the background regression failed
with `Missing expected exception`, and the served upgrade journey timed out
waiting for automatic recovery. The same checks then passed:

```sh
node --test --test-name-pattern='older background' test/workspace-integration.test.js
node test/browser/session-recovery-smoke.mjs
```

The upgrade journey covers both earlier key formats, exact command preservation,
foreign-agent and older-session rejection, and zero provider resubmissions.

## Spec

The independent Spec review is still in progress.
