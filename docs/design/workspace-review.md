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

The reviewer reported three findings:

1. **P1: Terminal drafts can be sent into a different session.** The interactive
   terminal did not retain or submit the session identity. Fix: capture the
   session and dataset when connecting, retain them in every unsent draft, and
   send the explicit session at acceptance. Edits and retries preserve the
   identity; stale or unverifiable drafts stay copy-only. The running terminal
   also retains its original context after another client starts fresh.
2. **P2: History search does not open the matching message.** Opening a result
   or cited source loaded only the first page. Fix: resolve the page containing
   the same-agent, same-session message in the service, then focus and highlight
   that exact message. Previous and following pages remain available.
3. **P2: Reference-only drafts are hidden after a session change.** The earlier
   records list required text or a submission. Fix: include nonempty source
   selections, preserving their original draft identity for inspection/copying.

All three fixes are implemented. Before the fixes, the terminal regression sent
its saved draft into the fresh session, the history regression could not find
its requested message, and the served recovery journey timed out waiting for
the earlier source-only draft. The same checks passed after correction:

```sh
node --test test/terminal-instance.test.js
node --test test/workspace-integration.test.js
node test/browser/history-navigation-smoke.mjs
node test/browser/session-recovery-smoke.mjs
```

The history journey opens a message beyond the first 100 through both search
and a cited source, verifies keyboard focus, and checks that browsing does not
change the active session. Terminal checks use a disposable daemon and offline
Demo; browser checks use disposable stores with external networking blocked.
Neither review nor these checks verify live providers or Docker execution.


## Integrated verification

After resolving the findings and merging the approved avatar delivery:

- `corepack pnpm run check` and `corepack pnpm run build` passed.
- `corepack pnpm test`: 503 passed, zero failures, three Docker-specific skips.
- Served workspace, session, session-recovery, history-navigation, dataset,
  memory, agent-images, and general GUI journeys passed. Light and Dark narrow
  workspace screenshots were inspected locally.
- 116 local file links across 22 changed Markdown files resolved.

Standards: two findings, worst P1, both corrected. Spec: three findings, worst P1,
all corrected. The independent reports reviewed the pinned implementation;
corrections were verified by the coordinator with execution checks. No follow-up
independent review of those corrections is claimed.
