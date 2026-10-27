# Select a model and reasoning effort

Model discovery is a metadata operation, not generation. It never sends your
conversation or API key. You can configure a model manually when discovery fails.
A reasoning override needs advertised support before Staf starts generation.

## Inspect choices in chat

Between requests, select a provider and inspect its models.

```text
/settings set session provider openrouter
/settings models
/settings models gpt
/settings model session PROVIDER/MODEL
/settings reasoning
/settings reasoning session high
/settings show
```

Replace the model ID and level with values shown for your model. An optional filter narrows model IDs and labels. Model selection
uses IDs, not list positions that could change after refresh. `model session` and
`reasoning session` are shortcuts for the existing scoped settings operations.
Use `model default ID` or `reasoning default LEVEL` to save your personal defaults.
Terminal commands affect future launches. Interactive remembered edits also apply now.

The terminal equivalents use the selected provider without constructing a chat
adapter or requiring its generation credentials.

```sh
pnpm start settings models --provider openrouter
pnpm start settings reasoning --provider openrouter --model PROVIDER/MODEL
pnpm start settings model default PROVIDER/MODEL --provider openrouter
pnpm start settings reasoning default high --provider openrouter
```

Inspect metadata before choosing a nondefault effort. A saved value is a validated
configuration draft, not a promise of availability. Per-model support is checked
before generation through the shared provider selection operation.

For Codex, model discovery reads the installed CLI's bundled catalog without a
new login. It does not query account entitlements.

```sh
pnpm start settings models --provider codex
pnpm start settings reasoning --provider codex --model CODEX_MODEL_ID
pnpm start --provider codex --model CODEX_MODEL_ID --reasoning high
```

The last command starts a live-capable chat after scoped authentication; entering
a message consumes account usage. It was not run against a real model in tests.

## Understand each source

| Provider | Discovery source | Effort control in this adapter |
| --- | --- | --- |
| OpenRouter | Public `GET https://openrouter.ai/api/v1/models` | `reasoning.effort`, gated by selected-model metadata |
| Codex | Official `GET https://api.openai.com/v1/models` | `-c model_reasoning_effort="LEVEL"`, gated by bundled model metadata |
| LM Studio | Configured compatible API root plus `models` | Explicit effort unsupported by current Chat Completions transport |
| Legacy live | Configured compatible API root plus `models` | Explicit effort unsupported for this generic transport |
| Demo | Built-in empty model list | No model or reasoning control |

HTTP metadata requests carry no Authorization header, reject redirects, and time
out after ten seconds. An auth-required catalog can therefore fail even when chat
auth is configured. There is no automatic alternate-host request or credential
fallback. Enter a model ID manually and use `default` reasoning in that case.

Codex discovery extracts only IDs, labels, and effort metadata. It does not retain
internal prompt text from the raw catalog. Bundled metadata can differ from the
account's live model access or the server's current capabilities. Native `ultra`
presets are shown as advertised metadata but excluded from selectable efforts
because they can imply delegation. Selecting effort never enables native tools.

LM Studio's native model API can describe native reasoning options, but those do
not establish support for a generic effort field on `/v1/chat/completions`. Staf
does not silently switch to native stateful chat or Responses. Local model IDs
can include downloaded models available through just-in-time loading, not only
models already resident in memory. Discovery does not load or download a model.

## Interpret reasoning metadata

`default` means omit Staf's override and use the provider/model default. It does
not mean reasoning is disabled. `none` is a different explicit OpenRouter effort
and is offered only if the selected model advertises it and does not require
reasoning. Efforts keep their backend names; they are not universal quality scores.

OpenRouter metadata with `supported_efforts` omitted means no advertised selector,
not an assumption of universal support. Null accepts the gateway's documented
efforts; an array narrows the selector. Mandatory reasoning removes `none`.
The view shows advertised default effort, default enabled state, mandatory state,
and token-budget support when present. Staf does not implement a token-budget UI.
Budget-only or unknown selectors remain unavailable for explicit effort.

The view distinguishes advertised support, unknown metadata, and an unsupported
transport. Unsupported or unknown explicit efforts fail before generation instead
of being silently dropped. A model ID can still be saved manually; reasoning can
remain `default` without discovery.

## Refresh and precedence

`/settings models [FILTER] refresh` or `/settings reasoning refresh` forces a new catalog
read. The terminal accepts `settings models refresh` and `settings reasoning refresh`.
Catalogs live only in process memory for five minutes. Views show source,
fetch time, and whether a result was cached. New terminal invocations start with
no cache. A failed refresh changes no settings and does not silently return stale
metadata; an earlier still-valid cache can be used by a later ordinary read.
Nothing is saved or selected automatically by discovery.

Reasoning uses the same precedence as model settings: built-in `default`, saved
personal default, `.env`, shell, CLI, then this-session override. The keys are
`reasoning.openrouter`, `reasoning.codex`, `reasoning.lmstudio`, and `reasoning.live`.
LM Studio and legacy accept only `default` in this version. The environment
variables are `OPENROUTER_REASONING_EFFORT`, `STAF_CODEX_REASONING`,
`LMSTUDIO_REASONING_EFFORT`, and `STAF_REASONING_EFFORT`, respectively.

Confirmed settings apply to the next request, including resumed chats. Provider/model
changes reset reasoning to default; history is preserved and transferred to the
selected destination. See [settings timing](settings.md#choose-this-session-settings).

## Shipped defaults versus your defaults

Saving a default means "my default in this data directory", not a new product
default. `.staf/config/settings.json`, sessions, auth, and runtime logs are local
user data. A fresh data directory still starts with demo and provider-default
reasoning. Do not edit source defaults to represent your own preferences.

The package allowlists source/build file patterns and the exact generic fixture,
not whole source directories. Root ignore rules alone did not exclude a synthetic
auth file nested under an allowlisted directory, so this narrower list is tested.
It also has ignore rules for runtime data,
auth, and real environment files. `.env.example` has no real key values; optional nonsecret overrides are commented
out so copying it does not hide your saved model/reasoning defaults.
The distribution test packs synthetic developer settings and credentials, checks
archive names exclude them, and starts the extracted CLI in a fresh data directory.
No real user data is read for that check. Git ignore rules protect future Git use;
ignore rules would not remove a file someone had already committed.

## Sources and verification

- [OpenRouter model reasoning metadata](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [OpenRouter model list](https://openrouter.ai/docs/guides/overview/models)
- [Codex effort configuration](https://learn.chatgpt.com/docs/config-file/config-reference)
- [LM Studio compatible model list](https://lmstudio.ai/docs/developer/openai-compat/models)
- [LM Studio native model list](https://lmstudio.ai/docs/developer/rest/list)
- [LM Studio native chat](https://lmstudio.ai/docs/developer/rest/chat)

Installed Codex 0.163.0 help and its bundled catalog were inspected. OpenRouter's
public catalog was inspected without authentication. Adapter generation and
reasoning payloads/arguments are covered by offline fixtures. On 2026-10-26,
direct `gpt-6-luna` generation with reasoning `high`, a history follow-up and a
resumed clock-tool round trip were
also live-tested using the user's existing grant. Other models/providers and
account access remain unverified by that smoke test.

Current Codex discovery uses the separately authorized direct Staf grant and
public account catalog. A legacy CLI login is not sufficient. Explicit manual
model selection remains available before sign-in, but inference requires the
direct grant and an account-available model. No native CLI is launched for
production discovery. [Fresh setup](codex-direct.md) explains activation.
