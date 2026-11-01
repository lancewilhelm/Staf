# Evolving session and execution architecture

Recorded on 2026-10-25. This note captures product direction and proposals. It does
not describe features already implemented in Staf. The current CLI processes one
turn at a time and waits for provider work. It has no agent scheduler or background
workers. Existing JSON session persistence is not a durable task service.

## Accepted MVP scope update — 2026-10-26

The [MVP scope interview](mvp.md#mvp-scope-interview--2026-10-26) now requires named
bots, persistent main chats that stay responsive during background work, and a
separate Activity monitoring space for tasks and actual steps. The web app and
CLI share an always-on personal instance; see
[ADR-0001](adr/0001-shared-instance-web-first.md). These are accepted product
requirements, not implemented features. The next interview round accepted
bot-to-bot requests and replies, with the requesting bot responsible for the
result, plus task announcements and steering in main chat. Activity shows detail;
the CLI offers task listing, inspection and optional live following of the same
records. The following round clarified that bots collaborate through actual
messages rather than copied transcripts; bot names and descriptions should be
discoverable, with discovery behavior to be tested. It also accepted restoration
of interrupted tasks, safe continuation and review of uncertain action outcomes,
plus latest-occurrence catch-up within a configurable lateness window. The
mechanisms below remain proposals; optional task sessions, permission enforcement,
discovery, detailed recovery and handoff behavior remain open.

## First-delivery task review — 2026-10-27

The owner accepted a bounded initial task lifecycle: one background task per bot,
responsive main chat, separate durable Activity, explicit direction and
stop-and-replace for changed objectives, observable stopping and failed attempts,
client-independent execution, interrupted work after instance restart with explicit
retry, and an adjustable five-minute execution default excluding approval waits.
See the [task review](mvp.md#first-delivery-background-task-review--2026-10-27).
The owner confirmed the complete agreement on 2026-10-27; see the
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/15#issuecomment-6458013516). This does not implement workers
or resolve storage/API choices. Safe automatic continuation remains later MVP work.

## Product direction

The accepted MVP includes named bots with persistent main chats and background
work shown in Activity, including actual inter-bot requests and replies. Bots
can start background tasks within existing permissions and announce them. Users
can stop or redirect a task through main chat, with clarification for ambiguous
references and acknowledgment of the request. Stopping is distinct from stopped.
Collaboration passes relevant context in messages, not a verbatim transcript.
Helpers must respect the assignment's approved scope and their own permissions.
The [approval decisions](mvp.md#approval-decisions--2026-10-27) establish three
approval modes with owner-controlled instance defaults, bot overrides and temporary
task overrides. Permissions and task scope bound all modes, including Never ask.
The same decision settles risky and remembered approvals, permission limits,
helper restrictions, revocation and unattended authorization. Optional task
sessions, permission-enforcement mechanisms and discovery behavior remain design
questions. Watching work does not automatically transfer control.

## Incremental delivery — 2026-10-27

The user chose milestone-by-milestone design and delivery. The first connected
bot delivery establishes the initial service/client boundary and a read-only
background task before broader memory, skill and collaboration behavior is
settled. See the [planning boundary](mvp.md#wayfinder-planning--2026-10-27).
The proposals below remain future design context, not prerequisites that all
must be resolved before the first milestone can enter specification and build.

## Accepted deployment requirements — 2026-10-27

The owner clarified local-network-first access to an always-on API, with a public
address and external hosting optional. This replaces the earlier public-HTTPS
setup assumption. Native installation in the owner's VM is the first documented
path, with Docker supported using the same configuration and API. Initial setup
works through CLI or browser. One owner per instance has lightweight client-device
authorization separate from provider sign-in. Linux VM is the initial native
platform, with an optionally installed service that starts after reboot. Browser
and CLI clients pair with a one-time code on the host and remain trusted until
revoked. Updates are owner-initiated, preserve data/configuration, and back up data
before format changes. Credential storage, transport and enforcement mechanics
remain to be designed. Household sharing remains later work; reconnect and
backup/restore requirements are in the
[deployment interview](mvp.md#deployment-and-owner-access-interview--2026-10-27).
The owner confirmed the full agreement on 2026-10-27; the
[accepted resolution](https://github.com/lancewilhelm/Staf/issues/5#issuecomment-6454200689)
closes the deployment decision. These are product requirements, not implemented
service or authentication behavior.

## Bot configuration ownership — 2026-10-27

The owner clarified that a bot owns copies of its initial provider/model/reasoning
configuration and starter identity settings. Updating creation defaults affects
future bots only. Explicit bot edits affect new work; already accepted work keeps
its captured configuration. Permission restrictions and revocations remain live,
separate from configuration copying. See
[ADR-0002](adr/0002-copy-bot-creation-defaults.md) and the
[initial bot review](mvp.md#initial-bot-contract-review--2026-10-27).
This is an accepted product rule, not implemented persistence behavior.

## Conversation topology and execution scheduling

Conversation topology answers where messages appear, which agent owns a session,
and how a task links to a main chat. Execution scheduling answers when work runs,
which resources it holds, and whether it blocks another request. Separate sessions
do not by themselves make execution independent. A background worker can still
block a coordinator if the coordinator waits synchronously for its result.

The goal is a responsive front chat while long work proceeds independently.
A quick reply need not spawn another agent. A durable visible history is not the
same as the active context sent to a model. Staf can retain a conversation while
selecting only a relevant portion for a particular request.

## Proposed mechanisms to evaluate

- Keep a thin conversational coordinator available for dialogue, status requests,
  clarification, and task routing while long work continues elsewhere.
- Represent background work as durable task records with IDs, status, progress,
  and results, rather than only as a blocking child call.
- Use shared persistent storage with scoped context access. A shared store does
  not mean every worker reads every agent's entire history.
- Give workers task-scoped briefs that identify the objective, constraints,
  relevant instructions, context references, and expected result.
- Deliver results as task-linked messages. Preserve which task produced a result
  and which session should receive it.
- Use a common session mechanism for main chats and optional task sessions, while
  keeping their roles and lifetimes explicit.
- Show actual inter-agent requests and replies, with provenance and privacy
  boundaries. Do not substitute an invented dialogue for the exchange.

No database, queue, process topology, routing algorithm, or agent framework has
been chosen by this note. These mechanisms are design candidates, not commitments.

## Questions to resolve through examples

- What does a user expect when opening, watching, replying to, or taking over a
  task session? When does the system need an explicit handoff acknowledgment?
- Which instructions reach a worker? How are instruction versions recorded so
  a later correction does not silently change the meaning of an existing task?
- What context belongs in a task brief? What permission grants access to linked
  messages, files, or another agent's results?
- How does cancellation get acknowledged? Distinguish a request to stop from
  confirmation that the worker and any side effects have stopped.
- What happens to a late result after cancellation, a changed objective, or a newer
  result? How does the user identify stale work?
- After a restart, which tasks resume, retry, or require review? How are duplicate
  side effects prevented and interrupted ownership recovered?
- How many tasks can run concurrently? How are model budgets, resource limits,
  fairness, and prioritization exposed without freezing the front chat?
- Which exchanges are visible to which users or agents? A shared store must not
  erase privacy boundaries or imply unrestricted credential access.
- When should one task create a separate session, and when should it remain in
  the main chat? How does the user navigate between them without losing context?

## Supplied advice and evidence limits

The user supplied Grok Bot advice to keep the front agent thin, use durable
background-task records and shared storage, and deliver task-linked results.
It suggested a common mechanism for main chats and extra sessions. These are
useful proposals to evaluate against concrete interaction examples.

Its description of Grok's internals and its hypothesis that Hermes waits on child
work are unverified. They are not established facts about either product and do
not prove that a particular Staf design will stay responsive.

[The supplied Grok Bot FAQ reference](https://docs.x.ai/grok-bot/faq) has not been
checked for this note. It is a supplied reference, not evidence for private internals.

## Current boundary

Implemented today: normalized provider adapters, one synchronous conversation
loop, a clock tool, and local resumable sessions. Proposed here: persistent main
chats per agent, independent task execution, durable task records, inter-agent
visibility, scoped shared context, and user-dependent handoff. The MVP update above
accepts the main-chat, background-work and Activity goals without choosing those
implementation mechanisms. No new runtime architecture is implemented here.

## Continuity across CLI, desktop, and mobile

Product direction recorded on 2026-10-25.

**Accepted product goal:** Retain the CLI as a first-class interface while adding
eventual desktop and mobile clients. The same agents, main chats, optional task
sessions, messages, artifacts, and progress should remain continuous across
access points. Opening another client should not create an unrelated conversation
or duplicate the work. Actual inter-agent exchanges remain inspectable, with the
same privacy boundaries. Handoff remains dependent on user expectations; watching
from another device does not automatically transfer control.

**Proposed implementation direction:** Keep runtime/domain behavior and durable
state separate from CLI presentation. Evaluate a common client contract through
a shared runtime, API, and event stream. Durable IDs could link agents, sessions,
tasks, messages, artifacts, and commands across clients. These are mechanisms to
evaluate, not a selected deployment architecture or an implemented sync service.

The design needs to address reconnect and event replay, command deduplication,
concurrent commands, cancellation acknowledgment, and permission checks at every
access point. A consistent view must distinguish requested changes from accepted
commands and completed work. Persistent visible history still differs from the
active model context. Clients should not infer a model's context from everything
visible in the synchronized history.

Open choices include a local daemon, self-hosted runtime, cloud runtime, or a
combination; offline behavior; conflict resolution; and desktop/mobile frameworks.
Seamless access does not imply cloud hosting or automatic synchronization of
provider credentials to every device. Credential location, device trust, account
access, and revocation need explicit design. No provider grants are expanded by
this goal.

### Proposed future acceptance scenario

1. Start a long task through the CLI in an agent's main chat. The system returns
   a durable task ID and leaves the front chat responsive.
2. Open mobile and follow that same task, its linked session, actual exchanges,
   artifacts, and progress. Watching does not transfer control or launch it again.
3. Use desktop to redirect the task. The system acknowledges the command against
   the existing task ID, applies the expected handoff/permission rules, and shows
   consistent status across clients without creating a duplicate task.
4. Reconnect a temporarily disconnected client. It receives missing updates once,
   identifies stale results, and shows the current state rather than replaying
   the user's command as new work.

This scenario is a future acceptance target, not a runnable test or a claim of
current UI, scheduling, or synchronization support. This update changes only docs.

## Bot profiles and task Activity

The main chat, separate Activity monitoring, actual bot-to-bot exchanges and
CLI task views are now accepted MVP requirements. Optional task sessions and
the following layout details remain proposals. The bot-profile Activity view
has a proposed task list with title, status, short summary and time;
opening a task shows a timeline, nested worker/subtask steps and selected result
detail. This combines the user-referenced Muse Activity pattern with Grok Bot's
visible bot exchanges. It is a product direction, not a claim about either
product's internal storage or execution model.

The future view should project canonical task/message/activity records. It must
not invent a separate conflicting UI log. Show actual exchanged messages,
observable steps, tool outcomes and results; do not fabricate internal reasoning.
The front chat governs background tasks according to user expectations. Activity
watching does not automatically transfer control. SQLite is selected for the first
shared instance; the schema and implementation remain open. Existing conversation
import is not required for the first delivery. No database migration, bot runtime
or Activity UI was implemented by recording this direction.
