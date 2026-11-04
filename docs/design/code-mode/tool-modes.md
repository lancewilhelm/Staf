# Selectable tool modes

The owner chose Direct, Hybrid, and Code Mode on 2026-11-04. That product
decision replaces the earlier requirement to retire direct model tools.
This document is the revised architecture checkpoint. The setting and production
integration described here are proposed, not implemented by the experiment.

## Usage

In Agent Settings, **Tool mode for chat** offers these choices:

| Choice | Tools offered to the model |
| --- | --- |
| Direct | The individual tools available to the accepted request. |
| Hybrid | Those individual tools plus `code_mode`. |
| Code Mode | `code_mode`, with those capabilities available inside its scripts. |

The proposed default for new agents is Hybrid. An existing configuration or
captured profile without a mode retains Direct. An explicit choice always wins.
These defaults require checkpoint agreement. Instance creation defaults may
select the mode copied into a new agent, following the existing defaults model.

The proposed authoritative configuration field is `toolMode`:

```toml
toolMode = "hybrid" # direct | hybrid | code
```

This example is a proposed format. The current parser rejects the new field.
Save through the existing settings revision and conflict handling. A valid edit
applies to the next accepted chat request. An active request keeps its captured
mode even if settings or the selected session change in another client.

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
has one implementation and one authorization and action-record path. The
session, document, and artifact services continue to own their operations.
Neither calling style looks up an agent's mutable current-session selection.
Fresh sessions retain the existing rule against implicit compaction or replay.

## Shape

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
terminal access and file editing require separate capabilities and are not
provided by this setting. Existing scratch-shell restrictions remain actual
runtime behavior until a terminal capability changes them explicitly.

## Scope and delivery

The proposed first delivery covers main chat. Label the setting accordingly.
Background tasks and helpers keep their current direct tools and captured task
authority. Extending the setting to all agent work requires task-specific host
bindings and approval handling. This scope is part of the checkpoint proposal.

Ship the selector with working adapters for the existing eligible chat tools:
clock, search, web reading, scratch shell, and selected skills. Preserve all
regular-chat behavior. Register separately owned feature methods when their
contracts are available on the integration base. Do not duplicate feature
storage, search, or revision logic.

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
4. Add the settings selector, inline approvals, retained code inspection, and
   cross-client progress using the existing workspace interactions.
5. Run the mode and capability-parity checks before presenting the modes as
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
session persistence in every mode. Exercise unsupported providers and executor
failure without fallback. Run `corepack pnpm run check`, `corepack pnpm test`, and
the existing served GUI smoke journey after implementation. No live or billable
provider requests are authorized solely by this design review.

The three choices are owner-selected. The proposed new-agent default, chat-only
first scope, and implementation shape await the previously requested
architecture checkpoint. After agreement, implement the complete chat slice in
a dedicated tracked issue and branch. The existing experiment remains a
developer lab until that integration is delivered.
