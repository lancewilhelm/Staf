# MVP decisions and current delivery

This document records user decisions. It is not a claim that every item exists.
Hermes is the primary reference for basic agent behavior. Staf remains a project
built from the ground up, with usability before full Hermes parity.

## Required MVP

- Codex and OpenRouter are the initial providers. Codex uses direct Responses,
  not CLI exec or app-server. LM Studio and other local providers come later;
  existing LM Studio code remains available.
- A personal, single-user Staf instance runs continuously, with authenticated
  access for its owner. Other people may operate their own instances; shared
  organizations and team permissions are outside this first MVP.
- The first app is a web app. The CLI connects to the same instance; Electron
  follows later. Closing a client does not stop agent work.
- Bot setup is quick: name and instructions are sufficient. Creation copies
  initial provider/model/reasoning values into the bot's own configuration.
  Later creation-default changes leave existing real-provider bots unchanged.
  Saving a real default also migrates remaining Demo bots. Each bot has a persistent main chat and easy customization.
- Main chats stay available while longer tasks run in the background. Bots may
  decide to start a task within existing permissions and announce it; users can
  explicitly request background work. Ordinary conversation stays in main chat.
- Main chat shows brief task-start, needs-user and completion updates. Users can
  stop or redirect work there; ambiguous task references require clarification.
  A stop request is acknowledged, with "stopping" shown until execution stops.
- Bots collaborate through actual messages, like people requesting help, asking
  questions and returning results. Messages convey relevant context rather than
  verbatim conversation transcripts. The requesting bot remains responsible for
  delivering the result; actual exchanges appear in Activity. Bot names and
  descriptions should be discoverable; discovery and mutual awareness need
  experiments before their exact behavior is settled.
- Routine steps may proceed within an approved task scope, according to the
  selected approval level. Work needing additional permission pauses. Helpers
  must respect both the assignment's scope and their own permissions.
- Approval modes are Ask every time, Ask for risky actions (the default), and
  Never ask. Permissions define allowed actions; approval mode defines when the
  owner must be asked. Never ask does not enable tools or expand task scope.
  Instance defaults may be overridden per bot and temporarily per task by the
  owner. See [approval decisions](#approval-decisions--2026-10-27) for the accepted
  rules and remaining questions.
- Each bot has its own memory. User memory spans all bots. Retention defaults to
  the addressed bot unless the user expresses an intent to share across bots;
  the save acknowledgment identifies the scope. Both memory scopes can be
  inspected, edited and deleted through the app or ordinary conversation, with
  clarification before ambiguous changes. Each bot has its own soul: enduring
  identity, personality, values, communication style and approach to its role.
  Basic setup supplies a starting soul that can be customized later. Soul editing
  and evolution rules remain open.
- Persistent chats and sessions retain history and consumption across restarts.
- An ordinary scheduler and event loop runs without an LLM polling for time.
  Creating a schedule authorizes future runs of the described action within
  agreed permissions and limits. A run needing additional permission pauses
  and explains what it needs. After downtime, run the latest missed occurrence
  once if it is within a configurable lateness window; skip older occurrences
  instead of replaying a backlog. The default window and overlap policy are open.
- After a restart, restore interrupted tasks and recorded progress. Continue
  where safe continuation can be established; uncertain action outcomes require
  review. Preserve completed work and never silently repeat an action that may
  already have changed something. Concrete recovery mechanics remain open.
- Tool execution includes shell, web search and source reading, memory, and skill
  discovery/use. An approval and rules pipeline must accompany executable tools
  from the start. This requirement does not authorize arbitrary host actions now.
- A useful chat UI and Activity visibility are essential to the MVP. Activity
  has a separate monitoring space showing the bot's tasks and actual work steps,
  following the user's preferred Muse interaction pattern. Activity offers a
  Stop control. The CLI offers a task list, task details and optional live
  following of the same records; leaving the view returns to chat while work
  continues. Exact commands and layout are not yet selected.
- Natural-language requests should select relevant skills. Slash commands must
  not be mandatory for ordinary skill use.

## MVP scope interview — 2026-10-26

This interview refines the required MVP. These are product requirements and open
choices, not implemented capabilities. It covers the whole MVP before a final
specification and implementation tickets are agreed.

Confirmed by the user:

- Personal instances, owner authentication, web-first delivery, a shared
  always-on instance for web and CLI, named bots, responsive main chats during
  background work, and authorization at schedule creation are required MVP.
  These answers supersede the earlier deferral of named bots and background work.
- Activity belongs in a separate monitoring space in the app. It shows running
  tasks and the steps taken. The user cites Muse as the desired interaction
  pattern; no claim about Muse's internals follows from that preference.
- Memory is explicit: recognize an expressed intent to retain information, with
  flexible natural-language phrasing rather than only the words "remember this".
  Automatic extraction from every conversation is not required for MVP. Bot
  memory and user memory are distinct agreed scopes, with inspection, correction
  and deletion through app and conversation. Retrieval details remain open. See the
  [glossary](../GLOSSARY.md) for the distinction from conversation history.
- The next interview round confirmed the task/Activity/CLI interaction, automatic
  task creation within permissions, main-chat steering, visible bot-to-bot help,
  quick bot setup with initial model defaults, and separate bot/user memory.
  The later bot-contract review clarified these are copies at creation, not live
  inheritance.
  The user additionally requires each bot to have its own soul.
- The following round defined soul, confirmed memory management, bounded task
  authorization, configurable approval levels, missed-run catch-up and safe task
  recovery. The user clarified that collaboration uses messages rather than
  copied transcripts, and that bot identity/discovery needs experimentation.

The shared-instance delivery boundary is recorded in
[ADR-0001](adr/0001-shared-instance-web-first.md).

## Initial bot contract review — 2026-10-27

The owner accepted minimal creation without a model call, optional blank
description and a neutral editable starter soul; duplicate names with preserved
identity; edits applying to new work while accepted work retains its revision;
conflict detection for concurrent edits; and idle-only archive/restore with
preserved history and no permanent deletion in the first delivery.

The owner rejected live inheritance of instance model defaults. Each bot owns
copies of its initial configuration. Future creation-default edits do not
silently reconfigure existing bots. See [ADR-0002](adr/0002-copy-bot-creation-defaults.md)
and the [reviewed contract](first-delivery-bot-contract.md). Permission restrictions
and revocations remain live under the separately accepted approval policy.
The owner confirmed the complete agreement on 2026-10-27. The
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/14#issuecomment-6455172896) closes the initial bot setup decision.
These are future requirements, not implemented bot behavior.

## First-delivery background task review — 2026-10-27

The owner accepted all eight recommendations while working through
[Set first-delivery background task behavior](https://github.com/lancewilhelm/Staf/issues/15).
The owner confirmed the complete agreement on 2026-10-27. The
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/15#issuecomment-6458013516) closes the task decision.
These are future requirements, not implemented task capabilities.

- Ordinary replies stay in main chat. Explicitly requested background work, or
  work the bot identifies as needing separate execution, becomes a task within
  existing permissions and approved scope. Announce its objective and stable ID.
- Allow one background task per bot while main chat remains responsive. An
  additional request reports that the bot is busy and identifies existing work.
- Capture relevant starting context. Later main-chat messages affect a task only
  when explicitly directed to it. A changed objective stops the old task and
  starts a linked replacement after it has stopped.
- Activity holds actual steps, tool results and errors durably, including when a
  later model response fails. Main chat receives brief announcements, requests
  for owner input and final outcomes. CLI supports list, inspect and optional
  progress following.
- A stop request is acknowledged promptly, prevents new steps and requests abort.
  Show stopping until execution settles. Preserve late output and explain the
  result; already completed work retains its completed outcome.
- Provider or tool failure leaves a visible failed attempt with recorded progress.
  Retry is explicit and creates a new linked attempt; no silent restart.
- Client disconnect does not stop work. Reconnect returns to the same records
  without resubmission. Instance restart marks unfinished work interrupted and
  preserves recorded progress, with explicit retry. Automatic safe continuation
  remains later work.
- Start with an adjustable five-minute execution limit, excluding approval waits.
  Reaching the limit requests a stop and records the reason; it does not imply
  execution has already stopped.

The bot configuration snapshot and live permission/approval policy remain as
previously agreed. Exact storage, API, state labels, timer configuration surface
and UI layout remain for specification and the existing map decisions. This
first-delivery recovery policy narrows the initial implementation without removing
the broader MVP goal of safe continuation.

## First-delivery chat and Activity interaction — 2026-10-30

The owner confirmed layout A as the starting direction: keep a simple main chat
visible beside the selected bot's Activity on desktop. Activity lists the bot's
tasks and shows the selected task's actual steps, status and result. Main chat
announces background work and outcomes, links to task details, and remains
available while work runs. The owner can stop or explicitly direct a task in chat;
Activity also offers Stop. The accepted task, approval and recovery rules continue
to apply.

The CLI connects to the same bot, chat and task records. It lists and inspects
tasks and can follow progress without taking ownership of the work's lifetime.
Exact commands, responsive behavior, labels and visual polish remain open. The
[synthetic prototype](https://github.com/lancewilhelm/Staf/blob/5ef5c333d590e85762c33f95f189de40053805c8/prototypes/first-delivery/index.html)
is throwaway code; it does not implement the connected service. The owner
confirmed the complete interaction in the [resolution](https://github.com/lancewilhelm/Staf/issues/16#issuecomment-6537511518).

## Approval decisions — 2026-10-27

Accepted with the owner while working through
[Set approval modes and permission boundaries](https://github.com/lancewilhelm/Staf/issues/2#issuecomment-6453313751).
The owner confirmed the complete decision on 2026-10-27 and the ticket is resolved.
These are future MVP requirements; no approval engine is implemented by this record.

| Approval mode | Accepted meaning |
| --- | --- |
| Ask every time | Prompt before each tool action. |
| Ask for risky actions | Default. Routine actions proceed; risky actions require approval. |
| Never ask | Proceed within granted permissions; pause when more permission is needed. |

Permissions determine what a bot may do; approval mode determines when it must
ask. A mode does not enable a disabled tool, broaden the approved task scope, or
give a helper extra authority through delegation. Helpers remain subject to the
assignment's scope and their own permissions.

The instance supplies the default approval mode. Each bot may have an override,
and the owner may change the mode temporarily for a task. Only the owner may
broaden permissions or relax approval requirements; bots may request a change.

Under Ask for risky actions, routine reads, research, drafts and reversible
edits within the task proceed automatically. Destructive changes, external
sending or publishing, purchases, software installation, security changes and
private-information disclosure require approval. Shell commands are judged by
their effects; uncertain effects require approval. Actions outside permissions
remain blocked until the owner explicitly changes the permission boundary.

A clear owner request counts as approval under Ask for risky actions when the
action, target and content are clear and permitted. For example, "Send this exact
message to Alex" authorizes that send without another confirmation; "Handle my
inbox" does not authorize arbitrary sends. Ask every time still prompts before
each tool action, including an action requested explicitly by the owner.

Approval normally covers one action. The owner may explicitly approve a
bounded action throughout a task or schedule, recording its action, resources or
recipients, limits and duration. Task grants end with the task; schedule grants
last until changed or revoked. Broader actions require fresh approval. The owner
also has an option to approve this type of action in the future. Remembered
approvals default to the current bot, with an explicit option to apply across the
owner's bots. Show the action type and boundaries before saving: for example,
"send reports to Alex", rather than every action a tool can perform. Remembered
approvals are visible, editable and revocable. They satisfy approval under Ask
for risky actions, but cannot expand permissions or task scope. Ask every time
still prompts for each tool action despite reusable approvals.

Instance permission limits constrain bots; bot permissions constrain tasks and
helpers. Task approval cannot override a disabled capability: the owner must
explicitly change that permission. Helpers must satisfy the assignment's scope
and both bots' permission limits. Apply the stricter approval requirement of the
requesting task and the helper so delegation cannot bypass prompts.

Permission revocation and approval-mode changes apply before the next action,
including queued actions. Recheck before execution. If a restriction removes
authorization for work already running, attempt to stop it and report effects
that already happened or remain uncertain.
Activity shows approval requests, grants, denials, revocations and blocked
actions; main chat receives a brief needs-user update when owner input is needed.

Creating a schedule approves its described recurring action, including a risky
action explicitly included in that description. Under Ask for risky actions or
Never ask, matching runs proceed within current permissions and limits. New
recipients, broader effects or additional permissions pause for the owner. Under
Ask every time, each tool action waits for approval; unattended operation requires
the owner to select another mode for the scheduled task.

No reply leaves the affected work paused while independent work continues.
Silence is never approval. Denial prevents the action and its dependent steps;
the bot reports the block without repeatedly asking the same question. Resuming
work rechecks current permissions, task scope and approvals.

### Permission and approval examples

All examples describe the agreed MVP behavior, not the current runtime.

| Situation | Result |
| --- | --- |
| Read an allowed source or reversibly edit a draft within the task, using the default mode | Proceed. |
| Send a message under the default mode without clear prior approval | Prompt before sending. |
| Owner says "Send this exact message to Alex", and sending is permitted, using the default mode | Send without another confirmation. |
| A remembered approval covers sending reports to Alex, but the bot wants to send to another recipient | Pause for approval of the new recipient; change permissions separately if required. |
| A permitted risky action is within the approved task scope, using Never ask | Proceed without an approval prompt. |
| A tool is disabled, even with Never ask or a remembered approval | Block; require an explicit owner permission change. |
| A helper has narrower permissions or a stricter approval requirement | Respect those limits; delegation cannot bypass them. |
| A schedule explicitly authorizes a daily report to Alex, using the default mode, with current permission to send | Run unattended within the described limits. |
| The same schedule uses Ask every time | Wait for approval before each tool action. |
| A permission is revoked while an action is queued | Recheck and prevent execution. |
| An approval receives no response, or is denied | Pause for no response; prevent the denied action and dependent steps. Independent work may continue. |

Detailed tool contracts, task/schedule recovery mechanics and Activity layout
remain with their existing planning decisions; these rules constrain that work.

## Deployment and owner access interview — 2026-10-27

Resolved in [Set deployment and owner access requirements](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689).
The owner confirmed the complete deployment agreement on 2026-10-27. The latest
clarifications supersede the earlier public-HTTPS-first setup assumption.

- Self-host an always-on Staf instance on a machine the owner controls. The
  service exposes a configured API so browser, CLI and future clients can connect.
  Local-network access is sufficient for the first delivery. A public address,
  domain, externally hosted app or internet exposure is not a prerequisite.
- Native installation inside the owner's VM is the first documented path.
  Docker is a supported alternative, using the same configuration and API. The
  owner already uses Hermes in that VM; this does not authorize changes to it.
  Docker is not a prerequisite. The first supported native platform is a Linux
  VM, while the application and API remain portable. Setup offers a background
  service that starts after reboot and survives terminal/SSH disconnection, with
  start, stop, status and log access. Exact installer and service wiring remain
  implementation choices. See [deployment trade-offs](deployment-options.md).
- Initial system setup must work through either CLI or browser. Both configure
  the same instance. Setup should be as simple as possible; precise initial
  settings, installation steps and setup authentication remain open.
- Staf client access is separate from model-provider authorization. The first
  delivery has one owner per instance and a lightweight way to authorize client
  devices. A full user-account or household-membership system is outside this
  first delivery. New browser and CLI clients authorize themselves using a
  one-time pairing code displayed on the Staf host. A paired client stays trusted
  until revoked; the owner can inspect and revoke paired clients. The earlier
  password-account suggestion is not adopted. Code handling, credential storage,
  transport protection and revocation enforcement remain implementation details.
- Future household access remains under consideration; shared-instance users
  versus separate instances, VMs, VPSs or containers is not settled. Do not assume
  a VM or container per person.
- Clients need a live connection to submit messages and control work. Show
  disconnection, then recover saved conversation and progress on reconnect.
  Offline submission queues are outside the first delivery; reconnect must not
  silently submit an action twice.
- Document backup and restore of bots, chats, settings and task history onto a
  replacement machine. Provider sign-in can be repeated when necessary.
- Updates are owner-initiated. Preserve data and configuration, and create a
  recoverable backup before changing stored data formats. Unattended automatic
  updates are deferred until installation and recovery paths are proven.

The owner confirmed this complete agreement and the planning ticket is closed.
These are future requirements, not capabilities added by this documentation.
Public access can be designed as an optional extension; its mechanism is not
chosen. Provider sign-in for a browser on a different machine still needs a
supported setup path. The current direct Codex flow uses the documented loopback
callback on the Staf host; simply opening its URL in a different machine's browser
does not complete that callback. The [setup research](deployment-options.md#provider-setup-on-a-remote-instance)
records this implementation gap separately from owner/device authorization.

## First-delivery shared state — 2026-10-30

The owner confirmed the complete [shared-state direction](https://github.com/lancewilhelm/Staf/issues/17#issuecomment-6537715795). One
Staf instance owns canonical bot, chat, settings, task, Activity and usage records
in SQLite. Web and CLI connect to the same service. Provider credentials stay
separate from bot profiles and client-visible records.

The first delivery assumes a clean start. Existing CLI conversation files remain
untouched, and import or migration is not required. Only one main-chat request
per bot is accepted at a time. A competing client sees that chat is busy and
keeps its unsent text for an explicit retry. Background work can continue while
main chat is in use.

Clients restore saved state and progress after reconnect. When acknowledgment of
a submission is lost, Staf checks its recorded status, shows uncertainty when
needed and does not silently submit it again. Previously accepted task restart,
pairing, revocation and backup/restore requirements still apply. HTTP with live
updates and stable IDs is the recommended direction; exact routes, event transport,
access enforcement, schema and backup mechanics remain to be specified and tested.
This decision is future behavior, not an implemented service or SQLite store.

## First-delivery acceptance review — 2026-10-30

The owner agreed to use the full installation-to-recovery journey as the first
delivery acceptance target, including shared web and CLI chat, a read-only
background task, Activity, stopping and reconnection. Later MVP capabilities
remain outside this delivery.

The owner agreed to repeatable offline behavior tests and actual native Linux
and Docker installation and recovery checks. Live provider sign-in and inference
checks require separate authorization; report them as unverified until run.
Before accepting the complete delivery, verify a supported setup path and a basic
live conversation for both Codex and OpenRouter, including the designed remote
setup path where applicable. An unrun or failed check remains an acceptance gap.
The owner also agreed to split the work into connected bot and chat, background
work and Activity, and installation and recovery. Each slice needs an observable
outcome and checks, and may start when its own prerequisites are resolved.

The owner confirmed the complete agreement. The [accepted resolution](https://github.com/lancewilhelm/Staf/issues/18#issuecomment-6537991279)
closes the acceptance decision. The delivery remains unimplemented.

## Wayfinder planning — 2026-10-27

The initial destination was a complete MVP design before specification. The user
changed the delivery approach on 2026-10-27: settle the decisions needed for one
usable milestone, specify and build it, then use the result to plan the next.
The full required MVP above remains the product target.

[Plan incremental Staf MVP delivery](https://github.com/lancewilhelm/Staf/issues/1)
is the canonical planning map. The active planning milestone is
[Plan the first connected bot delivery](https://github.com/lancewilhelm/Staf/milestone/1).
Its target is authenticated access to an always-on instance, initial named-bot
setup, shared persistent web and CLI chat, one simple read-only background task
using the clock capability, and Activity inspection. The former Demo provider was later removed. Exact behavior
is still being decided; this is a delivery boundary, not an implemented feature.

Only that milestone's own decision dependencies gate its specification and build.
The initial bot, task, Activity prototype, shared-state and acceptance questions
are separate from the broader MVP questions they feed. Deployment and owner
access is resolved; its [accepted requirements](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689)
and the accepted approval decision carry forward.
General memory tools, skill lifecycle, shell/web execution, recurring schedules,
soul evolution and bot collaboration stay in the later MVP planning backlog.

When a milestone's decisions are sufficient, hand it to to-spec and to-tickets
without waiting for every later decision on the map. Product implementation
belongs to the resulting build issues. Keep human decision interviews, prototypes
and factual research distinct; link each resolution from the map.

The [initial bot contract](first-delivery-bot-contract.md) records the accepted
bot setup agreement. The [first-delivery spec outline](first-delivery-spec-outline.md)
remains a review draft with separate technical proposals. Bot setup, initial
task behavior, the first interaction direction, shared-state direction and
acceptance requirements are resolved. The [delivery specification](https://github.com/lancewilhelm/Staf/issues/19)
and its implementation sub-issues are published.

The latest interview, glossary and ADR changes are currently local work. The
GitHub questions include relevant agreed context rather than assuming the older
published main-branch MVP document contains these answers.

## Delivered in this implementation

The direct adapter and in-process sign-in have offline tests. The default
Codex registry path no longer launches the CLI or app-server. On 2026-10-26,
user-authorized `gpt-6-luna` requests with an existing Staf grant verified text,
a saved-history follow-up and a resumed clock-tool round trip. Fresh browser
registration and live refresh rotation remain unverified; see
[verification and remaining gaps](direct-responses.md#verification-and-remaining-gaps).
OpenRouter, saved sessions, settings, context display and usage are implemented.
Clock is the only executable Staf tool. The existing CLI is the current UI.

The scheduler, shell/web/skill tools, broader approval rules engine and app Activity
view are not implemented by this change. They remain required MVP work. Automatic
skill creation, review and retirement remain undecided. History, memory, skills
and permissions are separate concerns; a transcript is not a memory system or a
permission grant.

## Deferred provider work

The direct provider supports one registration per data directory. An account-switch
UI and server-side grant revocation are not implemented; local logout removes
local tokens only. Automatic transport retries are also not implemented. Their
policies and priority remain open.

Before adding writable tools, define approval rules, durable side-effect tracking
and recovery so an interrupted or retried turn cannot silently repeat a write.
The current reversible clock read does not establish those guarantees. Usage and
metadata remain provider-specific; no account-wide quota or billing reconciliation
is implemented. See [usage accounting](usage-accounting.md).

## Architecture to keep open

Named bots, a persistent main chat per bot, background work with responsive main
chats, and a separate Activity monitoring space are now required MVP behavior.
Bot-to-bot requests and replies are now required MVP behavior, with the
requesting bot responsible for the result. Collaboration uses messages rather
than copied transcripts; discovery and mutual awareness need experimentation.
Optional task sessions, permission enforcement and handoff details remain open.
Activity shows actual messages, steps, tool outcomes and results. Concrete task and context relationships still
need agreement; see
[session architecture](session-architecture.md).

Future desktop, mobile and CLI clients share authoritative service state. They
must not invent conflicting local task histories or copy credentials to every
client. The detailed deployment topology and storage schema remain open. SQLite is
selected for the first shared service; no migration is performed here.

Hooks, triggers and sensing should cover schedules, events, conditions and
lifecycle hooks. Their design needs deduplication, freshness and health signals,
bounded runs and protection against self-trigger loops. Linked apps and services
are called **Connections**. Their implementation is after MVP. Event and
permission interfaces should still accommodate webhooks, polling and future
adapters. No Connection or external account was configured here.

Dedicated execution environments and shared-desktop takeover belong to later
vision. They are not a prerequisite for the current direct-provider work and
were not implemented or provisioned.
