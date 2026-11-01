# Deployment options: native and Docker

Research for the [deployment and owner access interview](mvp.md#deployment-and-owner-access-interview--2026-10-27), 2026-10-27. The owner subsequently confirmed the [deployment resolution](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689). This supporting reference records facts and implementation limits; it does not describe implemented Staf deployment capabilities.

## Working direction

The owner confirmed native installation inside the existing VM as the first documented path, with Docker supported as an alternative using the same API and configuration. The VM already runs Hermes. This reference does not authorize changing that installation or claim either Staf deployment has been tested. Aim for setup through a CLI or browser and an always-on local-network API that future clients can use. External hosting or public exposure is optional; a public domain is not a prerequisite. These are interview inputs, not a finished design.

## Filesystem and control boundaries

- **Native in a VM:** a Staf process has the VM operating system's access granted to its service identity, groups, filesystem permissions, and any configured service restrictions. A systemd system service defaults to root unless `User=` specifies another identity; a dedicated unprivileged identity makes the intended authority explicit. Running in the VM does not automatically grant access to its hypervisor or other devices: those resources must separately be made reachable and authorized. [systemd execution environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)
- **Docker:** a container can read or modify explicitly bind-mounted paths on the Docker daemon's host, subject to mount mode and the effective OS permissions and security controls. Bind mounts are writable by default; `ro` makes the mount read-only. Paths belong to the daemon host, which can differ from the CLI client. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)
- **Identity mapping matters:** container UID/GID values do not always correspond directly to host identities. Rootless Docker maps container root to the user running the rootless daemon; `userns-remap` maps it to a subordinate host ID. These differences can cause unexpected ownership or denied access on bind mounts. Check the effective mapping and host permissions for the actual deployment; do not assume matching numeric IDs suffice in every mode. [Docker UID/GID mapping](https://docs.docker.com/engine/security/rootless/uid-gid-mapping/), [Docker user namespace remapping](https://docs.docker.com/engine/security/userns-remap/)
- **Controlling other containers is separate from editing files.** It requires explicit access to a Docker daemon or another authorized control interface. Access to a conventional rootful Docker daemon is highly privileged: a client can request containers with host mounts. Rootless daemon authority is bounded differently by its owning user. Do not assume that mounting project files grants container management, or grant the daemon socket merely to edit files. [Docker Engine security](https://docs.docker.com/engine/security/)
- **Staf's approval policy is another layer.** OS permissions and mount modes define what the process can do; the planned application policy governs what Staf may ask to do and when approval is needed within that available authority. Neither should be assumed to enforce the other. The current approval decisions are future requirements, not an implemented general permission engine.

## Implications and open choices

Use the confirmed native-VM-first documentation order while preserving a documented Docker route. Give each deployment only the paths and access it needs, select read-only access where writes are unnecessary, and account for persistent state, backup and restore. Do not prescribe privileged containers, blanket host mounts, or a Docker socket mount as defaults. Validate actual permissions and compatibility on each supported environment before claiming a deployment works.

The owner confirmed Linux VM as the first native platform, a background-service option with startup after reboot, shared CLI/browser setup, one-time host pairing codes with revocable client trust, and owner-initiated updates with recoverable pre-migration backups. Household membership remains later work.

Still to design and verify: installer and service wiring, local API transport and credential storage, pairing/revocation enforcement, optional external access, data layout and backup/restore mechanics, remote provider setup, and deployment permissions. A full deployment recipe is not implemented or live-tested by this research.

## Provider setup on a remote instance

The current official ChatGPT-plan token-sharing guide identifies a self-hosted
VM as an agent host with a stable host ID. Its sign-in guide specifies an HTTP
`127.0.0.1` loopback callback; after registration, scheme, host and path stay fixed
while the port may change. Authorization and token exchange must use the same
redirect URI. [OpenAI token sharing overview](https://developers.openai.com/siwc/token-sharing-open-source),
[registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Staf currently opens that listener on its own host. A browser running on another
machine reaches that other machine's loopback, not the Staf host. Opening the
printed URL alone therefore does not complete remote sign-in. The current Staf
implementation has no client-side callback receiver or direct-grant device flow.
See [current sign-in architecture](direct-responses.md#supported-authentication-differs-from-the-reference).

The official pages checked do not document a ready-made device-code flow or
non-loopback callback for this direct registration. A client-side receiver or
forwarding path needs a verified design and implementation before it can be
promised as guided setup. This is an evidence limit, not proof that a solution
is impossible. Device-code support in a different Codex client does not establish
support for Staf's registration. Fresh real browser registration and live refresh
also remain unverified in the current implementation.

OpenRouter is configured separately through its own API key and selected model;
it is not a Codex fallback. Provider setup must remain distinct from the owner's
authorization of Staf client devices. No provider credentials were inspected or
created, and no live sign-in or model request was made for this research.
