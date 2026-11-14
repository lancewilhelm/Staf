# Staf runtime and provider boundary

The local development launcher runs Vite and the shared instance as separate
processes. Vite serves the workspace and forwards same-origin service requests
to the loopback backend; source changes rebuild and restart that backend. The
service remains authoritative for connections and shared data. See the
[development workflow](development.md#run-the-development-workspace).

Development reset builds the seed through `Instance` in a separate directory.
The launcher and maintenance commands share a data-directory owner port, and
maintenance also takes the SQLite exclusive lock. Before publishing a database
and file replacement, maintenance saves the database, agents, and core revision
tree and writes a durable marker.
Instance startup checks that marker before initialization and again after taking
the database lock. Maintenance fences the original and replacement SQLite files
with an unsupported schema version until the database, agent files, and core tree are durable,
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
and the generic live adapter use Chat Completions. ChatGPT and OpenRouter stream provisional text through the shared service; LM Studio and the generic live adapter buffer provider output. Only completed provider responses are committed as completed replies; stopped partial output is labeled separately. The terminal displays provisional text, command status and persisted tool progress. The service applies permissions and approval
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
automatic metadata discovery, manual model entry, reasoning and conflict recovery. Discovery results never save a choice. Concurrent catalog requests cannot replace newer metadata with an older response, and a failed refresh clears metadata used for later selection decisions. Creation uses the same fields and layout as agent settings. Editor drafts stay in
the browser tab across navigation, including their original profile revisions.
Explicit Cancel discards unsaved edits; creation operation recovery remains in
the controller.
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
legacy cleanup is safe. Earlier records without a dataset identity migrate only
when a stored command or creation operation establishes their origin. Otherwise,
Settings offers Copy and confirmed Discard for each record. Discard takes the
record's Web Lock and compares its saved value and dataset again before removal.
It leaves changed records, records owned by another tab, and scoped journals in
place. Clearing browser storage removes the journal.
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
service runs ChatGPT, OpenRouter, LM Studio and live with instance or host credentials and an explicit bot model. This preview does not implement the LAN,
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

The shared core override lives at `core/current/core.md` beside the instance
database. The `current` link selects a revision directory. An absent file uses
the built-in core; an empty file is an intentional override. Direct edits are
validated when read. Publication fsyncs a new revision and switches the link.
Staf checks retired revisions for late edits and blocks acceptance for owner
reconciliation. Direct writes can overwrite changes that Staf never observed.
Accepted chat and task profiles capture the effective core separately from the
agent soul. Retries preserve their predecessor's profile. Existing profiles
without a captured core use the earlier clock instruction. Tool definitions,
context, permissions, approval checks, and cancellation remain service-owned.
For an ordinary tool failure or explicit denial, the runtime records a matching
result and can ask the provider to continue. Denial closes action admission,
including for a Code Mode guest; a later provider step cannot reopen it. Stop,
fatal guest errors and provider errors retain their termination behavior.
Live authority failures close admission and can terminate the turn. A completed reply is persisted only after the
provider returns it. Scripted service and browser checks cover these paths;
they do not reproduce the owner's reported greeting or establish model behavior.
The Advanced Settings editor uses the paired core API and retains its draft
across workspace navigation. A failed or uncertain save requires a fresh read
before retry. Cache-impact feedback compares committed request-relevant settings:
core and soul text, tool mode, provider, and provider-supported model or reasoning
fields. The direct adapter's local key covers model, instructions, and sorted
tools, while reasoning changes the request separately. Neither a local key nor a
changed prefix establishes provider cache use. Controlled-provider and scripted
browser tests cover construction and feedback, not model behavior or cache reuse.

Discovery uses names and owner-edited descriptions. Each accepted command and
task captures its settings and instructions. The private execution session retains tool history, usage and
model-bound replay separately from visible chat. Permissions and revocations
remain service-controlled. Live provider execution remains unverified.
The shared chat-completions adapter passes caller cancellation and its timeout
to the HTTP transport.

The background-task preview stores tasks, linked attempts, captured profiles and context, ordered Activity, and private sessions in SQLite. A partial unique index enforces one queued, running, or stopping attempt per bot. Startup marks unfinished attempts interrupted. Stop intent is saved before requesting transport cancellation; observed terminal output and usage can still arrive. Clock permissions and approval modes are implemented. Explicit task inputs are stored in an ordered inbox and incorporated at provider boundaries; completion and input acceptance are serialized. Structured `ask_owner` and `ask_questions` calls wait for an answer without consuming the execution timer. Main chat does not implicitly direct a task. Explicit replacement is captured while waiting and becomes queued in the same transaction that records the original attempt settling. The shared chat snapshot places task attempts at their existing acceptance notices, with unanchored older attempts shown separately. It exposes the service-owned state and activity; the workspace can request Stop and decide task approvals. The workspace shows and resolves task question sets. Stop settles as stopped even if the provider returns text later; observed text and usage remain evidence. Explicit task API/CLI operations remain available. Offline tests do not establish live provider behavior.


### Shared-instance skills

Database version 8 adds the immutable skill catalog, per-bot availability, task catalog snapshots and command load evidence in the migration transaction after a protected backup. Configured credential values are redacted from new catalog records before storage and from existing records on read; catalog digests identify the original submitted bytes. Load evidence labels that value `sourceDigest` and records `loadedContentDigest` for the exact redacted UTF-8 body in the tool result. Older records do not contain the latter. Earlier database records and backups are not rewritten. The runtime offers at most 32 metadata records to tool-capable providers. A structured selection validates the captured ID and revision and current availability before returning untrusted text as a tool result. The task Activity and command status record successful loads. Availability is rechecked before later provider calls and actions. Clock authorization remains independent. Prior direct skill results and code results linked to actual skill child actions are replaced in the next turn's provider request; stored history, backups and already-sent provider data are not erased. Synthetic provider tests do not establish live model selection or resistance to prompt injection.

### Instance tool availability

Schema 41 stores revision-checked instance switches for clock, memory, web
research and files. The shared action coordinator filters offers and rechecks
availability at the same action boundaries used by direct and guest calls.
Availability is independent of permissions, task scopes, configuration, and
approvals. Web disable aborts active web/search controllers; it cannot reverse
an already dispatched request. Memory disable also suppresses automatic recall,
while owner inspection and retained records remain available. Native terminal
capabilities are not governed by the file switch. Existing instances gain the
enabled availability defaults without changing their existing permissions.
Controlled-provider tests exercise these boundaries; they do not establish live
provider or network behavior.

### Shared-instance memory

The browser exposes read-only agent and shared user memory through the existing
authenticated scoped list APIs. It validates each response against the requested
audience and paginates the complete snapshot locally in groups of 20. Leaving a
memory page aborts its request; later responses cannot repopulate another page.
Pairing loss unmounts settings and memory views. Archived agents remain
inspectable without restoration. Saved-entry lists are read-only; the agent memory page also resolves sensitive proposals.


Version 6 adds scoped memory in the instance database transaction after a protected migration backup. The store enforces bot and user scopes and optimistic versions. Provider calls receive bounded keyword-matched memories as untrusted request-only data. The session retains ordinary messages rather than the injected memory. Main-chat owner phrases and registered model actions can change agent memory or existing shared entries. Model saves and updates pass sensitivity rules; sensitive or uncertain changes require owner review. Shared creation by a model still requires separate shared-memory confirmation. Version 7 adds durable, bot-bound shared-memory proposals. A separate explicit owner confirmation atomically saves the proposed text once, and cancellation clears the pending proposal text without creating memory. The original text and proposal response remain in chat history and may be sent in future model requests or task context; cancellation does not erase backups or already-sent data. This is an offline-tested preview and not a general intent interpreter.

Schema 43 combines Slack work with revision-checked sensitivity rules and pending model-memory proposals. The default allows a model-classified ordinary change unless it matches an owner-defined sensitive term; missing and uncertain classifications require review, and review-all removes reliance on that classification for automatic saves. Model judgments and substring matching can miss sensitivity. A pending proposal contains the exact text in a separate instance table, with an instance-keyed fingerprint binding the agent, scope, target version and text. Paired owners decide it atomically; disabling memory or archiving its agent denies pending proposals and cancels their pending shared confirmations. Shared creation still needs the existing shared confirmation, which rechecks the approved text and current authority. New memory write invocations use keyed input fingerprints rather than durable plaintext input; older records are not rewritten, while existing action recovery checks current memory against that fingerprint. These protections do not erase or suppress conversation, provider, runtime event, Code Mode source or backup disclosures.

### Shared-instance clock dispatch

The service gates a validated clock action before dispatch. It evaluates the instance and bot permissions and task boundary using the current effective mode; an exact, one-action request is persisted before an in-process wait. Paired-client decisions resume that waiter, which rechecks current permissions before dispatch. Stop or restart interrupts the request; it does not replay provider work automatically. Task approval wait is excluded from the execution timer. Provider observations are saved before the wait. These mode settings apply to the shared-instance clock. Delegated clock actions also intersect both bots and the task scope. Reusable grants are not implemented.

## Recurring schedule preview

The version 9 instance migration creates schedule and occurrence tables after a protected backup. Version 10 binds retries to their schedule origin. Version 11 backfills historical task descendants after a protected backup. A tick reserves the occurrence, advances the cursor and creates the linked ordinary task in one SQLite transaction. Provider dispatch occurs after commit. Existing active tasks block new scheduled work. On startup, unfinished claims become uncertain rather than being dispatched again. The owner can inspect and mark an uncertain occurrence reviewed; a retry remains explicit. Clock use rechecks the structured schedule authorization and live approval policy. Version 22 adds an exact web URL scope copied into each occurrence and retry, plus a durable one-dispatch-per-occurrence ledger. A scheduled web read always requires its own owner approval, current instance and bot permission, and the task scope; an explicit task disable carries to retries. Schedule revocation aborts active web work. Redirects outside the exact URL are rejected, and the dispatch cap prevents a second hop. Version 23 similarly captures a literal search query and configured backend snapshot for a separately approved, one-dispatch occurrence; retries retain the same scope and task restrictions. A changed backend blocks dispatch, and schedule revocation aborts pending or in-flight searches. Version 24 captures an exact scratch command and Docker configuration, requires a separate owner decision, and reserves one occurrence-wide dispatch with the existing global shell lock. Retry retains the scope and explicit task disable; the uncertain-action review gate still blocks subsequent shell work. Host workspaces remain unavailable. The service loop runs only while the instance is running. The recurrence and catch-up choices are provisional and are described in [usage](usage.md#recurring-schedules-preview). This preview does not implement machine scheduling or general action grants.

The collaboration runtime journals actual bot messages and separate helper attempts. The owner approves each exact message before disclosure. A helper receives only the assignment brief as task context and does not retrieve private memory. Parent stop cancels its helper, and late output remains in helper Activity. Restart interrupts unfinished attempts. Offline synthetic-provider tests cover these paths; live provider behavior remains unverified.

Shared-instance ChatGPT sign-in owns a short-lived in-memory attempt bound to its initiating paired client and the service loopback callback. The credential adapter checks that client remains authorized at the locked credential commit boundary. Callback parameters are not returned in the response. The browser reserves a tab synchronously from the connection action and navigates it after asynchronous authorization setup. A blocked tab leaves a manual link for the same attempt. The browser keeps the sign-in URL only for the attempt that produced it and offers cancellation and retry if it is lost or the attempt fails. Paired CLI and GUI sign-out use the same guarded service operation. Credential status is local and does not verify account or model access. This integration has synthetic service, CLI, and served-browser tests and has not been verified with live authorization.

The shared main-chat runtime may request one background task per command through a host-controlled tool. A durable journal binds the command, tool call, objective, and task attempt, so duplicate submissions do not start duplicate work. Explicit main-chat task direction and stop use the attempt ID and do not expand permissions. New bots copy the instance provider, model, and reasoning creation defaults in the creation transaction; later default changes leave existing real-provider bots unchanged and migrate any remaining Demo bots. These paths have offline synthetic coverage; live provider behavior remains unverified.

Public web reads use a per-hop action broker. The action journal records generic summaries and keyed fingerprints; an authenticated owner sees the exact pending hop in memory and approves or denies it before DNS. Current permissions are checked again before dispatch, and permission revocation or task stop aborts the operation. The read path pins a validated public IPv4 address, validates each redirect, and bounds the returned untrusted text. Started actions become uncertain on restart and are not automatically replayed. Conversation and provider replay retention remains separate from the generic action journal; unknown secrets in source text cannot be reliably detected. The integration has synthetic coverage only.

The search tool sends only an approved literal query to the owner-configured loopback origin. The model cannot select the backend. Search uses a separate permission boundary and a keyed action journal, checks current configuration and permissions before dispatch, and aborts affected requests on revocation or task stop. It limits a single instance process to two concurrent dispatches and limits its database to ten per rolling minute, with rate history in the instance database. Separate instance processes do not share a concurrency limit. Search previews are untrusted, and result URLs are not fetched automatically. Queries can be retained by the selected service, its upstreams and the provider/session history. For chat and tasks the shared action service captures the backend, revision and query in a durable action binding and rechecks that binding and any claimed grant before start and result release. Task approvals pause the corresponding attempt timer. Synthetic tests include the production HTTP transport against a disposable loopback server; live SearXNG and provider behavior remain unverified.

Scratch shell uses only an owner-configured Docker CLI, daemon socket and pinned image, and always supplies a fixed bounded tmpfs workspace without an explicit host bind. A keyed action identity and exact-command owner decision precede daemon work. A durable lock and unresolved-action gate serialize execution; started work is marked uncertain on restart. The recorded endpoint configuration is retained for manual inspection. The owner must independently verify daemon identity because matching paths do not prove that the binary or socket still identifies the same daemon. Explicit owner review acknowledges that an absent observation cannot rule out a late create; it neither retries nor removes the old action. The CLI process and daemon can observe the command, tmpfs can use swap, and unknown output secrets can be retained. Integration tests use a synthetic executor. The hardened Linux container boundary has not been verified against a Linux daemon or kernel.

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
and OpenRouter presence statuses to offer configured shared connections. It retains an existing disconnected provider, blocks a
new unavailable selection, and keeps unsaved edits mounted while the owner
visits global Settings. The editor stages the chosen provider and model; the browser confirms the
potential history disclosure before its profile save.
The service still accepts supported configurations without requiring a saved
connection, so direct edits and other clients can configure an agent before
connecting. The editor does not run inference or verify provider access.

## Shared provider choice ownership

Agent files own remembered provider pairs; the active top-level pair is folded
into that history on reads and revision-checked service writes. The composer and terminal use the selection operation. Agent settings submits
the staged fields together through the revision-checked profile operation. Existing captured
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

The workspace reads service-owned command progress and persisted tool records through `/api/bots/{id}/chat-work`; it associates records and exact pending approvals with the command user message. Snapshot replacement avoids duplicate delivery. Tool outcomes remain stored independently of later provider success or failure. Database version 30 adds bounded result detail to command runtime events after a protected migration backup. Version 38 adds service-generated call identities and redacted bounded arguments to new events; older events remain unpaired. The GUI uses each identity to update one tool row and keeps the response container keyed by command through streaming and final persistence. The CLI summary contract remains unchanged. Ordinary chat no longer receives the background-task creation adapter; unsolicited calls fail without starting work. The task engine and explicit API/CLI remain intact. Synthetic checks do not prove live provider behavior.

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
Ordinary `runTurn` opens the captured command or actual task attempt and sends direct clock, memory, configured search, web, scratch, skill selection, file and native process calls and QuickJS child calls through the same registrations. `src/memory-actions.ts` binds agent scope to captured work and calls the existing store and proposal workflow; store updates and deletes enforce versions at the atomic effect. Version 35 protects upgrades from either version 34 predecessor and creates any missing native-process or search-binding tables. Version 33 retains source,
source hash, execution outcome and selected results; child linkage joins the
existing invocation journal, which remains authoritative if a guest disappears.
The provider receives the eligible guest definitions as a catalog, and child
calls publish their registered names and outcomes through command progress.
On restart a running guest is marked interrupted and is not rerun. Ordinary
script errors create a recovery epoch and return the manifest to the same
provider loop. Task controls use the executing attempt, helper mode and existing restrictions; pending owner input defers new actions until the inbox is drained. Web redirect hops use internal child actions under the same coordinator; each hop checks its exact URL and grant, and the parent checks all hop bindings before result release. Scratch binds the exact command and Docker configuration to its coordinator action and retains its separate reservation and review rules. The worker's
QuickJS limits do not establish OS/container isolation or a total host RSS cap.

### Registered skill selection

The service installs a tracker keyed by the actual command or task attempt while work runs. The shared registration loads exact captured revisions from the skill store and records evidence only after a load. It checks live availability before releasing cached results and before later child actions start. Completed recovery adopts the existing selection without recording another load. Replay scrubbing uses the saved execution and action linkage, while persisted history and native reasoning replay remain intact. The worker can receive a skill through its bounded cache; selected output keeps the normal output limit.

### Registered host files

Agent host file and native process actions reject input unless the owner has
selected the experimental Linux boundary and its policy checks pass. The fixed
launcher supplies pipe, PTY and file work, including write reconciliation;
unsupported and failed configurations never fall back to service-account host
execution. The launcher requests private namespaces, and the guard checks the
mount layout and capabilities and applies Landlock and seccomp before delivery.
File and terminal paths share the `/workspace` namespace. A scratch container
rejected before start is removed; failed removal remains uncertain for review.
Neither this path nor the separate Docker scratch boundary has been verified on
Linux. See [credential isolation](credential-isolation.md) for prerequisites,
trust assumptions and remaining tests. Helpers and scheduled tasks retain their
existing restrictions. Detached processes started before this gate and unrelated
same-user software are outside it.

Concurrent workspace writers can still race an edit: the hash check is not an
atomic filesystem compare-and-swap.

### Secret requests

The registered request action accepts descriptive metadata only. A separate
paired-client endpoint sends a value directly to the service, outside generic
action arguments and results. A separate SQLite database under the data directory
stores named values in plaintext and request metadata; the main action journal
contains the nonsecret request and outcome. Protected question-set steps bind their question and step to a specific named secret revision in that separate store. Ordinary draft inputs cannot contain a value for a secret step. The submitted result reports only its status; selection or saving does not authorize use. The store restores pending requests
as interrupted, and work is not replayed. Paired-client and work authority are
checked before a save or selection. Settings can add a value or confirm a
replacement or deletion using the current opaque revision. Metadata for existing
stores is added when the store opens. The secret database also stores grants bound
to the named secret revision, registered plugin role, and exact provider and
account or conversation destination. Each destination has a durable version even
when no grant exists. Decisions compare the reviewed version and prior grant in
the same transaction as the update. Replacement and deletion remove the grants
and advance their versions in the same transaction. Plugin setup reviews existing
grants, requires confirmation to replace them, and checks for changes before
connection. Gmail and Slack recheck grants at use alongside their
existing connection and agent permissions. Owner confirmation is required for
setup and grant changes. Interrupted and in-flight external requests are not
automatically replayed. Known saved values join the existing output filter, which remains a
secondary safeguard rather than isolation. The shared action coordinator filters
known values from result strings, keys, visible outcomes, and retained change
results before release to callers or normal records. The paired browser checks
recognizable formats locally before chat and question submission; flagged
question text is omitted from draft saves. Unknown and transformed values may
escape filtering. Older records and backups are not erased; an unsafe historical
encoded tool result is omitted when its conversation is next replayed and saved.
Incoming Slack messages matching recognized credential patterns or known values
are rejected before work or model dispatch, with only a generic notice retained.
This cannot remove the message from Slack or detect every credential.

The `setup_slack` work action captures only Slack IDs. Two separate protected
requests bind saved or selected secret names to their exact revisions. A durable
review presents the agent, destination, existing connection and current Slack
grants; replacing any grants requires a separate explicit confirmation. The
service checks the paired client, originating work, agent and connection
revisions, secret selections, and durable grant-review version before Slack
identification and again after it returns. Direct Gmail and Slack reconnects
attach the secret database to the instance database and commit configuration,
credentials and grant versions in one SQLite transaction. The service requires
rollback journals and full synchronous writes for both persistent databases;
unsupported journal settings reject the transition. A definite rollback retains
the previous configuration and grant versions. An ambiguous transaction stops
work and requires a restart and review. SQLite's cross-database crash atomicity
depends on its VFS, filesystem and storage honoring its durability assumptions;
process-interruption fixtures do not establish power-loss behavior.

Guided Slack setup commits its selected grants and binding with a durable pending
marker in the same transaction. Until setup completes, credential use is fenced
outside its initial socket attempt. A restart never resumes a marked setup: a
paired owner must keep Slack disabled and review the saved binding and approvals.
The recovery operation disables the plugin before clearing the marker, so it can
be repeated after interruption. The approval and marker are completed together;
the originating work is not replayed. The activation also retains its originating
work identity. On restart, an enabled guided connection whose work did not finish
is fenced for owner review even if its approval had already completed. A direct
reconnect replaces that origin in the same transaction. When upgrading a secret
store without transition tracking, an older setup recorded as connecting is
fenced during the same transaction that adds the tracking tables; the latest
completed guided setup is retained as a conservative origin for the startup
work check. A restart leaves an
unfinished review interrupted. Before delivery, including after restart, Staf
checks the workspace and compares the selected DM with Slack's response for the
selected user via `conversations.open` with `prevent_creation` and the `im:write`
bot scope. Socket startup succeeds only after the WebSocket opens; status belongs
to the verified generation and binding. The action journal must succeed before
delivery is released.
These paths use synthetic Slack and model fixtures, not live account verification.

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
reattachment. Both backends start the shell under a Node supervisor that remains
its process-group leader. After the shell exits, the supervisor waits for its
pipes to close and uses `/bin/ps` to observe that no non-zombie group members
remain. It accepts termination requests over live IPC (a private Unix socket for the PTY) and signals
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
owns output, Stop, shutdown and restart accounting. Handles also implement input,
EOF and optional PTY resize. `native-pty.ts` uses pinned node-pty with byte output,
a live supervisor and a private control socket; it never signals a stored group ID.
Both launch paths remove the supported credential environment variable names
before starting the supervisor. This limits direct inheritance, but the
supervisor and agent commands still run with the service account's host access;
it is not an isolation boundary for credential files or process inspection.
Interactions share a bounded per-process queue. Pipe writes await backpressure;
PTY submission has a cumulative byte budget because node-pty exposes no write
receipt or drain callback. A submitted receipt does not prove application consumption.

`WorkContext.signal` fences action admission; `workSignal` is the original accepted
work cancellation signal. The process lifetime listens to the latter, so closing a
guest does not kill a retained process. Work completion stops nonretained processes;
actual Stop, expiry, agent archive and shutdown request termination as applicable.
Later work checks the recorded owning agent, not the selected chat pointer.

The coordinator retains read receipts only in work-scoped memory, clearing them
when the last work handle is released; only changing-action receipts remain in
private SQLite results. Guest/internal read records keep completion metadata,
while selected output and ordinary provider history retain their existing
lifecycle. Random-access file reads include a credential-length byte overlap
when checking known secrets, so page boundaries cannot expose credential pieces. A bounded token lookback also checks pattern-recognized credentials; an unestablished boundary rejects the read.

Paired owner reconciliation uses the active command/task controller and its
immutable context. Feature hooks verify actual settled process observations,
file-write bytes or scoped memory state before recording a resolution and a new
recovery epoch. Task retries can resolve eligible predecessor actions. Original
outcomes remain unchanged, closed work stays closed, and a matching resolved
uncertain change still requires a repeat challenge. There is no generic force
resolution or model reconciliation tool. Capability-defined action equivalence
is used for both new recovery challenges and challenge refresh. See [the
contract](work-actions.md).

## Creation defaults and Demo migration

Demo is not selectable or executable. Before a real default is chosen, legacy Demo agents and their records remain in place and need setup. Database version 37 records pending Demo migration separately from the saved creation default. The service commits the selected provider and model before publishing revision-checked agent files. It retries pending migration on restart and when clients read or save defaults. It reports file conflicts and blocks acceptance for affected legacy agents until their configuration is repaired. Invalid files do not block healthy agents. Already-real agents are skipped on retry. Conversation records and accepted-work profiles are not rewritten. These checks use disposable offline instances and do not establish live provider behavior.

## Ordered chat messages and tool calls

Schema 39 adds `assistant_message` boundaries to the command event journal.
A validated intermediate provider message is retained before its tool calls,
separately from the current streaming text. Response snapshots carry the ordered
events, so live updates and history use the same boundaries. The GUI groups each
run of tools before the next agent name and message. Request and result updates
keep their call identity. Stop, failure, and restart retain observed messages;
legacy records without boundaries keep their prior grouping. The CLI tool-event
summary excludes message boundaries.

The built-in core describes general assistant behavior without naming tools.
Capability definitions and service enforcement remain separate. Custom and empty
core overrides keep their existing upgrade and reset behavior.


## Question requests

A journaled `ask_questions` action creates a durable request keyed by its
service-owned action identity and bound to the originating command. The action
returns immediately so the original turn can finish and the owner can continue
chatting. Drafts and the submitted or dismissed outcome live in the instance
database. A service-owned continuation ID is reserved at creation; a queued outcome
is claimed as a new command only after the original command completed. A crash
after claim leaves that command interrupted rather than automatically replaying
it. An interrupted or failed origin retains the request and outcome without
starting a continuation. A submitted answer starts a new command with its own
action journal, current tool settings, and normal approval checks. The journal
checks actions in the question request's command lineage before dispatch. It
blocks matching prior actions and fences unresolved or opaque effects. File
action comparisons resolve path aliases. Arbitrary commands can have equivalent
effects that the service cannot infer from their text. A dismissal continuation
has no tool offers. Structured sets are not offered to Slack-originated
commands, which retain ordinary conversational questions and answers.

Question drafts carry a content revision. Saves and resolutions compare the client revision with the current draft before changing state, so a stale client must reconcile its local answers with the saved draft. Task question sets are bound to an attempt and retained independently of chat continuations. The action waits for its outcome while the task timer is paused. Other work can proceed, but further actions in that task are deferred. The service checks task authority before accepting an active answer and before returning it to the model. Restart interrupts the attempt and leaves the request and draft for review. A new owner-initiated attempt binds resolved question IDs to the predecessor, retains the original objective and action lineage, and supplies results separately at provider dispatch. It checks current work authority at every provider dispatch and checks for prior or uncertain effects. Scheduled retries retain the occurrence and require its review and current authority. Gmail-private or Gmail-scoped task lineages cannot be retried or replaced; the owner starts fresh authorized Gmail work. Background questions and their answers do not enter automatic Slack updates. After a task or helper uses questions, Slack receives the outcome state. The owner can review and edit the exact outcome text in Staf before authorizing a separate delivery to the original thread. The service binds that approval to the current Slack destination and agent revision, rejects recognizable direct matches with questions or answers, and rechecks authority at dispatch. The match check cannot establish that paraphrases or encoded details are safe. Uncertain sends are not replayed. Gmail-private task outcomes also require current Gmail task authority; Gmail clarifications and action approvals remain separate. Tests use synthetic providers and disposable data.

## Bundled plugins and Slack

Bundled plugin definitions describe identity, configuration, lifecycle, tools,
events and account identity without a marketplace. The instance database stores
connection configuration, per-agent access and a durable account/event ledger.
Slack's Socket Mode transport admits only the configured workspace, user and DM.
It submits a normal service-owned command with the captured agent identity; the
existing work/action boundary still governs capabilities. Agent access and plugin
state are checked again for actions and before reply dispatch. A dispatch is
marked before the Slack API call so a crash or ambiguous response is not replayed.
For an approved Slack command, the model can invoke service-owned, journaled
task capabilities in the agent’s configured tool mode. Starting work captures
the owner’s original message and atomically binds the task attempt to its Slack
thread. Follow-up capabilities use that thread’s unique binding, never a
model-selected task ID; missing or ambiguous bindings require clarification. For
older threads with multiple tasks, a selection requires the owner to quote the
full original objective and the service to match it uniquely.
The older explicit `work:` route remains available for diagnostics. A durable delivery ledger derives progress and terminal
outcomes from the task record. It claims a dispatch before the external call,
retries a known rate limit, and marks ambiguous in-flight dispatches uncertain.
Current plugin access and the exact captured destination are checked before each
send. Disable pauses delivery but does not cancel accepted background tasks.
A restart interrupts unfinished tasks rather than replaying their effects.
Tokens live in the separate managed secret store. A reconnecting socket
can miss events during an outage; this slice has no Slack history backfill.
These paths are exercised with controlled providers, not live Slack.

Gmail uses the same account-keyed connection and agent-access tables. A paired
client starts an in-memory desktop OAuth attempt with PKCE and a loopback
callback; the service exchanges the code, verifies the Gmail profile identity,
and saves the client secret and refresh token as separate managed secrets with
destination-scoped approvals. Guided setup uses a service-defined mixed question
set and resolves its saved secret by revision. A paired owner reviews the exact
account, scopes, selected secret, destination, prior client and refresh grants,
and durable review versions before starting. A connected account with unavailable
managed credentials can be reconnected only to the same account; the reviewed
connection snapshot prevents a stale review from replacing a later connection.
Agent and model permissions are retained. Protected
secret changes require the captured agent revision, and stale requests require a
new setup. The service records an observed authorization success in the same
instance transaction as the plugin connection. Revocation or a later failed
attempt cannot erase that evidence. It records credential availability for the
current account at resolution. For each relevant provider call it computes a
fresh status in a transient message copy, after provider initialization and any
adapter preflight. At dispatch, built-in adapters refresh the messages and check
the complete model-bound payload against the current secret redactor. If a new
secret would change it, the call fails before sending. The check includes
instructions, tool schemas, model settings, and replay. Structured file and
terminal results are decoded and checked again before replay and session writes.
The credential store advances a durable generation on secret mutations; an
in-flight turn with encoded file or process output is fenced if that generation
changes before release. Terminal capture stops retaining new bytes after a change
and reports incomplete output. Historical structured output is rechecked against
current known values, including partial pages and interleaved process streams;
unsafe or unverifiable tool results are omitted from later replay and session
saves without removing unrelated conversation text. Structured bytes are checked
before text redaction can obscure their encoding tag; a new result is withheld
if redaction would make that tag unverifiable. Code Mode records an authenticated
proof bound to the exact guest result and whether it received file or terminal
bytes. Because a guest can return raw base64 without the original
encoding tag, historical guest results with such receipts, or without valid
provenance, are omitted from replay and new session/event saves. Other verified
guest results remain available. This also applies to records made before the
proof was introduced; the surrounding conversation is retained. Earlier durable records and
backups are not erased. The checks do not establish safety for every transformed
or unattributed fragment, including arbitrary scratch output. They do not prove
a platform isolation boundary. At preparation, tool
descriptions are redacted; an offer is omitted if its identity or schema keys
contain a known secret. Stored checkpoints are redacted again before writing; reasoning replay that cannot be retained safely
causes the write to fail. A later revocation or newly recognized secret cannot
recall input already sent to a provider.

Injected provider adapters are trusted code. An adapter must call
`refreshMessages` after any asynchronous preparation, immediately before each
model dispatch, and use its returned messages. It must then pass the complete
model-bound payload to `assertSafePayload` immediately before sending. It must
not cache earlier messages, input, instructions, or tool definitions for a
later dispatch. Staf cannot enforce these calls inside a noncompliant adapter.

A task that captures a Gmail setup continuation, its assistant reply, or a
related task outcome also receives current status. The instance records those
message identities and marks captured task snapshots for that agent. Chat turns
carry a service-signed identity bound to their stored message. These records
survive retries and partial context retention. The service never infers identity
from a prefix in user or model text. Legacy snapshots without trustworthy
identity do not acquire provenance from their content. The setup result has its own authenticated span within a turn, separate from
other notices and owner text. The service renews proofs only when it redacts
already authenticated content. If redaction crosses an authenticated result
boundary, the turn fails before provider dispatch instead of losing the result
identity. The service binds a new result only when its exact structured span
remains valid through persistence. A service-signed setup identity with unverifiable content fails closed; an
untrusted or unrelated message does not create provenance; other text is not replaced. Older signed
turns without a result span remain usable when their full content verifies.
Isolated
helpers do not inherit the parent's chat; separately approved helper text does
not grant access to Gmail status.

That status does not verify Google access or agent and model permissions. Older results
whose success was already overwritten cannot be reconstructed. The OAuth attempt
rechecks client, request, agent revision, grant identity and
version, connection revision, and nonsecret fields at dispatch and before commit.
The selected client secret is authorized for the exchange, while prior grants
remain until the selected grant, refresh token, plugin binding and setup result
commit together. A definite rollback retains prior state; an uncertain result
is fenced until restart and review. Startup marks a pending exchange interrupted
and never replays it. Controlled service and Google fixtures do not establish
live Google behavior.
The service fences an in-flight exchange against cancellation, expiry, client
revocation and connection revision changes. The connection-time history ID and
candidate message IDs are stored in SQLite; complete pages and the next cursor
commit atomically. A 404 retains an uncertain gap until the owner explicitly
rebaselines. The scanner reads field-limited current label metadata for new additions and compares
the message's last-modified history ID with the addition record ID. Matching IDs
and an INBOX label provide conservative inbox evidence; missing fields, a changed
ID, or a failed metadata read leave membership uncertain. SENT, DRAFT, SPAM and
TRASH are excluded. This inference does not prove exact historical membership;
uncertain and non-inbox candidates remain visible for review; an owner can explicitly queue an uncertain candidate for private assessment, while non-inbox candidates cannot start
assistant work. Evidence and cursor commit with candidate IDs. Schema 50 adds the
evidence table; legacy candidates remain unknown and legacy pending deliveries
without evidence are marked stale rather than sent. The assistant's initial
checkpoint includes all recorded additions after the connection baseline, and
claimed items cannot be processed again on re-enable. The history scanner itself
does not send mail to a model. Separate per-agent permission binds
read/search to an explicitly approved provider and model, with current
connection revision and access rechecked at dispatch and result release. A separate
owner grant is required for tasks and Slack-originated work, so existing chat-only
approvals do not expand. Paired
tasks capture an exact Gmail query and the account revision at acceptance; they
can read only IDs returned for that attempt. A Slack task can capture the query
through an explicit command. Private work is marked before results are released,
and the work-action service rejects other capabilities after that point except
the scoped Gmail action proposals, even when guest calls were queued earlier. Slack
receives generic notifications for private Gmail work. A proposal first
requires a generic Slack disclosure decision; only then is its exact effect shown
for a separate approval. The proposal binds the action fingerprint, work, agent,
Gmail account and revision, Slack identity and revision, and message. The action
journal claims dispatch after current authority is checked. A revision request
invalidates the earlier proposal and carries the owner's thread reply to the
model. Label, archive, and mark-read changes use the same approval boundary and
an optional Google modify grant. A restarted or ambiguous action is uncertain
and is not replayed; an owner can reconcile it after checking Gmail. Gmail
tool results and generated replies are excluded from subsequent model replay and
captured task context; the owner's request remains. Other tools are fenced for
the rest of that turn. The separately enabled inbox assistant creates an isolated task scoped to one
recorded candidate and captures agent and plugin revisions. The existing Gmail
action boundary performs the read. A validated model assessment queues either
a non-sensitive summary or a fixed generic private question. A Slack thread ID
binds an affirmative owner response to that candidate; uncertain sends are never
automatically repeated. Authority is checked again at evaluation and delivery.
A durable failure state deduplicates generic alerts while individual history
scans remain recorded. An explicit memory-provider opt-in allows retrieval of active memories from the bound agent and user scopes; pending proposals and other agents’ private memory are excluded. Live memory availability and selected versions are checked around provider calls, and any recalled memory forces private clarification before Slack disclosure. Non-sensitive less-urgent summaries are atomically batched for interval-based delivery; an uncertain batch remains inspectable and requires an explicit exact-text owner decision. Bound corrections are retained per item and keyed sender, without storing the sender in the feedback index. All active sensitive corrections are enforced independently of the bounded feedback sent to the model. Explicit failed-assessment retries use current authority and do not replay prior actions; uncertain deliveries remain owner-resolved. Known Slack 429 rejections preserve the full representable retry delay; invalid delays require review. Changes to privacy or sender sensitivity while a send is in flight are reconciled on a definite rejection, with the retry deadline retained for every separated digest member. Ambiguous sends remain uncertain. Schema 51 stores candidate review requests and delivery retry deadlines. Schema 52 separates active sender sensitivity from later corrections, retains new correction events and prior assessment and digest linkage, and makes all members of stale batches reviewable. Earlier overwritten corrections cannot be reconstructed. Model classification can be wrong, and the inbox evidence is an inference rather than a historical guarantee. Synthetic Google, Slack and model fixtures cover these paths; live
behavior remains unverified.

## Native home-network transport

The optional native HTTPS gateway binds a configured private IPv4 address and checks the external Host and Origin before forwarding to the fixed loopback service. TLS ends at the gateway; the service still owns pairing, client revocation, permissions and persistent state. The gateway adds no public owner API and is independent of the loopback CLI and callback. Controlled local tests cover this transport; Linux VM and LAN operation remain unverified. See [native installation](native-linux-installation.md).
