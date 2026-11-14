# Configuration reference

## Development workspace

`corepack pnpm dev` serves the loopback workspace at `http://127.0.0.1:3210`
and stores development state in `~/.staf/development`. `STAF_DEV_DATA_DIR`
explicitly selects another Staf instance directory outside the checkout;
`STAF_DEV_CONNECTION_DIR` selects the connection store of an existing Staf
instance without copying it; `STAF_DEV_PORT` selects another loopback port. The service inherits its launch
environment. `STAF_LINUX_HOST_EXECUTION=1` selects the experimental, unverified
Linux host boundary only when its root-owned policy and checks succeed; see
[credential isolation](credential-isolation.md). See [development](development.md#run-the-development-workspace)
for ownership, pairing, reset, and schema recovery.

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
`staf settings defaults`, `staf settings set provider|model|reasoning|toolMode VALUE`,
`staf settings set-default provider|model|reasoning|toolMode VALUE`, and `staf auth chatgpt
login|status|cancel|logout` operate through the same shared instance. These
commands accept the same trailing connection options. A one-shot provider change requires `--confirm-provider-change`, acknowledging that future requests may send conversation history to the new provider. Use `staf settings unset model|reasoning` or `staf settings unset-default model|reasoning` to clear saved values.

The terminal supports `/help`, `/settings`, `/settings show`, `/settings models`, `/settings reasoning`, `/set provider
NAME`, `/set model ID`, `/set reasoning LEVEL`, `/set toolMode MODE`, `/models`, `/auth chatgpt
login|status|cancel|logout`, `/usage [details|help]`, `/context [refresh|help]`,
`/confirm-provider`, `/cancel-provider`, `/unset model|reasoning`, `/unset-default model|reasoning`, `/stop`, `/status ID`, `/edit ID TEXT`, `/retry ID`, `/discard ID`, `/defaults`, `/set-default provider|model|reasoning|toolMode VALUE`, `/approvals`, `/approve ID`, `/deny ID`, and `/quit`. Settings
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

The supported bot providers are ChatGPT, OpenRouter, LM Studio, and live.
Each requires an explicit bot model. OpenRouter uses its fixed Chat Completions endpoint. The live adapter uses
a generic OpenAI-compatible Chat Completions endpoint and can incur API charges.
ChatGPT uses direct Responses and a separate Staf OAuth grant. A credential alone
does not select a provider. Per-bot endpoint overrides are not implemented.
See [model selection](model-selection.md) and [ChatGPT sign-in](codex-direct.md).

In the browser's agent settings, supported providers remain selectable without a
saved connection. Selecting a provider stages its remembered or default model
and reasoning for review. Saving a changed provider requires confirmation of
possible conversation-history disclosure. The paired service, CLI, and direct
files accept supported provider configurations independently of connection presence.

## Scripts

| Command | Effect |
| --- | --- |
| `pnpm dev` | Start the persistent local development workspace and watch frontend and backend sources. |
| `pnpm dev:reset` | Back up and replace development content with the current synthetic seed. |
| `pnpm dev:recover` | Restore an incomplete operation's complete backup, or finalize a committed publication. |
| `pnpm dev:restore BACKUP_DIRECTORY` | Restore a selected development backup after saving the current dataset. |
| `pnpm run build` | Build the Vue/Vite browser workspace and compile server source to `dist/`. |
| `pnpm run check` | Check server and browser TypeScript without emitting output. |
| `pnpm test` | Build and run JavaScript tests against compiled output. |
| `pnpm start` | Build and start the shared terminal. |

## Usage and context

`/usage` reports available provider observations saved with the main chat. It
does not query account quota or reconcile billing. `/context` reports any latest
historical input observation and explains that the next request's occupancy is
unavailable. Staf does not compact history. See [usage accounting](usage-accounting.md)
and [context display](context.md).

## Direct ChatGPT authentication

The GUI reserves a new tab during the Connect ChatGPT click, then navigates it
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

ChatGPT uses POST `https://api.openai.com/v1/responses` with `store:false`,
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
Earlier records without dataset identity are recovered only when durable service
records verify their origin. Other records appear under **Settings > Earlier
browser records** while present. Copy exports the selected record's text. Discard
requires confirmation and removes only a still-matching, unlocked old record;
scoped journals and pairing remain intact.

The workspace is served at `/`. Its persistent agent list selects main chats,
and duplicate names display the last four characters of their stable IDs.
Suffixes can coincide; full IDs remain available through the API and CLI. The UI
calls these records agents; the
existing `bots` API paths, fields, and CLI command remain unchanged. The former
Advanced page is not served.
Its appearance preference is stored in browser localStorage under
`staf-appearance`, with `light`, `dark`, or `system` values. Missing or invalid
values use Light. System follows the device color scheme. This preference is
not an instance configuration or a shared API setting.
`staf-design` stores browser-local sidebar (`expanded`/`focus`), palette
(`green`/`ink`), font (`sans`/`system`), body (13–17px), space (14–32px),
and corner (0–22px) choices. Defaults are expanded, green, sans,
14, 20, and 10. Invalid fields use their defaults. An old logo preference is
ignored; Staf uses the fixed pentagon-dot logo. Storage failure still allows
changes for the current page. Reset appearance restores these defaults and Light.
Authenticated `GET /api/inbox` projects pending questions and approvals.
`GET /api/task-updates` returns task summaries for the inbox. `POST /api/bots`
requires a nonblank `name` and accepts optional `instructions`, `provider`,
`model`, and `operationId`. An omitted provider uses the copied instance
default, and fails with a setup error if it is unset. A creation default requires a real provider and a nonblank model. An omitted model uses the default when the provider is omitted, or
is empty when a provider is specified. A model can override the default.
The browser uses one settings form for creation and editing. Profile saves submit
name, image, instructions, tool mode, provider, model, and reasoning together
with the original revision. Navigation retains unsaved form state in the current
tab. Cancel discards it; uncertain saves retain it for comparison. The composer
selection control remains an immediate service operation.

For retry-safe creation, clients supply an `operationId`;
`GET /api/bot-creations/OPERATION_ID` recovers a recorded result. Reusing an
operation ID with different input conflicts. The transaction copies remaining
creation defaults into the new bot. The version 27 migration adds the creation
journal after a database backup. Saving a real creation default migrates Demo agents, including archived agents; existing real-provider agents remain unchanged. The migration is resumable after interruption and preserves accepted-work snapshots.
For `POST /api/bots`, omitted model and reasoning fields use the applicable
defaults; explicit `null` leaves the corresponding value unset. Reusing an
operation ID with a different choice, including omission instead of `null`, conflicts.
The workspace automatically restores an unfinished creation using its original
operation ID, guarded by a browser Web Lock. Check creation and Retry same creation
use that ID. Unscoped legacy records are adopted only with matching durable command
or creation evidence; other records can be inspected and copied through **Earlier
browser records**, without automatic execution. Only the obsolete
`staf-draft` and `staf-pending` browser keys are deleted; the current
`staf-workspace-v1:` automatic recovery journal remains intact.

Shared-instance ChatGPT sign-in uses `POST /api/codex-auth/start`, `GET /api/codex-auth/current`, `GET /api/codex-auth/ATTEMPT_ID`, `POST /api/codex-auth/ATTEMPT_ID/cancel`, and `GET /api/codex-auth/credential`, and `POST /api/codex-auth/logout`. The initiating paired client owns an attempt and can recover its status and cancel it after a page refresh. Other paired clients cannot inspect it. The OAuth callback is a loopback route at `/auth/callback`; it does not expose callback parameters in its response. Cancellation, client revocation, expiry, and shutdown prevent a pending commit. Synthetic tests cover these boundaries; live sign-in is unverified.

`instance serve [DATABASE_PATH] [PORT]` uses the database directory for ChatGPT credentials and defaults to `.staf/instance.sqlite`
and port `3210`, binding `127.0.0.1` only. `instance pair|clients|revoke|bots|create|inspect|edit|archive|restore|read|send|status|response-follow|response-stop`
use the loopback origin and a separate client credential file; see
[usage](usage.md#local-shared-instance-offline-preview). `instance create URL CREDENTIAL_FILE NAME [--instructions TEXT] [--provider PROVIDER] [--model MODEL] [--operation-id ID]` joins name
arguments with spaces. Each option takes one argument and can appear once.
The CLI prints the generated operation ID before submission; callers can reuse
it with unchanged arguments. A direct API creation without an operation ID is
not retry-safe. The server stores
SHA-256 token hashes in SQLite and limits ordinary JSON request bodies to 64 KiB.
Skill import and update requests are limited to 1,600,000 bytes. Core updates are limited to 200,000 bytes. Authenticated
agent create/profile requests using the dedicated image media type have a
1 MiB limit; see [agent image configuration and API](#agent-image-configuration-and-api).
Newly created databases have owner-only permissions, independent of a permissive umask. Existing file permissions are not changed. Restrict the containing directory and any existing database separately. On the tested platform, SQLite rollback journals inherit the owner-only database mode.
The host issues a one-time code at startup and on each terminal Enter. Browser
requests with an Origin must match the exact server origin; JSON and bearer
credentials are required for protected writes. No network transport beyond
loopback is implemented here. ChatGPT and OpenRouter use instance-owned credentials; LM Studio and live use host configuration. Each requires an explicit bot model. Paired clients have derived
identifiers; any paired client can list and revoke them. Every paired client is trusted to act for the sole owner, including managing approvals and settings; there is no separate owner role check.

Paired clients can read the latest main-chat progress with `GET /api/bots/{id}/response`, or `responseProgress` within `GET /api/commands/{id}`. The response has the command ID, bot ID, accepted/running/stopping/stopped/completed/failed/interrupted state, provisional text and a safe error. `instance response-follow URL CREDENTIAL_FILE COMMAND_ID` polls and prints changed progress as JSON lines until a terminal state. Text that could complete a known credential may be withheld at chunk boundaries. The service also holds unfinished words for safe URL handling. Provisional snapshots stop growing at one million UTF-16 code units per provider step; the completed response remains available. Version 28 adds a progress table after a database backup; incomplete output is retained separately from committed conversation messages. ChatGPT direct and OpenRouter can emit deltas; LM Studio and generic Chat Completions adapters are buffered. No live provider verification was performed for this change.

Paired clients request Stop with `POST /api/commands/{id}/stop` or `instance response-stop URL CREDENTIAL_FILE COMMAND_ID`. The result is the current progress, including `stopping` while cancellation settles and `stopped` afterward. Repeating a request against the same command returns its current outcome and cannot stop a newer command. The accepted command keeps the per-agent busy lock while stopping; a noncooperative provider can delay settlement. Restart while stopping reports `interrupted`. Version 29 adds the stop journal after a database backup. Stopped partial output is retained as an `assistant_stopped` conversation message, excluded from provider replay.

The paired `GET /api/bots/{id}/response/stream` endpoint returns `text/event-stream` and requires a bearer authorization header and the same origin checks as other instance requests. An initial `snapshot` event contains the current progress or null. Later JSON events contain either a `snapshot` with `response`, or a `delta` with `id` and text to append. Completed snapshots have empty text; clients read the completed answer from the conversation. Failed, interrupted, stopping, and stopped snapshots retain provisional text. Each reconnection begins with a new snapshot; clients do not resubmit a command. Heartbeat comments keep idle connections open. Revocation closes the revoked client's connections. The instance allows up to 256 response streams and disconnects clients whose pending output exceeds 2 MB; they can reconnect for a current snapshot. The workspace uses authenticated `fetch` to consume the stream. Progress snapshots include ordered `events` with tool calls and completed intermediate assistant messages. A changed event boundary sends a snapshot even if text is unchanged. Chat work and pending approvals also use polling.

An optional profile description is directory metadata visible to other bots. A profile edit that omits it preserves its current value. The paired `POST /api/bot-discovery` endpoint accepts `requesterId` and `query`, and returns matching active or busy bots by name and description, without selecting a helper. Archived bots and the requester are excluded. Matching and limits are provisional; discovery itself does not execute collaboration. The version 12 migration backs up existing databases and initializes descriptions as empty strings. Version 13 separately records an owner-selected helper clock scope on task acceptance. Version 14 installs the collaboration journal and interrupts active assignments on restart. Version 15 installs the exact-message disclosure approval journal; pending and unused approvals are interrupted on restart. The exchange runtime has been exercised with synthetic providers, not live providers. Every request, question, answer, and result requires approval of its exact recipient and text. The helper clock scope defaults to false, retries retain it, and it does not enable a disabled capability. Version 16 journals main-chat task starts by command and tool-call ID. Version 17 adds revision-safe bot creation defaults.

Paired `GET /api/core` returns `source` (`default` or `override`), effective
`content`, `defaultContent`, host `path`, and a `revision`. `POST /api/core`
accepts that revision and `content`; a string replaces the core and `null`
removes the override. Empty strings are valid. Content is UTF-8, limited to
30,000 UTF-16 code units and 120,000 bytes, and cannot contain NUL. A stale
revision returns 409. An unreadable or invalid file and an edit to a retired
revision return 422 with `invalid_core_configuration`. An uncertain publication
returns 503 with `configuration_save_uncertain`. New work is rejected while
core configuration is invalid. A lost response also requires inspection before
retrying. Advanced Settings uses these same endpoints. It retains the draft on
failure and requires comparison before another save. Reset removes the override;
it does not write a copy of the default. The paired CLI uses `core`, `core-save`,
and `core-reset`; see
[shared core guidance](usage.md#shared-core-guidance).

`GET /api/bots/ID` returns `configDir`, `instructions`, and the current
configuration `revision`. `POST /api/bots/ID/profile` accepts `revision`,
`name`, optional `description`, `instructions`, `provider`, `model`, and
`reasoning`, and optional `image` and `toolMode`. `instructions` is the content of `soul.md`; `soul` is not a
separate editable field. `agent.toml` accepts only `name`, `description`,
`provider`, optional `model`, `reasoning`, `image`, and `toolMode`, and optional `providerChoices` tables. Direct edits are validated on
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

Authenticated clients use `GET` and `POST /api/skills` to list or import. Imports require `name`, `description`, `provenance` and literal `body` strings. `GET /api/skills/ID` inspects the current revision. `POST /api/skills/ID/update` adds a revision with those fields and the expected `revision`. `POST /api/skills/ID/enabled` takes a boolean `enabled`; `POST /api/skills/ID/availability` takes `botId` and boolean `available`. `GET /api/bots/BOT_ID/skills` lists currently enabled skills available to that bot. Known configured credentials are redacted before storage and from returned skill content. The catalog `digest` identifies the original submitted bytes, before redaction. Load evidence identifies this as `sourceDigest` and adds `loadedContentDigest`, the SHA-256 of the UTF-8 redacted body placed in the tool result. A registered `select_skill` action uses the work item’s captured catalog and current availability. A completed action can be resumed without another load after availability is rechecked. Older load evidence lacks a loaded-content digest. Existing stored records and backups are not rewritten. See [usage](usage.md#skills-in-the-shared-instance) for CLI syntax, selection and revocation limits.

### Model memory action contract

Every registered model capability shares an input-fidelity check: the instance
redactor must leave both raw and parsed JSON unchanged before private invocation
or journal persistence. Rejected input is never executed with substituted text.
This includes invalid identifiers and normalized inputs, not only memory writes.

The shared action registry exports `memory_search`, `memory_read`, `memory_remember`, `memory_update`, `memory_forget`, and `memory_proposal_status`. Both individual calls and QuickJS child calls use these registrations. Scope is `{ "kind": "agent" }` or `{ "kind": "user" }`; agent identity comes only from accepted work. Search accepts `query` and an optional cursor and returns at most 20 matching items and `nextCursor`. Read returns an item with its ID, stored scope and version. Update and forget require the ID, scope and version. A stale or wrong-scope mutation is a definite failed action. Text requiring current instance credential redaction is rejected during input parsing, before invocation inputs, action records, creation, proposal or update, so confirmation cannot save hidden text that differs from the review. Saves and updates take `classification` (`ordinary`, `sensitive`, or `uncertain`); omission fails closed to review. Owner rules can require review for matching text or every change. Pending sensitive proposals return an ID and fingerprint, never the proposed text in the action result. Shared remember additionally returns or creates the separately governed agent-bound shared proposal; only the owner chat confirmation or cancellation resolves that shared proposal. Proposal status is readable by the originating agent. Helpers are ineligible. These adapters use the common command/task context. The Code Mode description includes the eligible registered names and input schemas.

### Shared-instance memory API

`GET /api/memory-sensitivity` reads `{revision, mode, terms}`; `POST` uses the current revision, `mode` of `model` or `review-all`, and a bounded string array of case-insensitive substring terms. `GET /api/memory-proposals/BOT_ID` lists that agent's pending sensitive proposals including exact text and fingerprint. A paired owner sends the fingerprint to `POST /api/memory-proposals/ID/confirm` or `/deny`. Confirmation checks the exact stored proposal, active memory availability, agent state and target version. Sensitive shared creation creates a separate shared proposal requiring the normal chat confirmation; that final step rechecks the approved text and current authority. Proposals survive restart; disabling memory or archiving the agent denies pending sensitive proposals and cancels their pending shared confirmations. Plugin-originated proposals also require the originating connection and access revision to remain current. Schema 43 combines these tables with Slack work migrations without modifying existing memory or shared proposals. Model classification and term matching are imperfect; `review-all` requires review for every model save/update.


The workspace uses the authenticated `GET` routes below for read-only memory
pages. Each route returns the complete scope; browser pagination uses 20 entries
per page and does not change this API. A missing agent returns HTTP 404, and an
absent or revoked client credential returns HTTP 401.

Authenticated clients use `GET` and `POST /api/memories/user` or `/api/memories/bot/BOT_ID` to list or create entries. `POST` to `/MEMORY_ID/edit` takes `version` and `text`; `POST` to `/MEMORY_ID/delete` takes `version`. A stale or wrong-scope ID returns HTTP 409. Descriptive main-chat lookups return a bounded exact-scope candidate preview without mutation; edits and deletes still require an explicit ID and current version. See [usage](usage.md#scoped-memory-in-the-shared-instance) for scope, retrieval, and deletion limits.

### Shared-instance clock approval API

Paired clients can inspect `GET /api/approvals`, decide a pending request once with `POST /api/approvals/{id}/approve` or `/deny`, and read or update `GET` or `POST /api/approval-settings/{scope}`. Settings updates require `{ "mode": "ask-every-time" | "ask-for-risky-actions" | "never-ask" | null, "clockEnabled": boolean }`. Scope is `instance`, `bot:{id}`, or `task:{attemptId}`; null mode inherits and is invalid for the instance. Requests and decisions are persisted; interrupted requests cannot be approved after restart. The clock is the only supported capability in this API. See [usage](usage.md#clock-approvals-in-the-shared-instance) for limits.

The shared instance schedule preview exposes `schedule-create`, `schedule-list`, `schedule-inspect`, `schedule-disable`, `schedule-enable`, `schedule-revoke`, and `schedule-resolve`. See [recurring schedules](usage.md#recurring-schedules-preview) for JSON shape, time semantics, authorization and recovery. Schedule operations require a paired client.

### Shared-instance web reading

`GET` and `POST /api/web-permissions/{instance|bot:ID|task:ID}` inspect or set an explicit boolean `enabled`. Reads require instance and bot permission; ordinary tasks also require task permission. A scheduled web attempt receives its exact captured URL scope, subject to an explicit task disable; helpers are blocked. Task readback includes `override`, `inheritedSchedule`, `scopeEnabled`, `effective` and `scheduledUrl`. `GET /api/web-approvals` returns pending exact hop targets only to paired clients, and `POST /api/web-approvals/ID/approve|deny` decides a pending hop. Decisions and journal records store keyed fingerprints and generic status; the registered action binding also retains the canonical target URL and may appear in database backups. The version 18 migration installs disabled-by-default permissions and action recovery. URL and source content can still be retained in conversation or provider replay as described in [usage](usage.md#public-web-reading). Known configured secrets are redacted where implemented; arbitrary chat, source and model output may retain unknown secrets that cannot be reliably detected. The feature has synthetic, not live, verification.

### Shared-instance search

`GET` and `POST /api/search-config` inspect and revision-safely update the owner-selected backend origin. The only accepted form is `http://127.0.0.1:PORT`; clearing uses `null`. `GET` and `POST /api/search-permissions/{instance|bot:ID|task:ID}` inspect or set an explicit boolean `enabled`. A search requires instance and bot permission; ordinary tasks also require their task permission. Scheduled tasks may use only their captured exact query and backend, subject to explicit task disable; helpers are excluded. Task readback includes override, inherited scope, current effective access, query and backend. Paired clients inspect pending exact queries with `GET /api/search-approvals` and decide them with `POST /api/search-approvals/ID/approve|deny`. Action records and decisions store keyed fingerprints and generic status, not the query. Search result URLs containing percent-encoded sequences or known configured secrets are omitted. Version 19 installs the search configuration, permission, decision and rate-accounting tables. See [usage](usage.md#search-through-an-owner-configured-backend) for retention and upstream limits.

### Shared-instance scratch shell

Scratch-shell calls require Linux and a configured Docker engine that passes
the isolation checks. This backend has not been verified on Linux. Configuration
and recovery controls remain available for existing records.

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

Browser choice controls load model metadata on open and provider change. The composer saves explicit selections immediately; agent editors and provider defaults stage changes until saved. **Automatic** sends no explicit reasoning effort. Discovery does not authenticate or verify model access.

### Chat work records

Paired `GET /api/bots/{id}/chat-work` returns ordered `messages`, `requests`, and `tasks`. A task acceptance notice appears as a message with role `task`, its existing message ID, and `taskAttemptId`; each task snapshot carries its existing attempt and activity IDs and an `anchorMessageId` when an acceptance notice can be matched. Unmatched older attempts have a null anchor. Other task notices remain excluded from the chat message list. Each request contains its command `id`, service-owned response `progress`, and ordered `events` with stable numeric `id`, `type`, `name`, nullable numeric `success`, nullable `detail`, nullable `arguments`, nullable `callId`, and its `command_id`. Event types are `tool_start`, `tool_result`, and `assistant_message`. The latter retains intermediate assistant text in `detail` (up to 1,000,000 characters), with null `callId`, arguments, and success. Schema 39 fences older readers that cannot distinguish message boundaries. The CLI runtime-event summary still contains only tools. New start and result events share a service-generated call ID. Older events have a null call ID and cannot be reliably paired. Argument and result details are redacted and capped at 16,000 characters. Re-fetch replaces the snapshot; clients must not append duplicate events. Pending chat and task approvals come from `/api/inbox` and are matched by bot and work ID. Existing exact-ID approval decision endpoints and permission enforcement are unchanged. Background tasks remain available through explicit task endpoints and CLI operations, but are not offered to ordinary chat providers.

## Agent image configuration and API

The `image` field in agent list/profile responses is one of:

- `{"kind":"initials"}`.
- `{"kind":"avatar","shape":"pentagon","color":"lilac"}`.
- `{"kind":"upload","assetId":"…"}`, with a lowercase 64-character SHA-256 ID.

Shape IDs are `circle`, `rounded-square`, `capsule`, `triangle`, `pentagon`, and
`hexagon`. Color IDs are `apricot`, `coral`, `marigold`, `sage`, `lagoon`, `sky`,
`lilac`, and `rose`. Unknown IDs and extra descriptor fields are rejected.

`agent.toml` represents this descriptor as an optional top-level string, before
any tables. For example:

```toml
image = "avatar:pentagon:lilac"
```

`image = "upload:ASSET_ID"` selects a stored upload. An absent field or
`image = "initials"` uses the current initial badge. Direct file changes use the
existing validation, observed-history, and revision-conflict rules. An invalid
image setting follows the normal invalid-configuration behavior. A valid
reference whose image file is unavailable instead displays initials.

Agent create/profile JSON requests accept the descriptor above. Missing `image`
during creation means initials. Missing `image` during a profile edit preserves
the current image, including when an older client changes another field.
Explicit `{"kind":"initials"}` clears the selected image. Existing CLI profile
inspection and JSON editing carry the same descriptor. Newly selected upload
references must identify available stored bytes. An unchanged missing reference
can survive unrelated edits, and an accepted creation retry keeps its original
result if the image later becomes unavailable.

To submit a new crop, use `Content-Type: application/vnd.staf.agent-image+json`
with the ordinary agent-create or profile-edit body and
`image: {"kind":"upload-data","png":"BASE64"}`. This media type is accepted only
by paired `POST /api/bots` and `POST /api/bots/ID/profile` requests, up to 1 MiB.
The crop must be a valid non-interlaced 8-bit RGB or RGBA PNG, exactly 256 × 256
pixels, up to 512 KiB before base64 encoding. The service verifies checksums,
decodes and re-encodes the PNG, and publishes only its asset reference. Crop
bytes are never stored in the agent configuration or returned as profile data.
Ordinary JSON retains its 64 KiB limit. The GUI accepts PNG/JPEG/WebP sources up
to 10 MiB, 8192 pixels per side, and 24,000,000 pixels before cropping.

`GET /api/agent-images/ASSET_ID` requires the same bearer authorization, origin,
and optional dataset-header checks as other protected reads. It returns
`image/png` with `Cache-Control: no-store` or 404 when the accepted bytes are
unavailable or damaged. The browser fetches with authentication and uses a
short-lived Blob URL; credentials are not placed in image URLs. The CSP permits
Blob images without permitting executable uploaded markup.

Accepted files are private, immutable, content-addressed PNGs under
`agents/.images`, included in development dataset backups. The service fsyncs
the asset and containing directory entries before publishing its configuration
reference. Partial temporary files
are removed after processing and when the image store next opens. Completed
assets remain available for retained configurations and uncertain saves; clearing
an image does not garbage-collect them. Cancelled browser previews send no image
bytes. Stale profile saves are rejected before storing their crop. Retried
creation includes the canonical image identity in its operation fingerprint.

This extension needs no database schema migration. Older checkouts do not
recognize the new configuration field: remove `image` fields or restore a
compatible backup before running one. Retain accepted assets if you intend to
use those images again.

## Instance tool availability

Paired `GET /api/tool-defaults` returns `revision`, `clock`, `memory`, `web`,
and `files`. `POST` accepts the same object with the current numeric revision
and four booleans; a stale revision returns 409. Schema 41 adds the backed-up
instance setting, initialized to enabled for both fresh and upgraded databases
without changing existing permission or configuration records. These switches
filter registered capability offers and are rechecked at action authorization,
start and result release. `web` covers `read_web`, redirect hops and `search_web`;
`files` covers registered `file_*` actions; `memory` covers registered
`memory_*` actions and automatic recall. Owner memory inspection and native
terminal capabilities remain separate. In-flight web/search requests are aborted
on disable, but an already dispatched effect may have reached its destination.
Clock permission, web/search permissions, task scope and approvals remain
independent and authoritative. Search still needs a configured backend.

## Question sets

Schema 53 stores main-chat question definitions, drafts, resolution, the originating command, and a continuation ID. Schema 54 adds task-bound question sets and drafts. `ask_questions` accepts up to
12 optional single-choice, multiple-select, text, or protected secret steps. Choice questions
include a list of choices; ordinary questions accept a write-in. Paired clients can
inspect `GET /api/question-sets`, save an entire draft with
`POST /api/question-sets/ID/draft`, and resolve it through `submit` or `dismiss`.
A protected step is saved or selected separately with `POST /api/question-sets/ID/secret/INDEX/save|select|clear`; its value goes directly to the secret store; a new value may use an owner-chosen name. Clearing a selection keeps the saved value. The instance database retains only its saved, skipped, or unavailable status. Saving a step does not grant its use, and a deleted or replaced selection becomes unavailable. The service validates choices and retains explicit skipped results. The same
resolution is idempotent; a different resolution cannot replace it.

A completed origin permits a new, correlated continuation. A reserved command
identity makes repeated delivery converge on one command. Interrupted origins
and interrupted continuations are not automatically replayed. A submitted answer
starts new work with the current tool mode, permissions, approvals, and scope.
The action journal checks the originating question-work lineage before dispatch.
It blocks matching prior actions and fences unresolved effects. A dismissal
follow-up has no tool offers. Ordinary Slack chat continues as conversation.
The structured main-chat capability is not offered to Slack commands. A task waits for its own question outcome without spending its execution limit. A restart or stop retains the request and draft without resuming the attempt. A paired client can resolve the retained request and initiate a new attempt after review. Current task authority is checked while waiting and before accepting an answer to an active attempt. Task questions and answers are excluded from automatic Slack updates. A Slack-bound task with questions offers a separate owner review of its exact outcome text and original destination. Schema 55 records the approval with the current Slack and agent revisions and uses the existing delivery journal. A changed identity or authority blocks a pending approval. The owner may submit a new review when the original destination and authority are available. Ambiguous dispatch remains uncertain and is not replayed. The service rejects recognizable direct question or answer matches, but cannot detect every paraphrase or encoding. Gmail-private task outcomes also require current Gmail task authority; existing Gmail clarifications and action approvals remain separate. Secret values are not ordinary question answers.
Known credentials and recognized OpenRouter key patterns are rejected from drafts,
but detection is incomplete.

Schema 56 adds service-owned guided Gmail request state. `guide_gmail_setup`
creates the fixed mixed set in main chat or a task. A paired client can review
`GET /api/question-sets/ID/gmail-preview` and confirm its exact returned review
with `POST /api/question-sets/ID/gmail-start`. The review includes the current
client and refresh grant versions and the uses that would be replaced. The
in-memory `GET /api/question-sets/ID/gmail-authorization` URL is available only
while authorization is pending. Submitting or dismissing during authorization
interrupts it. Failures may leave saved use approvals or credentials, because
the instance and secret stores do not share a transaction. Restart interrupts an
unfinished exchange without replay. The connected result requires a matching
Google profile and a successful plugin commit. No secret value is included in
the question result. Existing agent/model access remains separate.

## Saved tool mode contract

`src/tool-mode.ts` exports `ToolMode` (`direct`, `hybrid`, or `code`) and
`parseToolMode(value: unknown)`. The parser returns `direct` for `undefined`
and rejects other invalid values, including `null`. Agent create, agent profile,
agent list, and creation-default API objects use the `toolMode` field. Omission
on profile and defaults updates preserves the existing value. Omission at creation
copies the creation default, initially `hybrid`; explicit input wins. A creation
operation fingerprint includes an explicit mode and remains stable when defaults
change. Agent TOML without the field reads as `direct`.

Accepted chat and task profiles capture `toolMode` at acceptance. The command, chat-work request,
and task snapshots expose it as `toolMode`, and `Instance.execution(id).profile`
and `Instance.taskExecution(id).profile` return the validated value. A captured
profile without the field reads as `direct`; invalid explicit values fail. Task
profiles use the existing task attempt identity, without a synthetic command ID.
Version 31 adds `creation_defaults.tool_mode` after the existing migration backup.

Chat and tasks open `WorkActions` for the captured command or actual attempt. Modes apply to eligible clock, scoped memory, configured search, web reading, scratch shell, skill selection, host files, native processes, task controls, and `code_mode`. Helpers use their captured profiles and existing restrictions. `GET /api/commands/ID` returns `codeExecutions`
(source, SHA-256 source identity, outcome, selected result, and linked action
IDs) and `workActions` journal records. `GET /api/tasks/ID` and the paired `instance task` command expose the same fields for an attempt. Chat-work returns code execution details
for the owning agent. The `code_mode` definition includes the eligible registered
guest catalog and schemas; child capability progress uses the registered name.
Version 33 adds execution records and marks running records
interrupted on restart without replay. See the [action service](work-actions.md)
for limits, recovery and adapter entry points.

An ordinary failed tool result is paired with its provider call ID before the
next provider step. Explicit action denial also permits a follow-up while the
service keeps action admission closed. An unoffered clock call reports that it
was not executed. Stop terminates work; failed live authority checks and fatal execution errors
can terminate it. The default limit is four provider steps, including the
initial request; a tool call on the last step may execute without a subsequent
provider response. A failed chat turn does not commit its provider history;
command progress, safe tool events, usage and action journals remain available
where persistence succeeds.

## Host file actions

Agent host-file calls fail closed by default. On Linux they can use the
explicitly configured, unverified host boundary described in
[credential isolation](credential-isolation.md).

`file_read({path, offset?, limit?})` returns at most 32,768 bytes (default 8,192) and returns base64 data, byte offset, size, next offset and, for files up to 1 MiB, a SHA-256. `file_write({path, content})` writes UTF-8. `file_edit({path, expectedHash, oldText, newText})` requires valid UTF-8, a file at most 1 MiB, the current hash and one exact match. `file_search({path, query, offset?, limit?})` returns byte offsets in a file, scanning up to 65,536 bytes per page, or matching names in a single directory. A page has at most 100 matches; a directory over 10,000 entries is rejected. Paths are at most 4,096 characters; write content is at most 131,072 UTF-16 code units, each edit string at most 65,536, and search queries at most 1,024. The shared 256 KiB serialized invocation limit also applies. Follow `nextOffset` until null. Concurrent host changes can invalidate a page or race an edit; the hash check is not an atomic compare-and-swap.

With the Linux boundary, paths resolve against the approved workspace unless absolute. The file helper rejects paths outside it, symlinks, and nested mounts. The isolated execution account and its workspace permissions apply. Inputs changed by redaction are rejected before journal preparation. Shared action admission, Stop, recovery, and uncertain-effect handling apply. Helper and scheduled task restrictions remain in force; task mode applies to eligible actions.

File tools return paths under `/workspace`, matching terminal commands. They also
accept the equivalent paths under `/srv/staf-workspace`. Isolated terminal
records use `/workspace` for the working directory. Recovery and question
continuations treat equivalent file and terminal working-directory paths as the
same action. For terminal replay protection, the same command and directory
are treated as the same effect even when process options change. Resuming a
particular terminal invocation still requires its original options. Invalid
working directories are rejected before a new action is recorded. Historical
terminal inputs are compared by their recorded structure even if a value later
becomes a known secret; an unrecognizable historical input requires review.

Random file pages check the complete known-credential overlap and up to 64 KiB
of preceding token context (or the larger known-credential overlap). Recognized
token patterns cannot be exposed by selecting their middle. If an unbroken token
extends beyond that context, the read fails with a credential-boundary error
instead of returning unchecked bytes. This can also reject very long benign
tokens. The returned page limit does not include this bounded privacy lookback
or the existing hash calculation.

### Action reconciliation

`POST /api/work-actions/command/WORK_ID/ACTION_ID/reconcile` and
`POST /api/work-actions/task/ATTEMPT_ID/ACTION_ID/reconcile` accept
`{"evidence": OBJECT}` from a paired owner. The work must be active; task scope
includes its predecessor lineage. Ordinary authority, Stop and denial checks
still apply. A successful response is the recovery manifest, including resolved
action IDs under `resolutions`. It never reruns the effect or changes the original
observed outcome. Matching completed or resolved changes still require a repeat
challenge; a previously blocked invocation needs a fresh call identity.

Supported evidence is feature-specific:

| Action | Evidence checked against the actual service |
| --- | --- |
| `terminal_run` | `{"processId":"ID","observedCursor":N}`; the same agent/action owns the process, its state is exited/failed, output is complete and the cursor matches. Live or lost observations cannot resolve. |
| `file_write` | `{"sha256":"HASH"}`; bounded current file bytes match both this hash and the recorded write content. |
| `memory_update` | `{"version":N}`; the scoped entry has the exact requested text and version immediately after the recorded version. |
| `memory_forget` | `{"absent":true}`; the entry is absent in the recorded scope. |

Other actions have no generic override. Process input submission does not prove
application consumption. A settled process observation does not establish
exactly-once external shell effects. The owner reviews the observed result before
requesting resolution; later calls still pass their normal preconditions.

CLI: `instance reconcile-action URL CREDENTIAL_FILE command|task WORK_ID ACTION_ID EVIDENCE_FILE`.
The evidence file contains only the feature evidence object, without an outer
`evidence` field. This is an owner control, not a model capability.

Read receipts used for recovery stay in memory only while work is open. Their
invocation rows have no private payload; selected output and conversation history
remain retained. An expired read resume reports its completed status without
re-executing it. A new read can fetch current data.

### Secret request API

`request_secret` accepts only `name`, `purpose`, and optional `destination`.
`GET /api/inbox` exposes pending or interrupted request metadata to paired
clients. `POST /api/secret-requests/ID/save` accepts `{ "value": "..." }`
directly; `/skip` and `/dismiss` accept `{}`. Responses contain status only.
`POST /api/secret-requests/ID/select` accepts a saved secret name and current
revision. Saving or
selecting checks the current client and originating work. Interrupted requests can
be dismissed, but cannot accept a value or resume work. Duplicate names are
rejected. `GET /api/secrets` returns metadata and an opaque revision only.
`POST /api/secrets/add` accepts a name, purpose, and value; `/replace` accepts a
name, current revision, value, and explicit confirmation; `/delete` accepts a
name, current revision, and explicit confirmation. Stale revisions fail. No API
returns saved values.
`GET /api/secret-grants` lists approved secret names, revisions, integration roles,
destinations, and grant-state versions. `GET /api/secret-grant-targets` lists the
current version and existing approval, or `null`, for each connected Gmail and
Slack destination. `POST /api/secret-grants/grant` and `/revoke` accept `name`,
`revision`, `integration`, `destination`, `version`, and `confirm: true`.
Approval also requires the reviewed `previous` approval or `null` and a boolean
`confirmDisplacement`. Replacing another secret requires that boolean to be true.
Each decision checks and changes the durable grant state atomically. Revoked and
never-approved destinations retain state versions; stale decisions fail. Granting
requires the current destination and a value valid for the selected role. The
supported roles are `gmail.client`, `gmail.refresh`,
`slack.app`, and `slack.bot`. Replacement and deletion revoke the secret's
approvals. Existing agent and client checks still apply at their respective
boundaries. The grant APIs never return a saved value.
The browser's recognizable-pattern warning is client-side; it is not an API
validation guarantee. Incoming Slack messages also receive a service-side check
for recognized patterns and known values before model dispatch. Neither check
detects every secret or removes a message already sent to Slack. The browser blocks flagged chat and question submissions and omits
flagged written answers from draft saves. Action results are filtered for known
values before normal retention and model delivery; this does not cover arbitrary
encodings, unknown values, historical records, or messages already sent.
See [secret requests](usage.md#secret-requests) for storage and backup limits.

`setup_slack` accepts nonsecret `teamId`, `userId`, and `channelId`; the agent
comes from the originating work. The service creates separate protected app and
bot token requests and exposes the resulting exact destination, secret versions,
current binding and Slack grant-review snapshot as a `slack-setup` inbox item.
`POST /api/slack-setup/ID/confirm` takes the exact `approval` object and requires
`confirmDisplacements: true` when the review lists existing grants. `/dismiss`
takes the same approval. Confirmation rechecks the client, work, agent, binding,
secret selections and reviewed grant state before identification and commit.
The result distinguishes connecting, connected, reconnecting and failure; a
verified socket does not verify the user or DM IDs. Restart interrupts an
unfinished request without replay. The secret-grant update and instance binding
are separate transactions: after a failure the owner must inspect both, since
new grants can remain while the old binding is disabled. See [Slack setup](usage.md#slack-plugin).


### Native process API

Agent native-process and host-file calls fail closed unless the experimental
Linux boundary is explicitly configured and passes its checks. This path and
the separate Docker scratch backend remain unverified on Linux. Resource APIs
remain available to paired owners for existing records.


The isolated launcher receives a fixed minimal environment, and the guard closes
extra descriptors before accepting a command. The older retained host supervisor
only filters selected environment variables and is not an isolation boundary.

Paired clients can list `GET /api/processes`, inspect `GET /api/processes/ID`,
read `GET /api/processes/ID/output?cursor=N`, and request termination with
`POST /api/processes/ID/stop`. Cursors count output chunks. Chunks contain
base64-encoded bytes, optional UTF-8 text, and a stdout/stderr label; `gap` indicates that earlier
chunks expired. `outputComplete` becomes true after output pipes close and the supervised group is observed settled. Output retention is 128 KiB per process, pages are at most 48 KiB, with at most 16 live
handles. The returned limits describe Staf's buffers, not OS memory limits.
Terminal command and working-path inputs requiring credential redaction are
rejected before invocation journaling or execution. Process output replaces known
configured credential bytes before storage, including matches split across
observations in the same stream. Text and base64 encode the same filtered bytes;
unrelated binary bytes are preserved. Pages identify this with
`redaction: "known-credentials"`. Unfinished credential prefixes can be delayed
until the next observation or stream closure. This does not detect unknown or
deliberately transformed credentials or rewrite older stored output and backups.
The process record identifies its originating agent, accepted work and action.
`unknown` means the service lost observation; it does not mean the OS process
exited, and Stop cannot signal a process without its live handle.

The `read_web` and `run_scratch_shell` registered actions accept only `{ "url": "..." }` and `{ "command": "..." }`, respectively. Direct, Hybrid and Code Mode use the same action registrations in chat and eligible tasks. Each web redirect is a separately authorized action. The parent action checks every hop and any reused grants before releasing a result, including on resume. A redirect action exposes `parentActionId` in `workActions`. Scratch actions bind the command, Docker binary, socket, image, revision and fixed limits. Scratch reservation and uncertain-action review remain in force. Approval waits pause the task timer.

The `search_web` registered action accepts only `{ "query": "..." }`. In chat and eligible tasks, Direct, Hybrid and Code Mode share its configured backend, exact-query approval, action identity and result. Model input cannot select an origin, revision or identity. Completed-result release checks the captured backend and any reused grant again. Task approvals pause the attempt timer.

### Interactive process contract

`terminal_run` additionally accepts optional `mode` (`pipe` or `pty`), `retain` (default false), and PTY `cols`/`rows` (defaults 80/24, each 1–1000). The process record exposes `retained`, `inputClosed`, `inputBytes`, `cols`, and `rows`. `terminal_write`, `terminal_eof` and `terminal_resize` are changing actions with normal invocation identity, completed-result recovery and uncertainty handling. They check the executing accepted agent against recorded process ownership. A completed input resume returns its receipt without resubmission.

Paired owners can POST `/api/processes/ID/input` with `{ "data": "text\n" }`, `/api/processes/ID/eof` with `{}`, or `/api/processes/ID/resize` with `{ "cols": 80, "rows": 24 }`. These explicit owner resource controls use the same process manager as model actions and remain usable after the originating work ends. Secret-altered input is rejected before submission; model input is rejected before invocation persistence. Text is not stored in process metadata.

`limits.inputBytes` is 16,384 per request, `pendingInputs` is eight per process, and `ptyInputBytes` is a cumulative 1,048,576 bytes per PTY lifetime. Input and resize requests are serialized per process. Stop closes interaction admission and interrupts queued input; it does not wait behind a blocked write. A receipt proves submission, not consumption. Pipe EOF closes input permanently; PTY EOF submits Ctrl-D. PTY output uses the `terminal` stream. Output bounds and redaction are shared with pipe mode.

Schema 36 adds process retention, input counters/closure and PTY dimensions through the protected migration process, preserving combined native/search schema 35. Old records default to nonretained. Unknown handles cannot receive input, EOF, resize or signals after restart.


## Bundled plugin management

Paired clients use `GET /api/plugins` to inspect bundled definitions, Slack
configuration without tokens, connection state, agent access, recent event
outcomes, and recent task delivery states (`pending`, `sending`, `sent`, or
`uncertain`). `sent` records Slack acceptance, not a human read. `POST /api/plugins/slack/connect` accepts `appToken`, `botToken`,
`teamId`, `userId`, `channelId`, `botId`, and `confirm: true`; it validates the bot token against
the workspace. Both tokens must satisfy the managed-secret limit of 16,000 characters; tokens that fail this limit or the format check are rejected before changing the connection. `POST /api/plugins/slack/access` takes `botId` and `enabled`.
The `enable`, `disable`, `disconnect`, and `delete-config` endpoints take empty
objects. Connections are instance-owned and keyed by service account identity;
this slice exposes one Slack account. Tokens remain host-local and are never
returned. Slack-originated model turns can use the service-owned `start_slack_task`
and `manage_slack_task` capabilities; thread and owner message identity are
captured by the service, not supplied as tool arguments. See [Slack setup](usage.md#slack-plugin) for limits and recovery.

Before reconnecting Gmail or Slack, `GET /api/secret-setup-review?integration=gmail`
or `?integration=slack` returns a version and the existing approvals that setup
would replace. If a prior grant state exists, the connection request must include
the reviewed `reviewedVersion`. If an approval exists, it also requires
`confirmDisplacements: true`. Setup rechecks the reviewed state before committing
the connection. An older backup restores the grant state recorded in that backup.

Gmail uses `POST /api/plugins/gmail/start` with `email`, `clientId`,
`clientSecret`, `confirm: true`, and optional booleans `sendEnabled` and `modifyEnabled`; it
returns an authorization URL, not a credential. Both options default to false
and request their respective Google scopes when true. Google
returns to the loopback `/gmail/oauth/callback` with the one-time state and code.

`GET /api/plugins` includes the 30 latest Gmail history scan `runs`, with start
and finish times and an outcome. Interrupted scans are marked on restart. These
records cover history scans only; they do not establish agent processing or
Slack delivery. When the separately enabled inbox assistant is active, continuing
monitoring failures can trigger a deduplicated generic Slack notice.
The paired owner can call `check`, `enable`, `disable`, `disconnect`, `poll`, or
`delete-config` with an empty object, and `access` with `botId` and `enabled`.
`model-access` takes `botId`, `provider`, `model`, and `enabled`; enabling it
requires an exact match to the current agent profile and existing agent access.
`work-model-access` takes the same fields and requires the existing model grant;
it separately permits tasks and Slack-originated work for that exact agent and
model. Setting or revoking the model grant clears the task and Slack grant.
`read` takes a `messageId` for owner inspection. `rebaseline` requires
`{"confirm":true}` and retains a record of the unknown interval.
`POST /api/plugins/gmail/inbox-preferences` takes `preferences` with `enabled`,
`attention`, `sensitiveTerms`, `digestMinutes` (1–1440), and `memoryContext`, the last observed `revision` (or `null` before setup), and `confirmModelAccess: true` with the `inboxTarget` identity, account and connection revisions as `target` when enabling (omit its display-only `name`). Opting into `memoryContext` additionally requires `confirmMemoryAccess: true` and enabled memory tools. Stale revisions and changed targets are rejected.
It binds to the current Slack agent, Gmail account, model and connection
revisions, and scans from the connection baseline. Initial setup includes eligible recorded candidates; compatible edits preserve pending updates, questions, digests and the candidate checkpoint. Unknown candidates require an explicit owner request; privacy changes under the same authority move pending details to private clarification, while authority changes make them stale. `inboxPreferences` and `inboxStatus`
in the plugin status expose settings, recent item states and current failure.
A message candidate is scoped to one service-owned task and its journaled Gmail
read. Only the exact bound Slack thread can resolve its private clarification.
Digest items and batches are durable. `POST /api/plugins/gmail/review-candidate` takes `messageId`, current monitoring `revision`, and `confirm: true` to assess an unknown candidate with private clarification; it does not change inbox evidence. `POST /api/plugins/gmail/retry-evaluation` takes `attemptId`, current monitoring `revision`, and `confirm: true` to retry a failed read-only or safely stale assessment under current authority. Stale digest members are reassessed individually, with prior assessment and batch linkage retained. Definite Slack rate limits retain the full valid delay across restart and reassessment; invalid or unrepresentable delays require owner review. A send interrupted or with an unknown result is uncertain and is not retried. `POST /api/plugins/gmail/resolve-delivery` takes `kind` (`item` or `digest`), its `id`, `decision` (`sent`, `dismiss`, or `resend`), the exact `expectedText`, and `confirm: true`. Resending requires current monitoring authority and is an explicit owner action that may duplicate the original send. Clarifications without a confirmed thread cannot be marked sent.
The Gmail entry in `GET /api/plugins` includes the account, connection state,
agent access IDs, model access, task and Slack model access, `sendEnabled`,
`modifyEnabled`, monitoring state, recent candidate IDs, inbox evidence (`yes`, `no`, or `unknown`), and gaps;
it never returns the client secret or refresh token. Older candidates are paged
through `GET /api/plugins/gmail/arrivals?before=CURSOR` using `nextBefore`.
There is one Gmail account in this implementation. The shared database keys
connections and access by plugin and account. Plugin secrets and approvals use a
separate SQLite store. `gmail_search` and `gmail_read` are journaled read actions
for explicitly permitted chat and task work in all three tool modes. A paired
`POST /api/tasks` may include `gmailQuery`, a nonempty query of at most 500
characters. The captured account, revision and exact query scope the attempt;
only message IDs returned by that attempt's searches can be read. The scope is
not inherited by retries, scheduled tasks, or helpers. `work gmail: QUERY` in an
authorized Slack DM creates a task with that exact scope. Gmail-derived Slack
responses are generic, except for a proposal the approved user has chosen
to reveal and the separately enabled inbox assistant’s scoped updates. `gmail_reply` requires the original message to be read in the same
work, the Google send scope, an enabled Slack connection for the agent, a
disclosure decision, and an exact approval. Slack revision requests invalidate
the original proposal and return the owner's direction to the model. A new
proposal requires a new approval. `gmail_modify` uses the same boundary for
`label`, `archive`, and `mark_read`, with the separate Google modify scope.
The command and task read endpoints include `gmailReplies` with the recorded
effect and outcome. `GET /api/plugins/gmail/uncertain` lists up to 100 uncertain
actions for paired clients. To reconcile an
uncertain send after checking Gmail, a paired owner can call
`POST /api/plugins/gmail/reconcile` with `actionId`, the recorded `fingerprint`,
and `outcome` of `sent` or `not-sent`. Reconciliation records the owner's
finding; it never sends mail. For an inbox change, use
`POST /api/plugins/gmail/reconcile-change` with the same identity fields and
an `outcome` of `applied` or `not-applied`.
Schema 44 adds Gmail history, disclosure and private-turn records while also
ensuring sensitive-memory schema is present. Both independent schema 43
predecessors upgrade without replacing their existing records. See
[Gmail setup](usage.md#gmail-plugin) for OAuth requirements and limitations.
Schema 45 adds task Gmail scopes, scoped message IDs, private-task markers, and
the separately approved task and Slack model permission. Schema 46 had independent
predecessors for history scans and Gmail action proposals; schema 49 merges both,
retains inbox monitoring settings and decisions, and adds digest, feedback,
memory opt-in, and uncertain-delivery recovery. Schema 50 adds inbox evidence;
older candidates remain unknown, and undelivered work lacking evidence is marked
stale. Schema 51 adds candidate review requests and delivery retry deadlines. Schema 52 stores active sensitivity separately from the latest correction, retains new correction events and old assessment and digest linkage, and marks all members of stale batches for review. A previously overwritten sensitivity correction cannot be reconstructed. Existing records and uncertain effects are preserved.

## Native home-network gateway

The optional native gateway uses `STAF_LAN_ADDRESS` (a specific private IPv4), `STAF_LAN_PORT` (1024–65535, default 3443), and absolute `STAF_LAN_KEY` and `STAF_LAN_CERT` paths in its systemd environment file. It serves HTTPS and forwards to the unchanged loopback service. See [installation and recovery](native-linux-installation.md#enable-home-network-https-access) for certificate trust, pairing and limits. The standard CLI remains loopback-only.
