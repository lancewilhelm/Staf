# Basic tools: grounding

Status: design research for [issue 79](https://github.com/lancewilhelm/Staf/issues/79), under [specification 78](https://github.com/lancewilhelm/Staf/issues/78). This records the evidence used for the subsequently owner-approved checkpoint, not implemented behavior or fresh runtime verification.

## How the current service works

The instance owns conversation state and dispatch so providers do not define different replay and permission semantics ([decision](../../decisions.md#keep-conversation-state-and-tool-dispatch-in-staf)). `runTurn` builds tool offers, maintains provider history and private replay, streams responses, records usage, injects recalled memory, validates selected skills, and saves completed conversation state ([runtime](../../../src/runtime.ts)). Both chat and task execution call that loop ([instance service](../../../src/instance-service.ts)). Plain chat intentionally does not start background tasks; their independent service infrastructure remains ([scope decision](../../decisions.md#simple-chat-before-background-task-workflows)).

Command acceptance persists an immutable profile and binds a submission ID to its inputs. Same-ID retries inspect existing work and conflicting inputs fail. A task attempt captures its own profile and context; delegation captures the helper's profile and preserves actual task ownership ([instance](../../../src/instance.ts)). Existing helper and task restrictions are live constraints, not a consequence of the captured mode. Config files remain authoritative for future accepted work; later ordinary edits do not rewrite an accepted profile ([ADR 0003](../../adr/0003-editable-agent-configuration.md); [ADR 0002](../../adr/0002-copy-bot-creation-defaults.md)).

The action journal already distinguishes command and task work, and records prepared, started, succeeded, failed, uncertain, and cancelled outcomes ([journal](../../../src/action-journal.ts)). The broker prepares an action, evaluates policy, obtains applicable approval, rechecks policy, and claims a start permit before dispatch ([broker](../../../src/action-broker.ts)). Exact action-ID retries return recorded status. That mechanism alone does not identify the same intended operation after a new provider call ID or a change of calling style. Restart makes started actions uncertain, not safely repeatable.

Agent and shared user memory share one SQLite store. Updates and deletions require the ID, scope, and version ([memory store](../../../src/memory.ts)). Shared additions go through the existing proposal and owner confirmation path ([instance](../../../src/instance.ts)). Model tools must preserve that path. Current memory recall for helpers is restricted; implementation must retain applicable task and collaboration restrictions.

The existing model-facing scratch shell is a bounded Docker scratch action ([scratch shell](../../../src/shell-sandbox.ts)); it is not the requested native process manager. The existing terminal client communicates with the shared service; it is not a model-accessible host PTY ([terminal client](../../../src/terminal-instance.ts)).

## Experiment evidence and rationale

[PR 75](https://github.com/lancewilhelm/Staf/pull/75) remains open at `2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f`. Its [executable contract](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/src/code-mode/contract.ts), [host](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/src/code-mode/host.ts), [protocol](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/src/code-mode/protocol.ts), [executor](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/src/code-mode/executor.ts), and [turn](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/src/code-mode/turn.ts) implement a synthetic lab, not normal production chat. The worker is separately supervised, and its QuickJS limits do not establish host isolation or a total-process memory ceiling. Its host validates and journals child actions, fences denial and uncertain changes, and holds intermediate read receipts within the request. Its store assumes a command and its experiment checks the current agent revision, which would reject captured work after unrelated configuration edits. Neither assumption fits the accepted specification.

The [recorded review](https://github.com/lancewilhelm/Staf/blob/2da3b8fb0dbda9d5b58526ba66bbc17b6a6ffc6f/docs/design/code-mode/review.md) describes fixes for completed-change replay, final authority checks, revocation fencing, and stalled checks. It expressly does not claim a second independent review of the fixes. Its previous synthetic and local test results do not prove live-provider behavior. The owner rejected PR 72; it is not an integration dependency.

## Constraints for this design

- Preserve the ordinary turn, accepted settings and conversation, actual command or task identity, existing memory store, selected-skill checks, task restrictions, and live authority checks.
- Change tool registration and dispatch so direct and scripted calls share validation, approval, action identity and outcomes. Replace broad profile revision checks with accepted-work liveness and live authority.
- Avoid a second production provider loop, a second memory database, PR 72 contracts, automatic replay, or a new permission policy.
- The service cannot infer arbitrary command intent from text. A completed or uncertain external effect requires explicit accounting; the design must also allow a deliberate new invocation of the same text.
- Cross-client visibility and process observation survive the guest, but an instance restart may lose live process observation. A stored PID alone cannot prove a process is the original one.

These findings are source inspection, not new runtime test evidence.

## Evidence coverage

The recorded decisions, current source, Git history, issues 78 and 79, and PR 75 and its review are the evidence used here. The issues record the accepted product direction; source and ADRs support the current ownership claims. The proposed gateway, recovery protocol, and process implementation are design inferences, not historical decisions. Connected long-form documents and chat were not searched for this repository-specific checkpoint; no infrastructure, error-tracking, or analytics evidence was used. Those are coverage gaps, not evidence that no other discussion or operational observation exists.
