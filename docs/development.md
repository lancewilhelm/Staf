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

The script uses a local Chrome or cached Chromium on macOS. Set `CHROME_PATH`
to an executable when neither default path exists. It starts a disposable local
instance and uses synthetic provider and sign-in fixtures. It does not verify
live provider access. The chat journey covers the circular Send/Stop action,
keyboard submission and Stop, delayed cancellation settlement, editable next
drafts, cross-tab Stop, long Markdown responses, scroll following, code Copy,
and narrow Light/Dark/System layouts. Docker-specific tests may be skipped without Docker;
report those skips separately.

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
  Settings should show theme cards, palette swatches, provider cards and an
  Edit defaults disclosure. Buttons
  keep their appearance on pointer hover and show keyboard focus.
- Narrow the window to phone width.
  Expect readable messages and a visible circular action without page overflow.
  Inline chat approval controls should remain available; Activity and Updates navigation are absent.

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

For inline tool review in the same fixture, send `What time is it in UTC?`. To require a decision first, enter `ask-clock` in the fixture terminal and wait for **Clock approvals enabled**. Expect a clock request below that message, exact-action Approve once/Deny controls, and a retained tool outcome. Refresh or use another paired client to decide; the original conversation updates on its next poll.
