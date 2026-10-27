# Read the context display

The current Codex provider is direct Responses. Its recurring footer now uses
the same labeled visible-payload estimate as other direct HTTP providers. The
old `Context: unavailable` footer referred to native CLI occupancy, not a direct
Responses request. `/context` and `/usage` preserve historical execution labels.


The recurring footer is intentionally short. Demo shows `Context: demo`. Direct Codex and other HTTP adapters show a labeled payload estimate, such
as `Context: ~1.4k / 128k (est.)` when fresh window metadata is known, or
`Context: ~1.4k tokens (est.)` when the window is unknown/stale. The denominator is
advertised metadata, not a guaranteed usable input budget. When same-model direct
Codex replay includes opaque reasoning, the suffix is `(visible est.)`. Its encoded
ciphertext is excluded from the text proxy; its actual token occupancy is unknown.
Detailed caveats are
available below rather than repeated after each message.

The `Provider:` notice appears on the first request and when the selected adapter
identity changes, including model or reasoning changes. `[provider_start]` remains
visible for each request. Neither line creates a chat. One running CLI session
keeps its saved history and session ID across turns; `--session ID` resumes it on
a later launch. Starting without `--session` creates one new conversation at launch.

Provider/model are already shown by the session header and provider activity,
so the footer does not repeat them. It appears at startup/resume and after an
operation, not twice around each turn or on every typed/streamed token. Routine
timestamps, historical counts and compaction diagnostics stay in `/context` and
`/usage`. Unsubmitted input is excluded.

```text
/context
/context refresh
/context help
```

`/context` and `/context help` explain the local display without provider I/O.
`/context refresh` explicitly uses the existing model metadata discovery (no
generation or account quota endpoint). `/settings models` and menu discovery
also populate the same memory cache. OpenRouter and compatible catalog reads do not send credentials;
Codex reads its direct account catalog using its separate Staf grant. A failed
refresh leaves settings/history intact.

## Three different numbers

1. **Session consumption** in `/usage` adds observed provider requests, including
   repeated history and tool continuations. It survives resume and model switches.
   Missing reports remain unavailable. It is not current context size.
2. **Next visible payload proxy** is computed from the current replay history and
   Staf-owned instructions/tool schemas. It is a rough estimate, not measured
   token occupancy. In `/context`, the prominently displayed last HTTP input count is measured
   by the provider, with observation time, provider and model scope; it belongs
   to that historical call. It is never relabeled for a new model.
3. **Advertised model window** comes only from matching model metadata. It is not
   an account quota or a guarantee of available input capacity. Unknown stays
   unknown; Staf does not substitute a guessed 128k limit.

Detailed `/context` example with synthetic metadata (not the recurring footer):

```text
Measured: last HTTP request input 350 tokens (100 cached, already included) [historical: openrouter:example/model; 2026-10-26T00:00:00Z]
Context: next payload ~400 tokens (bytes/4 proxy) / 8000 advertised (~5.0% proxy) | Compaction: not implemented
```

The detailed measured line uses the latest call, including the last tool continuation in
a multi-call turn. It does not sum calls or add cached tokens to input. If the
latest call did not return input usage, the line says unavailable instead of
silently substituting an older measurement. Old records may lack timestamps.

The fraction uses the approximate next-payload proxy, not the historical measured
count. Switching models keeps the old measurement labeled with its old provider;
it never applies that count to the new model window. The ledger does not store
exact request/template fingerprints or provider transformations, so Staf cannot
prove unchanged lineage for a measured-plus-delta next-context baseline. It
therefore shows the historical measurement and independent estimate side by side,
even after resume. History edits, prompt/tool changes and model switches do not
create a falsely precise baseline. Reported reasoning-output counts are not added
to the visible estimate. Opaque reasoning replay is excluded from the projection
rather than tokenized as ciphertext. It remains in actual same-model requests;
the displayed estimate does not establish total context occupancy.

This is not a verified fullness measurement.
It is not a hard safety check and does not prevent context-limit errors.

## How the proxy works

Staf calculates `ceil(UTF-8 bytes / 4)` over a serialized visible request bundle.
This is an inexpensive size indicator inspired by the English-text rule of thumb,
not a tokenizer for every provider. ASCII bytes and characters coincide; other
languages, code, escaping, and tokenizers can make the estimate badly wrong in
either direction. No accuracy range or safe-capacity guarantee is claimed.

The bundle includes readable message roles/content/tool exchanges, Staf's
instructions and the clock schema. Direct Codex uses its Responses item boundaries,
including readable replay content exactly once. It excludes reasoning replay items
from this display projection. Other HTTP providers exclude unsent `responseReplay`
and per-message `usage` metadata, matching their transport conversion. The prompt
pieces are shared with the actual adapters. The historical native CLI response
schema is not part of the direct Responses estimate. Transport headers/model
parameters, hidden provider templates,
native instructions, native tools/state, tokenizer-specific message framing and
provider-added content remain unknown. No output reserve is configured or
subtracted by Staf. Input plus output must fit the actual provider's limits.

The display returns counts and selected model/source labels, not message text or
secrets. `/context` reports the number of excluded opaque reasoning items and says
their token occupancy is unknown. A larger encoded blob therefore does not inflate
the visible estimate. More readable history or submitted input still increases it.
The projection never edits saved history, encrypted replay or outgoing requests.
It does not add context estimates to the persisted usage ledger.

## Window metadata and model switches

OpenRouter maps positive integer `context_length`; Codex direct account catalog metadata
maps `context_window` when actually present. An explicit matching model ID is
required. Codex `max_context_window` is not substituted for the active window.
LM Studio and legacy OpenAI-compatible model catalogs do not have a verified
window field mapping here, so their window stays unknown. No alternate endpoint
or account collector is added to fill those gaps.

Passive display reuses metadata in memory. `/context` shows source and fetch time;
cache data older than five minutes is labeled stale. Rendering never fetches or
polls. A provider/model/endpoint switch looks up its own cache key and model, so
an old model's limit is not carried across. Restart begins without this metadata
cache; persisted sessions still preserve messages and consumption.

## Compaction is not implemented in Staf

Staf currently replays the complete saved transcript. It has no enforced
compaction threshold and does not summarize, truncate or discard history. The
meter does not invent an 80%/90% trigger. Adding a compaction policy, summary
storage and recovery behavior is separate design/implementation work.

Historical CLI observations are cumulative native execution totals, not context
occupancy. Current direct Codex observations have request scope. The adapter does
not run a native compactor, summarize messages or discard history. It replays
normalized messages and same-model encrypted reasoning when provided. Context
estimation is still a rough visible-size proxy and can differ from provider
framing and opaque replay. No compaction threshold is inferred.

Future compaction would change supplied context, not erase accumulated usage.
The user goal is for each session to retain its consumption independently of
context management. Current `/usage` accounting continues to do that, with its
existing incomplete-coverage and failed-write limits.

## Verification and references

Offline tests cover metadata validation/unknowns, model switches, payload growth,
context versus consumption, shared prompt pieces, resume, unchanged ledger,
non-TTY/NO_COLOR, and actual PTY refresh/display with a fake Codex catalog.
Additional regressions vary ciphertext length independently of readable history,
check provider/model switches, preserve encrypted requests and saved files, and
exercise three CLI turns with one session and stable session-bound cache identity.
No live
generation or account quota query was used.

Primary references checked October 26, 2026:

- [OpenRouter model context_length](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [Codex 0.163.0 model metadata and native context logic](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/protocol/src/openai_models.rs)
- [OpenAI rough English token estimates and limits](https://help.openai.com/en/articles/4936856-understanding-and-counting-tokens)
