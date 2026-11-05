# Staf runtime and provider boundary

The local development launcher runs Vite and the shared instance as separate
processes. Vite serves the workspace and forwards same-origin service requests
to the loopback backend; source changes rebuild and restart that backend. The
service remains authoritative for connections and shared data. See the
[development workflow](development.md#run-the-development-workspace).

Development reset builds the seed through `Instance` in a separate directory.
The launcher and maintenance commands share a data-directory owner port, and
maintenance also takes the SQLite exclusive lock. Before publishing a database
and agent-file replacement, maintenance saves both and writes a durable marker.
Instance startup checks that marker before initialization and again after taking
the database lock. Maintenance fences the original and replacement SQLite files
with an unsupported schema version until the database and agent files are durable,
so an older checkout cannot open a partially published dataset even after a crash.
Maintenance reopens SQLite at the published path before further writes so its
rollback journal stays beside the active database.
Recovery retains the unchanged original before replacement begins, restores the
prior copy after replacement starts, and finalizes a committed dataset without
discarding later writes. Development startup
also saves a complete copy and fences the database before schema migration.
Provider connection files stay outside the replacement set. Explicit restoration
clears client authorizations and assigns a new browser dataset identity.

The shared service derives an opaque dataset identity from an instance secret and
returns it to the browser. Browser creation and draft records use that identity,
and the service rejects requests that carry a different identity. A legacy unscoped
draft is adopted only when its agent, command ID and command text match durable
server data; a legacy creation requires a matching recorded operation. Web Locks
protect adoption from an active older tab. Other unscoped records remain available
for explicit read-only copy-out, without assigning them to a dataset. The identity
survives an ordinary restart and changes on reset or explicit restore. Recovery
does not replay work.

A shared instance owns bot profiles, conversations, task attempts, permissions,
and provider execution. The browser and terminal are paired clients of the same
loopback service. The automatic terminal instance stores its SQLite database and
client credential under `~/.staf/terminal-instance` by default. The daemon
continues after the terminal exits; it is not an operating-system service.

The terminal edits a bot profile through the service. Each edit checks its
revision, and an accepted request captures the current profile. Creation defaults
are copied to new bots and do not change existing bots. Provider credentials and
endpoint configuration belong to the host environment or the instance's managed
ChatGPT and OpenRouter credentials. The service does not load a project `.env` file. Changing a provider can
send existing conversation history to the new provider on the next request.

Provider adapters normalize messages and tools for the runtime. ChatGPT uses direct
Responses with a Staf-owned grant and model-bound replay. OpenRouter, LM Studio,
and the generic live adapter use Chat Completions. The demo returns deterministic
responses. ChatGPT and OpenRouter stream provisional text through the shared service; LM Studio and the generic live adapter buffer provider output. Only completed provider responses are committed as completed replies; stopped partial output is labeled separately. The terminal displays provisional text, command status and persisted tool progress. The service applies permissions and approval
rules before supported actions. See [direct Responses](direct-responses.md),
[settings](settings.md), and [usage](usage.md).

The shared instance has synthetic provider and authentication coverage. Earlier
live ChatGPT checks used the prior CLI path and an existing grant; they do not verify
shared-instance sign-in or inference. See [verification](direct-responses.md#verification-and-remaining-gaps).

Main-chat progress is owned by the shared service. The version 28 migration stores sanitized provisional snapshots separately from completed messages; restart marks unfinished commands interrupted. The runtime emits provider-step starts and deltas without adding partial text to provider replay or the completed transcript. The GUI subscribes to the shared progress through an authenticated SSE connection; reconnecting starts with the latest saved snapshot. The CLI polls the same shared progress. The GUI preserves a next draft and renders Markdown without raw HTML. Its single circular composer action derives Send, Stop, and disabled Stopping states from shared response progress. It stays in Stopping until the shared service settles cancellation, including cancellation requested by another client; draft editing remains available, with no implicit submission or queue. Configured credentials and unsafe URLs are withheld or redacted before progress persistence. Buffered providers do not invent deltas. This path is tested with synthetic providers and does not establish live provider behavior.

## Local shared instance preview

The Vue workspace is built with Vite into static assets served by the same
loopback instance. Its persistent agent list selects main chats using stable
IDs, including when names coincide. It reads agents, chat work, and
pending chat approvals from the service and polls while visible. Existing `bots` API
paths and fields continue to identify these agents. Provider sign-in belongs to
the instance; each agent owns its model selection. The former Advanced page is not served.
Appearance and layout are browser-local preferences (`web/appearance.ts` and
`web/design.ts`); the default is Light/Evergreen with an expanded sidebar.
The bundled DM Sans font needs no external request. The composer popup renders grouped menu choices through the existing choice and
save boundary, while agent settings use the full form. Both keep service-backed
discovery, manual model entry, reasoning and conflict recovery. Creation uses a
native modal dialog over the chat; its durable state remains in the controller.
CSS follows the device color scheme when System is selected. These preferences
are not stored by the shared instance.

A browser journal retains each agent's next draft and submitted command. Each
open tab claims its records with browser Web Locks; closed-tab records can be
claimed automatically when that agent is opened again. Concurrent tabs keep
separate records and command IDs. When several unclaimed records exist for one
agent, one is loaded at a time; the next is claimed after the current record is cleared.
After reload or reconnect the browser checks the same command ID and resubmits
that ID if it is missing; the instance remains authoritative for accepted work.
Accepted commands use a deterministic user-message ID so the optimistic message
and the stored conversation appear once. Busy and definitive failures remain
inline for explicit retry or dismissal; an uncertain original cannot be dismissed
after a busy retry because it may still arrive. Accepted failed commands get a
new ID on explicit retry. Local journal storage and Web Locks are required for
sending. The obsolete `staf-draft` and `staf-pending` pre-journal keys are deleted
under Web Locks without importing or backing them up. The `staf-workspace-v1:`
journal is retained, including unclaimed closed-tab drafts and uncertain commands;
the retired manual picker also listed these current records. No journal-wide
legacy cleanup is safe. Clearing browser storage removes the journal.
 A keyed
bot-creation operation stores its fingerprint and result with the bot in one
transaction. Version 27 backs up an existing database before adding the journal.
The browser retains the operation ID locally and claims the creation record with
a Web Lock. On reload or reopening, it automatically restores an unclaimed creation
form with its original arguments and operation ID; another live tab cannot adopt it.
Closing and reopening the form in the owning tab retains the operation. The CLI
prints the ID before submission. A client can reuse the ID after a lost response or restart. Requests
without an ID do not have this guarantee. The shared service serializes archive
with chat and task acceptance and rejects archive while work is active. It keeps
the bot identity, configuration, and history for restoration.
Inbox approvals are projections of existing records and in-memory requests, not
a second authorization store. This UI does not add LAN transport or establish
live ChatGPT behavior.

`web/App.vue` composes the workspace from focused Vue single-file components.
`web/workspace.ts` provides one controller and a shallow reactive snapshot to
those components. API operations, draft persistence, polling, and streaming stay
in `web/controller.ts`. Markdown passes through remark and rehype with raw HTML
omitted and sanitization before trusted code-copy controls are added. See the
[frontend decision](adr/0004-vue-frontend.md).

The default terminal connects to the same instance over authenticated loopback
HTTP. A detached local daemon owns SQLite and remains alive after the terminal
exits. A private per-data-directory credential and challenge-based discovery
identify the daemon before the client sends its bearer token. The instance
owns the main bot and transcript. The terminal submits commands with unique IDs
and reports the ID when delivery is uncertain. Configuration phrases supported
by the terminal update the current bot profile with a revision check; they do
not require a provider. A paired client can connect to an explicit loopback
instance with its client credential.

The loopback HTTP service wraps `Instance` SQLite records. A client exchanges a
host-issued one-time code for a persistent bearer credential; the database stores
its hash. A client ID is derived from the token hash and is not a bearer token.
The first-delivery trust model treats every paired client as acting for the sole owner, with no separate role check. Any paired client can list and revoke client authorizations and manage approvals and settings. A browser stores its credential and uncertain draft locally, while a
CLI client uses a separate credential file. Commands claim a bot and append the
user message transactionally; completed responses are stored with the command
state. Stop records a durable request while retaining the pending command and its unique busy lock, aborts the running provider and pending operations, and settles only after the turn returns. A late provider result cannot commit after Stop. The partial output is stored as a stopped conversation entry and excluded from provider replay. Restart marks pending or stopping commands interrupted; it does not resume them. SQLite exclusive locking
prevents a second process from treating active commands as interrupted. The
service runs demo, ChatGPT, OpenRouter, LM Studio and live with instance or host credentials and an explicit bot model for each non-demo provider. This preview does not implement the LAN,
all operational features described in the plans above.

Agent settings and instructions live under `agents/ID/current` beside the
instance database. The `current` symlink points to a revision directory holding
`agent.toml` and `soul.md`. The service validates and fsyncs both new files
before atomically replacing the symlink. A hash of revision identity, content,
an observed-change generation and archive state detects stale client saves.
Archive and restore create a new revision identity. Direct file changes are validated on read and
their observed valid versions are retained under `.history`; `.published` holds
the initial pair in that revision directory. Existing valid configurations
without a copy are sealed on startup; existing invalid files remain unchanged.
Direct writes can overwrite unobserved versions, and separate writes to the two
files are not atomic. Before switching the
pointer, the service records the previous file hash. A direct edit detected
during publication causes a conflict and restores the previous pointer. A later
edit to an open previous file blocks new work until the owner reconciles it.
Archive state and operational records remain in SQLite. Unpublished revision directories can
remain after an interrupted save; they are not read as active configuration.
Old database-owned profiles are not migrated by this feature.

Discovery uses names and owner-edited descriptions. Each accepted command and
task captures its settings and instructions. The offline demo does not follow
instructions. The private execution session retains tool history, usage and
model-bound replay separately from visible chat. Permissions and revocations
remain service-controlled. Live provider execution remains unverified.
The shared chat-completions adapter passes caller cancellation and its timeout
to the HTTP transport.

The background-task preview stores tasks, linked attempts, captured profiles and context, ordered Activity, and private sessions in SQLite. A partial unique index enforces one queued, running, or stopping attempt per bot. Startup marks unfinished attempts interrupted. Stop intent is saved before requesting transport cancellation; observed terminal output and usage can still arrive. Clock permissions and approval modes are implemented. Explicit task inputs are stored in an ordered inbox and incorporated at provider boundaries; completion and input acceptance are serialized. Structured `ask_owner` calls wait for an answer to the recorded question ID, without consuming the execution timer. Main chat does not implicitly direct a task. Explicit replacement is captured while waiting and becomes queued in the same transaction that records the original attempt settling. The MVP workspace hides Activity and task questions; explicit task API/CLI operations remain available. Offline tests do not establish live provider behavior.


### Shared-instance skills

Database version 8 adds the immutable skill catalog, per-bot availability, task catalog snapshots and command load evidence in the migration transaction after a protected backup. Configured credential values are redacted from new catalog records before storage and from existing records on read; catalog digests identify the original submitted bytes. Load evidence labels that value `sourceDigest` and records `loadedContentDigest` for the exact redacted UTF-8 body in the tool result. Older records do not contain the latter. Earlier database records and backups are not rewritten. The runtime offers at most 32 metadata records to tool-capable providers. A structured selection validates the captured ID and revision and current availability before returning untrusted text as a tool result. The task Activity and command status record successful loads. Availability is rechecked before later provider calls and actions. Clock authorization remains independent. Prior skill tool results are replaced before the next turn's provider request; stored history, backups and already-sent provider data are not erased. Synthetic provider tests do not establish live model selection or resistance to prompt injection.

### Shared-instance memory

The browser exposes read-only agent and shared user memory through the existing
authenticated scoped list APIs. It validates each response against the requested
audience and paginates the complete snapshot locally in groups of 20. Leaving a
memory page aborts its request; later responses cannot repopulate another page.
Pairing loss unmounts settings and memory views. Archived agents remain
inspectable without restoration. No memory mutation or provider call is added.


Version 6 adds scoped memory in the instance database transaction after a protected migration backup. The store enforces bot and user scopes and optimistic versions. Provider calls receive bounded keyword-matched memories as untrusted request-only data. The session retains ordinary messages rather than the injected memory. Main-chat owner phrases and registered model actions can change agent memory or existing shared entries. Shared creation by a model creates a proposal, which requires separate owner confirmation. Version 7 adds durable, bot-bound shared-memory proposals. A separate explicit owner confirmation atomically saves the proposed text once, and cancellation clears the pending proposal text without creating memory. The original text and proposal response remain in chat history and may be sent in future model requests or task context; cancellation does not erase backups or already-sent data. This is an offline-tested preview and not a general intent interpreter.

### Shared-instance clock dispatch

The service gates a validated clock action before dispatch. It evaluates the instance and bot permissions and task boundary using the current effective mode; an exact, one-action request is persisted before an in-process wait. Paired-client decisions resume that waiter, which rechecks current permissions before dispatch. Stop or restart interrupts the request; it does not replay provider work automatically. Task approval wait is excluded from the execution timer. Provider observations are saved before the wait. These mode settings apply to the shared-instance clock. Delegated clock actions also intersect both bots and the task scope. Reusable grants are not implemented.

## Recurring schedule preview

The version 9 instance migration creates schedule and occurrence tables after a protected backup. Version 10 binds retries to their schedule origin. Version 11 backfills historical task descendants after a protected backup. A tick reserves the occurrence, advances the cursor and creates the linked ordinary task in one SQLite transaction. Provider dispatch occurs after commit. Existing active tasks block new scheduled work. On startup, unfinished claims become uncertain rather than being dispatched again. The owner can inspect and mark an uncertain occurrence reviewed; a retry remains explicit. Clock use rechecks the structured schedule authorization and live approval policy. Version 22 adds an exact web URL scope copied into each occurrence and retry, plus a durable one-dispatch-per-occurrence ledger. A scheduled web read always requires its own owner approval, current instance and bot permission, and the task scope; an explicit task disable carries to retries. Schedule revocation aborts active web work. Redirects outside the exact URL are rejected, and the dispatch cap prevents a second hop. Version 23 similarly captures a literal search query and configured backend snapshot for a separately approved, one-dispatch occurrence; retries retain the same scope and task restrictions. A changed backend blocks dispatch, and schedule revocation aborts pending or in-flight searches. Version 24 captures an exact scratch command and Docker configuration, requires a separate owner decision, and reserves one occurrence-wide dispatch with the existing global shell lock. Retry retains the scope and explicit task disable; the uncertain-action review gate still blocks subsequent shell work. Host workspaces remain unavailable. The service loop runs only while the instance is running. The recurrence and catch-up choices are provisional and are described in [usage](usage.md#recurring-schedules-preview). This preview does not implement machine scheduling or general action grants.

The collaboration runtime journals actual bot messages and separate helper attempts. The owner approves each exact message before disclosure. A helper receives only the assignment brief as task context and does not retrieve private memory. Parent stop cancels its helper, and late output remains in helper Activity. Restart interrupts unfinished attempts. Offline synthetic-provider tests cover these paths; live provider behavior remains unverified.

Shared-instance ChatGPT sign-in owns a short-lived in-memory attempt bound to its initiating paired client and the service loopback callback. The credential adapter checks that client remains authorized at the locked credential commit boundary. Callback parameters are not returned in the response. The browser reserves a tab synchronously from the connection action and navigates it after asynchronous authorization setup. A blocked tab leaves a manual link for the same attempt. The browser keeps the sign-in URL only for the attempt that produced it and offers cancellation and retry if it is lost or the attempt fails. Paired CLI and GUI sign-out use the same guarded service operation. Credential status is local and does not verify account or model access. This integration has synthetic service, CLI, and served-browser tests and has not been verified with live authorization.

The shared main-chat runtime may request one background task per command through a host-controlled tool. A durable journal binds the command, tool call, objective, and task attempt, so duplicate submissions do not start duplicate work. Explicit main-chat task direction and stop use the attempt ID and do not expand permissions. New bots copy the instance provider, model, and reasoning creation defaults in the creation transaction; later default changes do not alter existing bots. These paths have offline synthetic coverage; live provider behavior remains unverified.

Public web reads use a per-hop action broker. The action journal records generic summaries and keyed fingerprints; an authenticated owner sees the exact pending hop in memory and approves or denies it before DNS. Current permissions are checked again before dispatch, and permission revocation or task stop aborts the operation. The read path pins a validated public IPv4 address, validates each redirect, and bounds the returned untrusted text. Started actions become uncertain on restart and are not automatically replayed. Conversation and provider replay retention remains separate from the generic action journal; unknown secrets in source text cannot be reliably detected. The integration has synthetic coverage only.

The search tool sends only an approved literal query to the owner-configured loopback origin. The model cannot select the backend. Search uses a separate permission boundary and a keyed action journal, checks current configuration and permissions before dispatch, and aborts affected requests on revocation or task stop. It limits a single instance process to two concurrent dispatches and limits its database to ten per rolling minute, with rate history in the instance database. Separate instance processes do not share a concurrency limit. Search previews are untrusted, and result URLs are not fetched automatically. Queries can be retained by the selected service, its upstreams and the provider/session history. For chat and tasks the shared action service captures the backend, revision and query in a durable action binding and rechecks that binding and any claimed grant before start and result release. Task approvals pause the corresponding attempt timer. Synthetic tests include the production HTTP transport against a disposable loopback server; live SearXNG and provider behavior remain unverified.

Scratch shell uses only an owner-configured Docker CLI, daemon socket and pinned image, and always supplies a fixed bounded tmpfs workspace without an explicit host bind. A keyed action identity and exact-command owner decision precede daemon work. A durable lock and unresolved-action gate serialize execution; started work is marked uncertain on restart. The recorded endpoint configuration is retained for manual inspection. The owner must independently verify daemon identity because matching paths do not prove that the binary or socket still identifies the same daemon. Explicit owner review acknowledges that an absent observation cannot rule out a late create; it neither retries nor removes the old action. The CLI process and daemon can observe the command, tmpfs can use swap, and unknown output secrets can be retained. Integration tests use a synthetic executor; the component itself has separate disposable-container coverage.

Descriptive memory language is parsed before the broad memory fallback. It lists a bounded set of candidates from the explicitly resolved scope and never mutates an entry. Model actions and owner commands use the same version-checked store; shared-save confirmation is unchanged.


OpenRouter key entry, replacement, status and disconnect use authenticated
shared-service operations. A private atomic file in the instance auth directory
contains the plaintext key; its public status reveals presence only. The service
uses the managed key for new OpenRouter work and ignores the host environment
key. Saving does not verify account or model access. Known keys are redacted
from supported conversation and output paths; the key is rejected from agent
configuration writes. In-flight work may retain a previous key. Service, CLI,
and served-browser coverage uses synthetic credentials and streaming provider responses, including tool calls and recovery; live OpenRouter conversation and remote-instance access remain unverified.

The agent editor combines its revisioned profile with the authenticated ChatGPT
and OpenRouter presence statuses to offer configured shared connections and the
offline Demo provider. It retains an existing disconnected provider, blocks a
new unavailable selection, and keeps unsaved edits mounted while the owner
visits global Settings. Model text is retained and must be reviewed on a switch;
the browser confirms the potential history disclosure before its profile save.
The service still accepts supported configurations without requiring a saved
connection, so direct edits and other clients can configure an agent before
connecting. The editor does not run inference or verify provider access.

## Shared provider choice ownership

Agent files own remembered provider pairs; the active top-level pair is folded
into that history on reads and revision-checked service writes. The composer,
agent settings and terminal use the same selection operation. Existing captured
response profiles remain unchanged by later selections. Global nonsecret defaults
use atomic JSON replacement and content revisions beside the agent directories.
They seed first selections, never live inheritance. Creation still copies its
creation defaults when provider is omitted. An explicitly chosen provider uses
its own defaults instead of inheriting another provider’s reasoning. Authored
provider-choice layouts that cannot be edited safely cause a conflict without
changing the files.

Explicit metadata discovery supports unsaved providers and creation. The service
retains catalog metadata from both provider and agent discovery for advertised
defaults and reasoning reset;
it does not discover or generate during a selection save. Missing reasoning
metadata remains unknown. Synthetic service and served-browser checks cover
these flows; they do not establish live provider readiness or Docker behavior.

Workspace notifications use reusable dismissible toast components at the top of
the page. Information and success expire after six seconds of unpaused display;
pointer hover and focus within the toast pause the countdown and progress bar.
Errors persist until dismissed, while correction and retry context stays inline.
Sign-in transitions replace the previous attempt notice and clear terminal URLs;
local saved credentials still do not establish provider or model access.

### Inline main-chat execution

The workspace reads service-owned command progress and persisted tool records through `/api/bots/{id}/chat-work`; it associates records and exact pending approvals with the command user message. Snapshot replacement avoids duplicate delivery. Tool outcomes remain stored independently of later provider success or failure. Database version 30 adds bounded result detail to command runtime events after a protected migration backup. The CLI summary contract remains unchanged. Ordinary chat no longer receives the background-task creation adapter; unsolicited calls fail without starting work. The task engine and explicit API/CLI remain intact. Synthetic checks do not prove live provider behavior.

### Shared agent images

The shared agent-image contract owns the catalog, palette, descriptor validation,
rounded regular polygon rendering, and configuration encoding. Both the server
and Vue use it. The descriptor is a top-level `image` string in the authoritative
agent configuration; it is not a browser appearance preference. Omitting it preserves
legacy initials, and profile edits from older clients retain the saved choice.

The image asset store accepts only bounded, normalized PNG crops during Create
or Save. It decodes them, discards ancillary source content by re-encoding, and
writes private immutable assets under the backed-up agents directory before the
configuration can reference them. Existing configuration revision checks and
retry-safe creation identity include image choices. There is no separate upload
session that can publish an image before the form is saved. Completed assets
are retained for history and uncertain-save recovery; temporary files are
cleaned separately.

One Vue renderer supplies the existing badges. Uploaded images use authenticated
fetch and revocable Blob URLs, with initials on load failure. A shared chooser
owns local crop previews, independent shape/color selection, and keyboard crop
sliders. Normal state refresh delivers saved descriptors to other clients;
unchanged asset identities do not recreate image URLs on every poll. No image
metadata or bytes are added to model prompts. See the
[image reference](reference.md#agent-image-configuration-and-api) for limits and
transport details, and [usage](usage.md#agent-images) for owner controls.


The configuration slice for basic tools stores `toolMode` in agent TOML and
captures it in accepted chat and task profiles. `src/tool-mode.ts` owns the
shared type and boundary parser. Database version 31 adds the creation default
with the existing backup and migration process. Database version 32 adds accepted-work folder bindings and action-service records
through the protected migration process. `src/work-actions.ts` coordinates
registered actions and uses the existing action journal. The internal clock
registration uses the existing clock authority callback. See the
[accepted-work action service reference](work-actions.md) for its callable API.
Ordinary `runTurn` opens the captured command or actual task attempt and sends direct clock, memory, configured search, file and native process calls and QuickJS child calls through the same registrations. `src/memory-actions.ts` binds agent scope to captured work and calls the existing store and proposal workflow; store updates and deletes enforce versions at the atomic effect. Version 35 protects upgrades from either version 34 predecessor and creates any missing native-process or search-binding tables. Version 33 retains source,
source hash, execution outcome and selected results; child linkage joins the
existing invocation journal, which remains authoritative if a guest disappears.
The provider receives the eligible guest definitions as a catalog, and child
calls publish their registered names and outcomes through command progress.
On restart a running guest is marked interrupted and is not rerun. Ordinary
script errors create a recovery epoch and return the manifest to the same
provider loop. Task controls use the executing attempt, helper mode and existing restrictions; pending owner input defers new actions until the inbox is drained. Web, scratch and skill adapters remain later slices for Code Mode. The worker's
QuickJS limits do not establish OS/container isolation or a total host RSS cap.

### Registered host files

The host file capability registration supplies read, write, exact-match edit and bounded search to the existing work-action coordinator. Both chat calling styles use the accepted working directory and the same invocation identity and journal. Hash checks run within the edit effect so a completed-action resume returns its recorded result. An external writer may still race the check and the filesystem write; Staf does not claim atomic compare-and-swap. Effects with unknown outcomes remain uncertain rather than being automatically retried. File data uses service-account filesystem access, not QuickJS isolation.

### Native process slice

`NativeProcesses` owns host child handles independently of the guest worker.
The native capability rejects redaction-altered command and working-path input
before journal preparation. Each output stream has a byte-preserving credential
filter ahead of SQLite retention, so text and base64 cannot expose different
versions. The filter retains unfinished prefixes across observations and flushes
them on closure or lost observation; it does not decode arbitrary binary as UTF-8.
The coordinator supplies the immutable action ID and fingerprint to capability
`authorize` and `execute` callbacks; existing two-argument callbacks remain
valid. The manager records `starting` and accepted-work ownership before spawn,
retains bounded pipe output, records the shell exit status when observed, and reports the resource exited after the backend closes.
Work Stop requests process termination while the work remains active. Service
shutdown requests termination and records an unobserved result as unknown;
startup marks previously live observations unknown without replay or PID-based
reattachment. The current pipe backend starts the shell under a Node supervisor that remains
its process-group leader. After the shell exits, the supervisor waits for its
pipes to close and uses `/bin/ps` to observe that no non-zombie group members
remain. It accepts termination requests over its live IPC connection and signals
its own group, so the service never signals a stored process-group number. A
failed process listing retains the handle rather than claiming completion. The
record can show the shell's observed exit status while the resource is still
running or stopping. If the supervisor or observation is lost, the resource is
unknown. Descendants that change group or detach may survive and are not covered
by group observation or Stop. SIGKILL escalation can lose the supervisor's final
observation and is reported as unknown rather than proof of termination.

`startBackend(work, action, {cwd, mode, backend})` records ownership before
calling `ProcessBackend.launch(cwd, observers)`. Backends return a
`ProcessHandle` for termination and detachment and deliver asynchronous started,
output, failed, exited, closed and lost observations, including a combined
`terminal` stream. The manager retains live handles through `handle(id)` and
owns output, Stop, shutdown and restart accounting. Issue 85 can extend that
handle for serialized input, EOF and resize, and register a PTY backend through
the same manager. It must also separate actual work lifetime cancellation from
guest admission cancellation for intentionally retained processes. Those
interactions and retained workflows remain unimplemented.
