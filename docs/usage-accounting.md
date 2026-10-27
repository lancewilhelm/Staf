# Inspect observed usage

In chat, run:

```text
/usage
/usage details
/usage help
```

These are local deterministic commands. They work before setup and after a
provider failure, do not enter model history, and make no provider/account request.
`/usage` shows the last request, last user-turn attempt (including tool
continuations), last completed turn when recorded, session subtotals, and a
provider/model breakdown. `details` adds per-call sources and outcomes. There is
no reset command or account dashboard in this version.

Each request is one Staf adapter `complete` call. A tool turn can make several
requests; each can resend history and consume more input tokens. The harness does
not automatically retry failed requests. A manual retry is a separate attempt.
Historical Codex CLI execution aggregates are not an inventory of every internal
model request or native tool operation. The current direct adapter records
Responses request usage.

## Read the numbers

- Input, output and total are reported token counts. Missing is **unavailable**,
  never zero. Reported zero is retained. No local tokenizer estimate is used.
- Cached input and cache writes are details of input. Reasoning is a detail of
  output. Do not add these to the input/output totals again.
- Each subtotal shows how many calls supplied that metric. Mixed/old/missing
  reports give partial coverage; the subtotal is not an estimate of the missing
  calls. A provider-reported total is not inferred when absent.
- Latency is Staf's measured wall time for the adapter call, including transport
  and provider setup within that call. It is not provider-only inference time or time to first
  token. Session latency is a sum of call durations, not elapsed session time.
- Provider identity includes the configured model/effort where available. A
  separate reported model appears only when the response supplies a safe ID.
  The current direct Codex adapter requires an explicit selected model; historical
  CLI records may have an unknown default model.
- OpenRouter `costCredits` is the reported charge in account credits. It is not
  upstream provider cost, account balance, or a calculated dollar estimate.
  Codex has no dollar-cost report here. Local LM Studio usage is not a claim
  that hardware, electricity, or hosting is free.

This is **Staf-observed session usage**, not account-wide usage, remaining Codex
subscription allowance, rate limits, context-window occupancy or remaining
context capacity. Those values are unavailable. Repeated history can be billed
again, so cumulative input is not the size of the current prompt.

## Provider contracts

| Adapter | Report mapped | Explicit limits |
| --- | --- | --- |
| OpenRouter | `usage.prompt_tokens`, `completion_tokens`, `total_tokens`; `prompt_tokens_details.cached_tokens/cache_write_tokens`; `completion_tokens_details.reasoning_tokens`; `usage.cost` | Optional fields stay missing; upstream cost is not substituted. |
| LM Studio | Compatible Chat Completions `usage.prompt_tokens/completion_tokens/total_tokens` | Cache/reasoning/cost not promised by this transport. No transport change for metrics. |
| Codex direct | Responses input/output/total; input cached subset; output reasoning subset | Inclusive input. Missing fields stay unavailable. No cost/quota inference. |
| Historical Codex CLI | JSONL execution totals | Old records retain execution scope; not current request occupancy. |
| Demo | Not applicable | No language model or reported token/cost usage. |
| Legacy HTTP (`live`) | Unavailable | No verified generic usage contract; response fields are not assumed compatible. |

Direct Codex usage comes from the completed Responses event. Failed/incomplete
streams have unavailable usage when no trustworthy report commits. Legacy CLI
usage remains an execution aggregate. No native resume or app-server is used by
the direct path. See [direct accounting](direct-responses.md#inclusive-accounting).

## Persistence, failure and coverage

Version-1 session JSON can optionally contain a `usage` ledger. Each observation
has a unique local call ID, attempt ID, message-start index, provider identity,
optional reported model, measured latency, outcome, source and validated metrics.
New observations also record ISO observation time and explicit `request` versus
`execution` scope; older records may lack those fields. `/usage details` exposes
that scope/time. OpenRouter and LM Studio are per HTTP request; Codex is per fresh
execution aggregate. These scopes are not interchangeable for context occupancy.
Old sessions without the ledger remain readable and show incomplete coverage.
The ledger is not sent as part of provider message history. No prompt text,
credentials, account identifiers, or raw JSONL are added solely for statistics.

Successful tool continuation reports remain accounted for if a later request
fails. Failed calls get an unavailable record, because providers may have charged
usage they did not return. Failed conversation messages still roll back. Retrying
does not erase earlier observed consumption. A failed disk write cannot guarantee
usage durability; a crash before a report is saved can also lose accounting.
Duplicates are rejected by session validation and ignored defensively in display.
Invalid, negative, non-finite or fractional counts are discarded; impossible
subset/total relationships are omitted instead of trusted. This is observability,
not a billing reconciliation system.

## What cached prompts mean

A provider can reuse eligible matching prompt prefixes. Whether it does depends
on the model, routing, content, expiry and provider rules. Cache reads can lower
latency or price; cache writes can themselves be charged. Cache-read tokens are
already part of input, not extra tokens to add. Staf does not enable a universal
cache policy, insert cache-control directives, or promise a cache hit.

A cache hit does not mean the agent permanently remembers all history, has a
larger context window, or stores content under a universal retention policy.
Provider privacy and retention terms still apply.

Primary references checked October 26, 2026:

- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
- [LM Studio compatible tool response example](https://lmstudio.ai/docs/developer/openai-compat/tools)
- [Codex 0.163.0 exec event fields](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec/src/exec_events.rs)
- [Codex 0.163.0 cumulative JSONL processor](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching)

Offline tests cover provider mappings, missing/zero/invalid fields, cache and
reasoning subsets, duplicate Codex snapshots, tool continuations, failures,
manual retries, mixed providers, resume/old files, plain output and an actual PTY
command. No live generation, real credential setup or account query was used to
verify this feature.

## Context and account work

Session accounting remains implemented and persisted. [Context status](context.md)
is a separate approximate view of supplied history and metadata limits. Account
quota collection is deferred at the user's request; `/usage` remains local and
does not launch an app-server or query weekly account limits. Provider-specific
request normalizers continue to map into the common usage contract.
