# Staf

Staf is a self-hosted agent project in strict TypeScript for Node.js 22.16 or later.
It has persistent conversations, settings, usage reports and a clock tool.
Codex now uses direct Responses with a fresh Staf ChatGPT-plan registration.
OpenRouter is the other initial MVP provider. LM Studio and a generic HTTP
adapter are also available in the shared instance.

```sh
git clone https://github.com/lancewilhelm/Staf.git
cd Staf
pnpm install --frozen-lockfile
pnpm run build
pnpm link --global
staf
```

The terminal starts a local shared instance in `~/.staf/terminal-instance` when needed and reconnects to its
persistent main chat. Type `show settings`, `set provider to demo`, or `/help`.
`/quit` closes the terminal client while the instance continues. The offline
demo echoes messages and does not use a language model. See the [terminal setup
guide](docs/usage.md#start-the-shared-terminal) for provider credentials and
one-shot commands.

## Local shared instance preview

Run `pnpm start instance serve .staf/instance.sqlite 3210` and open
`http://127.0.0.1:3210/`. Enter the host's pairing code to open the chat workspace.
**Settings** shows the instance-wide Codex connection and offers sign-in when
needed. It also offers Light, Dark, and System appearance for this browser;
System follows the device setting. Each bot has its own configuration, which you can edit from its chat.
Instructions live in its `soul.md` file; settings live in `agent.toml`. You can
[edit these files directly](docs/usage.md#agent-configuration-files) on the instance host.
You can create a bot before connecting a provider. The inbox shows task updates and
requests for input or approval. The previous Advanced page has been retired;
other management features remain available through the service and CLI while
their GUI is developed. Shared-instance Codex sign-in has synthetic coverage
but is not live verified. Bots can start background work from main chat and
request help during tasks; each bot-to-bot message requires owner approval.
Public web reading, owner-configured local search and scratch-only shell are off
by default and require owner approval. Press Enter in the host
terminal to issue a fresh one-time code for another client. This preview binds
only to loopback; it does not support LAN access. See [usage](docs/usage.md#local-shared-instance-offline-preview) for CLI commands and limitations.

The loopback instance has an initial background-task and Activity interface. It is an offline-tested preview with important permission and recovery limitations; see [usage](docs/usage.md#background-task-preview).


The shared instance supports owner-imported [skills](docs/usage.md#skills-in-the-shared-instance) as an offline-tested preview.

The shared instance supports [scoped memory](docs/usage.md#scoped-memory-in-the-shared-instance) in an offline-tested preview.

The shared instance supports per-action approval and permission controls for its clock tool. See [clock approvals](docs/usage.md#clock-approvals-in-the-shared-instance) for setup and current limits.

The shared instance includes a provisional daily and weekly schedule preview for UTC clock reads, one exact separately approved public web read, one exact separately approved search, or one exact separately approved scratch command per occurrence. See [recurring schedules](docs/usage.md#recurring-schedules-preview) for authorization, recovery, and availability limits.

## Use Staf

- [Usage guide](docs/usage.md)
- [Native Linux installation and backup](docs/native-linux-installation.md)
- [Docker Compose installation and backup](docs/docker-installation.md)
- [Browser and CLI test plan](docs/mvp-test-plan.md)
- [Fresh direct Codex sign-in](docs/codex-direct.md)
- [Settings and recovery](docs/settings.md)
- [Configuration reference](docs/reference.md)
- [Consumption accounting](docs/usage-accounting.md) and [context display](docs/context.md)

## Understand Staf

- [Architecture](docs/architecture.md)
- [Direct Responses design](docs/direct-responses.md)
- [MVP decisions and delivery status](docs/mvp.md)
- [Evolving session and Activity design](docs/session-architecture.md)
- [Decision records](docs/decisions.md)
- [Third-party notice](THIRD_PARTY_NOTICES.md)

## Verify locally

See the [development guide](docs/development.md) for the pinned package manager,
focused tests, browser smoke check, and delivery workflow.

```sh
pnpm run build
pnpm run check
pnpm test
```

The offline suite covers providers, streaming, signed OAuth fixtures, refresh
rotation, cache identity, tools, errors, cancellation, sessions and PTY menus.
Regressions cover cancellation during OAuth exchange and provider setup, model
and reasoning shortcuts after a completed turn, unfinished output items, and
refusal display and replay.
Direct Codex text generation through the prior CLI, a follow-up using saved history
and a resumed clock-tool round trip were live-tested
with user-authorized `gpt-6-luna` requests and an existing grant on 2026-10-26.
Fresh browser sign-in and live refresh rotation remain unverified; see
[verification and remaining gaps](docs/direct-responses.md#verification-and-remaining-gaps).
Public OIDC metadata and the documented direct endpoint contract were checked.
On a new checkout, run
`pnpm install --frozen-lockfile`. pnpm 10.27.0 is used for verification.

The shared terminal displays command status and recorded tool progress.
`/usage` shows reported main-chat consumption. `/context` reports historical input
when available; current context occupancy is unavailable. Shared-instance provider
sign-in and live chat have not been verified with real credentials.

## License

Original Staf code is licensed under the [Apache License 2.0](LICENSE).
Third-party material retains its applicable licenses. The Hermes-derived
cache/request material in the direct Responses adapter remains subject to the
MIT notice in [Third-party notices](THIRD_PARTY_NOTICES.md).
