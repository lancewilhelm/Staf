# Initial bot contract

Status: initial bot agreement confirmed, 2026-10-27. The owner confirmed creation,
naming, copied configuration, active-work snapshots, edit conflicts and
archive/restore. See the [accepted resolution](https://github.com/lancewilhelm/Staf/issues/14#issuecomment-6455172896).
Items labelled Recommended remain implementation proposals. None of these
capabilities is implemented by this design record. This contract supports
[Set first-delivery bot setup behavior](https://github.com/lancewilhelm/Staf/issues/14)
and the [first-delivery spec outline](first-delivery-spec-outline.md).

## Purpose and accepted boundary

Create a useful named bot with minimal setup, then let its owner customize it
without losing the bot's main chat. The owner already agreed to a name and
instructions, a customizable starting soul, its own provider/model/reasoning
settings copied at creation, and one persistent main chat per bot. Earlier use
of "inherit" is superseded: existing bots do not follow later creation-default
changes. See [ADR-0002](adr/0002-copy-bot-creation-defaults.md).

The accepted [deployment resolution](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689)
provides one owner, a shared instance for web and CLI, and paired-client access.
The accepted [approval resolution](https://github.com/lancewilhelm/Staf/issues/2#issuecomment-6453313751)
keeps permissions and task scope separate from prompt text and approval mode.
See the [glossary](../GLOSSARY.md) for bot, soul, memory and main chat.

## Profile and creation defaults

The 2026-11-01 [GUI and agent-management interview](decisions.md#chat-gui-polish-and-agent-terminology)
changes the creation agreement to require only a name. It also requires manually
maintainable configuration files alongside GUI, CLI, and API management.
[ADR-0003](adr/0003-editable-agent-configuration.md) makes these files authoritative,
with validated changes applying to the next message. One soul.md combines
personality, role, and standing guidance, superseding the separate role-instruction
and soul fields described in the original agreement below. Existing text must be
preserved during consolidation. These are design requirements; this amendment
does not claim runtime implementation. Historical "bot" terminology below refers
to agents. See the [consolidated plan](chat-polish-plan.md).

| Item | Contract | Basis |
| --- | --- | --- |
| Identity | Give the bot a stable opaque ID. Renaming preserves this ID and its main chat. Names are labels, not identifiers. | Agreed B1 |
| Name and instructions | Require a nonblank owner-supplied name. Role instructions are optional. Creation needs no model request or working provider. | Revised by owner on 2026-11-01 |
| Description | Optional owner-editable text, initially blank. Do not add another required setup field or a model-generated description. | Agreed B2 |
| Soul | Start with a deterministic neutral template. One soul.md contains personality, role, and standing guidance. No automatic self-rewriting in this delivery. | B3 amended by owner on 2026-11-01 |
| Provider, model and reasoning | Copy initial values into the bot at creation. Later creation-default changes do not alter existing bots. The owner edits each bot's own values. | Agreed B7; replaces live inheritance |
| Main chat | Create exactly one durable main chat with the bot, as one all-or-nothing operation. | Agreed chat; recommended B4 atomic creation |
| Revision | Version accepted profile edits. An edit based on an old revision reports a conflict instead of overwriting a newer edit. | Agreed B5 |
| Lifecycle | Active or archived. Archive/restore preserves the profile and history. Permanent deletion waits for later MVP work. | Agreed B6 |

Agreed B1: duplicate names may exist. Clients select a bot by its ID and
show enough information to disambiguate; ambiguous natural-language references
require clarification. Do not impose a one-bot limit just because the first
acceptance example uses one bot.

Agreed B3 uses a neutral editable starter soul. The proposed initial wording is:

> You are an assistant working for the owner. Be clear and candid.
> Distinguish observations from assumptions. Follow the owner's role instructions
> and work within the permissions and task scope granted to you.

The template supplies a starting identity, not a memory system or permission
grant. Explicit owner requests may customize style within the allowed scope;
application permissions remain enforced by the service. The owner can edit the
soul later. Creation does not infer new personality traits or stored memories.
The captured profile supplies the bot's name separately from the soul text;
renaming does not automatically rewrite an owner-edited soul.

The original agreement composed separate soul and role instructions into each
provider request. The amended design supplies their consolidated soul content.
Providers must receive the context for that specific bot/run; do not implement
bot switching by mutating one shared global prompt. Keep the service's enforced
tool/permission rules separate from owner-editable identity text.

## Model settings and readiness

Agreed B7: bot creation copies the initial provider/model/reasoning values into
bot-owned configuration. Editing instance creation defaults affects future bots
only. Updating an existing bot is an explicit edit to that bot and creates a new
configuration revision. There is no live inheritance or return-to-inherit mode.
The same ownership rule applies to the initial soul and role instructions rather
than leaving a live link to a shared creation template.

If initial settings are incomplete, keep the bot's own incomplete values and show
what needs setup. A later instance-default edit must not silently fill them in.
If the owner changes the bot's provider, validate model/reasoning in that provider's
scope, using the bot's own saved choices when available or requiring explicit
selection. Never resolve missing bot configuration by consulting newer creation
defaults behind the owner's back.

Provider credential lifecycle and permission/approval policy remain separate.
The accepted approval rules still recheck restrictions and revocation before the
next action. Copying configuration never freezes or expands authority.

An authenticated owner can create or edit a bot before live credentials or model
selection are ready. Report missing setup when execution is requested and keep
settings usable. The existing offline demo remains available. Do not silently
switch providers, select an invented model, or make a live call just to save a
profile. Provider credentials stay in the instance credential/configuration
boundary; profiles and clients receive readiness, not the underlying credentials.

The service owns effective instance configuration. A remote CLI argument cannot
silently replace shared defaults. Any per-request override must be an explicit,
validated request with the same behavior available to other clients.

## Edits and ongoing work

Agreed B8: at acceptance, each main-chat turn or background task captures
the bot profile revision, role instructions, soul and effective provider/model/
reasoning configuration it will use. Refer to the captured revision in Activity.

- A name, soul, instruction or model edit applies to subsequently accepted work.
- Already accepted or running work keeps its captured configuration. Show the
  owner that the edit applies to new work, rather than implying an active task
  changed halfway through execution.
- A new task directive or cancellation is an explicit task command. Editing the
  profile is not a hidden instruction to redirect or cancel existing work.
- Permissions, approval requirements and revocations are rechecked before each
  action under the accepted policy. A captured profile never freezes authority
  or defeats a later restriction.

The precise execution/queuing contract is proposed in the
[spec outline](first-delivery-spec-outline.md#recommended-execution-defaults).
The service must define acceptance and configuration capture consistently across
clients so an acknowledged command cannot change meaning after reconnect.

## Logical operations

These are behavior contracts, not frozen HTTP routes or TypeScript interfaces.

| Operation | Observable result |
| --- | --- |
| Create | Return a stable bot ID, first profile revision and main-chat ID after durable creation. |
| List/get | Return canonical profile, lifecycle, main-chat reference, effective settings and readiness to authorized clients. |
| Update | Validate changes against an expected revision; return the new revision and when edits take effect. |
| Archive | Agreed B6: permit only when no main-chat turn or task is queued, running, stopping or waiting for approval. Otherwise explain what must finish or stop. |
| Restore | Make the same bot active again with its existing main chat and profile. |

Recommended B4: creation has a client command ID. Retrying the same command with
the same payload returns the same result; reusing the ID with different content
is a conflict. Return success only after the profile and main chat are durable.
Apply the same command-result principle to other state-changing operations.

Agreed B6: archived bots stay inspectable to the owner, are hidden from the
default active-bot picker, and accept no new execution until restored. Archive
and execution acceptance must be checked together so another client cannot start
work in the gap. Archive is not deletion. Permanent deletion, automatic cleanup
and a complete retirement workflow stay in later planning.

## Checks that establish the contract

Use the future public service command/query boundary with real temporary storage,
a deterministic clock and offline providers. Verify:

- Creation works without a live model and creates one profile/main-chat pair.
  A retried command does not create duplicates; a failed write leaves no orphan.
- Browser and CLI see the same profile and main chat. Two edits based on the
  same revision cannot silently overwrite one another.
- Renaming preserves identity, history and usage attribution.
- Requests for two different bots carry their respective captured instructions
  and soul without leaking one bot's context into the other's request.
- Existing bots keep their copied model/settings when creation defaults change.
  A bot created afterward receives the new values. Explicit bot edits affect
  that bot's new work, and incomplete settings do not silently inherit later values.
- A controlled in-flight operation retains its profile revision after an edit;
  the next accepted operation uses the new revision.
- Revoked permissions or stricter approval requirements still govern the next
  action of an older operation.
- Archive is rejected while work is active, blocks later execution once accepted,
  preserves history, and can be reversed by restoring the same bot.

These are proposed tests, not tests added or run by this document. They extend
existing behavior checks for settings precedence, next-request changes, session
resume, provider replay, storage failures and concurrent writers.

## Review and boundary

The six-question review settled optional blank description, neutral editable soul,
duplicate display names, conflict-aware edits, idle-only archive without permanent
delete, and captured configuration for accepted work. It explicitly replaced B7
live inheritance with independent copies at creation. Atomic/idempotent creation
(B4) remains the recommended shared-client correctness contract.

The owner confirmed the complete initial bot agreement on 2026-10-27; the
[decision is resolved](https://github.com/lancewilhelm/Staf/issues/14#issuecomment-6455172896). No task budget, execution concurrency,
storage technology or final API is approved by these bot-behavior answers.

This contract omits memory retrieval, automatic skill management, named-bot
collaboration, self-directed soul evolution and full retirement. Those remain MVP
requirements/planning topics; their absence here is a milestone boundary.
This agreement settles the initial bot behavior, not every task,
API, storage or UI decision. No planning issue is resolved by drafting it.
