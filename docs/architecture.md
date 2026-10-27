# Staf's runtime and provider boundary

Staf keeps conversation state and tool execution in its own runtime so a later
UI does not need to repeat that logic. Providers supply model responses. Their
transport and authentication details stay outside the conversation loop.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `src/cli.ts` | Parse input, select an adapter, acquire the session lock, render events, coordinate in-process auth and settings. |
| `src/registry.ts` | Construct adapters from names, configuration, and model choices. |
| `src/types.ts` | Define provider, message, tool, capability, event, and session contracts. |
| `src/provider-events.ts` | Normalize buffered adapter results and failures into events. |
| `src/providers.ts` | Implement demo and HTTP adapters. |
| `src/codex.ts` | Run the official Codex CLI and translate its structured decisions. |
| `src/runtime.ts` | Execute a turn, dispatch allowed tools, enforce limits, persist success. |
| `src/store.ts` | Validate IDs, load snapshots, atomically replace files, manage CLI locks. |
| `src/validation.ts` | Validate external messages and complete persisted histories. |
| `src/models.ts` | Normalize bounded model metadata and verify provider-specific effort. |
| `src/settings.ts` | Validate, atomically store, and resolve nonsecret defaults/session values. |
| `src/chat-input.ts` | Queue chat lines and lend terminal input to the menu. |
| `src/terminal-view.ts` | Semantic colors, readable event blocks, terminal-control filtering. |
| `src/settings-menu.ts` | Keyboard navigation, editors, and confirmation screens; calls shared settings operations. |
| `src/settings-commands.ts` | Deterministic settings command grammar shared by terminal and chat. |
| `src/config.ts` | Read allowlisted settings and redact known credential values. |

## Interactive provider setup

The CLI constructs an adapter from effective settings on each user turn. Provider
adapters hold request configuration; the runtime owns conversation history and
model discovery owns its metadata cache. There is no separate CLI adapter cache
to invalidate after textual settings shortcuts. A separate display-only string
records the last announced adapter identity. Unchanged turns omit the repeated
`Provider:` notice without affecting selection, request history or cache keys.

The CLI coordinates the existing direct auth module with the settings menu.
Confirmed Codex selection checks local credential presence without network access.
A missing/invalid record offers a sign-in screen, also used on interactive startup
with Codex selected. Explicitly choosing sign-in closes the raw menu, releases
readline, prints the full URL and runs `directAuth` in the same process. On success,
the menu reopens at Codex model selection. No prompt or model request is submitted.
The chat's data directory is used throughout. `/auth codex login|status|logout`
exposes the same lifecycle without the menu; standalone auth remains supported.
Login failure restores chat input for retry. Each login owns its cancellation
signal through the callback, token exchange, identity validation and credential
preparation. SIGINT closes the listener and exits chat through normal session-lock
cleanup. The callback settles before the login reports cancellation. Cancellation
before atomic replacement preserves the previous credential record. A replacement
already in progress finishes before the login reports its outcome. Local status
checks do not prove server readiness or refresh expired tokens. Other providers
retain their existing credential/environment setup.

## A clock request through the loop

For `what time is it?`, `runTurn` copies the completed conversation and adds the
redacted user message. The runtime emits `provider_start` and consumes
`providerEvents`. A model can answer with text or request a named tool.

A clock request produces `tool_start`. The runtime verifies that the tool is
`clock` and its arguments are an empty object. The runtime reads the UTC time,
adds a tool-result message linked to the request ID, and emits `tool_result`.
The provider receives the updated history and can write the final response.

The runtime saves messages and activity only after the final response. It emits
the final assistant event after the save succeeds. A failed provider step or
save leaves the prior completed conversation intact. The loop allows four
provider steps and at most eight tool requests in each response.

The clock has no file, shell, network, or write permission. The dispatch code
rejects every other tool name. This is the current permission mechanism. There
is no generic permission engine or approval UI.

## What the contracts guarantee

`Message` distinguishes user, assistant, and tool messages. Tool results include
`tool_call_id`. `Provider.complete` accepts normalized history and tool definitions
and returns an assistant message. Every application adapter has an explicit
`ProviderCapabilities` value for tool calls, incremental text, and transport.

`providerEvents` yields normalized message, error and supported `text_delta`
events. The direct Responses adapter emits text deltas and a final message.
Buffered adapters do not support incremental text; requesting it from those
adapters fails before generation. The current CLI buffers assistant display until
completion, and the runtime dispatches only completed tool calls after overall
response success. An adapter that declares no tool support receives no tool
definitions, and the runtime rejects any tool request it still returns.

The registry removes provider selection from the CLI's conversation logic.
A new adapter needs a factory registration and contract tests. That separation
makes the current adapters interchangeable for this small text-and-clock contract.
It does not prove compatibility with every model, multimodal format, reasoning
trace, or provider-specific metadata. A backend can reject tool definitions even
when its adapter understands the tool protocol.

TypeScript checks the application before it runs. External JSON remains unknown
until runtime guards validate it. Snapshot validation also checks turn order,
matching tool IDs, and event payloads. The JavaScript tests deliberately pass
invalid values through these boundaries. No type assertions convert unvalidated
JSON into a trusted message.

## Direct Codex owns transport, Staf owns execution

The registry selects `codex-direct.ts` for Codex. Direct Responses accepts real
message and function-call items, with a stable cache scope for each Staf session.
Staf owns the clock dispatch and permission boundary. Codex native tools,
app-server threads and CLI instructions are not involved. The new registration
is independent of all CLI credentials. See [direct Responses](direct-responses.md).

The old `codex.ts` runner remains explicit legacy code and fixture coverage. Its
read-only sandbox and isolated HOME applied to that old subprocess path, not to
this direct adapter. It is never a fallback for failed direct auth/inference.
No stronger tool permission is granted by changing transport.

## Storage and failures

Each session is a version-1 JSON snapshot under the selected data directory.
It contains the provider identity, normalized messages, and runtime events.
Provider identity includes the model and, where relevant, endpoint. Changing
that identity requires a new conversation.

The store writes a temporary file with mode 0600, then renames it over the snapshot.
This avoids partial JSON after an ordinary write failure. It does not guarantee
power-loss durability. The CLI acquires an exclusive lock before loading a
session. Direct runtime callers must arrange their own concurrency control.

A failed turn's activity appears in the terminal but is not saved. The CLI keeps settings available after provider/turn errors. Invalid launch
flags still exit with code 1. A session contains no durable audit of unsuccessful
calls. Unknown tools produce tool-error results that the model can respond to;
provider transport failures abort the whole turn.

HTTP and direct Responses use a 60-second timeout. The legacy Codex subprocess
uses a 120-second timeout and is killed when it exceeds that limit. There are no
paid-call retries or recovery protocol for an interrupted turn. `/quit` acts
between turns. The CLI creates its turn controller before provider preparation,
so Ctrl-C during metadata checks prevents a later generation request. Normal
interrupt handling releases the session lock; a hard crash may leave a stale lock.
Do not assume an interrupted live request stopped before consuming usage.

## Credential limits

`.env` loading is literal, allowlisted, and shell-first. A no-follow file open
rejects symlinks. Direct Codex auth parses and verifies the tokens issued to Staf,
then stores its separate grant under `DATA_DIR/auth`. It never reads or imports
the normal Codex CLI store. The explicit `auth codex-legacy` command alone delegates
credential management to the official CLI in its isolated context. `.env.example`
contains empty key placeholders; OAuth credentials do not belong there.

The CLI supplies a redactor to `runTurn`. Known configured key values are removed
from new user messages, replayed history, model responses, events, and successful snapshots. Provider
errors omit raw HTTP bodies and raw Codex stderr. This prevents known test keys
from entering snapshots. It cannot detect unknown credentials. Old snapshots are redacted when a turn
completes successfully, not by a background migration. Failed turns do not rewrite them. HTTP authentication headers still carry the intended key to the
selected endpoint. Conversation text remains plain text on disk.

## Further reading

[Decision records](decisions.md) explain the alternatives considered.
[Configuration reference](reference.md) lists current capabilities and limits.
[Use Staf](usage.md) has runnable commands.

### Legacy CLI execution details

Earlier versions invoked fresh read-only `codex exec` processes with isolated
HOME/CODEX_HOME, disabled shell/web/plugins and an empty-MCP preflight. These
settings remain in legacy helper tests. The current registry does not launch
that process. Old credentials remain untouched and are not imported into direct
OAuth. Old execution usage remains labeled as aggregate consumption.

## Why there are several configuration paths

OpenRouter is a cloud API adapter with a fixed API root and an OpenRouter key.
LM Studio uses the same HTTP wire format with a local default and optional auth.
Legacy live retains the original generic API-root/key interface. Sharing transport
keeps message validation and timeout behavior consistent without merging their
credential namespaces. Adding an OpenRouter key cannot change Codex authentication.

The demo is a harness exercise. It requests clock when the last message contains
the word "time", then renders the result; otherwise it echoes the input and counts
user turns. It does not demonstrate model reasoning. HTTP tests mock responses,
and Codex tests use a fake executable. These checks verify our translation and
persistence code, not real provider availability or tool quality.

Model IDs and endpoints are configuration, not credentials, but changing them can
change where conversation content goes and which provider identity can resume a
session. Staf therefore refuses identity changes on resume. The exception in
precision is `codex:default`: a provider default can change behind that name.
Explicit model IDs make that choice more visible without claiming fixed model
behavior across backend updates.

## Future clients

Lance's accepted product goal retains the CLI as a first-class client and adds
eventual desktop/mobile continuity. Runtime/domain behavior and durable state
should stay separate from presentation. A common API/event contract and sync
mechanisms are proposals, not current behavior. See
[continuity across access points](session-architecture.md#continuity-across-cli-desktop-and-mobile)
for the acceptance scenario and open topology, offline, conflict, and credential
questions. No app or sync backend is implemented by this direction.

## Configuration independent of presentation

`SettingsStore` owns a versioned nonsecret document, validation, locking, and
atomic replacement. `resolveSettings` is a pure operation that returns effective
values, source labels, and setup warnings. `SettingsSession` copies the launch
inputs and holds that snapshot steady. It accepts explicit temporary overrides
between turns, including after resume. `preview` computes the proposed destination,
reasoning reset and warnings; `apply` validates reasoning metadata, persists any
remembered batch atomically, then activates the new snapshot. Failed checks or
writes do not activate it. Terminal-only default writes leave active snapshots
alone. No credential/server probe occurs during setup.

The CLI and `settingsCommand` use those operations without importing a model UI
or generating model responses. Explicit reasoning validation may read metadata. The registry constructs an adapter lazily on a user message.
A setup failure therefore leaves the settings menu usable. Model/provider errors
no longer terminate the chat. Settings text is intercepted locally and never sent
through `runTurn`, so commands do not become conversation messages.

Both terminal and slash commands share the validated operations. A future client
can call SettingsStore, SettingsSession, and resolveSettings without the CLI
renderer or command parser. This is an internal Node module contract, not a public
network API. There is no remote sync, cross-device credential copying, or model
interpretation of settings commands. Scope and precedence are explicit in the
[settings guide](settings.md).

A JSON document is sufficient for these defaults and makes manual recovery
possible. A database or generic settings framework would add work without helping
this small scope. Locked read-modify-write prevents cooperating writers from
losing defaults. Snapshots, credential storage, and settings remain separate.
Unknown schemas stop rather than migrate implicitly. The current synchronous loop
has no concurrent task-settings API; future task snapshots need their own timing
contract instead of reading mutable defaults mid-flight.

## Model metadata is not model execution

The shared catalog operation extracts provider-specific IDs and effort metadata.
OpenRouter uses its public model endpoint. Codex uses the installed official CLI's
bundled catalog in a scoped context, without authentication or model generation.
LM Studio and legacy list compatible model IDs; their transport cannot yet apply
a generic effort override. Staf does not confuse native LM options with its
current Chat Completions protocol.

Metadata reads are explicit for browsing and required before a nondefault effort
can start generation. Catalogs are memory-only, source-labelled, and fresh for
five minutes. HTTP reads carry no keys, so protected endpoints can fail without
exposing credentials to a new destination. Manual model selection and provider-
default reasoning remain possible after failure. No fallback changes host or model.

Provider factories verify requested effort; adapters then emit the actual wire
parameter or CLI option. Effort changes provider identity for safe resume. The
reasoning selector does not grant tools. Codex's delegating ultra preset is not
exposed by this chat adapter. Metadata source and real account access are distinct.

Shipped defaults live in code. Local version-1 defaults are user overrides, and
build output never imports those files. An allowlisted package and synthetic
fresh-distribution test keep development settings/auth out of new-user defaults.
See [model selection](model-selection.md) for the exact current behavior and limits.

## Terminal presentation and input ownership

The CLI uses a small standard-library renderer rather than a terminal framework.
`ChatInput` suspends readline while `settings-menu` owns raw keyboard input, then
restores the draft and chat prompt. The menu restores raw mode and cursor visibility
in a finally block. The menu presents choices; `SettingsSession` still owns
validation, precedence, scoped values, and persistence. Textual commands use the
same operations and remain suitable for scripts and recovery.

The renderer labels assistant, provider, tool, and error output and filters
terminal control sequences from displayed content. Color is optional and never
the only status cue. It is not a full terminal emulator or a security boundary.
Menu metadata requests are not aborted when navigating away; a request token
prevents their late results from replacing the current screen. Provider timeouts
still apply. See [keyboard controls and tests](settings.md#use-the-chat-menu).

Menu screens carry semantic parent references rather than a chronological back
stack. Transient discovery screens are replaced by results or errors with the
same parent. Confirmation failures return to the value screen, so navigating
Back cannot reopen a previous confirmation. Startup resolves existing defaults;
provider flags remain optional compatibility overrides.

## Mixed-provider conversation history

Successful turns append optional `turns` records with start/end message indexes
(end-exclusive) and the exact adapter identity, including configured model/effort.
`session.provider` is the latest successful provider, not a session-wide identity.
Old version-1 files without `turns` remain valid; earlier attribution is unknown.
The runtime preserves the normalized complete tool/message sequence when changing
adapters. The receiving provider may still reject history or context size; failed
turns roll back as before. Direct Codex uses separate stateless Responses requests with model-bound replay.
Historical CLI execution records retain their prior meaning. Nothing grants new tool permissions.

## Usage observation boundary

`src/usage.ts` defines normalized optional metrics, provider-specific structured
mappings, persistence validation and local display. An adapter attaches a usage
report to its returned assistant message; `runTurn` records it once and removes
that metadata before adding the message to replay history. Each call gets an ID
and attempt group. The ledger persists even when later generation fails and
conversation messages roll back. It has no prompts or credential material.

The historical CLI adapter requests JSONL while retaining schema/last-message output, sandbox and
scoped login. Its last cumulative snapshot is counted once per fresh ephemeral
execution. No native thread resume was added. See [usage accounting](usage-accounting.md)
for partial coverage, failed-write limitations and primary contracts. A provider
report is preferable to estimates here: it is explicit about unavailable fields
and does not confuse subscription allowance with API billing.

## Context display and consumption are separate

`src/context-status.ts` computes a nonpersistent visible-payload size proxy and
reads matching metadata passively from `models.ts`. The CLI only renders its
result and initiates explicit refresh. `src/prompts.ts` shares Staf-owned prompt
text/schemas with HTTP/Codex adapters, so the estimator includes those pieces
without owning provider transport or changing messages. For direct Codex, it derives
Responses input with the existing converter and filters reasoning items only from
the display projection. The status records their count for the opaque-occupancy
caveat. Other HTTP providers omit unsent replay and per-message usage metadata.
The proxy is not a model tokenizer and never enforces a limit. Opaque reasoning
occupancy stays unknown, as does historical native CLI occupancy.

Per-request usage normalizers retain the standard optional metrics contract and
persist session consumption independently. Provider account/quota collectors are
deferred: no app-server account reader or account cache is wired into canonical
Staf. A future collector must expose typed scope, availability, source and
freshness; quota windows and key credits cannot be converted artificially into
session tokens. See [context rationale and limits](context.md).

There is no Staf compactor or trigger. A future policy needs separate decisions
on summaries, recoverability and retained history; it must not erase consumption.

## Measured request usage in the context display

The detailed `/context` view promotes the latest call's reported HTTP input before the
next-payload proxy. Usage observations now persist `scope` (request/execution)
and `observedAt`; older records without them remain readable, with scope inferred
only from known normalizer source labels and time left unknown. The renderer
never adds cached subsets to input or reasoning output to visible context.

The ledger records counts, not exact payload/template fingerprints. Rather than
invent measured-plus-delta precision, the view keeps the historical measurement
scoped to its old provider/model beside an independent next-context estimate.
Codex aggregate usage is explicitly not a last native request measurement.

`contextFooter` is a separate concise renderer for recurring status. It omits
historical measurements, timestamps and diagnostics without changing the status
model or usage ledger. Direct Codex shows `(visible est.)` when opaque replay is
excluded; other HTTP estimates keep `(est.)`. Stale/unknown windows are omitted.
No encoded ciphertext is converted to text tokens, and actual replay remains
unchanged. `contextDetails` retains the complete explanation. No extra metadata fetch or metrics were added.

## Current direct modules

`codex-direct-auth.ts` owns fresh registration, ID-token validation and serialized
refresh. `codex-direct.ts` owns the fixed endpoint, request conversion, cache key,
SSE and response replay. The SSE collector tracks announced and completed output
items by index until overall success. Reconstruction requires every observed item
to be complete and indexes contiguous from zero. A full terminal snapshot covers
observed indexes and is not combined with duplicate done items. Both paths reject
explicit incomplete item statuses. Assistant phase and refusal content survive
normalized same-model replay; refusal explanations also appear in canonical text.
Request construction supplies `summary: []` for saved encrypted reasoning items,
so old replay records satisfy the required input schema without a file migration.
`provider-events.ts` supports streamed adapters while
`runTurn` commits only completed messages and tool requests. Runtime cancellation
reaches the transport signal. Other adapters still use their existing contracts.
The [direct design guide](direct-responses.md) is authoritative for current Codex.
The [MVP record](mvp.md) separates required future tools/UI from current delivery.
