# Basic tools acceptance

[Spec #78](https://github.com/lancewilhelm/Staf/issues/78) uses a disposable Staf
instance and its paired API as the main acceptance boundary. Providers return
controlled responses. QuickJS, SQLite, files, scoped memory, native shell
processes and interactive terminals are real local components.

## Repeatable checks

Build before individual tests, then run the required repository checks:

```sh
corepack pnpm run build
node --test test/basic-tools-acceptance.test.js
corepack pnpm run check
corepack pnpm test
node test/browser/gui-smoke.mjs
```

The existing [development setup](../../development.md#verify-a-change) supplies the
Node and package-manager prerequisites. The GUI journey uses a disposable browser
profile and the existing controlled service fixture, with outbound browser
traffic blocked. It pairs a separate CLI with that same service.

| Requirement | Observable acceptance |
| --- | --- |
| Three modes and dispatch enforcement | [Chat bridge](../../../test/chat-code-bridge.test.js): offered sets, rejected forged calls, captured profiles, settings changes, denial, Stop and bounds. |
| Combined new capabilities | [Combined workflow](../../../test/basic-tools-acceptance.test.js): skill load, actual file write/edit/search, memory create/update/forget and retained native input in each mode; ten unique completed actions and linked code records. |
| Restart without replay | The combined workflow reopens the same SQLite file, retries the original request IDs, verifies unchanged action identities and retained bytes, and rejects any provider rerun. |
| Uncertain changing effects | The paired SQLite fixture changes a memory but raises an error before returning its receipt. A later changing call is fenced in Direct, Hybrid across styles, and Code Mode. The stored version proves the first effect occurred once. |
| File and memory details | [Files](../../../test/file-actions.test.js) and [memory](../../../test/memory-tools.test.js): real bytes, paging, explicit paths, failed/current-version edits, scope isolation, faithful shared confirmation and pre-journal privacy. |
| Native ownership and interaction | [Native processes](../../../test/native-process.test.js), [lifecycle](../../../test/native-process-lifecycle.test.js), [interactive terminals](../../../test/native-interactive.test.js), and [privacy](../../../test/native-process-privacy.test.js): pipe/PTY, input/EOF/resize, retained lifetime, second-client controls, Stop, group observation, restart uncertainty and filtered bytes. |
| Background and delegated work | [Task actions](../../../test/task-work-actions.test.js): actual attempt ownership, accepted modes and revisions, helper mode, restrictions, approval deferral, Stop and registered capability parity. |
| Existing capabilities and replay | The chat and task fixtures cover registered clock, web redirects, configured search, scratch dispatch, skill loading, revocation, completed-result release and later provider replay. Scratch transport is controlled; this is not Docker execution. |
| GUI and CLI agreement | [Served GUI journey](../../../test/browser/gui-smoke.mjs): saves every mode, creates file/memory from chat, revises them through the paired CLI, inspects code/result/action IDs, submits keyboard input to a retained PTY, resizes it and observes CLI Stop. Existing appearance, navigation, approval and narrow-layout checks run in the same journey. |
| Distribution and legacy behavior | The full suite includes [packed installation](../../../test/distribution.test.js), [real worker](../../../test/code-mode-worker.test.js), configuration/defaults, migrations, native dependency installation, replay, streaming and usage regressions. |

The [offline manual journey](../../development.md#review-chat-locally-without-a-provider)
uses the same fixture and needs no model credentials.

## Evidence limits

Local native and GUI verification was performed on macOS arm64 with Node
22.22.3. Linux runtime, Windows, remote hosts, live providers and production
deployment were not verified. Docker-dependent tests are reported separately
as skipped; controlled scratch dispatch does not establish Docker behavior.

File edits check the current hash immediately before writing; this is not an
atomic compare-and-swap against independent host writers. File Stop coverage
prevents dispatch before the effect; it does not demonstrate interruption during
an in-progress filesystem write. Escaped or detached process descendants can
survive group Stop. Lost process observation remains unknown, and restart never
reattaches or signals a remembered PID.

QuickJS coordinates service capabilities. Host terminal and file capabilities
use the service account's access; this feature does not establish a host sandbox.
Project attachment, automatic self-improvement, compaction, and the rejected
sessions/documents/artifacts implementation remain outside this delivery.
