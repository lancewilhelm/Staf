# Use Staf

For the persistent, hot-reloading local browser workspace and a terminal paired
to the same development instance, see [Run the development workspace](development.md#run-the-development-workspace). For a synthetic seed and explicit reset or recovery, see [Reset and recover development data](development.md#reset-and-recover-development-data).

## Start the shared terminal

Build and link the CLI once, then start it from your working directory:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm link --global
staf
```

Use `pnpm start` instead if you do not want a global link. Staf starts a detached
local instance and reconnects to its persistent main bot. The default data
directory is `~/.staf/terminal-instance`, so launches from different directories
reconnect to the same instance. Use `staf --data-dir PATH` to
select another directory. `/quit` closes the terminal and leaves the instance
running. The next launch displays the saved conversation. A stopped instance
starts again when you launch the terminal; unfinished requests are marked
interrupted when the instance restarts.

The initial provider is an offline demo that echoes messages. It is not a
language model. Type `show settings`, `set provider to demo`, `set model to NAME`,
or `set reasoning to LEVEL` to inspect or change the current bot profile. Use
`/help` to see deterministic commands, including approval and status commands.
Other messages go to the selected provider or the instance's existing memory and
task handlers. Natural-language settings support these documented phrases, not
arbitrary requests to change configuration.

To use OpenRouter, save an API key in the shared instance through global
Settings or the paired CLI commands below. Select the provider and an explicit
model in the bot profile. The instance does not silently fall back to another
provider. ChatGPT uses a Staf-owned sign-in grant. Shared-instance sign-in and
provider calls have synthetic coverage; live access remains unverified.

For LM Studio or generic HTTP environment changes, restart the automatic instance.
Inspect the PID in its descriptor and confirm that its command is the Staf
terminal daemon for this data directory before sending SIGTERM:

```sh
STAF_INSTANCE_PID="$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.staf/terminal-instance/terminal-service.json", "utf8")).pid')"
ps -p "$STAF_INSTANCE_PID" -o pid=,command=
kill "$STAF_INSTANCE_PID"
```

A stale descriptor may name a different process; only stop the confirmed daemon.
Start `staf` again with the desired environment.

For provider setup and a live chat test, follow [Configure a provider](#configure-a-provider).

## Agent images

New and existing agents use initials until you choose an image. In **New agent**
or agent Settings, open **Change image** and select **Initials**, **Built-in
avatar**, or **Uploaded image**. This choice belongs to the agent and is shared
with every paired client.

The built-in gallery shows all six shapes together: circle, rounded square,
capsule, triangle, pentagon, and hexagon. Polygons have softly rounded corners.
Every character has a solid body color and two black circular eyes. Choose any
of the eight colors independently of shape. Different agents can use the same
combination.

Uploads accept PNG, JPEG, and WebP source files up to 10 MiB, 8192 pixels on
either side, and 24 megapixels in total. Drag the square crop to reposition it,
or use the **Horizontal position** and **Vertical position** sliders. **Zoom**
ranges from 1× to 3×. The chooser shows a larger preview and the actual 24, 28,
and 30 pixel badge sizes. The saved crop is a static 256 × 256 PNG; the original
full-size source is not sent to the instance.

Browsing shapes, colors, and crops changes only the form preview. **Create
agent** or **Save settings** commits the selection. Closing the chooser does
not save it. **Cancel** preserves the current image. Failed or conflicting
saves keep your edits available for comparison and retry.
After a conflict, select **Compare latest settings** to review the saved choice.
**Use latest image** adopts that image while retaining your name and instruction
edits. Review the draft before saving again.

The saved image appears in the agent list, Focus rail, chat header, and agent
messages. Names and duplicate-name suffixes still identify agents. If an upload
cannot be displayed, Staf shows initials and explains the problem in the image
control. Choose another image or select **Initials** to replace it.

Image choices live in the agent's editable configuration. Accepted upload bytes
live under `agents/.images` beside the instance's agent directories and are
included when that directory is backed up. Uploaded images require a paired
client to read them. Returning to initials or replacing a photo retains prior
accepted image files for configuration history and uncertain-save recovery.
Include the entire agents directory when copying or backing up an instance.

The paired CLI's existing profile inspect/edit workflow can read or change the
image descriptor. Ordinary profile edits that omit `image` preserve it. See
[the image configuration and API reference](reference.md#agent-image-configuration-and-api).
Image selection does not require a provider connection or a model request.

The automatic instance does not adopt an existing project `.staf/instance.sqlite` database.
For scripts, `staf instance help` lists the existing one-shot commands. To connect
an already paired loopback client, use `staf --instance URL --credential FILE`.
The local terminal credential and service descriptor are stored in the data
directory. If the credential is missing for an existing database, or has been
revoked, pair a client explicitly instead of silently restoring access.

## Configure a provider

Open `/settings` in an interactive terminal to edit the current bot's provider,
model, and reasoning. `/settings show` prints the current profile. In plain
terminals, use `/set provider NAME`, `/set model MODEL_ID`, and `/set reasoning
LEVEL`. Confirm a provider change with `/confirm-provider` after reviewing the history-transfer notice, or cancel with `/cancel-provider`. Use `/unset model` or `/unset reasoning` to restore the provider default. Changes are saved to the shared bot profile and apply to new work. Bot
creation defaults are separate and do not change existing bots. Use `/defaults`
to inspect them and `/set-default provider|model|reasoning VALUE` to edit them. `/models` reads
model metadata explicitly; a failed discovery does not prevent manual entry.

The available providers are `demo`, `codex`, `openrouter`, `lmstudio`, and
`live`. All except demo require an explicit model in the bot profile. Demo is an
offline echo and does not use a language model. Switching providers can send the
existing conversation to the newly selected provider on the next request.

### Use ChatGPT

1. Start `staf` and enter `/auth chatgpt login`, or select **ChatGPT sign-in** in
   `/settings`.
2. Open the printed URL and complete sign-in in the browser. Use `/auth chatgpt
   status` to inspect the attempt and local credential status.
3. Select **ChatGPT** and an account-available model in `/settings`, or enter
   `/set provider chatgpt`, confirm with `/confirm-provider`, and enter `/set model MODEL_ID`.
4. Send a message in chat and inspect the response. A real request uses the
   account's plan permissions. Do not paste credentials into chat.

Sign-in and model calls in the shared instance have synthetic coverage but have
not been live verified. See [ChatGPT sign-in and recovery](codex-direct.md).

### Use OpenRouter

In the browser, open **Settings**, enter the key under **OpenRouter**, and
save it. For the default automatic terminal instance, start `staf` and set the
paired CLI connection arguments:

```sh
URL="http://127.0.0.1:$(node -p 'JSON.parse(require("fs").readFileSync(process.env.HOME + "/.staf/terminal-instance/terminal-service.json", "utf8")).port')"
CREDENTIAL_FILE="$HOME/.staf/terminal-instance/terminal-credential.json"
```

In zsh, use the following to enter a key without echoing it or placing it in
shell history:

```sh
staf instance openrouter-status "$URL" "$CREDENTIAL_FILE"
read -rs 'STAF_ROUTER_KEY?OpenRouter API key: '; printf '\n'
printf '%s' "$STAF_ROUTER_KEY" | staf instance openrouter-set "$URL" "$CREDENTIAL_FILE"
unset STAF_ROUTER_KEY
```

To disconnect, run `staf instance openrouter-disconnect "$URL" "$CREDENTIAL_FILE"`.

Use the paired credential and loopback URL for any other instance. `openrouter-set` reads standard
input, accepts no key argument, and replaces the existing key. Saving does not
contact OpenRouter or establish account, credit, or model access. Keys are held
in the instance's private `auth/openrouter.json` file, not agent configuration;
protect the data directory and its backups. The key is stored as plaintext with
mode 0600. Disconnect removes that file and affects subsequent work; requests
already in flight may still use the previous key. The shared instance ignores
`OPENROUTER_API_KEY` in its environment, so migrate an existing key into Settings
or the CLI. Select `openrouter` and an explicit model in each agent. A message
can spend API credits. OpenRouter streams provisional text and reports usage when available. Choose a model that supports function calling to use tools; capabilities vary by model. Interrupted, truncated, or unsupported responses are shown as incomplete. Restore a failed message from the composer to retry it; a newer draft is retained separately.
Synthetic service, CLI, and served-browser checks exercise the streaming adapter; live OpenRouter conversation and remote-instance access remain unverified.

### Use LM Studio or a compatible HTTP endpoint

For LM Studio, start its server and select `lmstudio` and an available model.
The instance uses `http://localhost:1234/v1/` by default. Set
`LMSTUDIO_BASE_URL` on the host to change the API root and set
`LMSTUDIO_API_KEY` only if the server requires it.

For a generic OpenAI-compatible endpoint, select `live` and a model. Set
`STAF_API_KEY` and optionally `STAF_BASE_URL` on the host before starting the
instance. The default API root is `https://api.openai.com/v1/`. This adapter can
incur API charges. API roots must not include the `chat/completions` suffix.
Host environment changes require an instance restart. Per-bot endpoints are not
implemented. These providers have not been live tested in the shared instance.

## Inspect usage and context

`/usage` reports available usage saved for the main chat. `/usage details` shows
individual observations. Unreported usage remains unavailable. `/context`
reports the latest available historical input count and explains that the next
request's context occupancy is unavailable. Dynamic instructions, memory, tools,
and notices can change the next request. Staf does not compact history. See
[usage accounting](usage-accounting.md) and [context display](context.md).

## Resolve common errors

- For `ERR_PNPM_UNSUPPORTED_ENGINE`, check the Node and pnpm versions. Staf
  requires Node 22.16 or later and pnpm 12.16.1 or later.
- If a provider reports a missing credential or model, check the instance connection or host environment
  and the bot profile. Restart the instance after changing host variables.
- For HTTP 401, check the selected provider's credential. For 402, check credits.
  For 429, wait before retrying. Staf does not automatically retry paid calls.
- For LM Studio connection errors, check the server and API root. Staf does not
  start the server or download models.
- For ChatGPT sign-in errors, use `/auth chatgpt status` and retry sign-in when ready.
- If the local client credential is revoked or missing for an existing database,
  pair an explicit client. Staf does not restore the credential automatically.

Use `/help` to list terminal commands. A failed provider request leaves settings
available; inspect the error and retry the message after correcting the cause.

## Local shared instance (offline preview)

Start with `pnpm start instance serve .staf/instance.sqlite 3210` and open
`http://127.0.0.1:3210/`. Pair with the displayed one-time code. Press Enter
in the host terminal to replace the code for the next client. Codes and
credentials grant access to all bots; keep them private. Browser authorization
is stored in localStorage. Use the paired-client CLI operations to inspect
and revoke a client. Revoking this browser returns it to pairing. A revoked
client needs a new host code to reconnect. Clients are identified by an ID,
not a device name.

The workspace keeps an agent list beside the selected main chat, visible while
the chat scrolls. Select an agent to switch conversations; agents with the same
name, including archived namesakes, show the last four characters of their stable
IDs in the list and Updates. Suffixes can coincide; full IDs remain available
through the API or CLI. **New agent**, under the **Agents** sidebar heading, opens creation, and **Settings** controls appearance and
instance-wide provider connections. New agent opens a modal with keyboard focus
contained inside; Escape or Cancel closes it and returns focus. Optional provider
choices remain under its Provider, model and reasoning disclosure. Choose Light, Dark, or System appearance;
Light is the default; System follows device appearance changes. The choice is saved
in this browser, independently of other browsers; clearing browser storage resets it.

The sidebar starts expanded. Use its panel icon to collapse it to the Focus rail;
the expand button then appears in the workspace header. Agent selection, New
agent, and Settings remain available in the rail. Settings offers Evergreen and
Ink palettes and **Layout and typography** controls for DM Sans or system sans,
text size, spacing, corners, and the five-dot logo. Defaults are Evergreen, DM
Sans, 14px text, 20px spacing, 10px corners, and Orbit. These choices apply only
to this browser. Settings groups shared connections into provider cards;
Creation defaults opens its editor through Edit defaults. The composer model button opens provider, model, and reasoning
choices immediately above it as grouped menu rows with selection checkmarks.
Use Up/Down or Home/End through the choices and manual entry controls. Tab or
Escape closes the menu and
return focus, or click outside to dismiss. Provider changes retain confirmation.

Workspace notifications appear as dismissible toasts at the top of the page.
Informational and success notices expire after six seconds, with a progress bar.
Hovering or focusing a toast pauses its timer. Errors remain until dismissed;
correctable errors also remain beside the affected control or message.

A saved ChatGPT sign-in is shared by all agents; it does not establish that the
provider or a model is available. In **Settings**, **Connect ChatGPT** opens sign-in
in a new tab. If the tab is blocked or closed, use **Continue sign-in** for the
same attempt on the instance host, and return to Settings for progress.
Cancel a pending attempt or retry a failed or expired one. If the page was
refreshed and the link is no longer available, cancel the attempt and start a
new one. **Sign out** removes the instance's local credential after confirmation;
finish active work and sign-in first. Agent provider and model selections and
unsent drafts are retained. Create an agent with a name and optional
instructions, provider, and model, even before signing in or choosing a model. Select the
agent avatar in the chat header to edit its full settings and Instructions. The
optional **Instructions** field provides standing guidance in the agent's
`soul.md`. Open **About Instructions** with a click, tap, or keyboard to read
the explanation; hovering the control also shows it. Press
Enter to send a message or Shift+Enter to insert a new line. The workspace keeps drafts when switching agents. If sign-in or a model is
missing, the submitted text remains beside an explanation and Retry control.

In agent settings, Demo is always available; ChatGPT and OpenRouter can be chosen
when their shared connection is saved. A saved connection does not verify account
or model access. A disconnected current provider remains visible, and **Open
provider settings** lets you repair a connection and return to your unsaved
agent edits. The browser does not offer LM Studio or HTTP compatible as new
choices because their host configuration is not managed in global Settings;
existing selections remain visible and can still be edited through the CLI or
configuration files. A provider switch retains the model text for you to review
and asks for confirmation because future requests can send the existing chat to
the new provider. Saving settings does not send a model request. Other agents
keep their own choices.
In agent settings, select **Archive agent** to retain configuration and history
while preventing new work. To restore it, expand **Archived agents** in the **Agents** sidebar and select
**Restore agent** beside its name. An agent with active chat or background
work cannot be archived until that work settles.

In the shared terminal, `/stop` requests cancellation of the current main-chat response, including one started by another paired client, and reports its settled state and any stopped partial output. Incremental provider text is labeled provisional until the response settles. A line entered while your terminal command is unresolved is kept as an unsent draft. Use `/edit ID TEXT` to revise it and `/retry ID` after the response settles; drafts are never queued automatically.

Actual tool requests and success/failure outcomes appear below the corresponding user message. Expand an outcome to read bounded, redacted output. Pending chat approvals show the exact action and scope with **Approve once** and **Deny**. Decisions from other clients disappear on the next refresh. Observed outcomes remain visible after response failure or Stop. These are tool records, not hidden reasoning.

While a response runs, the workspace receives provisional text and progress over a shared-instance event stream. If the connection drops, the workspace reconnects and shows the latest saved progress.
The composer has one circular action: an up arrow labeled **Send** when ready, and a square labeled **Stop** during an active response. You can type a next draft while the response runs. Select **Stop** to request cancellation; the response shows **stopping** until the provider and pending operations settle. The circular action stays disabled and labeled **Stopping response** until settlement, then returns to Send. The draft remains editable throughout; Enter cannot submit it during generation or stopping, and nothing is queued. Send it explicitly after the response settles. Stopped partial output stays in the conversation labeled **stopped** and is not treated as a completed provider reply. A provider that does not promptly honor cancellation can keep the agent in stopping until it returns.
Markdown headings, lists, links and code blocks render in assistant responses;
use Copy on a code block. Raw HTML is not rendered. The conversation follows new
output while you are at the bottom and stays in place when you scroll up.
Incremental output is available when the adapter supplies it; buffered adapters
show progress and then the completed message. A failed or interrupted response
remains labeled as incomplete.

Pending main-chat approvals appear in the conversation. The workspace checks for updates while visible; it does not provide background notifications. Activity, task updates, and task questions are deferred from the MVP workspace.

Drafts and pending message IDs are stored in the browser's local journal.
An agent's draft and pending submission recover automatically after reload or
after closing and reopening a tab. Concurrent tabs keep separate records; if
several closed tabs left drafts for one agent, one record is loaded at a time
and the next is recovered when the current draft and submission are cleared.
The composer waits until the selected agent’s draft is ready. The browser must
support secure random UUIDs, Web Locks, and local storage for sending. A lost acknowledgment is checked against the shared instance and,
if no command is found, resubmitted using the same ID. A failure or busy rejection
remains beside the message with Retry and Dismiss; a newer draft is retained.
If a retry finds the agent busy while the original request may still arrive,
the message cannot be dismissed and any retry keeps the original ID.
Obsolete pre-journal browser records are deleted without importing them. Current
journal records, including records owned by other open tabs and recoverable closed-tab
drafts, are retained. Older records without a dataset identity recover automatically
when a stored command or creation operation verifies their origin. Otherwise, open
**Earlier browser records** to inspect and copy the saved text and operation details;
these records are not submitted or assigned to the current dataset automatically.
An unfinished agent
creation is restored automatically after refresh or reopening a tab, with the same
operation ID for Check creation or Retry same creation. A live tab keeps ownership
of its creation record. Clearing browser storage removes locally saved drafts,
pending IDs, and unfinished creation records. The former Advanced page has been
retired. Profile, permission, memory, skill, schedule, and task management are
not yet fully available in the workspace; the service and CLI operations below
remain available.

After updating Staf, reload any already-open workspace tabs so they all use the
current draft coordination before editing in multiple tabs.
### Agent configuration files

Each agent has `agent.toml` for its name, description, provider, model and
reasoning, and `soul.md` for its instructions. The GUI, CLI and API publish to
the same configuration. Settings and `instance inspect` show the stable
`configDir` for inspecting and editing the files on the instance host. Edit
`agent.toml` or `soul.md` directly with a text editor or shell tool. Staf reads
and validates them on inspection and before accepting new work. Valid changes
apply without a restart; work already underway keeps its captured settings.
Invalid files remain intact and block new work for that agent until repaired;
its history and other agents remain available.

Staf retains the original published pair under `configDir/.published` and
copies of valid direct edits it has observed under `configDir/.history`. When a
client publishes a new pair, the earlier revision directory, including its
recovery copies, remains under the agent's `revisions` directory. These copies
are retained until removed by the owner and may contain private instructions.

Direct file saves are last-write-wins. An editor saving an old buffer can
overwrite a newer file without Staf being able to identify it as stale. Staf
cannot recover a version that was overwritten before it read that version.
If changing both files, finish the edits before sending new work: independent
file writes are not an atomic pair and Staf may see one before the other.
GUI changes preserve TOML comments and surrounding formatting; if a layout
cannot be safely updated, Staf reports an error and retains the file. Authored
provider-choice tables, dotted keys, or inline tables may require a direct edit.

Client saves include a revision and reject stale versions. If a client reports
that a save result is uncertain, inspect the current files before retrying.
In agent settings, **Compare latest settings** loads the current saved values
alongside your retained edits after a failed save. Review and reconcile them
before saving again; another intervening change will still cause a conflict.

If an editor writes an already retired published revision, Staf blocks new work
and reports that revision's path. Close the old editor, compare its retained
files with `configDir`, apply the changes you want to the current files, and
remove the old revision's `.retired` marker after review. The old files remain
on disk.

A later request after a provider change can send existing chat history to the new provider. Creation defaults set provider, model, and reasoning for future bots. The instance copies these settings at creation; changing defaults never changes existing bots. Revisions prevent stale clients from overwriting each other. In the CLI, use `instance defaults URL CREDENTIAL_FILE` and `instance defaults-set URL CREDENTIAL_FILE REVISION PROVIDER MODEL REASONING [TOOL_MODE]`; use `-` for an empty model or reasoning. Permission and approval settings remain separate. The description is owner-edited metadata visible to other bots; keep private instructions and memory out of it. New bots start with an empty description.
The deterministic demo provider does not follow the instructions. Select ChatGPT, OpenRouter, LM Studio, or live and an explicit model in the bot profile. OpenRouter uses the managed instance key described above; the instance command does not load the project `.env` file. ChatGPT uses the Staf grant under the directory containing the instance database. From a paired browser, use ChatGPT sign-in and open the provided link on the instance host. The initiating paired client can check or cancel that attempt, including after refreshing the page. The CLI provides `instance chatgpt-auth-start URL CREDENTIAL_FILE`, `chatgpt-auth-current URL CREDENTIAL_FILE`, `chatgpt-auth-status URL CREDENTIAL_FILE ATTEMPT_ID`, `chatgpt-auth-cancel URL CREDENTIAL_FILE ATTEMPT_ID`, `chatgpt-auth-credential URL CREDENTIAL_FILE`, and `chatgpt-auth-logout URL CREDENTIAL_FILE`. The callback listens on the same loopback origin. Revoking the initiating client prevents credential commit. These paths have been tested with synthetic auth only; live sign-in has not been verified. Provider failures do not fall back to another provider. Live provider execution has not been verified in this preview.

CLI examples (use a fresh host code for each client):

```sh
pnpm start instance pair http://127.0.0.1:3210 ~/.staf-client.json CODE
pnpm start instance create http://127.0.0.1:3210 ~/.staf-client.json Ada Lovelace --instructions 'Be concise'
pnpm start instance clients http://127.0.0.1:3210 ~/.staf-client.json
pnpm start instance revoke http://127.0.0.1:3210 ~/.staf-client.json CLIENT_ID
pnpm start instance bots http://127.0.0.1:3210 ~/.staf-client.json
pnpm start instance inspect http://127.0.0.1:3210 ~/.staf-client.json BOT_ID
pnpm start instance discover http://127.0.0.1:3210 ~/.staf-client.json REQUESTER_BOT_ID SEARCH_TERMS
# Run pnpm run build first. Use node directly to keep build output out of JSON.
node dist/cli.js instance inspect http://127.0.0.1:3210 ~/.staf-client.json BOT_ID > bot.json
# Edit the profile fields in bot.json and retain its revision.
pnpm start instance edit http://127.0.0.1:3210 ~/.staf-client.json BOT_ID bot.json
pnpm start instance archive http://127.0.0.1:3210 ~/.staf-client.json BOT_ID REVISION
pnpm start instance restore http://127.0.0.1:3210 ~/.staf-client.json BOT_ID REVISION
pnpm start instance read http://127.0.0.1:3210 ~/.staf-client.json BOT_ID
pnpm start instance send http://127.0.0.1:3210 ~/.staf-client.json BOT_ID 'Hello'
pnpm start instance status http://127.0.0.1:3210 ~/.staf-client.json COMMAND_ID
node dist/cli.js instance response-follow http://127.0.0.1:3210 ~/.staf-client.json COMMAND_ID
node dist/cli.js instance response-stop http://127.0.0.1:3210 ~/.staf-client.json COMMAND_ID
```

The bot name can contain multiple arguments. Pass instructions as one quoted
argument after `--instructions`; omit the option to use empty instructions.
Use `--provider PROVIDER`, `--model MODEL`, and `--tool-mode direct|hybrid|code` to override creation defaults.
The CLI prints a creation operation ID to standard error before submitting.
If the result is uncertain, repeat the same command with `--operation-id ID`
using that ID. Keep the other arguments unchanged. The browser retains its
creation operation in local storage for status checks and retries after reload.

The task form has a helper clock scope, also available with `instance task-start URL CREDENTIAL_FILE BOT_ID --delegate-clock OBJECTIVE`. It is off by default and recorded independently from the objective. Selecting it permits a helper to request clock reads, subject to current permissions and approval settings. Retries retain the original scope. Scheduled tasks currently receive no helper action scope.

Discovery searches names and descriptions, excludes the requester and archived bots, and reports busy bots and ambiguous matches. Matching and limits are provisional. Discovery does not itself assign work. During a task, a bot can request one helper; the owner reviews each exact bot message before it is sent. Helpers do not inherit either bot’s chat history or retrieve private memory.

Both clients report a conflict if another client has changed the profile since
you inspected it. Refresh the profile and reapply your changes. Archive works
only while the bot has no active chat request or background task. Archived bots
retain configuration and history and cannot accept new work until restored.

The CLI prints the command ID before submission; check status if its outcome is
uncertain instead of automatically resending. A busy bot does not accept a new
message. The browser clears the composer immediately and shows the submitted message and
status in the conversation while keeping the next draft editable. It automatically
recovers uncertain outcomes with the original command ID. Busy or rejected work
can be retried inline; retrying a failed or interrupted accepted command starts a
new command. Resolve or dismiss that message before sending the next draft. The
CLI takes text as an argument and has no interactive draft.

Providers receive the recorded conversation and tool history on each turn; the preview does not compact
or limit it. It does not import existing file-based sessions. The workspace polls
while visible; it does not provide push updates or a general backup and restore
workflow. When an existing preview database
requires a stored-format migration, Staf creates a SQLite backup next to it before the
schema change and prints its path. Commands accepted before private fingerprints were introduced remain available through status, but their IDs cannot be resubmitted because their original input cannot be verified. New SQLite database files are created with owner-only permissions. Existing database permissions are left unchanged; restrict them and the containing directory as appropriate. SQLite data and paired client authorizations persist across
restart. Only one process may own the database at a time. This is loopback-only,
not a LAN deployment.

## Background task preview

The background engine and task history remain available through explicit API/CLI operations. The MVP workspace hides Activity and task updates without stopping existing work. Main chat does not advertise or execute background-task creation. The CLI operations below can start and inspect tasks with a run
limit of five minutes by default. Stop requests cancellation; the task remains
stopping until its provider settles. A provider result already returned after
the request can still complete the task. Retry a failed, stopped, or interrupted
attempt explicitly. Replace an active task with a changed objective explicitly.
The replacement waits until the original settles and keeps a link to it.

The loopback CLI uses the same instance and credential file:

```sh
pnpm start instance task-start http://127.0.0.1:3210 ~/.staf-client.json BOT_ID 'Investigate the question'
pnpm start instance tasks http://127.0.0.1:3210 ~/.staf-client.json BOT_ID
pnpm start instance task http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID
pnpm start instance task-direct http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID 'Focus on the report'
pnpm start instance task-answer http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID QUESTION_ID 'The report'
pnpm start instance task-stop http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID
pnpm start instance task-retry http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID
pnpm start instance task-replace http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID 'Changed objective'
pnpm start instance task-follow http://127.0.0.1:3210 ~/.staf-client.json ATTEMPT_ID
```

The CLI currently uses the default limit. Inspect by attempt ID after an uncertain
submission; do not silently submit again. The workspace polls while visible. On restart,
unfinished work is marked interrupted and never restarts automatically. Existing
databases get a private SQLite backup before the task schema migration.

The selected task accepts explicit directions through `task-direct` or main chat with `direct task ATTEMPT_ID: your direction`. Use `stop task ATTEMPT_ID` in main chat to stop it. A request without a full attempt ID asks for clarification. Provider calls to `start_background_task` fail with no task started. Input is accepted first and applied at a subsequent safe boundary, with both statuses shown in Activity. A task may use the structured `ask_owner` tool to request clarification; answer the specific question ID with `task-answer`. Waiting for an answer does not consume the execution limit. Input is not approval for a tool action. Accepted but unapplied inputs remain visible after stop or restart. Adapters without tool-call support cannot request clarification.

The shared instance also supports separately permitted web reading, local search and scratch-only shell, as described below. A complete recovery workflow is not implemented. Browser task submission does not yet recover an uncertain request automatically. Provider cancellation and live execution require separate live verification.


### Scoped memory in the shared instance

In the workspace, open **Agent settings → View agent memory** to inspect that
agent's saved entries. Open **Settings → User → View user memory** for the
shared list, or follow **View shared user memory** from an agent's memory page.
Under **Archived agents** in the sidebar, **View memory** inspects retained
entries without restoring the agent. Audience labels distinguish each scope.
The read-only lists show all saved entries in pages of 20, with updated times
and expandable IDs, versions, created times, and origin information. Existing
entries have no recorded origin. Use **Refresh memory** to fetch a current
snapshot; loading and errors are distinct from an empty list. These lists are
separate from the up to five matches selected for a provider request.

Each agent has separate memory. User memory is shared across agents. In main chat, explicit phrases such as “Remember that I like tea” save to the addressed agent. “Remember for all agents: I like tea” proposes shared user memory. The response shows the exact text and warns that all agents can retrieve it. Send `Confirm shared memory PROPOSAL_ID` to save that exact proposal, or `Cancel shared memory PROPOSAL_ID` to cancel it without saving memory. Cancellation removes the text from the active proposal, but the original message and proposal response remain in chat history and may be included in later model requests or task context. Cancellation does not erase backups or data already sent to a provider. The proposal is bound to the addressed agent and survives restart. Repeating confirmation cannot duplicate it. The acknowledgment names the scope. Ambiguous scope or missing content prompts a clarification without saving. Other supported save forms include “Please keep in mind that …”, “Save this for later: …”, and the prefixes “for this agent” or “in shared memory”. For inspection say “List memories in shared memory” or “List memories in this agent memory”. For a specific entry say “Correct memory MEMORY_ID version VERSION in this agent memory to NEW TEXT” or “Forget memory MEMORY_ID version VERSION in shared memory”. Edits and deletions require the exact ID, last observed version, and scope. Scoped save phrases require a colon after the scope; partial agent scopes and recognizable conflicting restrictions require clarification. Phrase recognition is deterministic and cannot reliably infer every implied restriction; review the scope before using shared memory. “Forget that …” asks for an ID and scope rather than guessing which entry to delete. Descriptive requests such as “What do you remember about tea?”, “Forget the memory about tea” and “Correct my memory about tea to coffee” show up to ten matching candidates with IDs and versions; they do not change memory. Unspecified scope means this agent. Add “in shared memory” to preview shared entries. Ambiguous, excluded or other-agent scopes require clarification. A preview does not select an entry or authorize mutation; use the exact ID, current version, scope and replacement text in a separate command. Other natural-language phrasing is not reliably recognized. Tool-capable models can use the memory actions described below. The earlier “bot” wording remains accepted in these chat phrases. CLI scope values such as `bot:BOT_ID` are unchanged.

In ordinary chat, a tool-capable model can explicitly search or read retained memory, remember, update, and forget using the existing store. It chooses agent or user scope; agent scope is always the executing agent. Reads include IDs and versions. Updates and deletions require the current version, and stale or wrong-scope IDs fail. A shared remember action only proposes the text; the owner must send `Confirm shared memory PROPOSAL_ID` in the same agent chat to save it, or `Cancel shared memory PROPOSAL_ID` to discard it. The action record shows the exact proposed text and ID for review. The model can inspect a proposal status but cannot confirm it. Existing shared updates and deletion do not require a new confirmation. Model behavior depends on its tool use; review changes in the owner interfaces. Eligible tasks use the same memory actions; helpers remain excluded from private memory.

The workspace memory views are read-only. Use chat commands or the CLI to add, edit, or delete entries. The CLI uses explicit scopes. Use `memory-list URL CREDENTIAL_FILE user`, `memory-add URL CREDENTIAL_FILE bot:BOT_ID TEXT`, `memory-edit URL CREDENTIAL_FILE bot:BOT_ID MEMORY_ID VERSION TEXT`, and `memory-delete URL CREDENTIAL_FILE bot:BOT_ID MEMORY_ID VERSION`. Use `user` instead of `bot:BOT_ID` for shared user memory. Refresh after a conflict before editing or deleting. All paired clients act for the same owner.

Up to five keyword-matched entries from shared user memory and the addressed bot are included as untrusted data in each provider request. The matching is simple and may miss relevant memories. Injected entries are not added to saved conversation messages. Deleting an entry removes it from active memory and future retrieval; it does not erase prior transcripts, backups, or provider requests already sent or in flight. A memory saved or listed in chat remains in that transcript and can be sent again as ordinary conversation history after deletion. Memory is stored in the instance database and shares its access protections. A migration backup is created before upgrading an existing database. Offline integration tests cover this preview; live providers have not been verified for memory.

### Skills in the shared instance

The workspace does not yet provide skill management controls. A paired client can import explicit skill text, name, description and provenance through the CLI or API. Skill IDs and revisions are stable records; updates create a revision. A disabled skill is unavailable to every bot. All paired clients act for the owner.

For the CLI, use `instance skill-import URL CREDENTIAL_FILE NAME DESCRIPTION PROVENANCE BODY`, `skill-list URL CREDENTIAL_FILE`, `skill-inspect URL CREDENTIAL_FILE ID`, `skill-update URL CREDENTIAL_FILE ID REVISION NAME DESCRIPTION PROVENANCE BODY`, `skill-enabled URL CREDENTIAL_FILE ID true|false`, `skill-availability URL CREDENTIAL_FILE ID BOT_ID true|false`, and `skill-bot-list URL CREDENTIAL_FILE BOT_ID`. BODY is literal text, not a path or URL. Skill text is limited to 256 KiB. These commands do not read files or fetch URLs. Configured credential values are redacted from imported names, descriptions, provenance and text before storage, and from existing entries when read. The catalog `digest` identifies the originally submitted bytes, so it can differ from the displayed text after redaction. Existing database records and backups are not rewritten to remove previously stored credentials.

A tool-capable provider receives at most 32 available skill names, descriptions, IDs, revisions and hashes and may choose one in response to ordinary language. Direct and Hybrid offer `select_skill` as an individual tool. Hybrid and Code Mode also offer it as a guest capability. Selection is model-dependent and may be missed or ambiguous. The server validates the exact ID and revision and current availability when loading. Task attempts capture their catalog at acceptance, while live disable or removal stops subsequent model requests and tool actions after a skill was loaded. Successful loads appear in task Activity and in the command status `skillActivity` with name, ID, revision, `sourceDigest` for the original submitted bytes, and `loadedContentDigest` for the UTF-8 bytes of the redacted body loaded into the tool result. Older load records have only the source digest; a loaded-content digest cannot be reconstructed reliably. A recorded load does not establish that a subsequent provider request completed. A provider statement alone does not create a load record. Adapters without tool support cannot load skills.

Imported text is untrusted data in a tool result and does not grant tool permissions or run scripts. It can influence model output. Disabling does not retract content already sent to a provider, remove saved conversation records or backups, or undo actions already completed. Prior direct skill results and code results linked to skill child actions are removed from later provider replay; ordinary chat history may still contain information derived from it. Skill management, selection and permission checks are offline-tested with synthetic providers; natural-language selection and behavior with live providers are not verified. The import format and automatic skill creation, update and retirement remain open product decisions.

### Clock approvals in the shared instance

This first-delivery instance treats every paired client as acting for its sole owner; there are no separate owner and client roles. Any paired client can inspect and decide requests and change settings. The shared instance gates its `clock` tool for both main chat and background tasks. The default is **Ask for risky actions**, under which this read is routine. **Ask every time** pauses each clock action until a paired client approves or denies that specific request. **Never ask** still respects instance and bot clock permissions and the task's clock boundary. A task override selects its mode over a bot override, which selects over the instance default. Disabling the clock at any applicable boundary blocks it.

The workspace shows pending clock requests in Activity and can approve or deny them once. Approval settings are not yet available in the workspace. The CLI exposes `instance approvals URL CREDENTIAL_FILE`, `instance approve URL CREDENTIAL_FILE REQUEST_ID`, and `instance deny URL CREDENTIAL_FILE REQUEST_ID`. Inspect settings with `instance approval-settings URL CREDENTIAL_FILE SCOPE`; set them with `instance set-approval-settings URL CREDENTIAL_FILE SCOPE MODE true|false`. Scope is `instance`, `bot:BOT_ID`, or `task:ATTEMPT_ID`; mode is `ask-every-time`, `ask-for-risky-actions`, `never-ask`, or `inherit` for a bot or task. The boolean controls clock access at that boundary.

Pending approval does not consume the task's execution limit. Stop and restart interrupt pending requests; retry is a new attempt and must ask again when required. Approval does not grant access after permissions are revoked. These mode settings apply to the clock. Delegated clock actions also check both bots and the task scope. Web reading, search and scratch shell use separate permissions and exact-action decisions. Reusable grants are not implemented.

## Recurring schedules preview

A paired owner can create and inspect schedules with the CLI below. Schedule controls are not yet available in the workspace. Choose one exact action: read the UTC clock, read one canonical public web URL, search one exact query on the currently configured backend, or run one exact scratch command on the currently configured Docker endpoint and pinned image. A scheduled web occurrence allows at most one dispatch across its original attempt and any retries, with a separate owner approval before DNS or HTTP. Redirects to other targets are blocked; the one-dispatch cap also prevents following another hop. Web access must be enabled separately for the instance and bot. The captured URL supplies only this scheduled attempt’s exact task scope; an explicit task-level disable overrides it and carries to retries. Revoking a schedule cancels its pending or in-flight web read. Clock permissions and approval mode continue to apply. A scheduled search also requires instance and bot search permission, an exact query and backend snapshot, and a separate owner decision before dispatch. Its one-dispatch limit is shared across retries. A backend change blocks the scheduled search; create a new schedule for the new backend. Explicit task disables carry to retries. Scheduled scratch commands require separate instance and bot shell permission and a separate owner approval for each occurrence. The schedule captures the exact command, Docker binary, socket, image and fixed scratch limits. One dispatch is shared across retries, and changing the configuration blocks it. An explicit task disable carries to retries. The global uncertain-action lock and owner review still apply. Other tools, helper access and reusable grants are not authorized by a schedule.

The provisional recurrence policy supports daily or weekly local times in an explicit IANA time zone. A nonexistent local time is skipped and an ambiguous local time uses its first occurrence. On a delayed tick, at most the latest due run starts within the configured lateness window; earlier runs are recorded as skipped. A late or busy run is skipped. Re-enabling a schedule starts from the time of re-enabling. The instance must be running for schedules to execute. The in-process loop checks about every 30 seconds. The maximum lateness window must be at least one minute, although process delays can still cause skips. Docker deployment and a prepared native service setup are documented; native Linux service operation remains unverified.

For CLI creation, save a JSON object with a real bot ID and the intended objective. Weekdays use 0 for Sunday through 6 for Saturday. The example authorizes the UTC clock; an exact web authorization is shown below.

```json
{"botId":"BOT_ID","objective":"Report the current UTC time","recurrence":{"kind":"weekly","timeZone":"America/New_York","weekday":1,"hour":9,"minute":0},"maxLatenessMs":300000,"authorization":{"action":"clock.read","resource":"utc","limits":{"reads":"permitted"}}}
```

For a scheduled scratch command, load or configure the Docker endpoint and pinned image first. The authorization object below must use the current configuration and its revision, as shown by `instance shell-config URL CREDENTIAL_FILE`. The command and endpoint are stored in the schedule database and backups. Commands can contain secrets and are visible to the Docker CLI and daemon. Commands for this preview must be single-line, at most 4096 characters, with no asterisks or control characters. The owner must separately approve each occurrence. Only the fixed scratch tmpfs is available; host workspaces are not mounted.

```json
{"action":"shell.execute","resource":"printf safe","limits":{"maxExecutions":1,"dockerBinary":"/usr/bin/docker","dockerSocket":"/var/run/docker.sock","imageId":"sha256:REPLACE_WITH_64_HEX_DIGEST","revision":2,"sizeBytes":16777216,"maxInodes":1024,"timeoutMs":30000,"maxOutputBytes":65536}}
```

For a scheduled search, load or configure the backend first. Replace the authorization object with the exact query, current backend origin and current configuration revision shown by `instance search-config URL CREDENTIAL_FILE`. The query and backend are stored in the schedule database and backups, and the backend can forward or retain the query. Each occurrence still requires a separate owner approval.

```json
{"action":"search.read","resource":"safe query","limits":{"maxSearches":1,"origin":"http://127.0.0.1:8888","revision":2}}
```

For a scheduled web read, replace the `authorization` object with the following. The URL must already be canonical HTTP(S), without credentials or a query string. The exact path is stored in the schedule database and backups and can contain unknown secrets.

```json
{"action":"web.read","resource":"https://example.com/report","limits":{"maxReads":1}}
```

```sh
pnpm start instance schedule-create http://127.0.0.1:3210 ~/.staf-client.json schedule.json
pnpm start instance schedule-list http://127.0.0.1:3210 ~/.staf-client.json
pnpm start instance schedule-inspect http://127.0.0.1:3210 ~/.staf-client.json SCHEDULE_ID
pnpm start instance schedule-disable http://127.0.0.1:3210 ~/.staf-client.json SCHEDULE_ID VERSION
pnpm start instance schedule-enable http://127.0.0.1:3210 ~/.staf-client.json SCHEDULE_ID VERSION
pnpm start instance schedule-revoke http://127.0.0.1:3210 ~/.staf-client.json SCHEDULE_ID VERSION
```

Inspection shows occurrence status, linked task ID, skipped range and reason. An interrupted occurrence is marked uncertain and is not automatically repeated. Inspect its task and any external effects first. Use `schedule-resolve URL CREDENTIAL_FILE SCHEDULE_ID DUE_AT` with the occurrence's epoch-millisecond due time. Review releases the schedule for future runs; it does not retry the task or assert that it completed. A retry is an explicit task retry. It retains the schedule authorization and original objective. A revoked schedule cannot be retried. Scheduled attempts cannot be replaced. Stop the attempt and explicitly start a separate task for a changed objective. Inspection includes the state and outcome of each linked retry. Schedule creation is not yet idempotent: if a response is lost, inspect the list before submitting again. Automated tests use synthetic providers and clocks; live scheduled provider operation has not been verified.

### Public web reading

Web reading is disabled by default. A paired owner must enable it for the instance and bot. Ordinary background tasks additionally require their own task permission. A scheduled task instead receives only its captured exact URL scope, which can be disabled explicitly for the task; helpers cannot use web reading. The task permission readback distinguishes the owner override, inherited scheduled scope and current effective access. Use `instance web-permission URL CREDENTIAL_FILE SCOPE` or `instance web-permission-set URL CREDENTIAL_FILE SCOPE true|false` to manage these switches. `SCOPE` is `instance`, `bot:BOT_ID`, or `task:ATTEMPT_ID`.

A tool-capable bot may propose a public HTTP(S) page. A paired owner must approve each exact target, including each redirect, before DNS or HTTP. Use the browser approval list or `instance web-approvals URL CREDENTIAL_FILE`, `instance web-approve URL CREDENTIAL_FILE ACTION_ID`, and `instance web-deny URL CREDENTIAL_FILE ACTION_ID`. Web requests with credentials or query strings are rejected. A started request interrupted by restart is marked uncertain and is not automatically repeated. Revoking permission or stopping a task cancels in-flight reads.

Page text is untrusted data and cannot grant authority. The action journal records keyed fingerprints and generic outcomes. URLs supplied or generated in chat and source text may be retained in conversation, provider replay, Activity, and backups. Configured known secrets are redacted where implemented. Arbitrary chat, page text and model output may retain unknown secrets, and sensitive text cannot be reliably detected. Cancellation does not erase retained records. Synthetic dependencies test the integration; live web and live provider behavior have not been verified.

### Search through an owner-configured backend

Search is separate from web reading and is disabled by default. Configure the exact local backend origin in the form `http://127.0.0.1:PORT` with the CLI, then explicitly enable instance and bot search. An ordinary background task also requires its own search permission. A scheduled task can use only its captured exact query and backend scope, subject to an explicit task disable; helpers are not supported. Task readback distinguishes the owner override, inherited schedule scope and current effective access. The selected loopback port can identify any local HTTP service; only configure a backend you trust. In Docker, `127.0.0.1` refers to the container itself.

Each search requires owner approval of the exact query and backend before dispatch, unless an enabled matching reusable grant applies. In ordinary chat all three tool modes use the same search action, approval and result; the backend is never chosen by the model. The CLI supports `instance search-config URL CREDENTIAL_FILE`, `search-config-set URL CREDENTIAL_FILE REVISION ORIGIN` (use `-` to clear), `search-permission URL CREDENTIAL_FILE SCOPE`, `search-permission-set URL CREDENTIAL_FILE SCOPE true|false`, `search-approvals URL CREDENTIAL_FILE`, and `search-approve` or `search-deny` with an approval ID. Search has a limit of two concurrent dispatches within one instance process and ten dispatches per rolling minute per instance database; the rate history survives restart. Separate instance processes do not share a concurrency limit. Interrupted started actions become uncertain and are not automatically replayed.

The backend and its upstream search engines may retain queries. Queries, results, snippets and model output may also be retained in chat, provider replay, Activity, and backups. Unknown secrets cannot be reliably detected. Search results are untrusted previews. Result URLs containing percent-encoded sequences or configured secrets are omitted, and Staf does not automatically open result pages. A later public-web read requires its own permissions and approvals. Tests use synthetic providers and a disposable local HTTP fixture; a real SearXNG deployment and live provider behavior have not been verified.

### Scratch-only shell

Scratch shell is disabled by default. A paired owner must configure an absolute Docker CLI path, an absolute Unix daemon socket path and a pinned `sha256:` image ID, then enable instance and bot permission. Ordinary background tasks also require their own shell permission. Helpers cannot use it. A scheduled task may use only its captured exact command and Docker configuration, subject to an explicit task disable. Task permission readback distinguishes the owner override, inherited scope and effective access. The commands `instance shell-config URL CREDENTIAL_FILE`, `shell-config-set URL CREDENTIAL_FILE REVISION DOCKER_BINARY DOCKER_SOCKET IMAGE_ID`, `shell-permission URL CREDENTIAL_FILE SCOPE`, and `shell-permission-set URL CREDENTIAL_FILE SCOPE true|false` manage configuration and permissions. Use `- - -` to clear the configuration. Existing bot permissions and approval settings remain independent.

Each exact command requires owner approval in the browser or through `shell-approvals`, `shell-approve`, and `shell-deny`. The integration passes only a fixed 16 MiB, 1,024-inode scratch tmpfs to the sandbox, with a 30-second execution limit and 64 KiB output limit. It does not mount a host workspace. The Docker binary, daemon and pinned image must be trusted. The exact command is visible to host process observers and Docker container configuration until removal. Scratch tmpfs may use swap, and Docker can provide runtime-managed mounts. Commands, output and unknown secrets may persist in provider replay, conversations, Activity and backups. Known configured secrets are redacted where supported; arbitrary output may contain secrets that cannot be reliably detected.

An uncertain start, stop or cleanup blocks further scratch commands and daemon configuration changes. Inspect the recorded endpoint with `shell-uncertain` and independently verify the daemon identity before review. Staf compares endpoint configuration strings but cannot prove that the binary or socket still identifies the same daemon. A missing container does not prove that a delayed create cannot appear later. After independently verifying the daemon identity and inspecting it, the owner may explicitly acknowledge the risk with `shell-review URL CREDENTIAL_FILE ACTION_ID --acknowledge-uncertain` to record a review. This records a review; it does not remove a container or retry the action. The original action ID is never reused. Integration tests use a synthetic executor; the scratch component was separately tested with a disposable container, but live model-directed shell execution has not been verified.

## Provider choices

Open the composer model control to choose provider, model and reasoning. Provider
and reasoning selections and listed model choices save immediately; manual model text saves when leaving
the field. **List models** reports how many models loaded and shows an **Available models**
dropdown. If no models are returned, it says so; you can still enter a
model ID manually or retry. Discovery errors remain beside the controls. Model
listing reads metadata only and does not verify account access or run inference.
Model IDs absent from the list remain valid manual entries. Provider default reasoning leaves the effort unset. A model
with explicitly incompatible advertised reasoning resets the effort visibly.
Missing metadata leaves the saved effort intact; generation can still reject it.
Changing providers asks for confirmation before saving. Drafts stay in place.
Agent settings uses the same picker; name and instructions retain their separate
Save settings action and conflict recovery.

Global Settings → Provider defaults configures each provider's first-use pair.
Returning to a provider restores that agent's remembered pair. Changing defaults
does not update existing selections. Creation without an explicit provider keeps
the copied creation defaults. An explicit provider instead uses its own defaults or an explicit choice; after
discovery, an advertised default model can fill an unset model. It does not
inherit another provider’s reasoning.
Configuration does not verify model/account access.

Paired CLI clients can inspect and select the same state:

```sh
staf instance provider-defaults URL CREDENTIAL_FILE
staf instance provider-defaults-set URL CREDENTIAL_FILE openrouter owner/model high
staf instance inspect URL CREDENTIAL_FILE AGENT_ID
staf instance select URL CREDENTIAL_FILE AGENT_ID REVISION openrouter --confirm-provider-change
```

`select` optionally accepts model and reasoning after provider; `-` explicitly
clears a value. Omitted values restore the remembered pair or first-use defaults.
A provider change can send conversation history to the new provider; inspect the
agent and review the warning before adding `--confirm-provider-change`. Without
the flag the provider stays unchanged. Use the revision from inspect; conflicts
preserve the current configuration. The
interactive terminal keeps its existing provider-change confirmation.

## Save a tool mode

In agent settings, select Direct, Hybrid, or Code Mode and save. The creation
form can use the creation default or select a mode explicitly. In global Settings,
edit the creation default for future agents. Existing agents keep their choice.
New agents default to Hybrid. Existing agent files without `toolMode` mean Direct.

The terminal supports `staf settings set toolMode hybrid` and
`staf settings set-default toolMode code`. Interactive chat also accepts
`/set toolMode hybrid` and `/set-default toolMode code`. The paired CLI can
set `toolMode` in the existing agent profile JSON, or pass `--tool-mode` at
creation. The paired defaults command accepts a final mode argument.

In chat and eligible tasks, Direct offers the eligible clock, memory, configured search, web reading, scratch shell, skill selection, host file, and native process tools, Hybrid offers those individual tools and `code_mode`, and Code Mode offers `code_mode` with the same registered capabilities inside it. The code tool description lists eligible registered capability names and input schemas. Fabricated individual calls are rejected. Web reads require approval for each redirect target. Scratch commands continue to use the owner-configured Docker sandbox and its existing limits.
Background tasks use their captured mode for eligible registered capabilities, including clock and task questions, discovery and helper exchanges. A helper uses its own captured mode; helper and scheduled-work restrictions still apply. Pending owner input defers queued actions until the task drains its inbox. Plain text does not start a guest. Settings edits apply to new work; an accepted task and its retries retain their captured profile and task context. Clock permissions and applicable approvals remain live.

File actions use the agent's stable `work` directory for relative paths. Absolute paths use the Staf service account's normal host access; the working directory is not a sandbox. `file_write` creates or replaces a UTF-8 file, and `file_read` returns base64 bytes, their offset, the file size, a `nextOffset` when more remains, and a SHA-256 for files up to 1 MiB. Use that hash with `file_edit` to replace exactly one matching UTF-8 string; changed hashes, missing matches and multiple matches fail. `file_search` finds literal UTF-8 bytes in a file or matching names in one directory. Follow `nextOffset` to continue. Directory search is not recursive. These actions do not create parent directories.

An external writer can still race the hash check and write; it is not an atomic filesystem compare-and-swap. Failed effects that cannot be determined are recorded as uncertain and require reconciliation, not automatic replay. The paired action records and CLI status expose outcomes. Inputs that cannot be retained under the instance redaction rules are rejected rather than substituted. Unknown secrets and secrets split across file pages may still appear in output or retained history.

Skill results can occupy the guest cache up to its 2 MiB bound. Guest emitted and returned output remains bounded to 256 KiB, so a large skill can be processed inside the guest without returning its entire body.

The code tool runs a bounded QuickJS program. For example,
`return (await capabilities.clock({})).value;` returns the UTC time. Child calls
and direct clock calls share one action and approval service. The tool description
lists the eligible guest capabilities and their input schemas, and child calls
appear in work progress. Open **Code
execution** in the chat work details to inspect source, selected result and
linked action IDs. The paired CLI `instance status URL CREDENTIAL_FILE COMMAND_ID`
and `GET /api/commands/COMMAND_ID` expose the same execution and action records.
Known configured secrets are redacted; source that cannot be retained faithfully
is rejected. Unknown secrets can still be retained in source, output, provider
history and backups.

For an offline manual check, build and start the controlled fixture in
[development](development.md#review-chat-locally-without-a-provider), pair,
create a Demo agent with Hybrid, and send `Scripted clock fixture`. Expect
“Scripted clock completed” and a **Code execution** detail containing the
source, returned time and action ID. Select Direct or Code Mode for later work
and use a tool-capable provider to exercise the respective offer. This fixture
uses synthetic provider responses and does not establish live-provider behavior.
The broader basic-tools feature remains incomplete.

### Native process slice

Agents can call `terminal_run` with shell text and an optional `cwd`, and
`terminal_read` with a process ID and optional output cursor. `terminal_stop`
requests termination of an owned process. These operations run on the Staf
host with the service account's environment and access. The captured agent work
folder is the default; relative and absolute working paths are supported. They
are offered directly in Direct and Hybrid and through Code Mode in Hybrid and
Code. Existing scheduled and helper restrictions remain in force. Use `mode: "pty"` for a real terminal or the default `mode: "pipe"` for separate stdout/stderr. Set `retain: true` to keep a process after its accepted work completes; otherwise unfinished processes are stopped at work completion.

A paired owner can use `instance processes URL CREDENTIAL_FILE`,
`instance process URL CREDENTIAL_FILE PROCESS_ID`,
`instance process-output URL CREDENTIAL_FILE PROCESS_ID [CURSOR]`, and
`instance process-stop URL CREDENTIAL_FILE PROCESS_ID`. Output pages carry
base64 chunks labeled stdout or stderr, a cursor, and a gap indicator. Chat
shows processes alongside their originating work and offers output and Stop.
Stop requests termination; only an observed exit establishes an exit result.
Commands and working paths that would be changed by configured credential
redaction are rejected before execution. Output replaces known credentials
before storage; text and base64 show the same filtered bytes. Other binary
bytes are preserved. A possible credential prefix may wait for more output or
stream closure. Unknown or transformed credentials are outside this filter.

A live supervisor retains control of the owned process group after the shell exits. Stop requests group termination, but descendants that change group or detach may survive. A lost observation is reported as unknown; stored process IDs are not used to signal after restart.

### Interactive and retained processes

`terminal_run({command, mode: "pty", retain: true, cols: 80, rows: 24})` starts an interactive process with a real terminal. PTY output merges stdout/stderr into the `terminal` stream. Pipe mode preserves separate streams. Use `terminal_write({processId, data})` to submit exact UTF-8 input, `terminal_eof({processId})` to close a pipe or send terminal Ctrl-D, and `terminal_resize({processId, cols, rows})` for a PTY. Ctrl-D is an input character whose meaning depends on the program; it does not permanently close a PTY. Dimensions must be 1–1000. Input submission does not prove the application consumed it.

Retained processes remain usable by later accepted work for the same agent, regardless of its selected calling style. Guest return, ordinary error and guest limits do not stop them. Active-work Stop terminates every process started by that work, including retained ones. Explicit process Stop, agent archive and instance shutdown also request termination. Restart retains records and output but cannot recover a lost live handle.

Paired clients use the process `/input`, `/eof` and `/resize` endpoints. CLI commands are `instance process-input URL CREDENTIAL_FILE PROCESS_ID TEXT`, `instance process-eof URL CREDENTIAL_FILE PROCESS_ID`, and `instance process-resize URL CREDENTIAL_FILE PROCESS_ID COLS ROWS`. Input is exact: include a newline when the program expects Enter. Chat process details provide Send line, Close input/Send Ctrl-D, resize, output and Stop controls.

Each input accepts at most 16 KiB of UTF-8 and each process admits at most eight pending interaction requests. PTYs accept a cumulative 1 MiB per process, including Ctrl-D bytes; this bounds node-pty's unacknowledged write queue. The budget does not reset when an application produces output. Exhaustion leaves output and Stop usable. Pipe input uses write backpressure and has no cumulative input budget. Output keeps the existing 128 KiB buffer and explicit expiry gaps.

The pinned node-pty 1.2.0-beta.17 dependency ships native bindings; source installation permits that dependency's build scripts through the checked-in pnpm configuration. When a matching prebuild is absent, installation needs Python, a C/C++ toolchain and node-gyp. The supervised service targets Linux and macOS; real PTY and packed-install verification here is on macOS arm64. Linux runtime and Windows are not verified, and the service requires Unix signals, sockets and `/bin/ps`.
