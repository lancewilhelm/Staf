# Selectable tool modes

The owner chose Direct, Hybrid, and Code Mode on 2026-11-04. That product
decision replaces the earlier requirement to retire direct model tools.
The owner confirmed the focused basic-tool scope after the follow-up interview.
This document records those product decisions and the proposed implementation.
The setting and production integration are not implemented by the experiment.

During the follow-up interview, the owner confirmed these release requirements:

- Save the mode per agent and expose it through Settings, CLI, and API.
- Apply the selected mode to chat and background tasks. Active work retains
  its accepted mode when settings change.
- Include a host terminal and individual file read, write, edit, and search
  tools in the first selectable-modes release. Commands run on the service host
  with the service account's permissions, without requiring containers.
- Default new agents to Hybrid. Existing configurations without a saved choice
  retain Direct, and an explicit choice wins.
- Extend the existing permission and approval settings to host terminal and file
  tools. Direct and scripted calls use one decision for the underlying action.
- Delegated work uses the executing agent's own selected mode, with its task
  restrictions still in force.
- Provide a normal host terminal, including interactive programs, input, output,
  and background processes. The owner rejected a foreground-only first version.
  Permission policy is a separate topic from the terminal's supported behavior.
- Hybrid can continue with direct tools after an ordinary code error, accounting
  for completed actions. Code Mode-only work does not switch calling styles.
- Include first-class memory tools for search/read, remember, update, and forget.
  Memory belongs in the core tool catalog, backed by the existing memory service.

These answers replace the earlier chat-only scope and deferral of host tools.
The owner prefers adding project folders within the agent's existing directory
instead of relocating the entire agent directory. The owner accepted adding
projects and attaching existing folders without moving their contents, reusable
scripts and agent-authored skills, and ordinary reviewed development for changes
to Staf itself. The owner then deferred these expanded workflows to focus on
basic tool use. Their [later-work record](later-work.md) preserves that direction.

The owner rejected PR #72 and plans to rebuild that feature later. This release
does not depend on, merge, or import its sessions, documents, artifacts, or
workspace capability adapters. GitHub still reported the PR open when this
scope change was recorded; owner rejection takes precedence over that status.
The interview is complete and the owner confirmed shared understanding. The
implementation sketch still needs to cover the expanded task and terminal
requirements before the architecture checkpoint for production work.

## Usage

In Agent Settings, **Tool mode** offers these choices:

| Choice | Tools offered to the model |
| --- | --- |
| Direct | The individual tools available to the accepted request. |
| Hybrid | Those individual tools plus `code_mode`. |
| Code Mode | `code_mode`, with those capabilities available inside its scripts. |

The owner-confirmed default for new agents is Hybrid. An existing configuration
or captured profile without a mode retains Direct. An explicit choice always
wins. Instance creation defaults may select the mode copied into a new agent,
following the existing defaults model.

The proposed authoritative configuration field is `toolMode`:

```toml
toolMode = "hybrid" # direct | hybrid | code
```

This example is a proposed format. The current parser rejects the new field.
Save through the existing settings revision and conflict handling. A valid edit
applies to newly accepted chat and background work. An active request or task
keeps its captured mode even if settings or the selected session change in
another client.

For example, Direct can call `search_web({query: "example"})`. Hybrid can make
that same call or call `code_mode({source: "..."})`. Code Mode exposes only the
execution tool. A script uses `capabilities[name](input)` to call the same
available operations. `code_mode` itself is excluded from the script catalog.

The production tool name is proposed as `code_mode`, matching the owner's term.
The lab currently calls it `execute_code`. Rename the offered tool during
integration without offering two aliases. Retained history keeps its original
tool names and outcomes.

## Problem and existing constraints

Regular chat already owns streaming, provider replay, memory, selected skills,
usage, persistence, and cancellation in `runTurn`. The experiment has a separate
synthetic-only loop and no migrated production capabilities. Adding a selector
without integrating those behaviors would advertise modes that do not work.

Two calling styles are intentional in Hybrid. Each underlying capability still
has one implementation and one authorization and action-record path. Keep the
bridge extensible for future application services without importing the rejected
PR #72. Both calling styles use accepted work context instead of mutable client
selection. Preserve current conversation history without implicit compaction,
summarization, truncation, or replay from other conversations. New session,
document, and artifact features are outside this release.

## Shape

The sketch below describes the chat binding. The expanded first release also
requires a task binding with captured task identity, session, mode, permissions,
and cancellation. Its action records must retain task ownership rather than
invent a chat command identity. Complete that design after the interview.

Keep `runTurn` as the provider conversation loop. Extract the existing action
definitions and dispatch into a command-bound action service. Derive individual
tool definitions and the guest capability catalog from the same registrations.
The mode selects the offered definitions. Dispatch checks the selected set too,
so a provider cannot invoke an unoffered tool by returning its name.

The caller binds accepted context once. A proposed type sketch follows. These
signatures describe ownership, not an importable API or implemented behavior.

```ts
type ToolMode = 'direct' | 'hybrid' | 'code';

type AcceptedChat = {
	readonly botId: string;
	readonly sessionId: string;
	readonly commandId: string;
	readonly toolMode: ToolMode;
	readonly signal: AbortSignal;
};

interface ChatTools {
	// Derive the selected offer from the registered, eligible actions.
	definitions(): readonly ToolDefinition[];
	// Parse a provider call, enforce that offer, and execute through one service.
	invoke(call: ProviderToolCall): Promise<ToolResult>;
	dispose(): Promise<void>;
}

function bindChatTools(work: AcceptedChat, services: CapabilityServices): ChatTools {
	throw Error('not implemented');
}

// The normal loop owns messages, progress, usage, skills, and persistence.
await runTurn({session, provider, tools: bindChatTools(accepted, services), ...rest});
```

The common action service owns each action's input validation, live authority
checks, approval, dispatch permit, action identity, recorded outcome, and effect.
The guest host retains script scheduling, runtime limits, temporary results,
and code execution records. A guest call enters the common action service;
wrapping an already authorized action with a second approval or journal is
incorrect. Existing capability-specific URL, skill, grant, and permission rules
remain in that shared service path.

In Hybrid, an ordinary script error does not remove the available direct tools.
The agent can continue through them after accounting for completed actions and
checking any unknown outcome. This is use of the selected Hybrid mode, not a
mode change. Code Mode-only work reports failure instead of changing styles.
Denial, Stop, expiry, permission restrictions, exhausted shared budgets, and
uncertain effects still prevent a workaround through another calling style.

A denial ends the script and blocks further actions in the accepted request,
including direct calls already returned in the same provider response. Hybrid
cannot retry the denied action through another route. Stop, expiry, revocation,
and uncertain effects also apply across both calling styles. The final response
can explain completed work without dispatching additional actions.

Keep the experiment's conservative completed-change guard for the accepted
request across direct and script routes. An equivalent successful change must
not run again merely because the model changed routes or tool-call IDs. A new
owner request has a new command identity. Repeated intentional changes within
one request require distinct feature-owned input or revision semantics. An
unknown outcome requires reconciliation before another attempt. This does not
promise exactly-once effects or automatic replay.

`Instance.claim` already captures the profile. Carry the validated mode through
`execution()` as part of that snapshot, including legacy missing-field handling.
The same command ID retains the original accepted mode. The current
`codeModeStore` rejects any changed agent revision. Replace that broad comparison
with checks for active work, archive state, and current capability authority.
A mode, name, model, or instruction edit applies to new requests, while live
permission or feature-scope revocation still stops unauthorized actions.

Keep QuickJS as the current coordination runner. Selecting a mode does not
select a machine, shell backend, or isolation level. The owner has deferred new
container or OS isolation work. The existing process and resource limitations
must remain documented rather than described as checks that passed. Host
terminal and file tools are separate capabilities included in the first release.
The mode selects how those capabilities are called. Existing scratch-shell
restrictions describe the current runtime until the new capabilities land.

The host terminal uses the normal host shell and installed programs. Support
ordinary commands, scripts, interactive programs, and background processes,
including input, output, process observation, and Stop. Do not impose an allowed
command list or foreground-only behavior as a consequence of Code Mode. Separate
permission policy from the tool's functional capability.

Terminal process lifetime must be distinct from a QuickJS script's lifetime.
A script can start or interact with a service-owned process and return its
handle. Ending that script does not silently end an intentionally retained
terminal process. The implementation design must cover process ownership,
interaction, cancellation, and observed or uncertain restart outcomes without
automatically replaying commands. Guest execution limits are not terminal
session limits.

## Scope and delivery

The owner confirmed chat and background tasks in the first delivery. Implement
task-specific host bindings, captured profiles, and approval handling alongside
chat. Delegated work uses its executing agent's configured mode and retains
existing task restrictions. Preserve each task's actual authority and captured
conversation instead of borrowing a current chat's context.

Ship the selector with working adapters for the existing eligible chat tools:
clock, search, web reading, scratch shell, and selected skills, plus the new host
terminal, file, and first-class memory tools. Preserve existing chat and
background-task behavior.
Use a stable working folder under the existing agent directory for basic host
commands and relative file paths. Keep it outside revisioned configuration.
Project-management UI, external-folder attachment, model-created skill
management, and automatic self-improvement are deferred. Existing skill selection
remains part of the basic tools. Do not add new sessions, documents, or artifacts.

### Core memory tools

The owner explicitly added memory to the basic-tool release after confirming
the initial scope. Offer memory search/read, remember, update, and forget as
normal tools in Direct and Hybrid. Expose the same service capabilities inside
Code Mode scripts. Terminal access to storage and skill instructions do not
replace the core memory tools.

Use the existing memory service, not another store or retrieval system. Preserve
agent memory and shared user memory as distinct scopes. Bind agent-specific
operations to the agent doing the accepted work; a caller cannot substitute
another agent's ID. Return memory IDs and versions with reads, and use the
existing optimistic version checks for updates and deletion. Query/read output
and recorded mutation outcomes follow the common action service rules.

The current runtime accepts memory mutations through explicit owner phrases and
paired-client APIs, while provider output and task directions cannot mutate it.
The accepted feature changes that model interface by adding scoped memory tools
for chat and background work. It does not implicitly change existing shared
memory confirmation requirements or decide new permission policy. Those rules
remain in the service and apply equally to direct and scripted calls.

This is first-class access to retained memory. Automatic conversation compaction,
new embeddings, transcript storage changes, and autonomous memory harvesting
are outside this addition.

### Compatibility and delivery order

For a provider that reports no tool support, Direct retains its existing
text-only behavior. Hybrid and Code Mode should report an actionable unsupported
configuration before requesting model execution. An unavailable executor also
produces a clear error. Never silently change the selected mode or model.
These proposed error semantics need verification against provider adapters.

Implementation sequence:

1. Add the validated setting to authoritative TOML, defaults, profile APIs, and
   accepted profile reads. Preserve comments, idempotent creation, and conflicts.
2. Extract and verify the common action service through existing direct calls.
3. Adapt the guest host to that service and add mode-based offers and dispatch.
   Migrate the lab to the normal turn loop and remove the separate lab loop.
4. Bind the same selected modes to accepted background tasks while preserving
   task-specific permissions, inputs, outcomes, and Stop behavior. Add the host
   terminal, file, and scoped memory capabilities through the common action
   service.
5. Add the settings selector, inline approvals, retained code inspection, and
   cross-client progress using the existing workspace interactions.
6. Run the mode and capability-parity checks before presenting the modes as
   available. Named live-model validation remains distinct from offline tests.

## Synthesis decision

Two independent candidates explored a registry-centered dispatch facade and an
extension of the existing turn lifecycle. Both used one action implementation.
The parent and independent cross-judge chose the existing-loop candidate because
it preserves the current ownership of conversation behavior.

Adopt the registry candidate's explicit shared action identities and journal,
accepted-context rules, and exclusion of recursive code calls. Both drafts
needed the broad profile-revision check corrected. Reject a separate production
code-only loop, hand-maintained duplicate catalogs, and a settings-only change
that leaves the new modes unavailable. These choices concentrate action policy
without moving conversation ownership into the executor.

Both candidate sketches initially limited mode selection to chat. The owner's
follow-up answers supersede that scope. They also add host terminal and file
capabilities to the release. Their task and capability bindings require the
remaining interview and revised checkpoint before implementation.

We accept two model-facing calling styles in exchange for a user choice suited
to ordinary commands and larger scripted workflows. Keeping one action service
avoids two implementations of each capability. Hybrid offers more tool metadata
than Code Mode. Whether either mode improves cost, latency, or completion quality
requires measurement on actual tasks.

## Verification and checkpoint

Verify old TOML and saved profiles, invalid explicit values, surgical edits,
revision conflicts, creation fingerprints, and mode changes during active work.
Check all three offered sets and reject forged unoffered calls at dispatch.
Exercise equivalent direct and scripted actions, one approval and action record,
denial across routes, completed-change guards, uncertain effects, skill
invalidation, Stop, restart without replay, and executor cleanup.

Check normal streaming, provider history, usage, memory, selected skills, and
session persistence in every mode. Exercise captured mode changes, authority,
Stop, and retained outcomes for background tasks as well as chat. Verify actual
host command execution and file operations in disposable working folders.
Exercise unsupported providers and executor failures without silently changing
the configured mode or model. Verify recovery through direct tools after an
ordinary code error in Hybrid, while preserving completed-action and uncertainty
guards. Verify interactive terminal input, retained background processes, output,
and Stop independently of guest lifetime. Run `corepack pnpm run check`,
`corepack pnpm test`, and
the existing served GUI smoke journey after implementation. No live or billable
provider requests are authorized solely by this design review.

Verify memory search/read and create/update/forget through Direct, Hybrid, and
Code Mode against the real existing memory store. Check agent scope isolation,
shared-memory confirmation, stale versions, retained changes after restart,
and the same results through tools and existing owner interfaces. Do not treat
writing a memory-storage file through the terminal as proof of tool support.

The three modes, per-agent configuration, chat and background scope, first
release's normal host terminal, file and memory tools, defaults, shared approval policy,
delegated-agent mode selection, and Hybrid recovery are owner-selected.
Project-folder choices and self-improvement direction are recorded as later
work. The owner confirmed the complete focused product scope after the final
interview summary. Turn these decisions into a buildable specification and
dependency-linked tickets, and complete the expanded implementation design
before production changes. Use a dedicated issue and branch based on current
main and the reviewed execution experiment without PR #72. The existing
experiment remains a developer lab until that integration is delivered.
