# Staf

Staf is a self-hosted agent project in strict TypeScript for Node.js 22.16 or later.
It has persistent conversations, settings, usage reports and a clock tool.
ChatGPT now uses direct Responses with a fresh Staf ChatGPT-plan registration.
OpenRouter is the other initial MVP provider. LM Studio and a generic HTTP
adapter are also available in the shared instance.

```sh
git clone https://github.com/lancewilhelm/Staf.git
cd Staf
pnpm install --frozen-lockfile
pnpm run build
pnpm link --global
staf settings set-defaults codex MODEL_ID
staf
```

The terminal starts a local shared instance in `~/.staf/terminal-instance` when needed and reconnects to its
persistent main chat. On a fresh instance, first run `staf settings set-defaults codex MODEL_ID` with your chosen provider and model. Type `show settings` or `/help`.
`/quit` closes the terminal client while the instance continues. The offline
demo echoes messages and does not use a language model. See the [terminal setup
guide](docs/usage.md#start-the-shared-terminal) for provider credentials and
one-shot commands.

## Local shared instance preview

For the persistent hot-reloading development workspace, run `corepack pnpm dev`
after [toolchain setup](docs/development.md#develop-staf). See the
[development guide](docs/development.md#run-the-development-workspace) for
data selection, explicit seed reset, pairing, and recovery.

Run `pnpm start instance serve .staf/instance.sqlite 3210` and open
`http://127.0.0.1:3210/`. Enter the host's pairing code to open the chat workspace.
**Settings** shows the instance-wide ChatGPT connection and offers sign-in when
needed, progress, cancellation, retry, and sign-out. Connect ChatGPT opens a new
tab; Continue sign-in is available if the browser blocks it. Workspace notices
appear as dismissible toasts, with actionable errors retained beside controls. A saved sign-in does not
verify account or model access. It also offers Light, Dark, and System appearance for this browser;
Light is the default; System follows the device setting. Settings also offers
Evergreen/Ink palettes, a Focus agent rail, font, text size, spacing, corners, and logo preferences. The persistent agent list switches between main chats; each agent has its own configuration, which you can edit from its chat. Submitted messages appear immediately, and per-agent drafts and uncertain submissions recover automatically after a reload or reopening a closed tab in the same browser. Unfinished agent creation also recovers with its original operation ID for the same dataset. Older records without a dataset identity recover when matching server records establish their origin; otherwise **Earlier browser records** lets you inspect and copy them.
Instructions live in its `soul.md` file; settings live in `agent.toml`. You can
[edit these files directly](docs/usage.md#agent-configuration-files) on the instance host.
Connect an instance-wide OpenRouter key in global Settings or through the paired CLI; saved presence does not verify account or model access. In Settings, choose a real provider and model as creation defaults. New agent copies these values and can be created before connecting a provider. Saving defaults moves existing Demo agents, including archived agents, to that choice. Agent settings
offer a saved tool mode, Demo and configured shared connections, retain disconnected selections, and ask for confirmation before switching providers. Review the agent's model after a switch. Open full agent settings from the chat header avatar. Agent settings include archive; reveal Archived agents in the Agents sidebar to restore them. Tool requests, observed outcomes, and exact-action approvals appear in the chat conversation. The previous Advanced page has been retired.
Tool mode controls clock, scoped memory, configured search, web reading, scratch shell, skill selection, host file actions, and native host commands in chat and eligible tasks: Direct offers individual capabilities, Hybrid offers them and code, and Code Mode offers code with those capabilities. Native commands run with the service account’s host access; known credentials are filtered before process output storage, and pipe and PTY backends support input, EOF, resize, retained processes and cross-client Stop. Recovery keeps uncertain effects fenced until supported service evidence is reconciled through the paired owner API/CLI; it never automatically repeats them. Unselected read receipts expire with work. See [tool mode usage](docs/usage.md#save-a-tool-mode). Other management features remain available through the service and CLI while
their GUI is developed. Shared-instance ChatGPT sign-in has synthetic coverage
but is not live verified. Background-task creation from main chat is deferred. Explicit task API and CLI operations remain available.
Public web reading, owner-configured local search and scratch-only shell are off
by default and require owner approval. Press Enter in the host
terminal to issue a fresh one-time code for another client. This preview binds
only to loopback; it does not support LAN access. See [usage](docs/usage.md#local-shared-instance-offline-preview) for CLI commands and limitations.

The loopback instance retains the background-task engine; its separate Activity and task-update workspace is deferred. It is an offline-tested preview with important permission and recovery limitations; see [usage](docs/usage.md#background-task-preview).


The shared instance supports owner-imported [skills](docs/usage.md#skills-in-the-shared-instance) as an offline-tested preview. Eligible chat and task work can select them in Direct, Hybrid, or Code Mode.

The shared instance supports [scoped memory](docs/usage.md#scoped-memory-in-the-shared-instance) in an offline-tested preview, with read-only agent and shared user memory pages in Settings.

Agents can keep their initials, choose a geometric avatar with a separate color,
or use a cropped uploaded image. Use **Change image** in New agent or agent
Settings. Images are shared across paired clients and survive restarts. See
[agent images](docs/usage.md#agent-images) for formats, limits, and storage.

The shared instance supports per-action approval and permission controls for its clock tool. See [clock approvals](docs/usage.md#clock-approvals-in-the-shared-instance) for setup and current limits.

The shared instance includes a provisional daily and weekly schedule preview for UTC clock reads, one exact separately approved public web read, one exact separately approved search, or one exact separately approved scratch command per occurrence. See [recurring schedules](docs/usage.md#recurring-schedules-preview) for authorization, recovery, and availability limits.

## Use Staf

- [Usage guide](docs/usage.md)
- [Native Linux installation and backup](docs/native-linux-installation.md)
- [Docker Compose installation and backup](docs/docker-installation.md)
- [Browser and CLI test plan](docs/mvp-test-plan.md)
- [Fresh direct ChatGPT sign-in](docs/codex-direct.md)
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

The frontend uses Vue with Vite, Composition API, and focused `.vue` components
with `<script setup lang="ts">`.

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
Direct ChatGPT text generation through the prior CLI, a follow-up using saved history
and a resumed clock-tool round trip were live-tested
with user-authorized `gpt-6-luna` requests and an existing grant on 2026-10-26.
Fresh browser sign-in and live refresh rotation remain unverified; see
[verification and remaining gaps](docs/direct-responses.md#verification-and-remaining-gaps).
Public OIDC metadata and the documented direct endpoint contract were checked.
On a new checkout, run
`pnpm install --frozen-lockfile`. pnpm 12.16.1 is used for verification.

The workspace receives provisional main-chat response progress over an authenticated event stream and renders Markdown with copyable code. The circular composer action switches from an up-arrow Send to Stop during a response. Use Stop to end the current response while keeping the next draft; the shared service waits for cancellation to settle before accepting another message. The paired CLI can follow progress with `instance response-follow` and request Stop with `instance response-stop`. Incremental text depends on the provider: ChatGPT direct and OpenRouter support it; LM Studio and generic Chat Completions responses are buffered. The shared terminal labels incremental text provisional and displays command status and recorded tool progress.
`/usage` shows reported main-chat consumption. `/context` reports historical input
when available; current context occupancy is unavailable. Shared-instance provider
sign-in and live chat have not been verified with real credentials.

## License

Original Staf code is licensed under the [Apache License 2.0](LICENSE).
Third-party material retains its applicable licenses. The Hermes-derived
cache/request material in the direct Responses adapter remains subject to the
MIT notice in [Third-party notices](THIRD_PARTY_NOTICES.md).

Agent provider choices are shared across clients. The composer opens a provider,
model and reasoning picker; selections save for the next message. Global Settings
holds per-provider first-use defaults. See [usage](docs/usage.md).
