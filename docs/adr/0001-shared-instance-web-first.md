# Share one always-on instance across web and CLI

Accepted during the MVP scope interview on 2026-10-26. The first delivery is a
web app and CLI connected to the same personal, always-on Staf instance, with
authenticated owner access; Electron follows later. The instance owns continuing
agent work and persistent state so closing an interface does not stop work or
create a separate history. This prioritizes continuous operation and client
continuity over an Electron-first release or independent client-owned runtimes.

The owner confirmed self-hosting and documented backup/restore on 2026-10-27.
A later clarification that day supersedes the public-HTTPS-first proposal:
local-network access to an always-on API is sufficient, and a public address or
external hosting is not required. Native installation inside the owner's VM is
the first documented path, with Docker as an alternative using the same API and
configuration. Setup can be CLI or browser. The first delivery has one owner and
lightweight client-device authorization; household membership is later work.
Linux VM is the initial native platform, with a service option that starts after
reboot. Browser and CLI clients use a one-time host pairing code and remain
trusted until revoked. Updates are owner-initiated and preserve configuration/data,
with a recoverable backup before data-format changes. The installer, service
wiring, credential storage, transport and authorization enforcement remain
implementation choices. See the [deployment interview](../mvp.md#deployment-and-owner-access-interview--2026-10-27).

The owner confirmed the complete deployment agreement on 2026-10-27. See the
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689)
for the final scope. The planning decision is closed; the features still require
implementation and verification.
