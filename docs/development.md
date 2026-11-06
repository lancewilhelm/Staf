# Develop Staf

Use Node.js 22.16 or later and Corepack. The `packageManager` field in
`package.json` selects pnpm 12.16.1, which also matches the Docker build.
Use Corepack explicitly so a different `pnpm` earlier in your PATH does not
select a different version:

```sh
node --version
corepack pnpm --version
corepack pnpm install --frozen-lockfile
```

If an existing `node_modules` was installed with another pnpm major version,
reinstall the locked dependencies with the pinned version. pnpm may ask to
recreate `node_modules`; this does not remove instance data or credentials.

Keep the exact pnpm version aligned in `package.json` and `Dockerfile`. Upgrade
it deliberately after checking the registry's stable `latest` tag, regenerating
the lockfile, and running the checks below. The lockfile also records pnpm 12's
package-manager dependencies; application dependency versions remain locked.
The `start` and `test` scripts invoke their nested build through Corepack so a
different global pnpm does not override the project pin.

The distribution test uses the version from `package.json` for packing and
production installation. pnpm 12 excludes the root lockfile from `pnpm pack`, so
an extracted package installs production dependencies from its manifest with
`--no-frozen-lockfile`; this is separate from a repository or Docker build,
which must use `--frozen-lockfile`. Package installs follow manifest ranges and
do not provide the repository lockfile's exact dependency selection.

## Run the development workspace

After the pinned-toolchain setup above, run:

```sh
corepack pnpm dev
```

Open `http://127.0.0.1:3210/` and enter the one-time pairing code printed by
the launcher. The launcher identifies the checkout, data directory, URL, and
backend status. It uses `~/.staf/development` by default, outside worktrees and
separate from `~/.staf/terminal-instance`. It keeps the database, agent files,
provider credentials, and ChatGPT registration identity there across launches
and checkout changes. It does not import another tool's sign-in.

To use connections from an existing **Staf** instance while keeping development
conversations separate, stop the existing instance and set
`STAF_DEV_CONNECTION_DIR` to its data directory before launching. The launcher
reports the selected connection directory and uses the same Staf credential and
registration files. Do not run both instances against that connection store at
the same time. Connection changes, logout, and token refresh affect the shared
store. Nothing is copied or imported from another tool. Unset the variable to use the
development instance's own connection store. Avoid copying a live rotating
credential into two independent stores.

`STAF_DEV_DATA_DIR` explicitly selects another development data directory
outside the active checkout. If it points to an existing Staf instance, stop its
owner first: this selects the entire instance and its conversations, not a copy.
Unset it to return to the separate default development instance.
`STAF_DEV_PORT` changes the loopback workspace port when necessary; use the same
port to retain that browser origin's paired state and drafts.

Frontend edits hot reload. Edits under `src/` and `tsconfig.json` compile and
restart the backend; a compilation error leaves the previous backend running
and is reported in the launcher. A restart interrupts unfinished work under the
existing recovery rules: it does not replay uncertain provider or tool actions.
Browser clients reconnect and retain their local drafts. Only one development
launcher may own a data directory; it reports the active checkout on contention.
A conflicting workspace port also reports the checkout when another Staf
development launcher owns it. The SQLite lock still protects against other
instance launch paths. Stop the launcher with Ctrl+C; its Vite server and backend
stop with it. It does not stop other instances.

For an interactive terminal connected to this same instance, press Enter in
the launcher for a fresh pairing code, then in another terminal run:

```sh
mkdir -p "$HOME/.staf/dev-client"
node dist/cli.js instance pair http://127.0.0.1:3210 "$HOME/.staf/dev-client/client.json" PAIRING_CODE
node dist/cli.js --data-dir "$HOME/.staf/dev-client" --instance http://127.0.0.1:3210 --credential "$HOME/.staf/dev-client/client.json"
```

Replace `PAIRING_CODE` with the newly printed code. The launcher compiles the
CLI on startup. The terminal keeps its pending-command recovery files in the
separate `dev-client` directory. Pair once; reuse the client file on later launches. Use the
selected port in both commands if changed. The terminal opens the shared main
chat; other agents are accessible through `node dist/cli.js instance help`.

## Reset and recover development data

Stop `corepack pnpm dev` and any other instance using the selected data directory.
To build the synthetic seed for the current checkout, run:

```sh
corepack pnpm dev:reset
corepack pnpm dev
```

The reset prints a complete backup directory and creates new agent IDs. The seed
contains Demo agents, short and long conversations, memories, an empty chat, and
a synthetic failed request. It does not authenticate or call a provider. Normal
starts retain edits and never run the reset. Reset leaves the `auth` directory
and any selected `STAF_DEV_CONNECTION_DIR` intact. Use the same environment
variables for reset, recovery, and startup.

Reset removes paired client authorizations. Pair browsers and CLI clients again
with a new launcher code. Browser drafts and pending creations are scoped to a
dataset; records from a prior dataset stay separate. On an ordinary upgrade,
older unscoped drafts with a matching stored command and agent, and creations
with a matching stored operation, can recover automatically. Other unscoped
records remain in browser storage. Open **Earlier browser records** to inspect
and copy their text and operation IDs; Staf cannot establish their origin or
submit them automatically. Copy needed text before resetting. Normal backend
restarts keep the dataset identity and recover current records.

Staf writes a backup under the development data directory before reset and before
a supported schema upgrade. It includes SQLite and authoritative agent files,
but not provider credentials. Protect the backup like the original conversations.
If startup reports interrupted maintenance, stop all instances and run:

```sh
corepack pnpm dev:recover
corepack pnpm dev
```

Recovery keeps the original dataset if replacement had not begun, or restores
the complete prior copy if replacement was interrupted. If publication had
already completed, recovery finalizes it instead of rolling it back. The marker
remains until recovery succeeds, including after another interruption.
Recovery does not resume requests. If a schema is newer than the checkout, select
a compatible checkout, or explicitly reset the seed. To restore an earlier backup,
stop the instance and pass a backup directory printed by Staf:

```sh
corepack pnpm dev:restore BACKUP_DIRECTORY
```

Restore saves the current dataset first. It retains current provider connections,
clears restored client authorizations, and assigns a fresh browser dataset identity.
When the backup predates the first database, restore leaves an empty SQLite database
ready for initialization, so the database path remains protected during publication.
Use code compatible with the restored schema. The command does not automatically
start Staf. If restore is interrupted, `dev:recover` restores the state from before
that restore. Keep backups until you have checked the restored content. An abrupt
process termination can leave private staging directories in the data directory.

For a disposable offline check, run `node --test test/dev-launch.test.js` and
`node test/browser/dev-smoke.mjs` and `node test/browser/dataset-smoke.mjs` after installing dependencies. The latter
requires the Chrome executable described below. These checks use synthetic
credentials and demo responses; they do not prove live sign-in, token refresh,
provider access, or inference.
With commit `d2ab6fc` available in local Git history, `node test/manual/older-writer-probe.mjs`
also runs its actual older constructor against a paused replacement and after a
forced interruption. It requires a prior build and uses a disposable data directory.

## Verify a change

The browser interface uses Vue single-file components with Composition API and
`<script setup lang="ts">`. Start at `web/App.vue` for navigation and
`web/components/` for chat, agent settings, provider choices, and notifications.
`web/workspace.ts` exposes the existing client controller as a shallow Vue ref;
the controller owns API calls, draft recovery, polling, and response streams.
One controller survives `App.vue` hot reloads so it retains browser draft locks.
The CSS in `web/style.css` and `web/toasts.css` owns appearance.

Vite builds the browser assets; `vue-tsc` checks component scripts and templates
as part of `pnpm run check`. TypeScript is pinned to the 6.0 release line because
the installed Vue language tools require TypeScript below 7. The server uses
the same compiler. Upgrade these together when the Vue tools support it.

Build before running an individual test file; tests import the compiled `dist`
output. Replace the example with the relevant test file.

```sh
corepack pnpm run build
node --test test/instance-service.test.js
corepack pnpm run check
corepack pnpm test
```

For a workspace change, run the served GUI smoke journey after building:

```sh
node test/browser/gui-smoke.mjs
```

For memory settings changes, also run the focused read-only browser journey:

```sh
node test/browser/memory-smoke.mjs
```

It uses a disposable SQLite instance and rejects provider calls. It covers
complete scope lists, pagination, archived agents, keyboard and narrow layouts,
retained settings drafts, failed loads, repeated/interrupted navigation, and
revoked access. Screenshots are saved under `test-results/memory/`.

The script uses a local Chrome or cached Chromium on macOS. Set `CHROME_PATH`
to an executable when neither default path exists. It starts a disposable local
instance and uses synthetic provider and sign-in fixtures. It does not verify
live provider access. The chat journey covers the circular Send/Stop action,
keyboard submission and Stop, delayed cancellation settlement, editable next
drafts, cross-tab Stop, long Markdown responses, scroll following, code Copy,
and narrow Light/Dark/System layouts. Docker-specific tests may be skipped without Docker;
report those skips separately.

The combined basic-tool checks use the same disposable-instance boundary:

```sh
node --test test/basic-tools-acceptance.test.js test/basic-tools-review.test.js
```

These checks combine real files, scoped memory, skill loading and retained native
input in each mode, then reopen SQLite and retry completed work without replay.
A controlled SQLite failure preserves an actual memory change but loses its
receipt; subsequent paired calls must remain fenced pending reconciliation.
The served GUI smoke also saves all three modes, edits and searches a file,
updates and forgets memory, and controls a retained PTY using the browser and an
independently paired CLI. It checks keyboard input, resize, cross-client Stop,
source/result inspection and a narrow viewport. Providers are controlled; these
checks do not establish live-provider or remote-host behavior.

## Review chat locally without a provider

After building, run the existing controlled fixture in a terminal:

```sh
mkdir -p .staf/chat-review
node test/browser/held-instance.mjs .staf/chat-review/instance.sqlite 3211
```

Open `http://127.0.0.1:3211`, pair with the code printed by that process,
and create a Demo agent from **New agent**. This fixture uses synthetic providers
and stores review data separately under `.staf/chat-review`.

**Connect ChatGPT** opens a loopback page labeled **Simulated ChatGPT sign-in**.
Choose **Complete simulated sign-in** to exercise the connected state. This does
not sign in to OpenAI, store real credentials, or enable live model responses.
Earlier fixture links incorrectly opened OpenAI with a synthetic client ID,
which produced `invalid_authorize_client`.

For real ChatGPT sign-in, start a regular instance with separate data:

```sh
mkdir -p .staf/live-review
node dist/cli.js instance serve .staf/live-review/instance.sqlite 3210
```

Open `http://127.0.0.1:3210`, pair using that instance's code, and use
**Settings → Connect ChatGPT**. This starts the production flow; fresh live
registration remains unverified by the offline checks. See
[ChatGPT sign-in](codex-direct.md). Stop either instance with Ctrl+C.

- Send `Streaming markdown fixture`. Expect a long Markdown response, code Copy,
  a fixed composer and a circular Stop control. Scroll up; incoming text must
  leave your reading position unchanged.
- Type a next draft, then activate Stop with a click or keyboard Enter. Expect
  **Stopping…**, an editable draft, and no submission when Enter is pressed in
  the draft. Type `stream-next` in the fixture terminal to release the held
  provider. Expect stopped partial output and the up-arrow Send action; the draft
  stays unsent until you send it.
- Open another tab on the same address. Stop a response there; both tabs should
  show stopping until the fixture is released, while keeping independent drafts.
- In Settings, try Light, Dark and System, Evergreen/Ink, and Layout and typography.
  Reload to check persistence. Collapse the sidebar: the agent rail stays visible
  and the expand icon moves to the header. Open the composer model popup; check
  arrow/Home/End navigation, Tab/Escape dismissal with focus return,
  selection checkmarks, and outside-click dismissal. New agent opens a modal:
  expect Name focus, trapped Tab navigation, and Escape returning focus.
  The agent name and avatar open agent settings. Archive and ChatGPT sign-out
  open in-app confirmations; Escape cancels and returns focus. The message
  composer shows a focus indicator for keyboard navigation without a border
  change when clicked.
  Settings should show theme cards, palette swatches, provider cards and an
  Edit defaults disclosure. Buttons
  keep their appearance on pointer hover and show keyboard focus.
- Narrow the window to phone width.
  Expect readable messages and a visible circular action without page overflow.
  Inline chat approval controls should remain available; Activity and Updates navigation are absent.

For inline tool review in the same fixture, send `What time is it in UTC?`.
To require a decision first, enter `ask-clock` in the fixture terminal and wait
for **Clock approvals enabled**. Expect a clock request below that message,
exact-action Approve once/Deny controls, and a retained tool outcome. Refresh or
use another paired client to decide; the original conversation updates on its
next poll.

For an offline basic-tool review, use a Demo agent and repeat these steps with
**Agent settings → Tool mode** set to Direct, Hybrid and Code Mode:

1. Send `Scripted clock fixture`. Expect the time and an action record. Hybrid
   and Code Mode also expose source, result and linked action IDs under
   **Code execution**.
2. Send `Basic tools fixture direct`, then `Revise basic tools fixture direct`
   (replace `direct` with the selected mode). The first request creates
   `work/basic-acceptance.txt` containing `before` and an agent memory. The
   second reads, edits and searches the file, updates the memory and forgets it.
   Expect the file to contain `after` and no `browser acceptance` memory to remain.
3. Send `Interactive process fixture`. Open its **Process** detail after the
   response finishes. Expect a retained PTY and `interactive ready`. Send a line;
   **Refresh output** shows `answer:` followed by that line. Change Columns/Rows
   and select **Resize terminal**. Select **Stop process** before its 30-second
   fixture sleep ends; expect an observed exit.
4. Open a private window or another browser at the same address. Enter `pair`
   in the fixture terminal for a new code, then pair this client and inspect
   or stop the same process. For CLI controls, use the
   [process reference](reference.md#native-process-api) with that instance and a separate paired
   credential file. Both clients should show the same process ID and outcome.

These prompts execute actual local commands and modify only this fixture's
agent work files and memory. They exercise controlled responses; they are not
prompts for a live provider. General project management and automatic
self-improvement remain outside this feature.

To finish a held response normally, enter `stream-next` twice in the fixture
terminal. Stop the fixture with Ctrl+C when finished.

## Deliver a ticket

1. Inspect the working tree and preserve unrelated work. Read the issue and
   relevant project decisions before editing.
2. Implement and verify small behavior changes through their shared service
   interfaces. Keep tests and documentation aligned with the behavior.
3. Run the checks required by the issue and review the final diff against its
   acceptance criteria. Report the checks performed and any gaps.
4. Commit only the work authorized for that delivery. Do not include unrelated
   working-tree changes.
5. Finish with [manual test steps](#write-manual-test-steps) for the changed
   behavior, with prerequisites and expected results.

## Write manual test steps

For browser or shared-instance changes, use the persistent development workspace
as the default handoff. Name the branch or PR to test. State the prerequisites:
Node.js 22.16 or later, Corepack, and the locked dependencies installed. Include
installation commands only when setup is needed.

Start with the normal command, then add the feature-specific actions and their
expected visible results:

```sh
corepack pnpm dev
```

Open `http://127.0.0.1:3210/`, or the explicitly selected development port.
Keep the existing `STAF_DEV_DATA_DIR`, `STAF_DEV_CONNECTION_DIR`, and
`STAF_DEV_PORT` choices. When switching worktrees, stop the previous launcher
before starting the new checkout against that same data. For CLI changes,
use the paired CLI connection in [the development workflow](#run-the-development-workspace)
so the browser and CLI test the same instance.

Reuse the existing paired browser profile at the same address and port. Normal
restarts and worktree changes retain its authorization. A newly printed code
is for additional clients. Include pairing only for a new browser or origin,
cleared browser storage, revoked access, or a reset/restore that cleared client
authorization. Provider sign-in is separate: reuse the existing Staf connections
and include live setup only when the changed feature requires that journey.

When a test needs the representative starting dataset, make
`corepack pnpm dev:reset` an explicit optional preparation step with all writers
stopped. Explain that it backs up and replaces development agents, settings, and
conversations, retains provider connections, and requires fresh browser/CLI
pairing. Normal handoffs keep the existing data. Link to
[reset and recovery](#reset-and-recover-development-data) when schema recovery
or a clean dataset is relevant.

Label controlled fixture scripts as specialized offline checks and explain the
behavior they control. Prefer normal development commands and existing setup
over temporary directories or test-specific IDs in the user's manual steps.
Separate checks already run from steps the user can perform. Report skips and
distinguish synthetic coverage from live provider, VM, or Docker acceptance.
For docs-only changes, report the relevant documentation checks instead of
requiring an application launch.

## Review the agent editor

On the implementation branch, stop another development launcher using the same
port and data directory, then run `corepack pnpm dev`. Reuse the paired browser
at `http://127.0.0.1:3210/`. Open **New agent**, enter a name and change an image
or another field. Navigate to Settings and return to **New agent**; expect the
unsaved values to return. Select **Cancel**, reopen the form, and expect a fresh
form. Create an agent, then open its settings from the chat header. Change several
fields, including provider and model. Navigate to another agent and back; expect
the draft to remain. Select **Save settings**, cancel the provider confirmation,
and expect the draft to remain. Confirm a subsequent save and expect all values
to appear together when settings reopen. No provider request is needed.

For controlled offline checks, build and run `node test/browser/agent-images-smoke.mjs`
and `node test/browser/gui-smoke.mjs`. These use disposable instances and scripted
providers; they do not prove live provider behavior.

## Review agent images

On the implementation branch, stop another development launcher using the same
port/data directory, then run the normal workspace command:

```sh
corepack pnpm dev
```

Reuse the existing paired browser and provider connections. No provider request
is needed for this feature. In New agent or an existing agent's Settings, open
**Change image** and choose **Built-in avatar**. Expect one **Shape** gallery
with all six choices. Pick a triangle, pentagon, or hexagon and check its softly
rounded corners in the large preview and small badges. Change its color.
Expect a local preview until Create or Save. Cancel and reopen to verify the
previous choice remains. Save and check the sidebar, Focus rail, header, and
agent messages; another paired browser must show the same saved image.

Choose **Uploaded image**, select a PNG/JPEG/WebP file, and adjust zoom and crop
position using the pointer and sliders. Expect square previews at 24, 28, and
30 pixels. Save, reload, and restart the launcher normally: the accepted crop
must remain. Select **Initials** and save to return to the original badge. Check
both themes and a narrow viewport without resetting your existing data.

For automated offline verification, build first and run:

```sh
corepack pnpm run build
node --test test/agent-images.test.js
node test/browser/agent-images-smoke.mjs
```

The image browser journey follows the existing disposable instance/Chrome
fixture pattern. It uses generated JPEG input, two independently paired browser
contexts, a real service restart, and blocked external networking. It proves
cropping, saved identity, and supported UI interactions without a live provider.
The broader workspace and memory browser journeys remain relevant regressions.

The native process fixture uses disposable paired instances, a controlled
provider and real host commands. Run `node --test test/native-process.test.js test/native-process-lifecycle.test.js`
after building. In the controlled chat fixture above, send `Native process fixture`;
open its process detail to see `native browser output`, then select **Stop process**
and expect the process to reach an observed exited state. This is a controlled provider with a real host command; it does not establish live-provider behavior.

### Task action verification

`node --test test/task-work-actions.test.js` after `corepack pnpm exec tsc -p tsconfig.json` exercises paired disposable tasks with controlled providers and the real QuickJS worker. It covers all modes, owner input and a differently configured helper. Existing `test/background-task.test.js`, `test/clock-approval.test.js`, and `test/collaboration-integration.test.js` exercise task lifecycle and CLI behavior. These are local synthetic-provider checks; they do not establish GUI, live-provider, Docker or production behavior.

For a manual CLI check, start the controlled fixture as described in [Review chat locally without a provider](#review-chat-locally-without-a-provider). Pair the CLI with `node dist/cli.js instance pair http://127.0.0.1:3211 .staf/chat-review/client.json PAIRING_CODE`. Create a Demo agent in the workspace and select a tool mode. Use `node dist/cli.js instance bots http://127.0.0.1:3211 .staf/chat-review/client.json` to find its ID, then run `node dist/cli.js instance task-start http://127.0.0.1:3211 .staf/chat-review/client.json AGENT_ID "Scripted clock fixture"`. Inspect the printed attempt ID with `instance task` using the same URL and credential path. Expect a completed task and a succeeded clock action. Hybrid and Code Mode also show a returned code execution. Repeat after changing the agent mode; each new attempt uses the selected mode.

### Interactive terminal verification

After one build, run `node --test test/native-interactive.test.js` for the paired real pipe/PTY, retained-work, EOF/resize, cross-client/CLI, Stop, privacy and input-recovery checks. Reuse these disposable fixtures for focused development; run the required check/full suite at completed integration and the combined GUI/CLI journey at final feature acceptance. No extra test environment or live provider is needed. The distribution test packs Staf, installs production dependencies, and executes a real PTY command using the installed native binding. Linux runtime is separate from macOS arm64 evidence.

For a manual offline check, use the existing controlled instance above, create a Hybrid Demo agent and send `Interactive process fixture`. Its process should remain running after the response. Open process details, set a size and select Resize terminal, type `hello` and select Send line, then refresh output. Expect `answer:hello` in the terminal stream. Select Stop process and expect an observed exit. The same resource is inspectable and controllable from the paired CLI.
