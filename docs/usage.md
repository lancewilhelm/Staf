# Use Staf

For the persistent, hot-reloading local browser workspace and a terminal paired
to the same development instance, see [Run the development workspace](development.md#run-the-development-workspace). For a synthetic seed and explicit reset or recovery, see [Reset and recover development data](development.md#reset-and-recover-development-data).

## Answer a question set

A tool-capable agent can present a set of questions in its main chat. Choose an
answer, enter your own, or leave any question unanswered. For multiple-select
questions, you can combine choices and a write-in. Use **Next**, **Back**, or a
numbered question to move around. **Skip this question** clears its draft.
Submit at any time, including with no answers; unanswered questions are sent as
skipped. **Dismiss** declines the set. The chat remains available while it is
open, and ordinary drafts are saved on the instance across browser refresh and
service restart. Drafts may briefly be unsaved while a network request is in
progress; errors appear beside the controls.

The submitted set is retained as a new chat input, separate from later corrections.
If the original response completed, Staf sends one correlated follow-up to the
agent. That automatic follow-up has no tools: it can acknowledge your answers,
but further action requires a new message from you. If the original response
was interrupted, stopped, or failed, Staf retains the answers without resuming
it; inspect the prior work before giving new direction. A follow-up interrupted
by restart is not automatically replayed. Simple questions in an ordinary Slack
conversation can still be asked and answered in that conversation. Structured
question sets here are for main chat, not protected secret entry. Avoid putting
credentials in ordinary answers; detection is incomplete.

This behavior has controlled synthetic service and browser coverage, not live
model or Slack acceptance. Availability depends on the selected model supporting
tool calls; Direct, Hybrid, and Code Mode are supported.

For a disposable manual check with no provider account or network model call,
run `corepack pnpm run build` and then `node scripts/question-set-demo.mjs`.
Open the printed local address, pair with its printed code, and send **Ask a
set** to the synthetic agent. Type `r` and press Enter in the fixture terminal
to restart the service with the same disposable data, then refresh the browser.
Press Ctrl-C to stop it and remove that data. The fixture is separate from the
normal persistent development workspace.

## Start the shared terminal

Build and link the CLI once, then start it from your working directory:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm link --global
staf settings set-defaults codex MODEL_ID
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

A fresh instance requires a real provider and model. Replace `codex` and `MODEL_ID` in the setup command with your choice. No connection or inference is required to save it. Type `show settings`, `set model to NAME`, or `set reasoning to LEVEL` to inspect or change the current bot profile. Use
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
LEVEL`. Confirm a provider change with `/confirm-provider` after reviewing the history-transfer notice, or cancel with `/cancel-provider`. Use `/unset model` or `/unset reasoning` to restore the provider default. Changes are saved to the shared bot profile and apply to new work. Creation defaults are separate. Run `staf settings set-defaults PROVIDER MODEL [REASONING]` to set the provider and model together, including on a fresh instance. Use `staf settings defaults` to inspect them. In an interactive terminal, use `/set-defaults PROVIDER MODEL [REASONING]` to save the pair. `/models` reads
model metadata explicitly; a failed discovery does not prevent manual entry.

The available providers are `codex`, `openrouter`, `lmstudio`, and `live`.
Each requires an explicit model in the agent profile. Switching providers can send the
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
through the API or CLI. **New agent**, at the bottom of the sidebar, opens creation, and **Settings** controls appearance and
instance-wide provider connections. New agent uses the same settings form as an
existing agent, with provider, model, and reasoning choices visible. Choose Light, Dark, or System appearance;
Light is the default; System follows device appearance changes. The choice is saved
in this browser, independently of other browsers; clearing browser storage resets it.

The sidebar starts expanded. Use its panel icon to collapse it to the Focus rail;
the expand button then appears in the workspace header. Agent selection, New
agent, and Settings remain available in the rail. Settings offers Evergreen and
Ink palettes and **Layout and typography** controls for DM Sans or system sans,
text size, spacing, and corners. Defaults are Evergreen, DM
Sans, 14px text, 20px spacing, and 10px corners. These choices apply only
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
agent name or avatar in the chat header to edit its full settings and Instructions. The
optional **Instructions** field provides standing guidance in the agent's
`soul.md`. Use the information icons beside **Instructions** and **Tool mode** to read
their explanations by hover, focus, click, or tap. Press
Enter to send a message or Shift+Enter to insert a new line. The workspace keeps drafts when switching agents. If sign-in or a model is
missing, the submitted text remains beside an explanation and Retry control.

In agent settings, choose a provider and review its model and reasoning before
saving. Provider connections are shared by the instance, and a saved connection
does not verify account or model access. **Open provider settings** lets you repair
a connection and return to the unsaved form. Name, image, instructions, tool mode,
provider, model, and reasoning are saved together. A provider change requires
confirmation at Save because future requests can send the existing chat to the
new provider. Canceling that confirmation keeps the form. Navigating away keeps
the draft in the current tab; returning restores its original revision. **Cancel**
discards unsaved form edits. If a save fails or its acknowledgment is uncertain,
compare the latest settings and reconcile the retained draft before retrying.
Saving settings does not send a model request. Other agents keep their own choices.
In agent settings, select **Archive agent** to retain configuration and history
while preventing new work. Confirm the action in Staf. To restore it, expand **Archived agents** in the sidebar and select
**Restore agent** beside its name. An agent with active chat or background
work cannot be archived until that work settles.

In the shared terminal, `/stop` requests cancellation of the current main-chat response, including one started by another paired client, and reports its settled state and any stopped partial output. Incremental provider text is labeled provisional until the response settles. A line entered while your terminal command is unresolved is kept as an unsent draft. Use `/edit ID TEXT` to revise it and `/retry ID` after the response settles; drafts are never queued automatically.

Actual tool requests and success/failure outcomes appear below the corresponding user message. Expand an outcome to read bounded, redacted output. Pending chat approvals show the exact action and scope with **Approve once** and **Deny**. Decisions from other clients disappear on the next refresh. Observed outcomes remain visible after response failure or Stop. These are tool records, not hidden reasoning.

After an ordinary tool error or an explicit denial, the provider can receive the
matching result and produce a reply. A denied action closes admission for the
rest of that work, so a follow-up cannot execute another action. Stop still
ends the response. A provider failure or the four-step tool iteration limit can
leave no completed reply; inspect the response status and tool outcomes. A
provider decides its own wording, so a useful explanation is not guaranteed.

While a response runs, the workspace receives provisional text and progress over a shared-instance event stream. If the connection drops, the workspace reconnects and shows the latest saved progress.
Tool calls appear as compact rows before the next agent name and message. A response with several steps alternates tool rows, an agent message, more tool rows, and the next agent message. Intermediate messages remain visible after reload, failure, or Stop. Open a tool row to inspect its retained arguments and result. Approval requests and process controls remain available in the conversation. Older tool events without a call identity appear separately because their request and result cannot be paired reliably. Earlier responses without recorded message boundaries retain their existing tool group and final answer.
The composer has one circular action: an up arrow labeled **Send** when ready, and a square labeled **Stop** during an active response. You can type a next draft while the response runs. Select **Stop** to request cancellation; the response shows **stopping** until the provider and pending operations settle. The circular action stays disabled and labeled **Stopping response** until settlement, then returns to Send. The draft remains editable throughout; Enter cannot submit it during generation or stopping, and nothing is queued. Send it explicitly after the response settles. Stopped partial output stays in the conversation labeled **stopped** and is not treated as a completed provider reply. A provider that does not promptly honor cancellation can keep the agent in stopping until it returns.
Markdown headings, lists, links and code blocks render in assistant responses;
use Copy on a code block. Raw HTML is not rendered. The conversation follows new
output while you are at the bottom and stays in place when you scroll up.
Incremental output is available when the adapter supplies it; buffered adapters
show progress and then the completed message. A failed or interrupted response
remains labeled as incomplete.

Pending chat and task approvals appear in the conversation. Explicit background tasks show their status, outcome and activity there; task questions are visible but answers still require the CLI or API. The workspace checks for updates while visible; it does not provide background notifications.

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
when a stored command or creation operation verifies their origin. Otherwise, open **Settings > Earlier browser records** to inspect and copy saved
text and operation details, or discard an individual record after confirmation.
The section disappears when no earlier records remain. Staf does not submit or
assign these records to the current dataset automatically. A changed record or a
record owned by another open tab is not discarded.
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
### Shared core guidance

Staf supplies instance-wide operating guidance separately from each agent's
`soul.md`. The built-in core covers direct answers, proportionate detail,
useful follow-through, uncertainty, and service-enforced permissions. It names
no individual tool. Tool definitions describe the capabilities actually offered.
Upgrades adopt this text only when there is no custom override. To inspect or
adopt it deliberately, use **View latest built-in core** or **Reset core**.
Open **Settings → Advanced Settings** to edit the complete effective
core. **Save core** replaces the built-in text with your draft. Saving an empty
draft deliberately removes the shared guidance. Open **View latest built-in core**
to inspect the current shipped text. **Reset core** removes the override and
adopts that text. An unsaved draft stays in the editor when you navigate away or
reset; copy it before reloading or changing datasets.

If a save conflicts, fails, or its outcome is uncertain, the editor retains your
draft and blocks another save. Select **Compare latest core**, review the saved
content, and reconcile your draft before retrying. The editor uses the same
revision and authoritative file as the paired CLI. Inspect that file with:

```sh
node dist/cli.js instance core http://127.0.0.1:3210 "$HOME/.staf/dev-client/client.json"
```

The result includes the effective `content`, its `source`, `revision`, `path`,
and the latest `defaultContent`. To replace it, save UTF-8 Markdown in a file and
run `instance core-save URL CREDENTIAL_FILE REVISION FILE`. Use the revision
from inspection. An empty file deliberately disables only the shared core. To
remove the override and adopt the latest shipped default, run `instance
core-reset URL CREDENTIAL_FILE REVISION`.

The reported `path` is the authoritative override on the instance host. When
`source` is `default`, that file is absent; creating it activates an override.
Editing or deleting it directly affects newly accepted chat and task work.
Staf validates the file before accepting work. Invalid or unreadable content
blocks acceptance until repaired. An editor can overwrite an unobserved direct
edit, so coordinate direct writers. Client saves reject stale revisions. If a
save outcome is uncertain, inspect the current core before retrying.

Staf retains previous revision directories, which may contain private guidance.
If an editor writes an older open file after publication, Staf blocks new work
and reports its directory. Close that editor, compare the old and current files,
apply the desired changes, then remove the old directory's `.retired` marker.
Each accepted request retains its captured core, including during provider
continuations. A task retry retains its predecessor's captured profile. Prompt
text cannot grant tools or bypass service permissions, approvals, or Stop.
After relevant committed core, agent instruction, tool mode, provider, model, or
reasoning changes, the workspace may report that provider prompt-cache reuse
may decrease on the next message. It does not report this for name, image, or
creation-default changes. The notice depends on the selected provider and the
request inputs it uses. The direct ChatGPT adapter's local cache key includes
the model, instructions, and sorted tools; reasoning can change the request
without changing that key. A changed key or prefix does not establish a cache
miss, a hit, or a cost change. Provider cache behavior has not been verified live.

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

A later request after a provider change can send existing chat history to the new provider. Creation defaults set a real provider, model, and optional reasoning for future agents. The instance copies these settings at creation. In the creation editor, a cleared model and Automatic reasoning are saved as shown; the model can be chosen later. Saving a real default also moves remaining Demo agents, including archived agents, to that provider and model. Existing real-provider agents are unchanged. Migration does not authenticate or run inference. If a file conflict interrupts migration, repair the reported configuration and reload creation defaults to retry. Valid unrelated agents can still accept work. Revisions prevent stale clients from overwriting each other. In the paired CLI, use `instance defaults URL CREDENTIAL_FILE` and `instance defaults-set URL CREDENTIAL_FILE REVISION PROVIDER MODEL REASONING [TOOL_MODE]`; use `-` for automatic reasoning. Permission and approval settings remain separate. The description is owner-edited metadata visible to other bots; keep private instructions and memory out of it. New bots start with an empty description.
Select ChatGPT, OpenRouter, LM Studio, or live and an explicit model in the bot profile. OpenRouter uses the managed instance key described above; the instance command does not load the project `.env` file. ChatGPT uses the Staf grant under the directory containing the instance database. From a paired browser, use ChatGPT sign-in and open the provided link on the instance host. The initiating paired client can check or cancel that attempt, including after refreshing the page. The CLI provides `instance chatgpt-auth-start URL CREDENTIAL_FILE`, `chatgpt-auth-current URL CREDENTIAL_FILE`, `chatgpt-auth-status URL CREDENTIAL_FILE ATTEMPT_ID`, `chatgpt-auth-cancel URL CREDENTIAL_FILE ATTEMPT_ID`, `chatgpt-auth-credential URL CREDENTIAL_FILE`, and `chatgpt-auth-logout URL CREDENTIAL_FILE`. The callback listens on the same loopback origin. Revoking the initiating client prevents credential commit. These paths have been tested with synthetic auth only; live sign-in has not been verified. Provider failures do not fall back to another provider. Live provider execution has not been verified in this preview.

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

The CLI supports a helper clock scope with `instance task-start URL CREDENTIAL_FILE BOT_ID --delegate-clock OBJECTIVE`. It is off by default and recorded independently from the objective. Selecting it permits a helper to request clock reads, subject to current permissions and approval settings. Retries retain the original scope. Scheduled tasks currently receive no helper action scope.

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

The background engine and task history remain available through explicit API/CLI operations. The conversation shows each task, its state, result, activity and pending approvals, and offers Stop while it is active. Chat remains usable during the task. Main chat does not advertise or execute background-task creation. The CLI operations below can start and inspect tasks with a run
limit of five minutes by default. Stop requests cancellation and prevents new actions; the task remains stopping until its provider settles. Text and usage observed after Stop are retained as evidence, while the attempt remains stopped. An execution-limit stop retains its reason. Retry a failed, stopped, or interrupted
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

In chat and eligible tasks, a tool-capable model can search, read, remember, update, and forget within the existing agent and shared scopes. Set **Settings → Tools → Memory sensitivity** to allow model-classified ordinary changes or to review every model save and update. The default allows a model-classified ordinary change unless its text contains a configured sensitive term. Terms match case-insensitively anywhere in the text; add or remove terms in settings. A sensitive, uncertain or omitted classification requires review; an unrecognized value is rejected. A model can misclassify, and term matching misses synonyms and implicit details: choose **Review every model memory change** when this risk is unacceptable. The policy applies to model memory tools, not explicit owner memory commands or paired API and CLI changes. Native terminal and file access remain governed by their existing permissions and can write outside memory tools; these rules are not a filesystem sandbox.

Open **Agent settings → View agent memory → Memory proposals** to inspect the exact text, scope and target version, then confirm or deny. A confirmed agent proposal saves or updates that agent's memory; a stale update fails and can be denied. A sensitive shared creation requires this review and then the existing separate `Confirm shared memory PROPOSAL_ID` in that agent's chat. The final confirmation checks the approved text and current authority again. Shared updates still use their existing authority, with sensitive review added. Pending proposals survive restart. Disabling memory or archiving the agent denies its pending sensitive proposals and cancels their pending shared confirmations; re-enabling does not restore them. A plugin-originated proposal cannot be confirmed after its captured plugin access changes. A denial or confirmation cannot be replayed. Settings changes do not retroactively reclassify already saved memories or pending proposals. Helpers and scheduled tasks remain ineligible for these memory actions. Deletion still uses the existing version checks.

Saved memory lists are read-only; proposal decisions are available on each agent memory page. Use chat commands or the CLI to add, edit, or delete entries. The CLI uses explicit scopes. Use `memory-list URL CREDENTIAL_FILE user`, `memory-add URL CREDENTIAL_FILE bot:BOT_ID TEXT`, `memory-edit URL CREDENTIAL_FILE bot:BOT_ID MEMORY_ID VERSION TEXT`, and `memory-delete URL CREDENTIAL_FILE bot:BOT_ID MEMORY_ID VERSION`. Use `user` instead of `bot:BOT_ID` for shared user memory. Refresh after a conflict before editing or deleting. All paired clients act for the same owner.

Up to five keyword-matched entries from shared user memory and the addressed bot are included as untrusted data in each provider request. The matching is simple and may miss relevant memories. Injected entries are not added to saved conversation messages. Deleting an entry removes it from active memory and future retrieval; it does not erase prior transcripts, action records, backups, or provider requests already sent or in flight. New work-action invocations store a keyed fingerprint instead of memory-save or update input; older action records are not rewritten. Pending sensitive proposals separately store their exact text in the instance database for owner review; their text is cleared on decision, but database files and backups can retain prior bytes. Provider messages, chat and task history, tool event details and Code Mode source can contain proposed text independently of the action journal. A memory saved or listed in chat remains in that transcript and can be sent again as ordinary conversation history after deletion. Memory is stored in the instance database and shares its access protections. A migration backup is created before upgrading an existing database. Offline integration tests cover this preview; a scripted response to an interruption preference demonstrates the retrieval path, not empathy or reliable live model behavior. Live providers have not been verified for memory.

### Skills in the shared instance

The workspace does not yet provide skill management controls. A paired client can import explicit skill text, name, description and provenance through the CLI or API. Skill IDs and revisions are stable records; updates create a revision. A disabled skill is unavailable to every bot. All paired clients act for the owner.

For the CLI, use `instance skill-import URL CREDENTIAL_FILE NAME DESCRIPTION PROVENANCE BODY`, `skill-list URL CREDENTIAL_FILE`, `skill-inspect URL CREDENTIAL_FILE ID`, `skill-update URL CREDENTIAL_FILE ID REVISION NAME DESCRIPTION PROVENANCE BODY`, `skill-enabled URL CREDENTIAL_FILE ID true|false`, `skill-availability URL CREDENTIAL_FILE ID BOT_ID true|false`, and `skill-bot-list URL CREDENTIAL_FILE BOT_ID`. BODY is literal text, not a path or URL. Skill text is limited to 256 KiB. These commands do not read files or fetch URLs. Configured credential values are redacted from imported names, descriptions, provenance and text before storage, and from existing entries when read. The catalog `digest` identifies the originally submitted bytes, so it can differ from the displayed text after redaction. Existing database records and backups are not rewritten to remove previously stored credentials.

A tool-capable provider receives at most 32 available skill names, descriptions, IDs, revisions and hashes and may choose one in response to ordinary language. Direct and Hybrid offer `select_skill` as an individual tool. Hybrid and Code Mode also offer it as a guest capability. Selection is model-dependent and may be missed or ambiguous. The server validates the exact ID and revision and current availability when loading. Task attempts capture their catalog at acceptance, while live disable or removal stops subsequent model requests and tool actions after a skill was loaded. Successful loads appear in task Activity and in the command status `skillActivity` with name, ID, revision, `sourceDigest` for the original submitted bytes, and `loadedContentDigest` for the UTF-8 bytes of the redacted body loaded into the tool result. Older load records have only the source digest; a loaded-content digest cannot be reconstructed reliably. A recorded load does not establish that a subsequent provider request completed. A provider statement alone does not create a load record. Adapters without tool support cannot load skills.

Imported text is untrusted data in a tool result and does not grant tool permissions or run scripts. It can influence model output. Disabling does not retract content already sent to a provider, remove saved conversation records or backups, or undo actions already completed. Prior direct skill results and code results linked to skill child actions are removed from later provider replay; ordinary chat history may still contain information derived from it. Skill management, selection and permission checks are offline-tested with synthetic providers; natural-language selection and behavior with live providers are not verified. The import format and automatic skill creation, update and retirement remain open product decisions.

### Clock approvals in the shared instance

This first-delivery instance treats every paired client as acting for its sole owner; there are no separate owner and client roles. Any paired client can inspect and decide requests and change settings. The shared instance gates its `clock` tool for both main chat and background tasks. The default is **Ask for risky actions**, under which this read is routine. **Ask every time** pauses each clock action until a paired client approves or denies that specific request. **Never ask** still respects instance and bot clock permissions and the task's clock boundary. A task override selects its mode over a bot override, which selects over the instance default. Disabling the clock at any applicable boundary blocks it.

Pending clock requests appear inline in chat, where the owner can approve or deny them once. Approval settings are not yet available in the workspace. The CLI exposes `instance approvals URL CREDENTIAL_FILE`, `instance approve URL CREDENTIAL_FILE REQUEST_ID`, and `instance deny URL CREDENTIAL_FILE REQUEST_ID`. Inspect settings with `instance approval-settings URL CREDENTIAL_FILE SCOPE`; set them with `instance set-approval-settings URL CREDENTIAL_FILE SCOPE MODE true|false`. Scope is `instance`, `bot:BOT_ID`, or `task:ATTEMPT_ID`; mode is `ask-every-time`, `ask-for-risky-actions`, `never-ask`, or `inherit` for a bot or task. The boolean controls clock access at that boundary.

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

Web reading permission is disabled by default. A paired owner must enable it for the instance and bot. Ordinary background tasks additionally require their own task permission. A scheduled task instead receives only its captured exact URL scope, which can be disabled explicitly for the task; helpers cannot use web reading. The task permission readback distinguishes the owner override, inherited scheduled scope and current effective access. Use `instance web-permission URL CREDENTIAL_FILE SCOPE` or `instance web-permission-set URL CREDENTIAL_FILE SCOPE true|false` to manage these switches. `SCOPE` is `instance`, `bot:BOT_ID`, or `task:ATTEMPT_ID`.

A tool-capable bot may propose a public HTTP(S) page. A paired owner must approve each exact target, including each redirect, before DNS or HTTP. Use the browser approval list or `instance web-approvals URL CREDENTIAL_FILE`, `instance web-approve URL CREDENTIAL_FILE ACTION_ID`, and `instance web-deny URL CREDENTIAL_FILE ACTION_ID`. Web requests with credentials or query strings are rejected. A started request interrupted by restart is marked uncertain and is not automatically repeated. Revoking permission or stopping a task cancels in-flight reads.

Page text is untrusted data and cannot grant authority. The action journal records keyed fingerprints and generic outcomes. URLs supplied or generated in chat and source text may be retained in conversation, provider replay, Activity, and backups. Configured known secrets are redacted where implemented. Arbitrary chat, page text and model output may retain unknown secrets, and sensitive text cannot be reliably detected. Cancellation does not erase retained records. Synthetic dependencies test the integration; live web and live provider behavior have not been verified.

### Search through an owner-configured backend

Search permissions are separate from web reading and are disabled by default. Configure the exact local backend origin in the form `http://127.0.0.1:PORT` in Settings or with the CLI, then explicitly enable instance and bot search. An ordinary background task also requires its own search permission. A scheduled task can use only its captured exact query and backend scope, subject to an explicit task disable; helpers are not supported. Task readback distinguishes the owner override, inherited schedule scope and current effective access. The selected loopback port can identify any local HTTP service; only configure a backend you trust. In Docker, `127.0.0.1` refers to the container itself.

Each search requires owner approval of the exact query and backend before dispatch, unless an enabled matching reusable grant applies. In ordinary chat all three tool modes use the same search action, approval and result; the backend is never chosen by the model. The CLI supports `instance search-config URL CREDENTIAL_FILE`, `search-config-set URL CREDENTIAL_FILE REVISION ORIGIN` (use `-` to clear), `search-permission URL CREDENTIAL_FILE SCOPE`, `search-permission-set URL CREDENTIAL_FILE SCOPE true|false`, `search-approvals URL CREDENTIAL_FILE`, and `search-approve` or `search-deny` with an approval ID. Search has a limit of two concurrent dispatches within one instance process and ten dispatches per rolling minute per instance database; the rate history survives restart. Separate instance processes do not share a concurrency limit. Interrupted started actions become uncertain and are not automatically replayed.

The backend and its upstream search engines may retain queries. Queries, results, snippets and model output may also be retained in chat, provider replay, Activity, and backups. Unknown secrets cannot be reliably detected. Search results are untrusted previews. Result URLs containing percent-encoded sequences or configured secrets are omitted, and Staf does not automatically open result pages. A later public-web read requires its own permissions and approvals. Tests use synthetic providers and a disposable local HTTP fixture; a real SearXNG deployment and live provider behavior have not been verified.

### Scratch-only shell

Scratch-shell calls are currently blocked while credential isolation is
unverified. The configuration and recovery controls described below remain
available to the owner for existing records.

Scratch shell is disabled by default. A paired owner must configure an absolute Docker CLI path, an absolute Unix daemon socket path and a pinned `sha256:` image ID, then enable instance and bot permission. Ordinary background tasks also require their own shell permission. Helpers cannot use it. A scheduled task may use only its captured exact command and Docker configuration, subject to an explicit task disable. Task permission readback distinguishes the owner override, inherited scope and effective access. The commands `instance shell-config URL CREDENTIAL_FILE`, `shell-config-set URL CREDENTIAL_FILE REVISION DOCKER_BINARY DOCKER_SOCKET IMAGE_ID`, `shell-permission URL CREDENTIAL_FILE SCOPE`, and `shell-permission-set URL CREDENTIAL_FILE SCOPE true|false` manage configuration and permissions. Use `- - -` to clear the configuration. Existing bot permissions and approval settings remain independent.

Each exact command requires owner approval in the browser or through `shell-approvals`, `shell-approve`, and `shell-deny`. The integration passes only a fixed 16 MiB, 1,024-inode scratch tmpfs to the sandbox, with a 30-second execution limit and 64 KiB output limit. It does not mount a host workspace. The Docker binary, daemon and pinned image must be trusted. The exact command is visible to host process observers and Docker container configuration until removal. Scratch tmpfs may use swap, and Docker can provide runtime-managed mounts. Commands, output and unknown secrets may persist in provider replay, conversations, Activity and backups. Known configured secrets are redacted where supported; arbitrary output may contain secrets that cannot be reliably detected.

An uncertain start, stop or cleanup blocks further scratch commands and daemon configuration changes. Inspect the recorded endpoint with `shell-uncertain` and independently verify the daemon identity before review. Staf compares endpoint configuration strings but cannot prove that the binary or socket still identifies the same daemon. A missing container does not prove that a delayed create cannot appear later. After independently verifying the daemon identity and inspecting it, the owner may explicitly acknowledge the risk with `shell-review URL CREDENTIAL_FILE ACTION_ID --acknowledge-uncertain` to record a review. This records a review; it does not remove a container or retry the action. The original action ID is never reused. Integration tests use a synthetic executor; the scratch component was separately tested with a disposable container, but live model-directed shell execution has not been verified.

## Provider choices

Open the composer model control to choose provider, model and reasoning. The
picker loads model metadata when opened or when the provider changes. Creation,
agent settings, and provider defaults also load metadata automatically. Choose a
listed model or enter a model ID. The selected listed model is marked. If
metadata is unavailable, the entered ID remains editable and you can retry.
Discovery reads metadata only. It does not verify authentication, account access,
or inference.

The composer saves provider, listed model, and reasoning choices immediately.
Manual model text saves when you leave the field. The picker stays open until
you click outside it or press Escape. A provider change asks for confirmation in
the picker because the next request may send conversation history to that
provider. The message draft remains editable. Agent settings and creation stage
choices with the other fields until you save or create the agent.

**Automatic** leaves reasoning to the provider. Known model metadata limits the
explicit choices. Choosing a model that advertises incompatible reasoning resets
the effort visibly; unknown metadata preserves it. A later request can still
reject an explicit effort. Global Settings → Provider defaults configures each
provider's first-use pair. Returning to a provider restores that agent's
remembered pair. Changing first-use pairs does not update existing selections.
Saving a real creation default also migrates existing Demo agents to that pair.
An explicit provider uses its own defaults or an explicit choice. Discovery alone
does not change a saved selection.

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

## Manage tool availability

In **Settings → Tools**, inspect and enable or disable clock, memory, web
research, and files for the instance. All four are enabled on a fresh install
and when an older instance is upgraded. Save changes explicitly. These controls
apply to Direct, Hybrid, and Code Mode in chat and eligible tasks; they do not
change agent permissions, task scope, approval modes, or the native terminal.
Disabling memory also stops automatic recall for new provider requests. Your
saved memories, tool history, configuration and permissions remain in place.
Reenable a tool to make it available again, subject to the same permissions.
Already dispatched external actions cannot be undone; disabling web research
requests cancellation of active web reads and searches.

The search backend can be inspected and configured in the same settings section.
It must be a trusted SearXNG origin of the form `http://127.0.0.1:PORT`.
Availability alone does not grant web or search permission: those permissions
remain off on a fresh instance and are managed separately through the paired
CLI. Search additionally requires a configured backend and exact-query approval;
see [search setup](#search-through-an-owner-configured-backend) and
[web reading](#public-web-reading). Existing permissions are never widened
by enabling a tool.

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

In chat and eligible tasks, Direct offers eligible individual tools, Hybrid offers those tools and `code_mode`, and Code Mode offers `code_mode` with the same registered capabilities inside it. The code tool description lists eligible registered capability names and input schemas. Fabricated individual calls are rejected. Web reads require approval for each redirect target. Agent host file, native process, and scratch shell calls fail closed until a credential-isolation backend is established and verified; changing tool availability or approval settings cannot bypass this restriction.
Background tasks use their captured mode for eligible registered capabilities, including clock and task questions, discovery and helper exchanges. A helper uses its own captured mode; helper and scheduled-work restrictions still apply. Pending owner input defers queued actions until the task drains its inbox. Plain text does not start a guest. Settings edits apply to new work; an accepted task and its retries retain their captured profile and task context. Clock permissions and applicable approvals remain live.

The host file implementations remain in the codebase, but agent calls are blocked before execution while isolation is unavailable. The working directory alone is not a sandbox.

An external writer can still race the hash check and write; it is not an atomic filesystem compare-and-swap. Failed effects that cannot be determined are recorded as uncertain and require reconciliation, not automatic replay. The paired action records and CLI status expose outcomes. Inputs that cannot be retained under the instance redaction rules are rejected rather than substituted. File reads check surrounding bytes for complete known credentials, including credentials split across page boundaries; a page near a credential may also be rejected. Pattern-recognized tokens are checked back to their boundary; a read fails if the boundary cannot be established within the bounded lookback, including for very long benign tokens. Unknown or deliberately transformed secrets may still appear in output or retained history.

If recovery is fenced after an opaque or uncertain change, inspect the action
and resource first. The paired CLI supports
`instance reconcile-action URL CREDENTIAL_FILE command|task WORK_ID ACTION_ID EVIDENCE_FILE`.
The JSON evidence must match a supported service observation: a settled native
process (`processId` and `observedCursor`), current file-write `sha256`, updated
memory `version`, or forgotten memory (`absent: true`). See the
[reconciliation reference](reference.md#action-reconciliation).
This clears a supported recovery fence for active work; it does not repeat an
effect, reopen stopped work, or override unknown outcomes. Unselected script read
payloads expire when work ends; selected output and conversation history remain.

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
create the fixture agent with Hybrid, and send `Scripted clock fixture`. Expect
“Scripted clock completed” and a **Code execution** detail containing the
source, returned time and action ID. Select Direct or Code Mode for later work
and use a tool-capable provider to exercise the respective offer. This fixture
uses synthetic provider responses and does not establish live-provider behavior.
The broader basic-tools feature remains incomplete.

## Secret requests

A tool-capable agent may request a name, purpose, and intended destination in
main chat or background work. Any currently paired browser can save, skip, or
dismiss the request. The input is masked by default and can be revealed before
saving; a saved value is never returned to the browser or model. The model gets
only the outcome. A pending request survives a restart as interrupted: dismiss
it and start a new attempt rather than replaying work. Saving neither enables a
plugin nor authorizes a destination, and there is not yet a supported path to
use, select, or replace a named secret through this feature. Settings lists
nonsecret metadata and can delete a named secret after confirmation. Deletion
does not revoke a provider credential or erase backups. Existing
Gmail and Slack credential files are unchanged.

Named values are unencrypted in `secrets/credentials.sqlite` under the instance
data directory, with owner-only directory and file permissions. The service
account, host administrator, and anyone with a copy of the store can read them.
Agent-accessible host execution and file tools are blocked on every platform;
this does not protect against pre-existing detached processes, other programs
running as the service user, host administrators, or host compromise. Stop old
agent processes before using the store. No Linux isolation or live provider
acceptance has been demonstrated. Do not paste secrets into ordinary chat.

A stopped full data-directory backup includes the secret store. Protect it like
the original. Development reset/restore snapshots do not include or restore this
store; retain it separately when moving development data. Backup copies may
retain values after any later removal. No master password is required at restart.


## Native process slice

Agent calls to native processes and scratch shell currently fail closed on all
platforms. No Linux isolation backend is implemented or verified. Paired owners
can still inspect or stop previously recorded resources, but old detached
processes may survive an upgrade and must be stopped separately before storing
secrets. The following describes the retained process implementation, not
currently available agent execution.

The retained implementation accepts shell text and an optional `cwd` through
`terminal_run`, reads output with `terminal_read`, and requests termination with
`terminal_stop`. It runs on the Staf host with the service account's access,
which is why agent access is blocked. Its launch environment omits
`OPENROUTER_API_KEY`, `STAF_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, and
`LMSTUDIO_API_KEY`; other variables remain available. This omission is not a
security boundary: commands and file tools can still reach files and other
resources accessible to the service account, including credential files, and
unknown credentials or aliases in the environment are not removed. A future
backend must provide a verified boundary before restoring agent access.


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

The retained implementation supports interactive PTY and pipe resources, but
agent access to these actions is blocked as described above. PTY output merges
stdout/stderr into the `terminal` stream. Pipe mode preserves separate streams.
Input submission does not prove the application consumed it.

Previously retained processes may still be visible to paired clients. Explicit process Stop, agent archive and instance shutdown request termination. Restart retains records and output but cannot recover a lost live handle.

Paired clients use the process `/input`, `/eof` and `/resize` endpoints. CLI commands are `instance process-input URL CREDENTIAL_FILE PROCESS_ID TEXT`, `instance process-eof URL CREDENTIAL_FILE PROCESS_ID`, and `instance process-resize URL CREDENTIAL_FILE PROCESS_ID COLS ROWS`. Input is exact: include a newline when the program expects Enter. Chat process details provide Send line, Close input/Send Ctrl-D, resize, output and Stop controls.

Each input accepts at most 16 KiB of UTF-8 and each process admits at most eight pending interaction requests. PTYs accept a cumulative 1 MiB per process, including Ctrl-D bytes; this bounds node-pty's unacknowledged write queue. The budget does not reset when an application produces output. Exhaustion leaves output and Stop usable. Pipe input uses write backpressure and has no cumulative input budget. Output keeps the existing 128 KiB buffer and explicit expiry gaps.

The pinned node-pty 1.2.0-beta.17 dependency ships native bindings; source installation permits that dependency's build scripts through the checked-in pnpm configuration. When a matching prebuild is absent, installation needs Python, a C/C++ toolchain and node-gyp. The supervised service targets Linux and macOS; real PTY and packed-install verification here is on macOS arm64. Linux runtime and Windows are not verified, and the service requires Unix signals, sockets and `/bin/ps`.

## Gmail plugin

Gmail is optional and starts disconnected. One account can be connected through
**Settings → Plugins → Gmail**. The service records new message candidates and
lets a paired owner inspect them. An agent can search and read mail in chat only
after both agent access and a separate, explicit model disclosure decision.
Connecting Gmail alone does not authorize sending email to a model. The opt-in inbox assistant can assess new candidates and send scoped Slack updates. Optional Google scopes allow an agent to propose a reply or inbox change for approval in Slack.

To prepare an owner-operated connection:

1. In your own Google Cloud project, enable the Gmail API and configure the
   OAuth consent screen. Create an OAuth client of type **Desktop app** and
   obtain its client ID and client secret. If the app is in external Testing
   mode, add the Google account as a test user. The connection requests
   `https://www.googleapis.com/auth/gmail.readonly`, a restricted scope used
   for read/search and history. Reply sending additionally requests
   `https://www.googleapis.com/auth/gmail.send`. Inbox changes additionally request
   `https://www.googleapis.com/auth/gmail.modify`, which Google also permits for
   sending; Staf separately requires its send setting and approval for replies.
   Google's [scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes)
   and [restricted-scope verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
   explain applicable verification and exceptions. Do not assume that a
   particular personal or organizational configuration qualifies.
2. Open Staf using `http://127.0.0.1:3210/` or its selected loopback port.
   For a remote host, use an SSH tunnel forwarding the same port and open the
   loopback address locally; the OAuth callback needs that loopback address.
   The HTTPS LAN gateway is not an OAuth callback address. Use the paired
   browser and open **Settings → Plugins → Gmail**.
3. Enter the intended Gmail address, desktop client ID and client secret. To
   allow approved replies, select **Allow Gmail to send replies after explicit
   approval in Slack**. To allow approved label, archive, and mark-read changes,
   select **Allow Gmail inbox changes after explicit approval in Slack**.
   Reconnect and select the permissions you want if the existing connection
   lacks them. Select
   **Begin Google authorization**, then **Open Google authorization**. Sign in
   to the intended account and grant the requested access. Google redirects to
   the local Staf callback. Return to Settings and refresh Gmail status. Staf
   checks that the Google profile email matches the address entered; the
   connection starts disabled and agent access starts off.
4. Choose **Enable** to start monitoring. To let an agent read mail, allow its
   access and separately confirm **Allow Gmail to** the displayed provider and
   model. That decision allows message text and search results to be sent to
   that provider during this agent's chat. It does not apply to another provider
   or model. To use Gmail in background tasks or Slack-originated work, separately
   confirm **Allow Gmail in tasks and Slack work**. Existing chat permissions do
   not grant that access. Revoke either permission in Settings. Enabling and
   **Check Gmail connection** refresh the token and check the profile. After a restart,
   connection status is **Not checked** until the next check or successful poll.

Staf captures the Gmail history ID when the account is first connected, without
reporting existing mail. While enabled, it polls approximately every 30 seconds
and commits message IDs, evidence and the history cursor together. The same ID
is recorded once across retries and restarts. Settings lists all mailbox additions
and lets the paired owner inspect them without a model call.

Gmail history entries normally contain only message and thread IDs. For each new
addition, Staf separately reads the message's current labels and last-modified
history ID. It infers inbox evidence only when that ID equals the addition's
history record ID and `INBOX` is present; it excludes messages carrying `SENT`,
`DRAFT`, `SPAM`, or `TRASH`. A matching ID and other labels are recorded as a
non-inbox candidate. If IDs or labels are missing, the message has since changed,
or metadata cannot be retrieved, inbox membership is uncertain. These candidates
remain in Settings for owner review and are not automatically assessed or sent to
Slack. This conservative inference is not a guarantee of exact historical
classification, and a move into the inbox after a non-inbox addition is not a new
message arrival. To assess an uncertain candidate, inspect it and choose **Assess this candidate** in Gmail settings. Confirm the model disclosure; the assessment always requires private clarification before Slack shares details. This does not change the recorded evidence or establish historical inbox membership.
Legacy candidates without recorded evidence remain uncertain; their pending
assistant deliveries are marked stale on upgrade rather than sent. See Google's
[history reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
and [message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages)
for the available fields. Gmail's [watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)
filters push notifications; Staf uses history polling, not watch.


To enable the inbox assistant, first configure an approved Slack DM bound to the
same agent, and grant that agent both Gmail model permissions above. Under
**Inbox assistant**, enter attention guidance and sensitive topics, then enable
monitoring and confirm the displayed model-provider disclosure. Staf sends the
candidate sender, subject, snippet and bounded plain text to that provider for
assessment. The captured agent instructions and attention guidance are used. Optionally, you can separately approve sending relevant active agent and user memories to that same model provider. Pending sensitive-memory proposals and other agents’ private memories are excluded. Memory must remain enabled. When any memory is used, Staf asks for private approval before disclosing the resulting summary in Slack. A model can make
mistakes, so define sensitive topics and review the results. Staf also treats a
match to a configured sensitive term, truncated message, or message without extractable plain text as private. HTML and attachments are not assessed.

A relevant candidate classified non-sensitive and urgent receives a useful update in the
approved DM. Less urgent candidates accumulate into a digest at the configured interval (1–1,440 minutes). The interval is measured from setup or the last due check, rather than a fixed local clock time. Empty digests are quiet. Digest batches and their individual items survive restart; an uncertain send is never automatically repeated. A sensitive or uncertain candidate receives only a generic question
in that DM; reply yes or no in its thread. An affirmative response authorizes
that one summary in the same thread. Other replies ask for clarification. No
sender, subject or message content appears in the initial question. Staf does
processes eligible additions recorded since the connection baseline, including
those collected during initial setup, only after monitoring and model access are
explicitly enabled. A later re-enable resumes unprocessed eligible additions;
previously claimed items are not processed a second time. Compatible preference edits retain pending immediate updates, private questions and digest items. Changes to sensitive topics or memory with the same authority send pending unapproved details for private clarification. Authority changes mark pending work stale for review. Changes to Gmail, Slack, agent or model authorization
pause the assistant; enable it again after reviewing permissions.

History checks and evaluation failures are recorded. The assistant sends one
generic Slack alert for a continuing failure when the approved DM is available;
a recovered check permits a later failure alert. A failed or safely stale assessment can be explicitly retried from Gmail settings under current authority; failed attempts with other recorded actions cannot be retried. To find an older assessment, use **Load older candidates** in Gmail settings. Each member of a stale digest can be reassessed separately. Staf retains the earlier assessment and batch evidence and asks privately before sharing the new result. This starts a new assessment rather than replaying actions. A definite Slack rate-limit rejection retains the full valid retry delay across restart and reassessment. If Slack gives an invalid or unrepresentable delay, the delivery is held for owner review and is not retried automatically. A Slack send with an unknown outcome is marked uncertain and is not automatically repeated. In Gmail settings, review the exact attempted text and inspect Slack. You can mark a message delivered, dismiss it, or explicitly confirm sending the same text again; a resend can duplicate it and requires current authority; Staf refuses a resend when a subsequent privacy change requires renewed review. An uncertain generic clarification cannot be marked delivered because its Slack thread is unknown. The Settings status also flags failed and stale work for review in agent tasks.
Reply in an individual update or clarification thread with a correction such as
“This should have been less urgent” or “This is sensitive.” Staf records the
correction for inspection in Gmail settings and may use it as context for later
messages with the same normalized From header, matched by a keyed digest rather
than a stored sender address. This is not proof of sender identity. A sensitivity correction also moves pending updates from that
sender to private clarification and treats later messages from that sender as
private, even if you later correct that item’s urgency or say it is not sensitive. To remove that correction, reply “Forget that correction” in the same
individual thread. Saying “not sensitive” is a correction, not
permission to share the current private message or automatically downgrade later
messages: answer the separate question explicitly. For a digest with several items, identify the position, for example “The second item should have been urgent.” To clear a correction on a digest item, reply “The second item forget that correction.” Staf asks for the position when the target is ambiguous. Edit the attention and sensitive-topic
preferences in Settings when you want a standing rule.

Assessment and delivery use controlled fixtures only; live provider quality,
Slack and Google behavior have not been verified.

If Gmail reports that the saved history ID expired, Settings reports an unknown
interval and stops automatic polling. **Start monitoring from now** records the
gap and establishes a new baseline only after confirmation; it cannot reconstruct
missing arrivals. Accounts connected by an older Staf version have no baseline:
they require that same explicit step and record the earlier interval as unknown.
Disable pauses polling without deleting the cursor or candidates. Gmail's history
can expire during a long outage or while disabled. A scan is limited to 100
history pages and 10,000 distinct message IDs. If that limit or a connection
error prevents a scan, it reports failure and keeps the old cursor. An explicit
restart from now records the unknown interval rather than claiming recovery.

In Direct, Hybrid, and Code Mode, an agent with access and model permission can
call `gmail_search` and `gmail_read` in main chat. Slack-originated chat also
requires the separate task and Slack model permission.
Search returns at most 20 IDs per call and signals when
more exist; narrow the query to find others. Read returns bounded plain text,
headers and a snippet; HTML and attachments are not included. Gmail content is
untrusted data, not instructions. Read fails rather than truncating a Gmail API
response over 2 MiB, and displayed plain text is limited to 16,000 characters.
For a background task, the paired owner can include `gmailQuery` in the
`POST /api/tasks` body. The exact query is the task's Gmail scope. The task can
read only IDs returned by that query in that attempt. Retries, scheduled tasks,
and helper assignments do not inherit this scope. In an authorized Slack DM,
`work gmail: in:inbox` starts a task scoped to the exact query `in:inbox`.
Replace that query with the intended Gmail search. The agent must already have
Gmail access and both model permissions when the task starts. Changes to
the connection or any permission stop subsequent Gmail work.

After a Gmail result in a turn, other tools are unavailable for the rest of that
turn except Gmail search, read, and approved action proposals. Inbox monitoring tasks are restricted to the scoped read and cannot propose Gmail changes. This also applies to guest calls already queued behind the Gmail action. Ordinary Slack updates remain
generic. To propose a reply, the agent must read the original message in that
work and have an enabled Slack connection for the same agent. Staf first asks
the approved Slack user a generic question before showing the proposal. If the
user chooses **Show proposal**, Slack displays the account, recipient, subject,
and complete plain-text body with **Approve send**, **Request changes**, and
**Deny** buttons. To request changes, select **Request changes**, then reply in
the indicated thread. The old buttons stop working. The agent receives your
direction and must make a new proposal with a new disclosure and approval.
Only an approval of that proposal can send it. A reply has one recipient and no
attachments. The subject must be nonempty, at most 400 characters, and match the
original message, as required by [Gmail threading](https://developers.google.com/workspace/gmail/api/guides/threads).
The body limit is up to 2,600 characters; the complete proposal must fit within
3,000 characters. An agent may need another instruction if it cannot revise
the proposal. Edits are requests to the agent, not direct edits of the email.

For an inbox change, the agent must first read the target message in the same
work. It can propose adding an existing user label by its exact name, archiving
the message, or marking it read. Staf resolves the label name to its Gmail ID
and checks it again before dispatch. Slack shows the account, message, and exact
change after the generic disclosure question. Approval applies only that change.
The Gmail account can change between the final check and Google's operation.

Slack receives a generic send result. A timeout, lost connection, or interrupted
send or change can leave the outcome unknown. Staf does not replay an uncertain
action and blocks further actions on that message until the owner reviews it.
In **Settings → Plugins → Gmail**, review **Gmail outcomes needing review**.
Check Sent mail or the message's labels in Gmail, then record your finding. If
you are unsure, leave it unresolved. Recording a finding does not retry anything;
a new action still needs a new approval. The paired command or task API also
includes `gmailReplies` with the recorded effect and state. Pending
approvals are interrupted on restart and old buttons cannot send. The separately enabled inbox assistant uses the scoped disclosure flow above. The owner's
visible chat, task activity, and proposal records can contain the email and
should be protected like the mailbox.
Gmail tool results and generated replies from that turn are omitted from later
model replay and captured task context; the owner's original request remains.
An agent must search again to use the mail in a later turn. This cannot recall
content already sent to the explicitly allowed provider.

Disable retains credentials, agent access and model disclosure settings.
Disconnect disables the plugin and removes its local credentials, but retains
account configuration and all permissions. Reconnecting the same account can
therefore make an existing model permission usable again; revoke it separately
if that is not wanted. Delete Gmail configuration removes all permissions.
Neither action
revokes the grant at Google; revoke it in Google account settings if desired.
Reconnect requires the client secret and Google consent again. The client secret
and refresh token are stored in host-local `auth/gmail.json` with restrictive
permissions, outside SQLite and outside normal dataset backups. Protect the
host and securely backed-up credentials; otherwise reconnect after restore.
External apps in Google Testing mode with this scope generally receive refresh
tokens that expire after seven days; Google can also revoke tokens for other
reasons. See Google's [OAuth token expiration guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

OAuth, monitoring, read/search, and reply sending are covered by synthetic HTTP
and controlled model fixtures. Real Google sign-in, token refresh, mail, history
delivery, Slack interactions, and model behavior have not been tested. No live
account is needed for tests.

## Slack plugin

Slack is bundled and inactive until the owner configures it. This preview binds
one workspace, one approved Slack user and one direct-message channel to an
existing Staf agent. It uses Socket Mode, so Slack does not need a public Staf
URL. It does not accept channels, group DMs, other users, message edits or bot
messages. The approved user can interact with that agent's main chat and the
agent's existing capabilities and permissions; messages and responses are sent
to its selected model provider. Choose these identities with that access in mind.

To set up your own Slack app:

1. Create an app in the desired workspace, enable Socket Mode, and create an
   app-level token with `connections:write`. Under OAuth & Permissions add the
   bot scopes `im:history` and `chat:write`; under Event Subscriptions subscribe
   the bot to `message.im`. Enable **Interactivity** for the approval buttons.
   Install the app in the workspace. Enable the Messages
   tab and allow users to send messages if Slack presents that setting.
2. Open the app's direct message and find the workspace ID (`T...`), your user
   ID (`U...`), and the DM channel ID (`D...`). Slack's profile and workspace
   links expose user and workspace IDs; a copied link to a message in the app DM
   includes the DM channel ID. IDs identify the approved conversation; names
   are not sufficient. Slack's [Socket Mode guide](https://docs.slack.dev/apis/events-api/using-socket-mode/),
   [`message.im` reference](https://docs.slack.dev/reference/events/message.im/),
   and [`chat.postMessage` reference](https://docs.slack.dev/reference/methods/chat.postMessage/)
   describe the transport, scopes and reply behavior.
3. In **Settings → Plugins → Slack**, enter the app-level and bot user tokens,
   the IDs and an existing active agent. **Connect** checks the bot token's
   workspace with Slack. Then explicitly **Allow agent access** and **Enable**.
   A connected status means the Socket Mode WebSocket opened, not that a DM
   has been tested. An app token or Slack settings error may require correcting
   the setup and enabling again.
4. Send a harmless test DM from the approved user. The agent's response should
   appear in that DM, or in the originating thread for a threaded message.
   Inspect the corresponding main chat and **Recent message outcomes** in
   Settings. A busy agent or failed model request is recorded, not queued.

Disable stops the socket and cancels active Slack chat responses while retaining
configuration, access, and history. Accepted Slack background tasks continue;
their delivery waits until the same approved destination and agent are enabled again. Disconnect also removes the locally saved
Slack tokens, while preserving the binding and history. Delete saved configuration
removes the binding and agent access as well. These actions do not uninstall the
Slack app or revoke tokens at Slack. Reconnect requires the tokens again. Tokens
are stored as a host-local `auth/slack.json` file with restricted permissions;
they are not returned to clients or included in the instance database. Protect
host access and backups. Consult the backup instructions for which files are
included; reconnect Slack after a restore unless the credential file was
explicitly and securely restored.

Ask the agent for work in a normal DM, for example, “Please investigate this
and let me know what you find.” A tool-capable model can choose to start
independent work; the service uses your original message as its objective and
sends a receipt in that message's thread. For an update, direction, an answer,
or Stop, reply in that same thread in ordinary language. Staf binds these actions
to that thread's task. If there is no unique binding or open question, it asks
for clarification and makes no change. If older work shares a thread, quote the
full original request from the offered choices to identify it. Start a new
top-level message for a new task. An agent can run one background task at a time.

The agent still uses its captured identity, context, tool mode, permissions and
task scope, and service approval rules continue to apply. This task workflow does
not itself decide action approvals; Slack email approval is addressed separately
in [issue #109](https://github.com/lancewilhelm/Staf/issues/109). A model that
cannot call tools cannot use the natural-language task capabilities. Existing
`work:` and ID-based controls remain available for diagnostics and older threads.

Receipt, actual tool progress, questions and the terminal outcome are sent to
the request's thread. A result does not require another DM. If Slack is disabled,
disconnected or rate limited, pending delivery is retained for the same
workspace, user, channel and agent; reconnect and enable that same binding to
resume. A confirmed Slack acceptance is not proof that a person read the message.
Inspect **Recent task deliveries** in plugin settings. A send with an unknown
result is marked uncertain and never automatically replayed. Inspect Slack and the
stored task before deciding what to do. A service restart interrupts unfinished
tasks; it does not rerun model work or uncertain effects, and the interrupted
outcome is delivered when possible. Duplicate events are not run again. Replies
are limited to 39,000 characters. Socket Mode does not backfill events missed
while disconnected. Slack and model behavior have controlled offline coverage;
real workspace setup and delivery have not been validated by the implementation
tests.

## Home-network browser access

The optional [native HTTPS gateway](native-linux-installation.md#enable-home-network-https-access) lets a paired browser reach the loopback instance over a trusted home network. Each browser origin needs pairing; CLI access and ChatGPT loopback sign-in use SSH forwarding. Native Linux, LAN and live sign-in remain unverified.
