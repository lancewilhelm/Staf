# Staf

Staf is a CLI-first agent project in strict TypeScript for Node.js 22 or later.
It has persistent conversations, settings, usage reports and a clock tool.
Codex now uses direct Responses with a fresh Staf ChatGPT-plan registration.
OpenRouter is the other initial MVP provider. Existing LM Studio and legacy HTTP
adapters remain available, with local-model expansion after MVP.

```sh
git clone https://github.com/lancewilhelm/Staf.git
cd Staf
pnpm install --frozen-lockfile
pnpm start
```

Use `/settings` to select a provider, model and reasoning effort. Demo works
offline. For direct Codex, select Codex in `/settings`, choose **Sign in with
ChatGPT**, complete browser consent, then choose a model in the same Staf process.
You can also use `/auth codex login|status|logout` inside chat. Existing CLI tokens are not reused. There
is no automatic app-server, CLI exec or paid API-key fallback.

## Use Staf

- [Usage guide](docs/usage.md)
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
Direct Codex text generation, a follow-up using saved history and a resumed
clock-tool round trip were live-tested
with user-authorized `gpt-6-luna` requests and an existing grant on 2026-10-26.
Fresh browser sign-in and live refresh rotation remain unverified; see
[verification and remaining gaps](docs/direct-responses.md#verification-and-remaining-gaps).
Public OIDC metadata and the documented direct endpoint contract were checked. No new runtime
or development dependencies were added. On a new checkout, run
`pnpm install --frozen-lockfile`. pnpm 10.27.0 is used for verification.

The `Provider:` notice appears on the first request or a provider/model/reasoning
change. Per-request progress does not create a new conversation. `/usage` shows
reported session consumption. `/context` retains detailed measured counts and
estimate limits. Opaque encrypted reasoning is excluded from the visible text
estimate and remains in actual replay; affected footers say `(visible est.)`.
The recurring footer stays short. Compaction is not
implemented. The CLI consumes streamed responses but commits assistant display
only after completion. No shell, web, memory or skill tools were enabled by this
provider change. Those capabilities and their approval pipeline remain MVP work.
