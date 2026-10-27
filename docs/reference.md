# Configuration reference

## CLI flags

| Flag or command | Meaning |
| --- | --- |
| `--provider NAME` | `demo`, `openrouter`, `codex`, `lmstudio`, or `live`. Uses saved provider default, otherwise `demo`. |
| `--reasoning LEVEL` | Provider-specific effort override; `default` omits the override. |
| `--model ID` | Explicit model override. Rejected with demo. |
| `--session ID` | Resume a UUID from the selected data directory. |
| `--data-dir PATH` | Session directory. Defaults to `.staf/` relative to the current directory. |
| `sessions` | List saved session IDs without calling a provider. |
| `--live` | Legacy alias for `--provider live`. Conflicts with another selected provider. |
| `auth codex login` | Start explicit browser sign-in for the Staf direct grant. |
| `auth codex status` | Report local direct sign-in readiness without refreshing. |
| `auth codex logout` | Remove local direct tokens; does not revoke the server grant. |
| `--help` | Print usage without loading credentials or calling a provider. |

## Environment variables

Staf loads `.env` from the current directory. Only the settings below are accepted
from that file. Existing shell variables take precedence. CLI model overrides take
precedence over variables. A live provider is selected by an explicit flag or saved default; a key alone
does not select a provider. Explicit session settings can override the selection.

| Variable | Used by | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter | Required |
| `STAF_MODEL` | OpenRouter and legacy live | Required unless `--model` is supplied |
| `OPENROUTER_REASONING_EFFORT` | OpenRouter | `default` |
| `STAF_CODEX_REASONING` | Codex | `default` |
| `LMSTUDIO_REASONING_EFFORT` | LM Studio | Only `default` supported |
| `STAF_REASONING_EFFORT` | Legacy live | Only `default` supported |
| `STAF_CODEX_MODEL` | Codex | Required unless supplied by `--model` or saved settings |
| `LMSTUDIO_MODEL` | LM Studio | Required unless `--model` is supplied |
| `LMSTUDIO_BASE_URL` | LM Studio | `http://localhost:1234/v1/` |
| `LMSTUDIO_API_KEY` | LM Studio | No authentication header |
| `STAF_API_KEY` | Legacy live | Required |
| `STAF_BASE_URL` | Legacy live | `https://api.openai.com/v1/` |

The legacy live adapter uses OpenAI-compatible Chat Completions and can incur
API charges. It remains available for compatibility with earlier Staf usage.
OpenRouter fixes its endpoint to `https://openrouter.ai/api/v1/chat/completions`.

The `.env` parser accepts literal `KEY=value`, optional `export`, and matching
single or double outer quotes. Blank lines and full-line comments are accepted.
It does not expand variables, decode escape sequences, or parse inline comments.
Symlinks, nonregular files, and files larger than 64 KiB are rejected. No setting
in `.env` changes PATH, `CODEX_HOME`, or the official Codex login store.

HTTP endpoints require HTTPS except on `localhost`, `127.0.0.1`, or `[::1]`.
Base URLs cannot contain credentials, query parameters, or fragments. Redirects
are rejected. Requests have a 60-second timeout and no automatic retries.
Buffered Codex subprocesses have a 120-second timeout and a 4 MiB captured-output
limit. Explicit interactive login has a ten-minute timeout and inherits the terminal.

## Scripts

| Command | Effect |
| --- | --- |
| `pnpm run build` | Compile strict application source to `dist/`. |
| `pnpm run check` | Check application types without emitting output. |
| `pnpm test` | Build and run JavaScript tests against compiled output. |
| `pnpm start` | Build and start the CLI. |

## Capability facts

Codex uses direct Responses at a fixed public endpoint, with Staf-owned function
tools and normalized streaming events. The CLI buffers assistant display until
completion. OpenRouter, LM Studio and legacy HTTP retain buffered Chat
Completions. Clock is the only executable tool. No native Codex tool is exposed.
Signed registration/refresh edge cases are offline-tested. Direct `gpt-6-luna`
text generation, a history follow-up and a resumed clock-tool round trip were
live-tested with an existing grant
on 2026-10-26; this does not establish access for other accounts or models.

## Direct Codex authentication

In chat, `/auth codex login|status|logout` manages the direct grant using the
running chat's data directory. `/settings` offers sign-in after confirmed Codex
selection when a valid local credential record is missing, and includes a
**Codex sign-in / reconnect** action. Interactive startup with Codex selected
also offers setup if needed. Choosing sign-in explicitly starts authorization;
menu sign-in success resumes model selection. Textual login returns to chat.
Denied/failed login returns to chat. Ctrl-C cancels pending login and exits chat.
Cancellation reaches the token exchange and identity checks. An active callback
settles before cancellation is reported. Once atomic credential replacement has
started, its actual outcome is reported rather than an early cancellation.
The URL is printed in full outside the menu. These actions make no generation
request and do not borrow CLI credentials. Status does not validate server access
or token freshness; existing records may still need reconnecting after rejection.

The standalone `auth codex login|status|logout [--data-dir PATH]` also manages the direct grant under
`DATA_DIR/auth`. Login listens on loopback for up to ten minutes and requires user
browser consent. Status reads local readiness without refreshing. Logout removes
local tokens only. The host ID stays stable. Token exchanges time out after 15
seconds and serialized refreshes rotate atomically. No `.env` or CLI auth record
is used. See [sign-in](codex-direct.md) and [auth contract](direct-responses.md).

The explicit `auth codex-legacy` alias manages the old isolated CLI context for
compatibility. It is not selected by `--provider codex` and cannot provide direct
generation credentials. The public OAuth endpoints and JWKS were verified without
a grant. Offline generation tests use dummy responses; the earlier live smoke
checks are listed under capability facts.

## Provider selection and identity

| Adapter | Model sources below session overrides | Endpoint or runtime | Session provider identity |
| --- | --- | --- | --- |
| demo | No model allowed | In-process deterministic reply | `demo` |
| openrouter | `--model`, `STAF_MODEL`, saved per-provider model | Fixed OpenRouter Chat Completions URL | `openrouter:MODEL` |
| codex | Explicit `--model`, `STAF_CODEX_MODEL`, or saved model | Public Responses with separate Staf OAuth grant | `codex-direct:MODEL` |
| lmstudio | `--model`, `LMSTUDIO_MODEL`, saved model | `LMSTUDIO_BASE_URL`, then loopback default | `lmstudio:ORIGIN/API_ROOT/:MODEL` |
| live | `--model`, `STAF_MODEL`, saved per-provider model | `STAF_BASE_URL`, then OpenAI default | `live:FULL_CHAT_ENDPOINT:MODEL` |

Provider names are case-sensitive. There is no `STAF_PROVIDER` variable,
`--base-url` flag, automatic model discovery, automatic `.env.local` loading, or
API-key login option in Staf. Explicit `settings models` discovery is available. Configuration and model choice are not automatically restored from a transcript;
resume uses current settings, shows the previous provider, and preserves history.
Direct Codex requires an explicit account-available model ID. Historical
`codex:MODEL` identities remain execution aggregates.

HTTP API roots gain a trailing slash if needed, then `chat/completions` is appended.
For example, LM Studio's default becomes
`http://localhost:1234/v1/chat/completions`. OpenRouter ignores STAF_BASE_URL and
STAF_API_KEY. LM Studio ignores STAF_BASE_URL, STAF_MODEL, and STAF_API_KEY.
Empty model values trigger the next fallback. Empty shell values for the same
variable still override `.env` values because the file is merged before selection.

## HTTP request and response facts

The shared HTTP transport sends one POST with `model`, the complete normalized
message history prefixed by Staf's system message, and tool definitions. It sends
no streaming option. OpenRouter adds `reasoning.effort` only for an explicit
supported effort; generic transports do not receive that control. A configured key
becomes a Bearer Authorization header; LM Studio omits that header without a key.

The adapter accepts `choices[0].message`, validates its assistant role and text or
tool-call shape, and normalizes the supported fields. Supported provider usage
fields are normalized into the separate session ledger; raw usage objects, other
choices, reasoning metadata and unsupported provider fields are not preserved.
See [usage mappings](usage-accounting.md#provider-contracts). Malformed JSON or an
invalid message aborts the turn. It does not download or discover models.

The adapter declares tool-protocol support, not proof that every selected model
supports tools. The harness executes only the allowlisted clock with empty object
arguments, sends its result back, and allows at most four provider steps and eight
tool requests per response. Requests for unsupported tools become tool errors.
Configured-MCP rejection applies to Codex's own runtime, not to HTTP transports.

The shared Chat Completions adapters buffer output and do not retry automatically.
HTTP status errors expose only the status and a generic hint; raw response bodies
are not logged. Network, redirect and timeout failures share the connection error.
Provider setup is lazy. A missing key/login or failed call keeps chat settings
available. Invalid explicit CLI choices still fail at launch. Failed turns retain
the last completed conversation snapshot. Observed usage can still be persisted,
but failed activity is not durably audited.

A saved provider identity does not bind the session to an account or API key.
Changing a key or signing in to another scoped Codex account can send the same
conversation to that account. Credentials are not stored as part of session identity.

## Versioned nonsecret settings

The canonical settings guide is [settings.md](settings.md). The file is
`DATA_DIR/config/settings.json`, version 1, with a `defaults` object. Supported
keys are `provider`, `model.openrouter`, `model.codex`, `model.lmstudio`,
`model.live`, `endpoint.lmstudio`, and `endpoint.live`. Draft defaults may lack
credentials or a model; `show` reports setup warnings without constructing an adapter.

Precedence is built-in, saved default, project `.env`, shell, CLI, then this-session
settings. `/settings set session KEY VALUE` applies on the next request.
Chat `/settings set default KEY VALUE` applies now and persists; terminal
`settings set default` affects future launches only. Provider/model changes reset
reasoning to default, and selecting another provider's field activates that provider. `/settings show` lists effective sources and saved values
separately. Each chat turn selects an adapter from the current effective values,
including changes made through `model` and `reasoning` shortcuts. The `Provider:`
notice appears on the first selection or an adapter identity change; per-request
progress and adapter construction do not create new conversations. Ctrl-C during
provider preparation prevents that turn from starting generation.
`/settings reload` rereads config before a completed turn. `back` and
`cancel` do not undo applied edits. A corrupt config is never silently reset.

Model IDs permit up to 200 characters in the supported identifier alphabet.
Values must be nonempty and at most 2048 characters. API roots use the transport's
scheme and credential restrictions and must not end in `/chat/completions`.
These validations apply to saved, environment-derived, and explicit settings;
previously accepted model prose or full chat endpoint URLs now fail coherently.
Unknown config versions and fields fail safely. Credentials remain in their
existing separate stores. Configuration operations do not construct adapters or call network clients.

## Model catalogs and effort

The canonical reference is [model-selection.md](model-selection.md). Additional
settings keys are `reasoning.openrouter`, `reasoning.codex`, `reasoning.lmstudio`,
and `reasoning.live`. Nondefault effort is supported only for OpenRouter and Codex
when per-model metadata advertises the requested backend string. Default identities
remain unchanged; explicit effort adds `:reasoning=LEVEL` to the provider identity.
`settings models [refresh]` and `settings reasoning [refresh]` expose metadata only.
Shared selection verifies effort support before constructing a live adapter.

No settings JSON is bundled as a product default. Package files are allowlisted;
`.staf/`, actual `.env` files, auth, logs, and private vision/interview notes are
excluded from the distribution. Developer defaults remain in local ignored data.

## Usage commands

`/usage [details|help]` reads the local session ledger. It never queries account
quotas, adds generation calls, or estimates dollar costs. Optional session `usage`
records are backward compatible with files lacking them. See the complete
[field mappings and accounting rules](usage-accounting.md).

## Context commands

`/context [refresh|help]` explains the running payload proxy/window display. Only
`refresh` triggers existing metadata discovery; passive display makes no network
request. Window mappings are OpenRouter `context_length` and Codex account-catalog
`context_window`, positive integers for the exact selected model. Others remain
unknown. See [context status](context.md). Staf compaction is not implemented.

New optional usage observation fields: `scope: request|execution` and ISO
`observedAt`. Old sessions remain readable. Context rendering shows historical
last-request input separately from next-payload estimates; no measured-plus-delta
baseline is asserted without exact payload lineage.

The recurring context footer shows `Context: demo` for demo or a labeled visible
payload estimate for direct Codex and other HTTP providers. When same-model Codex
replay contains opaque reasoning, `(visible est.)` identifies the projection that
excludes its ciphertext. `/context` reports excluded item count and unknown token
occupancy separately from provider-reported historical input. Unsent replay and
per-message usage metadata are excluded for other HTTP adapters. The display does
not modify history, replay, requests or the ledger. `/context` retains timestamps,
sources and compaction caveats;
`/usage` retains consumption accounting. No context/usage fields were removed.

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
