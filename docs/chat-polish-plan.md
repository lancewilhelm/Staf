# Chat and agent management polish

Status: the owner confirmed this consolidated scope on 2026-11-01. Published as
[Polish agent chat, provider setup, and shared configuration](https://github.com/lancewilhelm/Staf/issues/26),
labelled ready-for-agent. This is a target design, not a claim of implemented or
verified behavior. The GitHub issue is the implementation specification.

## Workspace and appearance

Keep the existing chat direction, using T3 Code as the owner's reference for
polish. Focus the sidebar on the agent list, New agent, and Settings. Defer inbox
expansion and keep clock approvals accessible when needed. Call bots agents.
No tools beyond the clock tool need implementation in this pass.

Offer Light, Dark, and System appearance in Settings. Default to System and
remember the choice separately in each browser.

## Chat behavior

Send immediately clears the composer and places the owner's message in the
conversation. Submission progress appears there. Remove routine Check status
controls and the saved-browser-record recovery disclosure. Keep automatic
per-agent draft retention and submission recovery without duplicate messages.
Show actionable failures and Retry beside the affected message.

Stream responses and render Markdown, including code blocks with Copy. Keep the
composer visible. Follow the bottom during responses unless the owner has
scrolled up to read.

Allow one response at a time per agent. The owner can type the next draft while
a response runs and use Stop. Enable sending the next message once the current
response finishes or stops. Steering and queuing are deferred.

## Agent creation and management

Require only a name to create an agent. Instructions and provider/model setup
are optional during creation and easy to configure later. Prefill provider/model
choices from instance creation defaults and copy them into the new agent.
Changing defaults later does not change existing agents. Creation works without
a connected provider and makes no model request.

Support creation, renaming, instruction edits, provider/model selection, archive,
and restore through the shared service for the GUI, CLI, and future apps.
Preserve stable IDs and conversations through renaming and archive/restore.
Keep permanent deletion for later work.

## Provider connections

Global Settings contains Codex browser sign-in and OpenRouter API-key entry,
connection status, and disconnect controls. Connections belong to the instance;
each agent chooses its own provider and model. Keep credentials outside agent
configuration files. Distinguish saved credentials from verified provider access.

## Editable configuration

Each agent has a directory keyed by its stable ID, containing agent.toml for
structured settings and one soul.md for personality, role, and standing guidance.
The GUI exposes one Instructions editor. Optional headings may organize its
content without creating more required setup. Preserve existing soul and role
text when combining them.

Configuration files are authoritative. The GUI, CLI, and API update those same
files through the service, while terminal tools and external agents can maintain
them directly. Expose the directory path in agent Settings and through the CLI.
Conversations and operational records remain in the shared database.

Valid saved configuration applies to the next message without a restart. Work
already underway uses its captured configuration. Concurrent edits report a
conflict and preserve unsaved client changes. Invalid files remain intact, show
an actionable error, and block new messages for that agent. Its conversation
stays readable, and other agents stay usable.

## Deferred work

Prompt construction, prompt updates, prompt-cache impact rules, and detailed
cache-warning design need a later discussion. Retain the requirement to warn
when changes may affect prompt-cache reuse. Do not promise cache hits or misses.
Inbox expansion, steering, queuing, extra tools, and permanent deletion are also
outside this pass.

## Delivery evidence

Implementation must update affected usage and reference documentation. Run
pnpm run check and pnpm test for behavior changes, and exercise the changed GUI
with synthetic provider/authentication dependencies. Cover the CLI/service
contract and direct file edits as well as browser interactions. Report live
provider authentication and inference separately from synthetic checks. Do not
use real credentials or make live/billable requests solely to validate docs.

See the [decision record](decisions.md#chat-gui-polish-and-agent-terminology),
[configuration ADR](adr/0003-editable-agent-configuration.md),
[agent contract](first-delivery-bot-contract.md), and
[OpenClaw/Hermes comparison](research/agent-instruction-files.md).
