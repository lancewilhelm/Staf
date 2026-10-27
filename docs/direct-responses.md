# Direct Responses architecture

Staf owns the agent loop, messages, tools and local persistence. The `codex`
provider now sends direct Responses requests. It does not start `codex exec` or
app-server, carry native coding-agent instructions, or inherit native tool access.
The old CLI adapter remains explicit legacy code for compatibility tests and old
auth management. It is not selected by the registry and is never a fallback.

## Supported authentication differs from the reference

Hermes commit `daec3cd4c6d34f5befbc8f25a8af3e3b84b94f06` is the primary design
reference for Responses message conversion, cache scope and usage. Its legacy
ChatGPT backend route and OAuth registration are not copied. Current OpenAI docs
specify dynamic registration for the app's own name and host, and inference at
`https://api.openai.com/v1/responses`. Staf uses that contract. It identifies as
Staf and does not impersonate Hermes or the official Codex client.

`codex-direct-auth.ts` owns the separate direct grant under `DATA_DIR/auth`.
`codex-host.json` holds a stable host UUID. `codex-direct.json` holds the issued
client ID, validated issuer/subject, tokens, scopes and expiry. No CLI auth path
is read. No OAuth token belongs in `.env`, settings JSON, a transcript or a request
body. Files are owner-only and replaced atomically through an exclusive lock.
Symlinked credential files and directories are rejected.

User-run login starts a temporary loopback listener on `127.0.0.1` at
`/auth/callback`. PKCE, state and nonce are fresh per attempt. Registration starts
with `dynamic_agent_client` and the actual name Staf. The callback's issued client
ID is required for exchange. RS256 ID-token verification checks OpenAI's published
JWKS, issuer, audience, expiration and nonce. Returning sign-in must match the
selected subject and client. The required direct plan scopes gate inference.

A login attempt owns the listener, deadline and cancellation signal through the
token exchange, identity checks and credential save. Cancelling before the final
file replacement prevents that attempt from changing credentials. An active
callback settles before cancellation is reported, so it cannot save later. If the
atomic replacement has already started, Staf waits and reports its actual outcome.

The authorization URL omits optional ID-token hints to keep identity tokens out
of terminal output. Expired retained ID tokens are not treated as access tokens.
Refresh uses only the separately issued direct refresh token, with a lock across
the exchange and atomic rotation. Failed refresh does not replace credentials.
Two processes do not use the same rotating refresh token concurrently.

This implementation supports one selected direct registration per data directory.
Account selection UI and multiple saved direct accounts remain future work.
Local logout removes the token record, not the server grant. No account quota
collector, legacy-token import or paid API-key fallback is implemented.

## Request and replay boundaries

`codex-direct.ts` builds separate user/assistant message items, `function_call`
items and `function_call_output` items. It supplies Staf instructions separately
and only exposes Staf's function definitions. Clock remains the only executable
Staf tool. Unknown function names return a tool error and cannot run a shell.

Each request uses `store:false`, `stream:true` and an OAuth bearer bound to the
fixed public endpoint. Redirects are rejected. The adapter never substitutes an
OpenRouter key, `STAF_API_KEY`, old CLI token or another destination on failure.
The current model must be explicit and available to the account. Model discovery
uses the same direct grant at `https://api.openai.com/v1/models`.

Completed output is normalized to existing messages. Optional `responseReplay`
stores whitelisted output items, including opaque encrypted reasoning, for the
same direct provider and exact model. Reasoning input includes the required
`summary: []` alongside saved encrypted content; older Staf replay records are
normalized at request construction without changing their files. This preserves function-call boundaries
without duplicating the visible assistant message. Assistant `phase` is preserved
when supplied, including `commentary` and `final_answer`. Other providers and changed
models receive the canonical visible history without opaque replay items. Old
session files remain readable. Replay is model-bound data, not memory or a grant
of tool permissions. No encrypted reasoning is decoded or displayed.

Assistant content accepts both `output_text` and `refusal` parts. Refusal
explanations appear in canonical assistant text in content order. Same-model replay
retains the original refusal parts and assistant phase. Other providers receive
the readable canonical history. Existing version 1 sessions remain readable.

The context display filters opaque reasoning only from its visible-size projection.
It does not remove or rewrite those items in saved history or actual requests.
The footer uses `(visible est.)` when opaque items are excluded; `/context` gives
their count and states that their token occupancy is unknown. Encoded ciphertext
length is not treated as a token count. Provider-reported input remains a separate
historical measurement.

## Stable cache scope is not a cache guarantee

The cache key hashes the persisted Staf session ID, model, instructions and
name-sorted function definitions. It stays stable as turns append. A different
session, model, instruction text or tool definition changes the key. Reasoning
settings do not change this static-prefix hash. Cache hints contain no raw
prompt or credential. History remains structured instead of one JSON transcript
inside a new user message. Routing, eligibility and expiry still control actual
cache hits. No live cache or performance claim is made for this direct adapter.

## Streaming, errors and cancellation

The adapter consumes bounded SSE with UTF-8 fragments, CRLF and multiple data
lines. Text deltas are provisional. Only `response.completed` produces a final
message and executable tool requests. The collector records announced output items
and completed `response.output_item.done` items by output index. When the successful
terminal snapshot has an empty `output` array, every observed item must be complete
and the indexes must be contiguous from zero before reconstruction.
This matches the direct stream observed on 2026-10-26: the message arrived in a
done event and the terminal array was empty. A nonempty terminal snapshot is used
once without appending duplicate done items. A nonempty snapshot must cover every
observed index. Both paths reject items explicitly marked incomplete or in progress.
Text deltas and announced items are never promoted into final output. Conflicting
completed duplicates and incomplete reconstruction fail closed. At most 32 output
indexes are retained within the existing 5 MiB stream bound.

Failed/incomplete events, malformed output,
missing terminal events and native output types fail closed. Repeated progress
or terminal events do not execute a function twice. There is no automatic HTTP
retry, token-exchange retry or alternate-provider fallback.

The provider contract exposes streamed events. The current CLI buffers assistant
display until completion so failed partial output and split secrets are not
committed or printed. The adapter also redacts the known bearer across delta
boundaries. Incremental CLI text presentation remains future work. Provider and
tool progress remain visible today.

The CLI creates each turn's cancellation controller before provider selection.
Ctrl-C during metadata checks prevents generation after those checks return.
Each turn builds an adapter from current effective settings; model catalog caching
remains separate. Model and reasoning shortcuts therefore affect the next request.
The CLI retains only the last announced adapter name for display and suppresses
unchanged provider notices. Conversation history and session-bound cache identity
remain owned by the runtime/session, not by an adapter instance.

Ctrl-C aborts fetch and reader consumption. Abort checks suppress late messages,
tool dispatch and successful persistence. The request has a 60-second timeout;
auth exchanges have bounded timeouts. Failed turns preserve prior history, with
unavailable usage when no trustworthy report returned. Persisted usage is not a
billing-reconciliation guarantee after crashes or storage failure.

The loop's four-step limit is unchanged. It executes only completed tool calls.
The current tool is read-only. Durable exactly-once side-effect journals, tool
approval rules and recovery for future shell/web tools remain required MVP work.
A manual retry is a new user attempt and can repeat a reversible clock read.

## Inclusive accounting

Responses `input_tokens` includes `input_tokens_details.cached_tokens`.
`output_tokens_details.reasoning_tokens` is an output subset. Staf retains these
subsets without adding them again, preserving missing versus reported zero.
Hermes uses an uncached internal input bucket and re-adds cached input in its
prompt total. Staf keeps its existing inclusive convention instead. No Codex
API-price estimate or account-quota inference is added. Historical CLI aggregate
observations remain labeled as execution scope.

## Verification and remaining gaps

Offline fixtures exercise signed OAuth callbacks and dummy refresh rotation,
request/cache contracts, fragmented streams, cancellation, replay, errors,
redaction and provider regressions. Public OIDC discovery confirms the issuer,
RS256 algorithm, authorization/token endpoints and JWKS URI.

On 2026-10-26, the user authorized live diagnosis and verification using an existing
Staf direct grant and `gpt-6-luna` with reasoning `high`. Before the fix, a completed
message item followed by an empty terminal output reproduced the parser error.
After the fix, the CLI returned `Staf is connected.` and a follow-up correctly
repeated that saved reply. A resumed session then executed clock exactly once and
returned the time after its function-result follow-up. The resumed test also
confirmed the required reasoning summary field, fixing an HTTP 400 on later turns.
This verifies basic generation, clock execution and same-model replay
for that account/model, not general model availability or billing reconciliation.
Later authentication, parser, CLI lifecycle and context-display fixes were
verified with offline fixtures and stored-session inspection, without new live
model requests. Multi-turn CLI regressions check full outgoing history, exact
encrypted replay, stable session cache identity and one saved conversation across
fresh adapters. Context projection tests check that ciphertext stays in replay
while the visible estimate excludes it. The last full offline run passed all
124 tests, including POSIX PTY menus, on 2026-10-26.

The remaining verification gaps are:

- A fresh real browser registration and sign-in through the in-process menu have
  not been recorded as live-verified. Signed dummy OAuth and loopback/PTY tests
  verify the local flow.
- Live refresh-token rotation has not been recorded as verified. Rotation and
  cancellation use dummy credentials in offline tests.
- The tiny cancellation race after credential-file rename has already started
  is source-reviewed, not fault-injected. Remote exchange and JWKS cancellation
  paths have deferred-fixture regressions. A started atomic replacement may win;
  the operation reports its actual outcome.
- Other accounts and models, live cache reuse and billing reconciliation are
  not established by the recorded smoke checks.

Raw response bodies and bearer tokens were not logged. Follow
[direct sign-in](codex-direct.md) for setup and recovery. Unimplemented provider
features are tracked under [deferred provider work](mvp.md#deferred-provider-work).

- [OpenAI streaming completed items](https://developers.openai.com/api/reference/resources/responses/streaming-events#response.output_item.done)
- [OpenAI fresh registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [OpenAI refresh and account storage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [OpenAI OIDC discovery](https://auth.openai.com/.well-known/openid-configuration)
- [Hermes reference](https://github.com/NousResearch/hermes-agent/tree/daec3cd4c6d34f5befbc8f25a8af3e3b84b94f06)
- [Reference notice](../THIRD_PARTY_NOTICES.md)
