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
live provider access. Docker-specific tests may be skipped without Docker;
report those skips separately.

## Deliver a ticket

1. Inspect the working tree and preserve unrelated work. Read the issue and
   relevant project decisions before editing.
2. Implement and verify small behavior changes through their shared service
   interfaces. Keep tests and documentation aligned with the behavior.
3. Run the checks required by the issue and review the final diff against its
   acceptance criteria. Report the checks performed and any gaps.
4. Commit only the work authorized for that delivery. Do not include unrelated
   working-tree changes.
