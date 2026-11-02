# Develop Staf

Use Node.js 22.16 or later and Corepack. The `packageManager` field in
`package.json` selects pnpm 10.27.0, which also matches the Docker build.
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

## Verify a change

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
- In Settings, try Light, Dark and System; narrow the window to phone width.
  Expect readable messages and a visible circular action without page overflow.
  Activity and approval controls should remain available.

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
