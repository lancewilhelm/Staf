# Implementation decisions

## Keep conversation state and tool dispatch in Staf

Accepted on 2026-10-25. Each adapter translates its own protocol into Staf messages.
Staf owns tool IDs, results, the clock allowlist, iteration limits, and snapshots.
A later UI can call the same runtime.

Letting each provider own conversations would reduce some adapter work, but
resume behavior and tool permissions would then differ by provider. The current
choice repeats full history and has no context compaction. It covers a small
shared text-and-clock contract, not arbitrary agent behavior.

## Use a registry and explicit capabilities

Accepted on 2026-10-25. The CLI looks up adapter factories in `providerRegistry`.
The runtime consumes normalized events and checks declared tool support.
Buffered adapters declare incremental text unsupported.

Separate conditionals in the CLI were adequate for one optional HTTP adapter.
A registry is easier to extend and test as the list grows. A plugin loader or
large adapter framework would add complexity without helping the current scope.

## Use the official Codex CLI as a structured planner

Superseded on 2026-10-26 by [direct Responses with a Staf-owned grant](#use-direct-responses-with-a-staf-owned-grant).
The following records the original CLI implementation.

Accepted on 2026-10-25. `codex exec` provides a supported interface for existing
ChatGPT authentication and schema-constrained final output. Staf runs clock itself.
No subscription tokens or private endpoints enter Staf's configuration.

An app-server integration could support richer interaction and custom tools later.
It would require a persistent process, lifecycle handling, and a larger protocol.
The first version accepts subprocess overhead and buffered output. Its generation
behavior is mocked-tested, not live-tested.

## Load project credentials without writing them

Accepted on 2026-10-25. A small literal `.env` parser keeps existing shell workflows
and limits project configuration to documented keys. Shell values take precedence.
This decision covers project API-key configuration. The original Codex CLI path
used official CLI login storage; the current direct path separately stores its
Staf-owned grant under `DATA_DIR/auth`.

A keychain or encrypted vault would offer different storage properties but needs
its own setup and recovery behavior. `.env` remains plain text and needs careful
local access. Known-value redaction is a last defense, not credential isolation.

## Share the HTTP transport across OpenRouter and LM Studio

Accepted on 2026-10-25. Both support Chat Completions, so they reuse validation,
timeouts, errors, and tool-message translation. Each adapter owns its key names,
endpoint defaults, and model selection. LM Studio omits auth when no key is set.

Provider SDKs would add dependencies and features this version does not use.
The direct transport keeps the implementation small. Models can still differ in
tool support and request limits. Their real behavior needs live verification.

## Official sources

- [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [OpenRouter authentication](https://openrouter.ai/docs/api_reference/authentication)
- [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions)
- [LM Studio authentication](https://lmstudio.ai/docs/developer/core/authentication)

Hermes remains a product reference from the interview. This implementation uses
primary provider documentation and does not copy Hermes code or credentials.

## Give Staf its own official Codex context

Superseded for the default Codex provider on 2026-10-26 by
[direct Responses with a Staf-owned grant](#use-direct-responses-with-a-staf-owned-grant).
The isolated CLI context remains available through explicit `auth codex-legacy`
commands. The following records the earlier integration.

Accepted on 2026-10-25. Staf replaces its earlier machine-login
behavior with scoped CODEX_HOME and HOME directories. Official file storage avoids
copying OAuth tokens and keeps normal CLI login separate. Auth commands are explicit;
an absent scoped login is an error, not a reason to borrow the normal account.

Reusing machine login required less setup but obscured ownership. A separate OAuth
application registration was not implemented at that point.
The CLI path uses its official client identity and the chosen account's allowances.

Apps, hooks, and plugins are disabled, and configured MCP entries stop generation.
System policy and native-read limitations remain. Dummy-account lifecycle tests and
a real empty-context status check verify plumbing without creating a real grant.

## Use direct Responses with a Staf-owned grant

Accepted on 2026-10-26. The default `codex` provider uses the public Responses
endpoint with a separate Staf OAuth registration and grant. It does not import
CLI credentials, launch CLI exec or app-server, or fall back to an API key.
Staf continues to own conversation history, tool dispatch and session storage.
Only the clock tool is executable.

Provider selection and explicit browser sign-in are available in the running
chat, so setup can return to model selection without a separate terminal auth
step. Standalone auth commands remain available for recovery. The menu is
deterministic and does not require a working model to configure one.

This replaces the CLI planner and scoped CLI context as the default integration.
It requires Staf to implement OAuth validation, refresh, streaming normalization
and model-bound replay. The CLI buffers assistant display until completion;
only successful completed responses commit conversation output or tool calls.
Usage keeps inclusive input counts and cached/reasoning subsets separately.
See [direct Responses](direct-responses.md) for the contract and
[verification gaps](direct-responses.md#verification-and-remaining-gaps).

## Keep settings deterministic and independent of model availability

Accepted for the settings MVP. Nonsecret defaults use versioned local JSON with
atomic replacement. Session overrides are separate and never saved as defaults.
Precedence and value sources are explicit. Updated October 26: confirmed chat edits apply on the next request,
including resumed chats; remembered edits also persist for future launches.
Terminal default writes affect only future launches. This supersedes the initial
fresh-conversation-only setting lock. Provider initialization is lazy and failures leave settings
commands available. Credentials stay in existing separate stores.

A model-driven setup assistant would fail during bootstrap or a provider outage.
The first menu is deterministic, with a terminal recovery interface using the same
operations. Natural-language shortcuts and remote configuration are deferred.
