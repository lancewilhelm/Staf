# Use Code Mode for agent tool work

## Revision: selectable tool modes

On 2026-11-04 the owner chose Direct, Hybrid, and Code Mode. Hybrid includes
`code_mode` alongside individual tools. Direct exposes individual tools, and
Code Mode exposes only the execution tool. These calling styles share the
service-owned capabilities, permissions, accepted work context, and outcomes.
This replaces the earlier requirement to retire direct tools and prohibit a
second model-facing calling style.

In the follow-up interview, the owner confirmed a saved per-agent mode exposed
through Settings, CLI, and API, applied to chat and background tasks. Active work
retains its accepted mode. The first release also includes host terminal and
file read, write, edit, and search capabilities using the service account's
permissions without requiring containers. This replaces the proposed chat-only
scope and deferral of host tools. These capabilities remain unimplemented.

The owner confirmed Hybrid for new agents, Direct for existing configurations
without a saved choice, shared permission and approval settings for both calling
styles, and the executing agent's own mode for delegated work. Adding project
folders within the existing agent directory is preferred over relocating the
agent directory. The owner accepted adding projects and attaching existing
folders, writing tested scripts and saved skills, and normal reviewed
development for Staf changes, then deferred these workflows to prioritize basic
tools. See the [later-work record](../design/code-mode/later-work.md).

The owner rejected a foreground-only terminal scope. Normal host commands,
scripts, interactive programs, input, output, and background processes belong in
the basic-tool release. Permission policy is a separate topic. Terminal process
lifetime must remain distinct from a QuickJS script's lifetime. Hybrid can use
direct tools after an ordinary code error, accounting for completed actions and
retaining shared denial, Stop, budget, permission, and uncertainty restrictions.
Code Mode-only work must not silently change styles.

The owner rejected PR #72 and plans to rebuild that feature later. The first
basic-tool release does not depend on or import its sessions, documents,
artifacts, or capability adapters. The extensible service boundary remains a
requirement for future integrations.

The [revised architecture checkpoint](../design/code-mode/tool-modes.md) proposes
the focused basic-tool release and production migration.
The owner confirmed the focused product scope and completed the follow-up
interview. The expanded task and terminal implementation design still needs
architecture review; the current implementation remains a synthetic developer
experiment. New
container or OS isolation is deferred at the owner's direction. The earlier
requirements below remain a historical record, not evidence that those checks
passed or that the mode setting exists.

## Earlier decision

Accepted and confirmed by the owner on 2026-11-03. The Code Mode design interview
is complete. These decisions describe future behavior, not implemented or
verified capabilities.

After a bounded execution experiment passes, make Code Mode the normal way
agents use tools. An agent generates a program that combines permitted actions;
Staf remains responsible for credentials, permissions, approvals, and action
records. Retire equivalent direct model tools as the migration succeeds. Normal
chat and deterministic GUI and CLI operations remain available. This chooses a
single target for agent tool use rather than maintaining two equivalent model
interfaces indefinitely. The tradeoff is an additional execution runtime whose
isolation, recovery, and model reliability must be demonstrated first.

The first migration covers existing main-chat capabilities: clock, web search,
page reading, scratch commands, and skill loading. Prove the execution boundary
with a small experiment before migrating the complete set. New integrations
follow after this foundation works. The existing limits and permission boundaries
of each capability remain in force.

Each script execution starts with fresh variables. It may wait for an owner
approval while Staf is running. If Staf restarts, the execution is interrupted
and is not automatically rerun. Conversation history and recorded action outcomes
remain available, including actions completed before the interruption. Persistent
interpreter sessions and automatic script replay are deferred.

## Keep connections and explain model testing plainly

Keep all current ways to connect Staf to AI: ChatGPT, OpenRouter, LM Studio, and
the generic compatible connection. A connection is how Staf reaches AI. A model
is the particular AI chosen for an agent, and one connection can offer many
models. Keeping a connection available does not mean every model offered through
it has been tested with Code Mode.

Documentation must say which models were actually checked with each connection,
what was checked, and which combinations remain untested. Checking that Staf can
send a request is different from checking that a model can reliably write and
use the generated programs. Explain this distinction in ordinary language rather
than describing models as "qualified" without an explanation. When Code Mode
work cannot be completed, retain the owner's selected model and report a clear
failure under the rules below.

## Handle denial and failures

Accepted in the next interview round on 2026-11-03. If the owner denies an action,
end the script, retain completed results, and explain what remains unfinished.
The agent must not try another route to perform the denied action.

If generated code is invalid before any actions run, allow the selected model a
small, fixed number of attempts to correct it. After that limit, report a clear
failure. Do not automatically change models or switch back to the old direct
model tools.

If work partly succeeds, preserve successful results and avoid repeating
completed actions. The agent may retry failed reads within current permissions
and limits. If an action might already have changed something but its result is
unknown, check what happened before trying it again. Report completed, failed,
and uncertain outcomes distinctly.

## Show useful work and make code inspectable

Normal chat shows understandable progress, approval requests, and results.
Generated code is collapsed by default and can be inspected in expandable
details alongside the individual actions. The owner does not need to read code
to understand or approve the requested actions.

## Bound approval waits and parallel actions

An approval request remains available for up to 24 hours while Staf stays
running. The owner can use Stop at any time. After the approval expires, the
script ends as expired and retains its completed results. Expiry never counts
as approval. A Staf restart still interrupts the execution without automatic
replay.

Independent reads may run in parallel within a small concurrency limit. Present
approval requests one at a time for each agent. Within a script, run actions
that change things one at a time so their order and outcomes remain clear.
Current capability permissions and limits continue to apply to every call.

## Retain useful work and discard unused temporary data

Retain generated code, action history, and returned results with the
conversation. Keep enough to inspect what happened and recover from partial
failure. Discard unused temporary data when execution ends, rather than
automatically saving every intermediate value or full page processed by the
script. This does not erase existing conversation history or action records.

## Bind capabilities to accepted work and feature-owned methods

On 2026-11-03, owner-authorized coordination added an integration constraint:
capture immutable `{botId, sessionId, commandId, signal}` when work is accepted.
Every capability call rechecks active work and authority while retaining that
captured session. A later client selection must not redirect running work,
results, or writes through a mutable current-session pointer.

The separate session, document, and artifact features own their storage, APIs,
UI, tests, and narrow typed service contracts. Code Mode adapts those methods
through its one host capability registry when they become available. It does
not implement those features or introduce a second direct-model-tool route.
The concrete integration contract was read at local commit
`3e42d18ce6fdc3258304e6312eb269de08662c82`; see
[the coordination record](../design/code-mode/coordination.md) and
[specification #67](https://github.com/lancewilhelm/Staf/issues/67).

Fresh sessions must not silently summarize, truncate, compact, or replay older
sessions. Older material enters context only through explicit authorized
search, read, or reference operations. Current-work result recovery must not
become implicit old-session replay.

## Approved architecture experiment and remaining evidence

On 2026-11-03, the owner approved the
[architecture checkpoint](../design/code-mode/rationale.md) as the basis for the
bounded execution experiment. The candidate is generated JavaScript in a fresh
QuickJS/Wasm guest inside a supervised local process, with the Staf service
owning authority, records, queues, and result handling. The
[detailed design](../design/code-mode/design.md) records the approved starting
limits. Those numbers remain unmeasured experiment defaults, not proven
production capacities.

The owner also approved the retention clarification: temporary successful-read
results may span fresh script invocations within the same accepted request to
support bounded recovery. Discard them when that request ends; persist selected
partial/final outputs rather than every processed page. There is no implicit
cross-session result cache. Each presented approval has its own 24-hour window,
so several approvals can make a request last longer than 24 hours.

Architecture agreement is complete. The next work is the scoped execution
experiment, before production capability migration. Active execution and
approval waiting have separate limits; no shorter hidden timeout may undermine
the approved approval window.

The experiment must establish isolation, enforcement on every action, handling
of pending and in-flight calls during Stop or expiry, recovery from uncertain
effects, resource cleanup, and model reliability. The live evaluation still
needs named model and connection combinations and an explicit scope and budget.
The exact dependency pin, platform isolation profiles and proven production
limits still require evidence. No production runtime has been implemented or
validated. See the
[source-backed investigation](../research/code-mode-adoption.md) for evidence and
the proposed experiment.
