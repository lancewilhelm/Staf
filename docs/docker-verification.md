# Docker installation verification — 2026-11-03

Issue [#25](https://github.com/lancewilhelm/Staf/issues/25) remains incomplete.
This change prepares guarded recovery commands, a shared SSH helper and an
actual-container acceptance script. No actual-container result is claimed.

## Environment

- macOS 27.0.1 (26A434), Apple Silicon; Node 22.22.3, pinned pnpm 12.16.1.
- Docker CLI 29.9.2; Compose v5.6.1; context `desktop-linux` configured for
  `unix:///Users/lancewilhelm/.docker/run/docker.sock`.
- OpenSSH 10.3p1. Browser checks use local cached Chromium with non-loopback
  browser requests blocked by a disposable proxy.
- Base commit `9eb427232a44c3bc947caf79e0ad4cbd31fa8ea3`; dedicated local branch
  `issue-25-docker-recovery`. No user instance data is used.

Docker daemon access was previously denied in this session. That denial was
honored: no socket-permission changes, alternate daemon or retry of daemon
access was used. CLI-only configuration and help commands do not use the daemon.

## Observed checks

| Check | Result and evidence boundary |
| --- | --- |
| `corepack pnpm run build` | Passed; server and current Vue workspace built. |
| `corepack pnpm run check` | Passed; server and Vue type checks. |
| `corepack pnpm test` | 455 tests: 452 passed, zero failed, three Docker-dependent scratch-shell tests skipped. |
| Focused instance/store/service/auth/CLI/OpenRouter/recovery tests | 68 passed, zero skipped; synthetic providers and local files/listeners. |
| `node --test test/recovery.test.js` | Passed. Real stopped-data tar copy into a separate local directory retains agent revisions/symlinks, credential bytes, archived profiles, chats, defaults, approvals, client authorization/revocation and existing task history. Reconstructed schema 29 upgrades to 30 and leaves a readable private version-29 backup. This is local-process evidence, not Docker or a released-image upgrade. |
| `node test/browser/recovery-smoke.mjs` | Passed. Reuses the container script's current browser/CLI journey: separate pairing, bidirectional Demo chat, revocation and revoked-browser reload. Local process only. |
| `sh -n deploy/docker-data.sh deploy/connect.sh` | Passed syntax validation; does not establish actual Docker backup/restore operation. |
| `docker compose -f compose.yaml config --quiet` | Passed without daemon access. Actual CLI help confirmed recovery command options. |
| SSH configuration expansion with `ssh -G -F /dev/null` | Verified explicit loopback forwarding, exit-on-forward-failure and keepalives. No connection or authentication performed. |
| Acceptance preflight | Existing evidence file is preserved and rejected before any Docker command. Invalid recovery project names are rejected before filesystem changes or Docker commands. |
| `node --test test/docker/recovery-guards.test.mjs` | Nine passed. Synthetic Docker commands test aborts on failed writer/emptiness inspection, honoring the Compose stack/resolved volume, rejecting bind-mounted data or installed mount drift, and refusing alternative mount mechanisms. The first two tests failed before correcting shell error propagation; Compose-stack/bind and four alternative-mount tests failed before their corresponding fixes. No daemon was used. |

The broader unchanged `node test/browser/gui-smoke.mjs` passed on one rerun. Its
initial run failed at line 496 with `Missing button Send` after dismissing a
failed request. No server, browser implementation or smoke-script change was
made between attempts; they are unchanged from the base commit. The transient
failure remains recorded rather than counted as an uninterrupted first pass.
The separate installation browser/CLI journey passed as recorded above.

The new recovery test adds coverage of the existing storage contract. It is not
a failing-before/passing-after fix to the database migration implementation.
The Dockerfile now initializes new `/data` directories with mode 0700; existing
volume permissions are not rewritten.

## Outstanding operational acceptance

- Run `node test/docker/installation.mjs` with authorized Docker daemon access
  and free loopback port 3210. Container build/run, non-root volume ownership,
  replacement, the Docker backup/restore helper guards, actual-container schema
  migration and replacement-project restore are **not run here**.
- Verify the protected SSH path from a separate trusted machine using the
  [manual journey](docker-installation.md#verification-and-reusable-acceptance).
  Local browser/API checks and SSH configuration expansion do not prove it.
- Restore on a replacement Docker host and verify retained records and clients.
  A same-host replacement project cannot establish this requirement.
- Verify an update between reviewed released images separately. The migration
  fixture reconstructs the previous schema using the current image.
- Live provider sign-in/inference is not authorized or tested. Coordinate it
  with [remote setup](https://github.com/lancewilhelm/Staf/issues/23).

Do not mark the corresponding issue acceptance criteria complete until those
operations have observed evidence. See [installation and recovery](docker-installation.md)
for commands and trust assumptions.
