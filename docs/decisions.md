# Implementation decisions

## Keep conversation state and tool dispatch in Staf

Accepted on 2026-10-25. Each adapter translates its own protocol into Staf messages.
Staf owns tool IDs, results, the clock allowlist, iteration limits, and snapshots.
A later UI can call the same runtime.

Letting each provider own conversations would reduce some adapter work, but
resume behavior and tool permissions would then differ by provider. The current
choice repeats full history and has no context compaction. It covers a small
shared text-and-clock contract, not arbitrary agent behavior.

## Use a registry and explicit capabilities

Accepted on 2026-10-25. The CLI looks up adapter factories in `providerRegistry`.
The runtime consumes normalized events and checks declared tool support.
Buffered adapters declare incremental text unsupported.

Separate conditionals in the CLI were adequate for one optional HTTP adapter.
A registry is easier to extend and test as the list grows. A plugin loader or
large adapter framework would add complexity without helping the current scope.

## Use the official Codex CLI as a structured planner

Superseded on 2026-10-26 by [direct Responses with a Staf-owned grant](#use-direct-responses-with-a-staf-owned-grant).
The following records the original CLI implementation.

Accepted on 2026-10-25. `codex exec` provides a supported interface for existing
ChatGPT authentication and schema-constrained final output. Staf runs clock itself.
No subscription tokens or private endpoints enter Staf's configuration.

An app-server integration could support richer interaction and custom tools later.
It would require a persistent process, lifecycle handling, and a larger protocol.
The first version accepts subprocess overhead and buffered output. Its generation
behavior is mocked-tested, not live-tested.

## Load project credentials without writing them

Accepted on 2026-10-25. A small literal `.env` parser keeps existing shell workflows
and limits project configuration to documented keys. Shell values take precedence.
This decision covers project API-key configuration. The original Codex CLI path
used official CLI login storage; the current direct path separately stores its
Staf-owned grant under `DATA_DIR/auth`.

A keychain or encrypted vault would offer different storage properties but needs
its own setup and recovery behavior. `.env` remains plain text and needs careful
local access. Known-value redaction is a last defense, not credential isolation.

## Share the HTTP transport across OpenRouter and LM Studio

Accepted on 2026-10-25. Both support Chat Completions, so they reuse validation,
timeouts, errors, and tool-message translation. Each adapter owns its key names,
endpoint defaults, and model selection. LM Studio omits auth when no key is set.

Provider SDKs would add dependencies and features this version does not use.
The direct transport keeps the implementation small. Models can still differ in
tool support and request limits. Their real behavior needs live verification.

## Official sources

- [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [OpenRouter authentication](https://openrouter.ai/docs/api_reference/authentication)
- [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)
- [LM Studio authentication](https://lmstudio.ai/docs/developer/core/authentication)

Hermes remains a product reference from the interview. This implementation uses
primary provider documentation and does not copy Hermes code or credentials.

## Give Staf its own official Codex context

Superseded for the default Codex provider on 2026-10-26 by
[direct Responses with a Staf-owned grant](#use-direct-responses-with-a-staf-owned-grant).
The isolated CLI auth commands were later removed with the standalone CLI.
The following records the earlier integration.

Accepted on 2026-10-25. Staf replaces its earlier machine-login
behavior with scoped CODEX_HOME and HOME directories. Official file storage avoids
copying OAuth tokens and keeps normal CLI login separate. Auth commands are explicit;
an absent scoped login is an error, not a reason to borrow the normal account.

Reusing machine login required less setup but obscured ownership. A separate OAuth
application registration was not implemented at that point.
The CLI path uses its official client identity and the chosen account's allowances.

Apps, hooks, and plugins are disabled, and configured MCP entries stop generation.
System policy and native-read limitations remain. Dummy-account lifecycle tests and
a real empty-context status check verify plumbing without creating a real grant.

## Use direct Responses with a Staf-owned grant

Accepted on 2026-10-26. The default `codex` provider uses the public Responses
endpoint with a separate Staf OAuth registration and grant. It does not import
CLI credentials, launch CLI exec or app-server, or fall back to an API key.
Staf continues to own conversation history, tool dispatch and session storage.
Only the clock tool is executable.

Provider selection and explicit browser sign-in are available in the running
chat, so setup can return to model selection without a separate terminal auth
step. Standalone auth commands remain available for recovery. The menu is
deterministic and does not require a working model to configure one.

This replaces the CLI planner and scoped CLI context as the default integration.
It requires Staf to implement OAuth validation, refresh, streaming normalization
and model-bound replay. The CLI buffers assistant display until completion;
only successful completed responses commit conversation output or tool calls.
Usage keeps inclusive input counts and cached/reasoning subsets separately.
See [direct Responses](direct-responses.md) for the contract and
[verification gaps](direct-responses.md#verification-and-remaining-gaps).

## Keep settings deterministic and independent of model availability

Accepted for the settings MVP. Nonsecret defaults use versioned local JSON with
atomic replacement. Session overrides are separate and never saved as defaults.
Precedence and value sources are explicit. Updated October 26: confirmed chat edits apply on the next request,
including resumed chats; remembered edits also persist for future launches.
Terminal default writes affect only future launches. This supersedes the initial
fresh-conversation-only setting lock. Provider initialization is lazy and failures leave settings
commands available. Credentials stay in existing separate stores.

A model-driven setup assistant would fail during bootstrap or a provider outage.
The first menu is deterministic, with a terminal recovery interface using the same
operations. The shared terminal now supports a bounded set of natural-language shortcuts for the current bot profile. The deterministic settings commands remain available without a working provider. Broader natural-language configuration remains unimplemented.

## MVP shared-instance delivery boundary

See [ADR-0001](adr/0001-shared-instance-web-first.md) for the accepted product
boundary. It is not implemented runtime behavior; remaining scope questions live
in the [MVP interview](mvp.md#mvp-scope-interview--2026-10-26).

## MVP approval modes and permission boundaries

The owner accepted the three approval modes, the default, owner-controlled
instance/bot/task settings, and the distinction between permissions and approval
prompts on 2026-10-27. The discussion also settled risky actions, explicit and
remembered approvals, permission limits, helpers, revocation and unattended work.
See the [approval decisions](mvp.md#approval-decisions--2026-10-27) for the accepted
requirements and concrete examples. The owner confirmed the complete decision
on 2026-10-27; the [resolution](https://github.com/lancewilhelm/Staf/issues/2#issuecomment-6453313751)
closes the planning ticket. These are future product rules, not changes to the
current clock-only dispatch boundary.

## Deliver the MVP in usable milestones

Accepted on 2026-10-27. Resolve only the decisions needed for the next usable
milestone, then specify and build it. The accepted full MVP remains the target;
later design questions do not gate the first connected bot delivery. This
replaces the earlier all-MVP-design-first planning boundary so working software
can inform later choices. See the [incremental plan](mvp.md#wayfinder-planning--2026-10-27)
and [planning map](https://github.com/lancewilhelm/Staf/issues/1).

## Deployment and owner access requirements

On 2026-10-27, the owner clarified that the service must expose a local-network
API, with no required public address or external hosting. This supersedes the
earlier public-HTTPS-first setup assumption. Support for native and Docker
installation is required, with native installation inside the owner's VM the
first documented path and Docker an alternative using the same configuration
and API. Initial setup can be CLI or browser. One owner per instance uses
lightweight client-device authorization, separate from provider sign-in; household
memberships and isolation remain later questions. Linux VM is the first native
platform; setup offers an automatically starting background service with lifecycle
and log access. Browser and CLI clients pair through a one-time code on the host
and stay trusted until revoked. Updates are owner-initiated and preserve data and
configuration, with recoverable backups before stored-format changes. Installer,
transport, credential storage and enforcement mechanics remain to be designed.
Online client submission, reconnect recovery and backup/restore remain required.
The owner confirmed the complete deployment agreement on 2026-10-27. The
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689)
closes the planning ticket; installer, transport and security mechanisms remain
implementation work rather than claims of verified deployment.
See the [deployment interview](mvp.md#deployment-and-owner-access-interview--2026-10-27)
and [installation trade-offs](deployment-options.md). No deployment, authentication
or host permissions changed.

## Bots own their configuration after creation

Accepted on 2026-10-27 during the initial bot-contract review. Instance defaults
are copied when a bot is created rather than consulted as a live inheritance
source. Existing bots keep their values until explicitly edited. See
[ADR-0002](adr/0002-copy-bot-creation-defaults.md) and the
[accepted bot contract](first-delivery-bot-contract.md). The owner confirmed the
complete initial bot agreement on 2026-10-27; the
[resolution](https://github.com/lancewilhelm/Staf/issues/14#issuecomment-6455172896) closes the planning ticket. No runtime behavior changed.

## First-delivery background tasks

The MVP scope was revised on 2026-11-02; see
[Simple chat before background-task workflows](#simple-chat-before-background-task-workflows).
The following records the earlier delivery agreement.

On 2026-10-27 the owner accepted the eight task recommendations: one background
task per bot with responsive chat, explicit task direction, separate Activity,
observable stopping, preserved failures, client-independent work, explicit retry
after instance restart and an adjustable five-minute execution default excluding
approval waits. See the [task review](mvp.md#first-delivery-background-task-review--2026-10-27).
The owner confirmed the complete agreement on 2026-10-27; the
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/15#issuecomment-6458013516) closes the planning decision.
This is future behavior, with storage/API and interaction design still separate
map work.

## First-delivery chat and Activity interaction

The separate Activity workflow is deferred from the MVP by the
[2026-11-02 scope revision](#simple-chat-before-background-task-workflows).
The following records the earlier interaction decisions.

Accepted on 2026-10-30. Use the simple side-by-side layout A as the starting
direction for desktop web chat and Activity. Chat stays available while Activity
shows the selected bot's task list and actual task details. The CLI lists,
inspects and optionally follows the same records. Exact commands, responsive
behavior and visual polish remain open. See the [interaction record](mvp.md#first-delivery-chat-and-activity-interaction--2026-10-30)
and [confirmed resolution](https://github.com/lancewilhelm/Staf/issues/16#issuecomment-6537511518). The synthetic prototype is not runtime behavior.

On 2026-10-31 the owner selected an inbox for updates alongside a persistent
bot list. Activity is hidden when there is no work and opens automatically only
when the owner must provide input or approve an action. This revises the earlier
desktop default of showing Activity beside chat. The owner selected guided
provider and bot setup, with Codex first. A bot can still be created without a
working provider. The shared instance remains the owner of chat and Activity.
The current UI and verification status are described in [usage](usage.md).

On 2026-11-01 the owner clarified that provider authentication belongs to the
instance, while each bot selects its own model. Provider setup belongs in global
Settings. The owner retired the Advanced browser page and chose to bring other
controls into the workspace incrementally. The underlying service operations
remain available; the retired page is not the current GUI.

## Simple chat before background-task workflows

Accepted on 2026-11-02 during the review of
[background work delivery](https://github.com/lancewilhelm/Staf/issues/22).
Focus the MVP on a simple chat interface, with Hermes Agent as a product
reference. Actual tool use and brief status updates belong in the message list.
Defer independently running background tasks and their separate Activity,
question, and management workflow from the MVP. This revises the earlier
first-delivery requirement to finish that workflow now.

Preserve the existing background-task implementation for later work. Deferral
does not mean issue #22 is complete, and a separate Activity view remains a
possible future feature. The current runtime still exposes background-task
creation to tool-capable chat providers; changing that exposure and simplifying
the web interface require implementation after this design discussion.

Sub-agents means temporary workers created for a particular assignment, with
results returned to the parent agent. They are a future concept, distinct from
the existing collaboration between persistent agents. This decision does not
add sub-agents to the MVP or change runtime behavior.

## First-delivery shared state and client contract

Accepted on 2026-10-30. One Staf instance owns shared records in SQLite and
serves web and CLI clients. A clean start is sufficient; existing conversation
files remain untouched and import is not required. Per bot, accept one main-chat
request at a time; a competing client keeps its unsent text for an explicit retry.
Live updates, reconnect without duplicate submission and verified backup/restore
remain required. HTTP with live updates and stable IDs is the recommended
implementation direction, with exact mechanisms still open. See the
[shared-state record](mvp.md#first-delivery-shared-state--2026-10-30) and
[confirmed resolution](https://github.com/lancewilhelm/Staf/issues/17#issuecomment-6537715795). This is not implemented runtime behavior.

## First-delivery acceptance and handoff

The owner confirmed the complete first-delivery acceptance agreement on
2026-10-30. The full owner journey, offline and operational checks, separately
authorized live checks for both initial providers, and three delivery slices
are recorded in the [acceptance review](mvp.md#first-delivery-acceptance-review--2026-10-30)
and the [accepted resolution](https://github.com/lancewilhelm/Staf/issues/18#issuecomment-6537991279).
An unrun or failed live provider check remains an acceptance gap. The planning
decision is closed. The [delivery specification](https://github.com/lancewilhelm/Staf/issues/19)
and implementation sub-issues are published; the milestone still requires
implementation and verification.


## Shared terminal replaces the standalone CLI

The current terminal connects to the shared instance for chat, settings, and
Codex sign-in. The earlier standalone commands and isolated Codex CLI auth alias
described in historical decisions above are no longer available. Existing legacy
data is not automatically migrated into the shared instance. See
[usage](usage.md) and [Codex sign-in](codex-direct.md).


## Chat GUI polish and agent terminology

On 2026-11-01 the owner selected a focused cleanup of the current chat workspace.
The immediate goal is chatting with agents, creating and managing agents, polished
Codex and OpenRouter connection flows, and properly displayed responses. The
owner chose "agent" as the canonical term for the entity previously called a bot.
The glossary uses the new term; existing runtime names and historical records
still use bot terminology. Renaming those is implementation work.

The owner identified Light, Dark, and System appearance choices, sent text
remaining in the composer with a Check status control, and the saved-browser-record
recovery disclosure as priorities. Remove that disclosure from the normal chat
experience. The owner subsequently accepted automatic per-agent draft retention
and recovery, immediate composer clearing on Send, and submission progress in
the conversation. Errors and Retry belong beside the affected message. Recovery
must avoid duplicate messages. Routine Check status controls are removed.

T3 Code is the owner's UI reference, particularly its inbox sidebar. Preserve the
existing chat direction and prioritize a simple interface. No tools beyond the
clock tool need implementation in this pass. The owner accepted focusing the
sidebar on the agent list, New agent, and Settings, deferring inbox expansion
while retaining access to clock approvals when needed.

The owner accepted Light, Dark, and System in Settings, defaulting to System,
with the preference remembered separately in each browser. The composer is the
message input box. It stays visible while responses stream and render Markdown,
including code blocks with Copy. Responses follow the bottom unless the owner
has scrolled up to read.

Initial agent management includes creation, renaming, instruction edits, provider
and model selection, and archiving with retained conversations. Global Settings
provides Codex browser sign-in and OpenRouter API-key entry, connection status,
and disconnect controls. Agents select their own provider and model using the
instance's shared connections.

Agent lifecycle and configuration must be available through the shared service
to the GUI, CLI, and future apps. The owner requested a backend design discussion
and selected Hermes profiles as a comparison, without adopting its folder layout.
The owner confirmed that normal management uses the GUI, CLI, and API, and
requires configuration files that are easy to inspect and maintain manually.
Terminal tools and external agents must be able to edit those files directly.
The owner accepted configuration files as authoritative, with GUI and CLI
changes writing those same files through the service. Conversations and
operational records stay in the shared database; credentials remain in the
instance credential store. See [ADR-0003](adr/0003-editable-agent-configuration.md).
Saved changes apply automatically to the next message without restarting the
instance. Work already underway uses its captured configuration. Concurrent
edits report a conflict and preserve unsaved client changes. An invalid file
remains intact, produces an actionable error, and blocks new messages for that
agent while its conversation and other agents remain usable.

For issue #28, the owner reconsidered the proposed explicit publish workflow
and chose direct file editing. Staf reloads valid files before new work and
retains observed configurations for recovery. Direct saves are last-write-wins:
an overwritten version that Staf never observed cannot be recovered, and
separate edits to the two files are not an atomic pair. See the revision in
[ADR-0003](adr/0003-editable-agent-configuration.md#revision-direct-editing-and-recovery).
The owner confirmed that cache means provider prompt caching. Preserve the
requirement to warn about configuration changes that may affect reuse, but defer
prompt construction, prompt updates, cache-impact rules, and detailed warning
design to a later discussion. Do not expand this GUI pass into prompt-cache
engineering or claim a guaranteed cache miss.
This requirement revises the database-only profile storage recommendation; it
does not select a separate database or process per agent, or add terminal tools
to this implementation slice.

Creation requires only a name. Instructions are optional, and provider/model
choices are prefilled from instance creation defaults, with customization
available during creation or later. A working provider is not required to create
an agent. This revises the earlier requirement for nonblank role instructions in
the [initial agent contract](first-delivery-bot-contract.md#profile-and-creation-defaults).
Existing agents continue to own their copied configuration. The owner accepted
a configuration directory keyed by stable agent ID, with its path available in
agent Settings and through the CLI. Settings belong in agent.toml. After reviewing
[OpenClaw and Hermes](research/agent-instruction-files.md), the owner selected one
soul.md document for personality, role, and standing guidance, exposed through a
single Instructions editor. Preserve existing soul and role text when combining
them. There is no separate instructions.md in the target layout.

While a response is underway, the owner can type the next message and use Stop.
Send becomes available after the current response finishes or stops. Keep one
response at a time per agent and retain the next draft automatically. Steering
and queuing are explicitly deferred.

The owner confirmed the [consolidated GUI polish plan](chat-polish-plan.md) on
2026-11-01 and requested specification publication. The implementation spec is
[Polish agent chat, provider setup, and shared configuration](https://github.com/lancewilhelm/Staf/issues/26),
labelled ready-for-agent. These are accepted design decisions, not implemented or
verified GUI behavior.

## Approved chat workspace appearance

Accepted on 2026-11-02 with the iteration-4 prototype at
`prototype/quiet-work-browser`, commit `f581a771bc4b1e096210bcf518da08b39c3e34e4`.
The owner chose Light, Evergreen, DM Sans, Orbit, and an expanded sidebar as the
initial appearance. This supersedes the earlier System default above to match
the approved design. Existing saved Light/Dark/System choices remain honored;
System is still available. Appearance and layout preferences belong to each
browser. The Focus rail keeps agent navigation available. Provider choices use
a popup above the composer, with the existing service contracts and inline save
feedback. Separate Activity/background-management screens remain deferred.

On 2026-11-02 the owner clarified that the accepted prototype is the visual and
interaction authority for all menus and pages, with existing production features
adapted into that style. Use grouped model menu rows, the New agent modal,
provider cards and the Edit defaults disclosure. Keep manual entry, reasoning,
connection recovery and agent lifecycle controls within those components.

## Optional agent images

Accepted on 2026-11-03 after reviewing prototype revision
`f51e14f031414f6d19d416d92984aa5e682769c0`. Ship the six approved rounded shapes
and regular polygons together, with the existing eight colors selected
independently. Characters use solid fills and two black circular eyes.
Polygons have equal sides and angles and vertical symmetry. Initials remain the
default, and uploads use a square crop. Changes commit through Create or Save.

The choice belongs to shared agent configuration, while uploaded PNG bytes live
with the instance's backed-up agent files. Existing revision conflicts, direct
file editing, and retry-safe creation apply. Accepted images are retained for
configuration history and uncertain-save recovery. See
[image usage](usage.md#agent-images) and the
[configuration/API reference](reference.md#agent-image-configuration-and-api).

## Code Mode for agent tool work

### Revision: selectable tool modes

On 2026-11-04 the owner replaced the mandatory code-only direction with Direct,
Hybrid, and Code Mode choices. Hybrid offers individual tools plus `code_mode`.
Direct offers individual tools. Code Mode offers only the execution tool, whose
scripts can call the same permitted capabilities. Both calling styles use the
same service-owned implementations, accepted session context, permissions, and
action records. This supersedes the earlier prohibition on a direct model path
and the plan to retire individual tools.

The owner prioritizes simplicity and has deferred additional container or OS
isolation work. In the follow-up interview, the owner confirmed that modes are
saved per agent through Settings, CLI, and API and apply to chat and background
tasks. Active work retains its captured mode. The first selectable-modes release
also includes a host terminal and file read, write, edit, and search tools.
Host commands use the service account's permissions without requiring containers.
These choices supersede the proposed chat-only first scope and deferral of host
tools. They are release requirements, not implemented runtime behavior.
The owner subsequently confirmed Hybrid for new agents and Direct for existing
configurations without a saved choice. Host terminal and file tools use the
existing permission and approval settings, with one underlying action decision
for both calling styles. Delegated work uses the executing agent's own mode and
retains task restrictions. The owner prefers adding project folders to the
agent's existing directory rather than moving the agent directory. Folder layout
and code-based self-improvement were subsequently accepted as later work: add
project folders or attach existing locations without moving them, allow tested
scripts and saved skills, and use ordinary reviewed development for Staf changes.
The owner explicitly deferred these expanded workflows to focus on basic tool
use. Basic terminal and file tools remain in the first release, with a stable
working folder. Research into current harness skill conventions belongs to the
[later-work record](design/code-mode/later-work.md).

The owner rejected limiting the terminal to foreground commands. The basic tool
release must support the normal host terminal's commands, scripts, interactive
programs, input, output, and background processes. Permission policy is a
separate topic. A QuickJS script's lifetime must not silently limit an
intentionally retained terminal process. The owner also confirmed that Hybrid
can continue through direct tools after an ordinary code error, accounting for
completed actions. Denial, Stop, restrictions, exhausted shared budgets, and
uncertain effects still prevent workarounds; Code Mode-only work does not
silently switch styles. The owner then confirmed the consolidated basic-tool
scope and shared understanding, completing the follow-up interview. This confirms
the product requirements, not implementation or live-provider verification.

The owner then added basic memory operations as core tools in the same release:
search/read, remember, update, and forget. Direct and Hybrid expose normal memory
tools, and Code Mode scripts call the same memory service. This promotes memory
beyond owner-phrase commands, paired-client APIs, and request-time recall into
the model tool catalog. Preserve agent and shared user scopes, exact IDs,
optimistic versions, and existing shared-memory confirmation. It does not add a
new memory backend or change permission policy. Current memory behavior remains
implemented as documented until the new tool adapters land.

The owner rejected PR #72 and intends to rebuild its feature later. The basic
tool release no longer depends on that delivery or its service contracts. Do not
merge or import its session, document, or artifact implementation into this work.
This supersedes the earlier recommendation to land #72 before #75 integration.
GitHub still reported #72 open when the rejection was recorded; this status does
not reverse the owner's decision.

The existing runner's actual limits remain documented. The
[revised architecture checkpoint](design/code-mode/tool-modes.md) proposes
the focused basic-tool release and production design. These are not current
settings or verified runtime behavior. The remaining text records the prior
decision and the bounded experiment built from it.

### Earlier decision and experiment

On 2026-11-03 the owner accepted Code Mode as the target for agent tool use after
a bounded execution experiment passes. Migrate the existing main-chat clock,
web search, page reading, scratch commands, and skill loading through the shared
service, then retire equivalent direct model tools. Each execution starts with
fresh variables, may wait for approval, and becomes interrupted on a Staf restart
without automatic replay. Conversation history and actual action outcomes remain
recorded.

Keep all current AI connections. Explain plainly that a connection can offer
many models and that testing one model does not establish that all models work
with Code Mode. Documentation must name the models actually checked and identify
untested combinations. The [Code Mode decision](adr/0005-service-owned-code-mode.md)
records these accepted choices and the remaining technical decisions.

In the next round, the owner confirmed that denying an action ends its script
without a workaround. Invalid code can receive a bounded number of corrections
before any action runs, using the selected model. Partial failures retain
successful results, retry only failed reads within current limits, and require
checking uncertain effects before retrying them. Normal chat shows progress,
approvals, and results, with generated code collapsed into inspectable details.

The owner subsequently accepted approval waits of up to 24 hours while Staf
stays running. Expiry ends the script and retains completed results without
granting approval. Independent reads may run in limited parallel work, approval
requests appear one at a time per agent, and actions that change things run in
order within a script. Retain generated code, action history, and returned
results with the conversation, and discard unused temporary data when execution
ends. On 2026-11-03 the owner confirmed the consolidated agreement and completed
the design interview. Runtime selection and resource limits were left for
`/architect with checkpoint` before implementation.

Owner-authorized feature coordination requires Code Mode calls to use the
immutable agent, session, command, and cancellation context captured when work
was accepted. Session, document, and artifact services provide their own typed
methods through the same host bridge, without a second direct-model-tool path.
Fresh sessions must not silently summarize, truncate, compact, or replay older
sessions. The [coordination record](design/code-mode/coordination.md) identifies
the local integration contract and the separately owned feature scope.

The owner approved the architecture checkpoint on 2026-11-03 as the basis for
the bounded execution experiment: a fresh local JavaScript QuickJS/Wasm guest,
the shared host capability contract, and the starting limits in the
[detailed design](design/code-mode/design.md). Temporary successful-read results
may span fresh script invocations within the same accepted request and are
discarded when it ends; selected returned outputs are durable. Each presented
approval has its own 24-hour window, so several approvals can extend total
request time beyond 24 hours. This approval does not establish isolation,
resource enforcement, model reliability, or production readiness.
These are future product decisions, not implemented runtime behavior.

The first execution experiment is implemented under [issue #74](https://github.com/lancewilhelm/Staf/issues/74).
It is available only to an internal synthetic-provider lab. The [experiment record](design/code-mode/experiment.md)
distinguishes working host lifecycle behavior from the unproven total-process
ceiling, platform isolation and live-model gates. Production tool migration
remains deferred until those gates pass.
