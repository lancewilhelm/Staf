<!-- Normal interactive entry point: pnpm start; provider selection is in /settings. -->
# Use Staf

## Start the offline demo

1. Open a terminal in the project.

```sh
git clone https://github.com/lancewilhelm/Staf.git
cd Staf
pnpm install --frozen-lockfile
pnpm start --provider demo
```

2. Enter `hello`. Expect an echo marked `Demo (offline)`.
3. Enter `what time is it?`. Expect `tool_start`, `tool_result`, and a UTC timestamp.
4. Enter `/quit`. EOF also exits.

Demo mode uses no model. Saved defaults can select another provider, so the
explicit demo flag keeps this exercise offline. A credential alone selects no provider.
On a new checkout, run `pnpm install --frozen-lockfile` before starting.

## Configure OpenRouter

OpenRouter requests can spend API credits. Choose the model and key before making
a request. Use a model that supports function calling for Staf's clock tool.

1. Create `.env` in the project with your editor if the file does not already exist.
2. Use [.env.example](../.env.example) for the variable names. Leave any existing `.env` intact.
3. Set `OPENROUTER_API_KEY` and `STAF_MODEL` to your key and chosen model ID.
4. Restrict file access.

```sh
chmod 600 .env
```

5. Start the provider.

```sh
pnpm start --provider openrouter
```

To choose a different model for one run, replace `PROVIDER/MODEL` below with its ID.

```sh
pnpm start --provider openrouter --model PROVIDER/MODEL
```

You can keep using exported shell variables instead of `.env`. Shell variables
override `.env`, including empty values. CLI model flags override both sources.
Staf does not write OpenRouter credential files. Codex credentials do not belong in `.env`.

## Give Staf its own Codex login

Start Staf with `pnpm start`, then open `/settings`. Choose Provider, a scope,
Codex, and confirm. Staf offers **Sign in with ChatGPT** if credentials are missing.
Choose it, open the printed URL, and review Staf's ChatGPT-plan permissions in the
browser. After consent, the same Staf process resumes model selection. Choose an
account-available model and confirm before chatting. Starting with Codex already
selected also offers setup when a local credential record is missing or invalid.

For plain terminals, reconnecting, or status checks, use these inside chat:

```text
/auth codex login
/auth codex status
/auth codex logout
```

Textual login returns to chat; select a model with `/settings`. The menu also
provides **Codex sign-in / reconnect**. These actions use the current data directory
and make no generation request. Status is local only. Standalone
`pnpm start auth codex login|status|logout` remains available for recovery.

Credentials live in `DATA_DIR/auth/codex-direct.json`, separate from the earlier
isolated CLI login. No credential migration, CLI fallback or app-server is used.
See the complete [fresh sign-in and recovery guide](codex-direct.md).

The direct stream can deliver a finished message before its final completion
notification. Staf retains that message and displays it only after the response
succeeds, including when the final notification's output array is empty. Failed
or interrupted turns still preserve the last completed history. A model refusal
appears as an assistant reply with its explanation, rather than a parser error. Text generation,
a history follow-up and a resumed clock-tool round trip with `gpt-6-luna` were live-tested on 2026-10-26 using an existing
user-authorized grant; other model/account access is not implied.

## Use an existing LM Studio server

1. Select a model already available in LM Studio.
2. Start its local server yourself if it is stopped.
3. Replace `LOADED_MODEL_ID` below with the server's model ID.

```sh
pnpm start --provider lmstudio --model LOADED_MODEL_ID
```

Staf defaults to `http://localhost:1234/v1/`. Use `LMSTUDIO_BASE_URL` for another
endpoint and `LMSTUDIO_MODEL` for a default model. Set `LMSTUDIO_API_KEY` only if
your server requires authentication. Staf sends no Authorization header otherwise.
The implementation did not start a server, download a model, or expose a network port.

## Use the legacy HTTP adapter

This adapter can incur charges at the configured endpoint. Use it for a generic
OpenAI-compatible Chat Completions server, rather than for Codex subscription auth.
Staf requires a key for this adapter even if the target server itself does not.
Use the dedicated `lmstudio` adapter for a local server without authentication.

1. In your shell or project `.env`, set `STAF_API_KEY` and `STAF_MODEL`.
2. If using another server, set `STAF_BASE_URL` to its API root, such as
   `https://your-provider.example/v1/`. The `.example` address is a placeholder.
3. After configuring a real endpoint and approving its cost, start the adapter.

```sh
pnpm start --provider live
# Equivalent legacy spelling:
pnpm start --live
```

The default API root is `https://api.openai.com/v1/`. The transport appends
`chat/completions`; do not set the base URL to the complete chat endpoint.
No model is selected automatically. Pass `--model MODEL_ID` to override
`STAF_MODEL` for one invocation. `--provider live` always uses API-key billing,
not ChatGPT subscription login. It does not use OPENROUTER_API_KEY or Codex auth.

## Resume a conversation

1. Copy the session ID printed at startup, or list the stored IDs.

```sh
pnpm start sessions
```

2. Resume with the same provider, model, and endpoint used for that session.

```sh
pnpm start --session SESSION_ID
pnpm start --provider openrouter --model PROVIDER/MODEL --session SESSION_ID
pnpm start --provider codex --session SESSION_ID
pnpm start --provider lmstudio --model LOADED_MODEL_ID --session SESSION_ID
```

Use the first command for demo sessions. The others are separate alternatives.
If you used an explicit Codex model before, pass that model again.
Use `--data-dir PATH` on both runs to store sessions outside the default `.staf/`.
Start a new session when you change provider or model. Version-1 sessions from
the original JavaScript version still load without migration.

## Resolve common errors

- For `ERR_PNPM_UNSUPPORTED_ENGINE`, run `pnpm --version` and `node --version`.
  Staf requires pnpm 10.27.0 or later and Node 22 or later. The interactive shell
  previously selected Corepack pnpm 10.27.0 while automation selected Homebrew 12.11.2.
  Both now work. You do not need a global update to run Staf.
- For a missing API key or model, set the named variable or pass `--model`.
  An empty shell variable overrides a nonempty `.env` value.
- For HTTP 401, check the selected provider's key. For 402, check credits. For 429,
  wait before retrying. Staf does not retry paid calls automatically.
- For an LM Studio connection failure, inspect its server status and endpoint.
  Staf does not start the server for you.
- For a model rejecting tools, select a model that supports function calling.
  Staf cannot prove the selected model's capabilities before the request.
- For a Codex login error, use `/auth codex status` inside chat, then `/auth codex login` to reconnect. This adapter requires ChatGPT
  sign-in. Check model access and subscription limits if execution fails.
- For a damaged conversation, keep the JSON file for inspection and start a new
  session. Staf refuses to overwrite malformed snapshots.
- For a session lock after a crash, confirm no Staf process uses that session before
  removing that session's `.json.lock` file. Do not remove an active session's lock.

Provider failures leave the last completed turn unchanged and keep the chat open
for `/settings` or a retry. Invalid launch flags still exit with code 1. Retry the user message after resolving the error. See the
[configuration reference](reference.md) for parser restrictions and exact settings.

## Check configuration without generating

These commands build or inspect help and do not call a model.

```sh
pnpm run check
pnpm test
pnpm start --help
```

For a complete local exercise, start demo with a disposable directory, ask for
the time, quit, then resume its printed ID using the same directory.

```sh
pnpm start --provider demo --data-dir /tmp/staf-demo-example
pnpm start --provider demo --data-dir /tmp/staf-demo-example --session SESSION_ID
```

Replace SESSION_ID with the UUID from the first run. Existing settings are not
changed. This example creates local conversation files; it is not a live-provider test.

A configuration example for a new `.env` is shown below. Replace the placeholder
values yourself before selecting a live adapter. Do not overwrite an existing file.
Do not put quotes around a shell expression expecting Staf to expand it.

```dotenv
OPENROUTER_API_KEY=YOUR_OPENROUTER_KEY
STAF_MODEL=PROVIDER/MODEL
STAF_CODEX_MODEL=
LMSTUDIO_MODEL=LOADED_MODEL_ID
LMSTUDIO_BASE_URL=http://localhost:1234/v1/
LMSTUDIO_API_KEY=
```

Provider selection uses saved defaults, then explicit overrides; absent both, it
defaults to demo. A key does not select its provider.
For independent cloud and local models, use STAF_MODEL for OpenRouter and
LMSTUDIO_MODEL for LM Studio. STAF_BASE_URL affects only legacy live; it cannot
redirect OpenRouter or Codex. Auth commands ignore this file entirely.

`/settings` opens an arrow/hjkl menu in an interactive terminal. Enter selects;
Escape backs out without saving. Textual `/settings show` still works.
[Settings and recovery](settings.md) covers the primary in-chat menu, terminal
commands, effective sources, persisted defaults, and application timing. Provider
construction is lazy: entering settings never checks login or starts generation.

## Inspect models and choose effort

Use `/settings models` for an explicit metadata read, then select by model ID
with `/settings model session ID`. `/settings reasoning` reports the selected
model's advertised choices. Use `/settings reasoning session LEVEL` before a
request, or `reasoning default LEVEL` to apply now and remember the choice. `default` means
leave the provider's effort unchanged, not turn reasoning off. Model and reasoning
shortcuts apply on the next request even after a completed conversation turn.
Ctrl-C during provider setup stops that turn before generation starts.

See [model and reasoning selection](model-selection.md) for safe terminal examples,
manual fallback, provider differences, cache/refresh behavior, and resume identity.
Saved defaults apply only to your local data directory and are not shipped.

## What a conversation stores and which tools run

Successful turns save normalized user/assistant/tool messages, provider identity,
and activity events in `DATA_DIR/<UUID>.json`, normally `.staf/`. Empty sessions
can be created before the first turn. Failed turns keep the last completed history;
settings slash commands never become chat messages. Later turns use the full
stored history. `--session ID` resumes it across processes. No compaction is present.

Nonsecret defaults live separately in `DATA_DIR/config/settings.json`. Direct
Codex credentials live in `DATA_DIR/auth`; the legacy CLI context remains separate.
Staf persists its own conversation history regardless of legacy native thread
options.

The only Staf-dispatched tool is clock. Demo requests it for time prompts; HTTP
models can request it through normalized tool calls; the Codex CLI planner returns
a structured clock decision that Staf executes in the legacy adapter. Direct Codex now returns Responses function calls. The old CLI adapter was a native runtime,
not a bare API model. Its native access restrictions and limitations are described
in [architecture](architecture.md). This is not a claim of tool-free or stateless chat.

## Menu-first startup

Run `pnpm start`, open `/settings`, and choose Provider, then This session.
Confirm to use the provider on the next request. Remembering a personal default applies now and persists for subsequent launches. Provider-specific flag examples
above remain valid for scripts; `--provider` is optional. Back/Escape moves up
the menu hierarchy. Existing conversations can switch between requests while preserving history.

The `Provider:` notice appears on the first request or when the active provider,
model or reasoning identity changes. `[provider_start]` is request progress, not
a new chat. All successful turns use the same running session and append to its
history. Use `--session ID` to resume that conversation after restarting.

## Inspect usage

Run `/usage` locally in chat, `/usage details` for per-call sources, or `/usage help`
for the caching explanation. This makes no model/account request. Missing fields
remain unavailable. See [usage accounting](usage-accounting.md) for provider
reports, subset rules, failure/resume coverage and subscription limits.

## Inspect context separately

The short context footer updates after operations. Demo shows `Context: demo`.
Direct Codex and other HTTP adapters show a labeled estimate and known window when
available. A direct request with opaque reasoning replay shows `(visible est.)`.
Its ciphertext is excluded from the estimate without removing it from requests.
Its actual token occupancy is unknown. `/context` explains the
visible-payload proxy and selected window; `/context refresh` reads metadata
explicitly. It does not measure cumulative consumption, and it does not enable
compaction. See [context display](context.md) for scope and accuracy limits.

Explicit `/context` output leads with provider-reported input from the latest HTTP
call, with provider/model/time and historical scope. Its next-payload estimate
remains separately labeled; native Historical Codex CLI execution aggregates are not request
occupancy. Missing measurements stay unavailable.
