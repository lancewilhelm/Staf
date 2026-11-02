# Configuration reference

## Shared terminal

`staf` starts or connects to a detached, loopback-only shared instance and opens
its persistent main chat. `--data-dir PATH` selects its data directory, which
defaults to `~/.staf/terminal-instance`. `--instance URL --credential FILE`
connects to an explicitly paired loopback instance. The service inherits the
launch environment and does not load `.env`. The terminal's `/help` lists its
settings, approval and command-status controls. Settings phrases affect the
current bot profile and use its revision. Natural-language settings support the
phrases listed in [usage](usage.md#start-the-shared-terminal).

The local database, client credential, service descriptor and daemon log are in
the data directory. The client does not restore a revoked credential. The
descriptor records the daemon PID and port. The daemon continues after the
terminal exits and restarts on the next launch if stopped. It is not registered
as an operating-system service.

## Terminal commands and environment

`staf --help` lists launch options. `staf --data-dir PATH` selects the local
instance directory. `staf --instance URL --credential FILE` connects to a paired
loopback instance. `staf instance help` lists one-shot instance commands. `staf settings show`,
`staf settings defaults`, `staf settings set provider|model|reasoning VALUE`,
`staf settings set-default provider|model|reasoning VALUE`, and `staf auth codex
login|status|cancel|logout` operate through the same shared instance. These
commands accept the same trailing connection options. A one-shot provider change requires `--confirm-provider-change`, acknowledging that future requests may send conversation history to the new provider. Use `staf settings unset model|reasoning` or `staf settings unset-default model|reasoning` to clear saved values.

The terminal supports `/help`, `/settings`, `/settings show`, `/settings models`, `/settings reasoning`, `/set provider
NAME`, `/set model ID`, `/set reasoning LEVEL`, `/models`, `/auth codex
login|status|cancel|logout`, `/usage [details|help]`, `/context [refresh|help]`,
`/confirm-provider`, `/cancel-provider`, `/unset model|reasoning`, `/unset-default model|reasoning`, `/stop`, `/status ID`, `/edit ID TEXT`, `/retry ID`, `/discard ID`, `/defaults`, `/set-default provider|model|reasoning VALUE`, `/approvals`, `/approve ID`, `/deny ID`, and `/quit`. Settings
commands edit the current bot profile; creation defaults are separate. See
[settings](settings.md) for behavior and controls.

The interactive terminal labels streamed text provisional and follows a response
that it stops, including a response started by another paired client, through its
settled state. Browser draft recovery uses local storage and Web Locks to keep
concurrent tabs separate. The browser also requires secure random UUID support;
the composer waits for the selected draft to load.

The instance inherits its host environment at startup. It does not load `.env`.
Changing the environment of a later terminal does not change a running instance.
Models and reasoning belong to the bot profile, not environment variables.

| Variable | Provider | Meaning |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Legacy provider adapter | The shared instance ignores this value; use its managed OpenRouter connection. |
| `LMSTUDIO_BASE_URL` | LM Studio | API root; defaults to `http://localhost:1234/v1/`. |
| `LMSTUDIO_API_KEY` | LM Studio | Optional API key. |
| `STAF_BASE_URL` | live | API root; defaults to `https://api.openai.com/v1/`. |
| `STAF_API_KEY` | live | Required API key. |

The supported bot providers are demo, Codex, OpenRouter, LM Studio, and live.
Live providers require an explicit bot model. The demo echoes messages without a
model. OpenRouter uses its fixed Chat Completions endpoint. The live adapter uses
a generic OpenAI-compatible Chat Completions endpoint and can incur API charges.
Codex uses direct Responses and a separate Staf OAuth grant. A credential alone
does not select a provider. Per-bot endpoint overrides are not implemented.
See [model selection](model-selection.md) and [Codex sign-in](codex-direct.md).

In the browser's agent settings, Demo is always selectable and Codex or
OpenRouter is selectable when the instance reports a saved connection. Existing
disconnected or host-configured selections remain visible. LM Studio and live
are configured on the host and are not offered as new browser choices. The
browser retains the model on a provider change, asks the owner to review it,
and confirms possible conversation-history disclosure before saving. This
selection policy is a browser convenience; the paired service, CLI, and direct
files continue to accept supported provider configurations independently of
connection presence.

## Scripts

| Command | Effect |
| --- | --- |
| `pnpm run build` | Build the Vite browser workspace and compile server source to `dist/`. |
| `pnpm run check` | Check server and browser TypeScript without emitting output. |
| `pnpm test` | Build and run JavaScript tests against compiled output. |
| `pnpm start` | Build and start the shared terminal. |

## Usage and context

`/usage` reports available provider observations saved with the main chat. It
does not query account quota or reconcile billing. `/context` reports any latest
historical input observation and explains that the next request's occupancy is
unavailable. Staf does not compact history. See [usage accounting](usage-accounting.md)
and [context display](context.md).

## Direct Codex authentication

The GUI reserves a new tab during the Connect Codex click, then navigates it
when authorization setup returns. Continue sign-in remains a fallback for the
same attempt. Refreshing loses that URL; cancel and restart if it is needed.

A paired client starts a sign-in attempt on the instance. The instance owns the
loopback callback and stores the Staf grant under its data directory. Status is
local and does not establish account access. Logout removes local tokens and
does not revoke the server grant. A paired client can cancel its own pending
attempt. No official Codex CLI credential is imported. See
[sign-in and recovery](codex-direct.md) and the [auth contract](direct-responses.md).
Shared-instance sign-in and inference have synthetic coverage and remain
unverified with a live account.

The paired CLI exposes `instance codex-auth-logout URL CREDENTIAL_FILE` alongside
start, current, status, cancel, and credential inspection. Credential inspection
reports a locally readable record and its expiry; it does not contact the
provider or verify account or model access. Sign-out is rejected while work or
sign-in is active and does not change agent configuration.

## Direct Responses request facts

Codex uses POST `https://api.openai.com/v1/responses` with `store:false`,
`stream:true`, explicit model, Staf instructions, structured input items and
Staf function tools. Redirects and automatic HTTP retries are disabled. Only a
completed terminal event commits a response. If its `output` array is empty,
completed `response.output_item.done` items are assembled in output-index order.
A nonempty terminal snapshot is used once. Provisional deltas never become final
output on their own; failed/incomplete/aborted streams still cannot dispatch tools
or save a successful turn. Empty-snapshot reconstruction requires completion of
all announced items and contiguous indexes from zero. A nonempty snapshot covers
every observed index. Both paths reject explicit incomplete or in-progress item
statuses. Duplicate conflicts and more than 32 output indexes are rejected.
Assistant message phase is retained for
same-model replay. Encrypted reasoning replay adds the required `summary: []`
at request construction, including for older saved records. The request timeout is 60 seconds.
The session-scoped static-prefix cache hash includes model/instructions/tools.
Reasoning effort is forwarded only when an explicit nondefault value is selected.
[Replay, error and cancellation rules](direct-responses.md) define the remaining
contract. Assistant `refusal` parts display their explanation as canonical text
and retain their native type for same-model replay. No API-key or native-runtime
fallback exists.

## Local shared instance preview

The workspace journals per-agent drafts and command IDs locally. It recovers an
uncertain submission automatically with the same command ID; busy and definitive
failures have inline Retry and Dismiss controls. A failed accepted command needs
a new ID for an explicit retry.

The workspace is served at `/`. Its persistent agent list selects main chats,
and duplicate names display the last four characters of their stable IDs.
Suffixes can coincide; full IDs remain available through the API and CLI. The UI
calls these records agents; the
existing `bots` API paths, fields, and CLI command remain unchanged. The former
Advanced page is not served.
Its appearance preference is stored in browser localStorage under
`staf-appearance`, with `light`, `dark`, or `system` values. Missing or invalid
values use System, which follows the device color scheme. This preference is
not an instance configuration or a shared API setting.
Authenticated `GET /api/inbox` projects pending questions and approvals.
`GET /api/task-updates` returns task summaries for the inbox. `POST /api/bots`
requires a nonblank `name` and accepts optional `instructions`, `provider`,
`model`, and `operationId`. An omitted provider uses the copied instance
default. An omitted model uses the default when the provider is omitted, or
is empty when a provider is specified. A model can override the default.
For retry-safe creation, clients supply an `operationId`;
`GET /api/bot-creations/OPERATION_ID` recovers a recorded result. Reusing an
operation ID with different input conflicts. The transaction copies remaining
creation defaults into the new bot. The version 27 migration adds the creation
journal after a database backup. These operations do not change existing bots.
The workspace automatically restores an unfinished creation using its original
operation ID, guarded by a browser Web Lock. Check creation and Retry same creation
use that ID. Manual earlier-record pickers are removed. Only the obsolete
`staf-draft` and `staf-pending` browser keys are deleted; the current
`staf-workspace-v1:` automatic recovery journal remains intact.

Shared-instance Codex sign-in uses `POST /api/codex-auth/start`, `GET /api/codex-auth/current`, `GET /api/codex-auth/ATTEMPT_ID`, `POST /api/codex-auth/ATTEMPT_ID/cancel`, and `GET /api/codex-auth/credential`, and `POST /api/codex-auth/logout`. The initiating paired client owns an attempt and can recover its status and cancel it after a page refresh. Other paired clients cannot inspect it. The OAuth callback is a loopback route at `/auth/callback`; it does not expose callback parameters in its response. Cancellation, client revocation, expiry, and shutdown prevent a pending commit. Synthetic tests cover these boundaries; live sign-in is unverified.

`instance serve [DATABASE_PATH] [PORT]` uses the database directory for Codex credentials and defaults to `.staf/instance.sqlite`
and port `3210`, binding `127.0.0.1` only. `instance pair|clients|revoke|bots|create|inspect|edit|archive|restore|read|send|status|response-follow|response-stop`
use the loopback origin and a separate client credential file; see
[usage](usage.md#local-shared-instance-offline-preview). `instance create URL CREDENTIAL_FILE NAME [--instructions TEXT] [--provider PROVIDER] [--model MODEL] [--operation-id ID]` joins name
arguments with spaces. Each option takes one argument and can appear once.
The CLI prints the generated operation ID before submission; callers can reuse
it with unchanged arguments. A direct API creation without an operation ID is
not retry-safe. The server stores
SHA-256 token hashes in SQLite and limits JSON request bodies to 64 KiB, except skill import and update requests, which are limited to 1,600,000 bytes. Newly created databases have owner-only permissions, independent of a permissive umask. Existing file permissions are not changed. Restrict the containing directory and any existing database separately. On the tested platform, SQLite rollback journals inherit the owner-only database mode.
The host issues a one-time code at startup and on each terminal Enter. Browser
requests with an Origin must match the exact server origin; JSON and bearer
credentials are required for protected writes. No network transport beyond
loopback is implemented here. Codex and OpenRouter use instance-owned credentials; LM Studio and live use host configuration. Each requires an explicit bot model. Paired clients have derived
identifiers; any paired client can list and revoke them. Every paired client is trusted to act for the sole owner, including managing approvals and settings; there is no separate owner role check.

Paired clients can read the latest main-chat progress with `GET /api/bots/{id}/response`, or `responseProgress` within `GET /api/commands/{id}`. The response has the command ID, bot ID, accepted/running/stopping/stopped/completed/failed/interrupted state, provisional text and a safe error. `instance response-follow URL CREDENTIAL_FILE COMMAND_ID` polls and prints changed progress as JSON lines until a terminal state. Text that could complete a known credential may be withheld at chunk boundaries. The service also holds unfinished words for safe URL handling. Provisional snapshots stop growing at one million UTF-16 code units per provider step; the completed response remains available. Version 28 adds a progress table after a database backup; incomplete output is retained separately from committed conversation messages. Codex direct and OpenRouter can emit deltas; LM Studio, generic Chat Completions and demo adapters are buffered. No live provider verification was performed for this change.

Paired clients request Stop with `POST /api/commands/{id}/stop` or `instance response-stop URL CREDENTIAL_FILE COMMAND_ID`. The result is the current progress, including `stopping` while cancellation settles and `stopped` afterward. Repeating a request against the same command returns its current outcome and cannot stop a newer command. The accepted command keeps the per-agent busy lock while stopping; a noncooperative provider can delay settlement. Restart while stopping reports `interrupted`. Version 29 adds the stop journal after a database backup. Stopped partial output is retained as an `assistant_stopped` conversation message, excluded from provider replay.

The paired `GET /api/bots/{id}/response/stream` endpoint returns `text/event-stream` and requires a bearer authorization header and the same origin checks as other instance requests. An initial `snapshot` event contains the current progress or null. Later JSON events contain either a `snapshot` with `response`, or a `delta` with `id` and text to append. Completed snapshots have empty text; clients read the completed answer from the conversation. Failed, interrupted, stopping, and stopped snapshots retain provisional text. Each reconnection begins with a new snapshot; clients do not resubmit a command. Heartbeat comments keep idle connections open. Revocation closes the revoked client's connections. The instance allows up to 256 response streams and disconnects clients whose pending output exceeds 2 MB; they can reconnect for a current snapshot. The workspace uses authenticated `fetch` to consume the stream. Task and Activity updates still use polling.

An optional profile description is directory metadata visible to other bots. A profile edit that omits it preserves its current value. The paired `POST /api/bot-discovery` endpoint accepts `requesterId` and `query`, and returns matching active or busy bots by name and description, without selecting a helper. Archived bots and the requester are excluded. Matching and limits are provisional; discovery itself does not execute collaboration. The version 12 migration backs up existing databases and initializes descriptions as empty strings. Version 13 separately records an owner-selected helper clock scope on task acceptance. Version 14 installs the collaboration journal and interrupts active assignments on restart. Version 15 installs the exact-message disclosure approval journal; pending and unused approvals are interrupted on restart. The exchange runtime has been exercised with synthetic providers, not live providers. Every request, question, answer, and result requires approval of its exact recipient and text. The helper clock scope defaults to false, retries retain it, and it does not enable a disabled capability. Version 16 journals main-chat task starts by command and tool-call ID. Version 17 adds revision-safe bot creation defaults.

`GET /api/bots/ID` returns `configDir`, `instructions`, and the current
configuration `revision`. `POST /api/bots/ID/profile` accepts `revision`,
`name`, optional `description`, `instructions`, `provider`, `model`, and
`reasoning`. `instructions` is the content of `soul.md`; `soul` is not a
separate editable field. `agent.toml` accepts only `name`, `description`,
`provider`, optional `model` and `reasoning`, and optional `providerChoices` tables. Direct edits are validated on
read and valid changes apply to subsequent work. Invalid content and late edits to a previous revision return
HTTP 422 with `code` `invalid_agent_configuration` and block new work without
changing the files. Agent settings and credentials have separate storage.
An error during the publication switch returns HTTP 503 with `code`
`configuration_save_uncertain`; the change may have taken effect and the client
must inspect it before retrying. Direct writes can overwrite a file version
before Staf observes it, and separate edits to both files are not atomic.

Bot profile edits and archive operations require the current revision. Stale
revisions return HTTP 409. Profile edits preserve TOML comments and surrounding
formatting; an unsupported layout returns 409 instead of discarding its text and
can be changed by directly editing the file. The service stores a profile snapshot for each
accepted chat command. Archive rejects active chat commands. The instance captures the profile for each turn, stores full provider history privately, and exposes only visible chat. New command IDs use a private keyed fingerprint to distinguish exact retries from different input that redacts to the same text. Older commands without a fingerprint remain queryable, but reuse of their IDs is rejected because the original input cannot be verified. Provider-specific settings are checked during execution. A pre-journal SQLite database is copied with `VACUUM INTO` before migration. The backup path
is printed by `instance serve`; this is not a complete backup/restore workflow.

OpenRouter streams Chat Completions with usage requested, reconstructs fragmented function calls, and commits only after a supported finish reason and the stream terminator. An incomplete provider response cannot dispatch its proposed tools or become a completed message; tools completed in earlier response steps remain recorded. Models vary in tool support; missing usage remains unavailable. LM Studio and generic Chat Completions remain buffered. OpenRouter and other chat-completions adapters combine caller cancellation with
their 60-second timeout. Offline tests verify that cancellation closes a local
HTTP request.

A paired client can inspect and update copied bot defaults with `GET` and `POST /api/creation-defaults`; updates require the current revision. Provider, model, and reasoning are copied into new bots, never inherited by existing bots. The loopback instance task preview adds `task-start`, `tasks`, `task`, `task-stop`, `task-retry`, `task-replace`, `task-direct`, `task-answer`, and `task-follow` commands. See [background task preview](usage.md#background-task-preview) for syntax and limitations. The service accepts an optional `limitMs` from 1,000 through 86,400,000 and defaults to 300,000.


### Shared-instance skills API

Authenticated clients use `GET` and `POST /api/skills` to list or import. Imports require `name`, `description`, `provenance` and literal `body` strings. `GET /api/skills/ID` inspects the current revision. `POST /api/skills/ID/update` adds a revision with those fields and the expected `revision`. `POST /api/skills/ID/enabled` takes a boolean `enabled`; `POST /api/skills/ID/availability` takes `botId` and boolean `available`. `GET /api/bots/BOT_ID/skills` lists currently enabled skills available to that bot. Known configured credentials are redacted before storage and from returned skill content. The catalog `digest` identifies the original submitted bytes, before redaction. Load evidence identifies this as `sourceDigest` and adds `loadedContentDigest`, the SHA-256 of the UTF-8 redacted body placed in the tool result. Older load evidence lacks a loaded-content digest. Existing stored records and backups are not rewritten. See [usage](usage.md#skills-in-the-shared-instance) for CLI syntax, selection and revocation limits.

### Shared-instance memory API

Authenticated clients use `GET` and `POST /api/memories/user` or `/api/memories/bot/BOT_ID` to list or create entries. `POST` to `/MEMORY_ID/edit` takes `version` and `text`; `POST` to `/MEMORY_ID/delete` takes `version`. A stale or wrong-scope ID returns HTTP 409. Descriptive main-chat lookups return a bounded exact-scope candidate preview without mutation; edits and deletes still require an explicit ID and current version. See [usage](usage.md#scoped-memory-in-the-shared-instance) for scope, retrieval, and deletion limits.

### Shared-instance clock approval API

Paired clients can inspect `GET /api/approvals`, decide a pending request once with `POST /api/approvals/{id}/approve` or `/deny`, and read or update `GET` or `POST /api/approval-settings/{scope}`. Settings updates require `{ "mode": "ask-every-time" | "ask-for-risky-actions" | "never-ask" | null, "clockEnabled": boolean }`. Scope is `instance`, `bot:{id}`, or `task:{attemptId}`; null mode inherits and is invalid for the instance. Requests and decisions are persisted; interrupted requests cannot be approved after restart. The clock is the only supported capability in this API. See [usage](usage.md#clock-approvals-in-the-shared-instance) for limits.

The shared instance schedule preview exposes `schedule-create`, `schedule-list`, `schedule-inspect`, `schedule-disable`, `schedule-enable`, `schedule-revoke`, and `schedule-resolve`. See [recurring schedules](usage.md#recurring-schedules-preview) for JSON shape, time semantics, authorization and recovery. Schedule operations require a paired client.

### Shared-instance web reading

`GET` and `POST /api/web-permissions/{instance|bot:ID|task:ID}` inspect or set an explicit boolean `enabled`. Reads require instance and bot permission; ordinary tasks also require task permission. A scheduled web attempt receives its exact captured URL scope, subject to an explicit task disable; helpers are blocked. Task readback includes `override`, `inheritedSchedule`, `scopeEnabled`, `effective` and `scheduledUrl`. `GET /api/web-approvals` returns pending exact hop targets only to paired clients, and `POST /api/web-approvals/ID/approve|deny` decides a pending hop. Decisions and action records store keyed fingerprints and generic status, not the target. The version 18 migration installs disabled-by-default permissions and action recovery. URL and source content can still be retained in conversation or provider replay as described in [usage](usage.md#public-web-reading). Known configured secrets are redacted where implemented; arbitrary chat, source and model output may retain unknown secrets that cannot be reliably detected. The feature has synthetic, not live, verification.

### Shared-instance search

`GET` and `POST /api/search-config` inspect and revision-safely update the owner-selected backend origin. The only accepted form is `http://127.0.0.1:PORT`; clearing uses `null`. `GET` and `POST /api/search-permissions/{instance|bot:ID|task:ID}` inspect or set an explicit boolean `enabled`. A search requires instance and bot permission; ordinary tasks also require their task permission. Scheduled tasks may use only their captured exact query and backend, subject to explicit task disable; helpers are excluded. Task readback includes override, inherited scope, current effective access, query and backend. Paired clients inspect pending exact queries with `GET /api/search-approvals` and decide them with `POST /api/search-approvals/ID/approve|deny`. Action records and decisions store keyed fingerprints and generic status, not the query. Search result URLs containing percent-encoded sequences or known configured secrets are omitted. Version 19 installs the search configuration, permission, decision and rate-accounting tables. See [usage](usage.md#search-through-an-owner-configured-backend) for retention and upstream limits.

### Shared-instance scratch shell

`GET` and `POST /api/shell-config` inspect and revision-safely set the owner-selected Docker binary, Unix socket and pinned image ID. `GET` and `POST /api/shell-permissions/{instance|bot:ID|task:ID}` inspect or set an explicit boolean `enabled`; shell requires instance and bot permission, and tasks require task permission. Helpers are blocked; scheduled tasks may use only their captured exact command and Docker configuration, subject to explicit task disable. Task readback includes override, inherited scope, current effective access and command. `GET /api/shell-approvals` shows exact pending commands to paired clients; `POST /api/shell-approvals/ID/approve|deny` decides one. The runtime always supplies the fixed bounded scratch workspace; a model cannot select a host path or daemon. `GET /api/shell-uncertain` lists unresolved actions and recorded endpoint configurations. Endpoint string equality does not prove the binary or socket still identifies the same daemon; the owner must verify daemon identity independently. `POST /api/shell-actions/ID/review` requires acknowledgment `verified-daemon-identity-and-accepted-late-create-risk`; review does not perform cleanup or prove that a late create cannot materialize. Version 20 adds the scratch configuration, permissions, decision snapshots, durable serialization lock and review journal. See [usage](usage.md#scratch-only-shell) for process visibility, swap and retention limits.

### Scheduled exact web authorization

`POST /api/schedules` accepts the existing UTC clock authorization or `{ "action": "web.read", "resource": "https://example.com/report", "limits": { "maxReads": 1 } }`. The resource must be canonical HTTP(S) without credentials or query. The owner sees and saves the exact URL; it remains in the schedule database and backups. Every web request requires a separate owner approval before DNS or HTTP. Other targets and redirects are blocked, and one dispatch per occurrence is shared by its retries. Instance and bot web permission remain required; an explicit task disable overrides the copied scope and is carried to retries. Schedule revocation aborts pending or in-flight reads. No reusable approval or helper scope is granted. Version 22 adds backed-up attempt scopes and occurrence dispatch accounting; existing clock schedules do not gain web access.

### Scheduled exact search authorization

`POST /api/schedules` also accepts `{ "action": "search.read", "resource": "safe query", "limits": { "maxSearches": 1, "origin": "http://127.0.0.1:8888", "revision": 2 } }`, using the currently configured backend origin and revision. The query and backend snapshot are retained in the schedule database and backups; the selected service and upstreams may also retain the query. Each dispatch requires a separate owner decision. One dispatch per occurrence is shared with retries. Current schedule, backend revision, instance and bot permissions, and task scope are checked before dispatch. Explicit task disable persists across retries; revocation aborts in-flight search. Helpers and reusable grants cannot authorize scheduled search. Version 23 adds backed-up attempt scopes and occurrence dispatch accounting.

### Scheduled exact scratch authorization

`POST /api/schedules` also accepts `shell.execute` with the exact command in `resource` and limits containing `maxExecutions: 1`, the current Docker binary, socket, image ID and configuration revision, and the fixed `sizeBytes`, `maxInodes`, `timeoutMs` and `maxOutputBytes` values shown in [usage](usage.md#recurring-schedules-preview). The owner-selected command and configuration are retained in schedule records and backups; command text is visible to the Docker CLI and daemon. Each occurrence requires a separate owner decision. The one-dispatch limit is shared across retries and is reserved atomically with the global shell lock. Current schedule, configuration, instance and bot permissions, and task scope are checked before dispatch. Explicit task disable persists across retries; revocation aborts in-flight work. The existing uncertain-action and owner-review gate remains in force. Host workspaces, helpers and reusable grants are not authorized. Version 24 adds backed-up attempt scopes and occurrence accounting.


### OpenRouter connection

Paired clients use `GET /api/openrouter-connection` for `{saved: boolean}`,
`POST /api/openrouter-connection` with `{key: string}` to save or replace, and
`POST /api/openrouter-connection/disconnect` to remove the key. Responses never
include the key. `instance openrouter-status`, `openrouter-set`, and
`openrouter-disconnect` use these operations; `openrouter-set` reads the key from
standard input. Storage is plaintext in `auth/openrouter.json` (mode 0600) under
the instance data directory. Presence does not verify account or model access.
No inference is performed by saving a key or an agent. The shared instance ignores
the host `OPENROUTER_API_KEY`. In-flight requests may finish with a prior key.

## Shared provider selections

`agent.toml` keeps active `provider`, `model`, and `reasoning` at the top level,
plus `[providerChoices.PROVIDER]` tables with optional `model` and `reasoning`.
An empty table remembers an explicitly unset pair. Top-level values win for the
active provider, including direct edits; edit an inactive table to change its
remembered pair. Unknown providers/fields and invalid identifiers are rejected.
Files and revision conflicts remain authoritative across restart and clients. If an authored providerChoices layout cannot be safely changed, the client save is rejected without changing the files; edit them directly.

Owner defaults live in `agents/provider-defaults.json` beside agent directories,
a nonsecret map from provider ID to `{model, reasoning}` (nullable). GET/POST
`/api/provider-defaults` reads/writes the map using its content revision; POST
takes `revision`, `provider`, `model`, `reasoning`. POST
`/api/bots/ID/selection` takes agent `revision`, `provider` and optional nullable
`model`/`reasoning`. POST `/api/models` takes `provider`, including an unsaved
provider or creation choice. All require paired authorization. Discovery uses
existing provider transports and returns metadata only, never credentials.
An explicitly advertised catalog `default_model` may seed a first selection after
discovery; list order is never a default. Without a remembered pair, owner default
or advertised default, the model remains unset and chatting requires a choice.
