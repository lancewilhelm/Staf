# Evolving session and execution architecture

Recorded on 2026-10-25. This note captures product direction and proposals. It does
not describe features already implemented in Staf. The current CLI processes one
turn at a time and waits for provider work. It has no agent scheduler or background
workers. Existing JSON session persistence is not a durable task service.

## Product direction

The intended experience has one persistent main chat per agent, optional individual
task sessions, and visibility into actual inter-agent exchanges. Handoff depends
on what the user expects. Watching another agent's work should not automatically
transfer control. These expectations still need concrete interaction examples.

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
visibility, scoped shared context, and user-dependent handoff. No new runtime
architecture is implemented by this documentation change.

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

## Future direction: bot profiles and task Activity

Each persistent bot should have a main coordinating chat, optional task
sessions, and visible messages exchanged with other bots. The proposed
bot-profile Activity view has: a task list with title, status, short summary and time;
opening a task shows a timeline, nested worker/subtask steps and selected result
detail. This combines the user-referenced Muse Activity pattern with Grok Bot's
visible bot exchanges. It is a product direction, not a claim about either
product's internal storage or execution model.

The future view should project canonical task/message/activity records. It must
not invent a separate conflicting UI log. Show actual exchanged messages,
observable steps, tool outcomes and results; do not fabricate internal reasoning.
The front chat governs background tasks according to user expectations. Activity
watching does not automatically transfer control. Schema, storage choice and
implementation remain open; no database migration, bot runtime or Activity UI
was implemented by recording this direction.
