# System prompt assembly and cache stability

Research checked on 2026-11-05. This note supports the owner's discussion; it
is not a decision or an implementation plan. Staf source is at
`8eed8ed1b5f6538a6ae37b7cc19369d5e6165e0a`, with the existing working-tree
changes preserved. External source was inspected at OpenClaw
[`6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba`](https://github.com/openclaw/openclaw/tree/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba)
and NousResearch Hermes Agent
[`74915d7af8d3115c3eb821893f3c01ab783146a5`](https://github.com/NousResearch/hermes-agent/tree/74915d7af8d3115c3eb821893f3c01ab783146a5).
Documentation is live and may change. This extends the earlier
[instruction-file research](agent-instruction-files.md), which pins the source
heads inspected on 2026-11-01. No agent or model was run for this research.

## Findings for the owner's discussion

- Staf already sends product instructions when the agent's Instructions are
  blank. The current text explicitly says to use `clock` for the current time.
  That text may influence a model's tool choice, but neither the clock call nor
  the reported missing answer establishes that it caused either outcome.
- Both references distinguish product-provided operating guidance from
  owner-editable identity. Their actual assembly, update timing, and handling of
  changing context differ. Neither treats natural-language instructions as a
  substitute for tool policy or execution authority.
- Stable instructions and tool definitions help preserve a reusable prefix.
  Prefix stability, local key stability, provider cache hits, savings, and
  assistant quality are different claims. Measure them separately.
- A tool result is normally an intermediate message, followed by another model
  request. Authorization, cancellation, malformed responses, provider errors,
  or limits can prevent that continuation. Diagnose the reported turn before
  choosing a prompt-only fix.

The accepted Staf contract remains one authoritative `soul.md` for personality,
role, and standing guidance, with `agent.toml` for structured settings. GUI,
CLI, API, and direct file editing share those files. Valid changes apply to the
next message, while in-flight work retains its captured configuration. The owner
also required a warning for configuration changes that may affect prompt-cache
reuse, but deferred the construction and warning design. [Recorded decisions](../decisions.md#chat-gui-polish-and-agent-terminology),
[ADR-0003](../adr/0003-editable-agent-configuration.md), and
[glossary](../../GLOSSARY.md). The linked decision covers the agent-management discussion.

## What Staf sends and how a turn continues

The base in [`src/prompts.ts`](../../src/prompts.ts#L4) is `You are Staf, a
helpful assistant. Use clock for the current time.` Both task and main-chat
execution append `Bot instructions:` and `profile.instructions`, even if the
latter is empty. The two paths pass the composed string into provider
selection. See [`src/instance-service.ts`](../../src/instance-service.ts#L342)
and [main chat](../../src/instance-service.ts#L740). This description concerns
these service paths, not every legacy prompt helper in the repository.

[`runTurn`](../../src/runtime.ts#L42) appends the user message, constructs the
offered tools for each provider step, and invokes the provider. Tool schemas
depend on provider capability, work kind, tool mode, registered capability
eligibility, and skill availability. Direct tools can receive recovery metadata;
code mode receives a catalog in the `code_mode` description. The work-action
service decides eligibility and enforces action checks and authorization. Tool
schema presence is not a permission grant. See [tool construction](../../src/runtime.ts#L80)
and [work-action offers and checks](../../src/work-actions.ts#L93).

The runtime clones request history and may append a skill catalog and recalled
memory to the latest user message. It labels both as untrusted, and replaces
previously loaded skill results with a reload notice on later turns. Task inbox
updates can also change the request. These variations matter when evaluating the
whole serialized prefix, even if the system instruction string does not change.
See [request construction](../../src/runtime.ts#L92) and
[task input handling](../../src/runtime.ts#L68).

On an ordinary successful tool round, Staf retains the assistant's tool call,
executes each call, appends a matching tool-result message, and enters the next
provider step. A response with no calls becomes the final assistant event and
is saved. Direct Codex converts the tool message to a Responses API
`function_call_output`; OpenRouter sends Chat Completions messages. See
[the loop](../../src/runtime.ts#L113),
[tool execution and results](../../src/runtime.ts#L147),
[final response and persistence](../../src/runtime.ts#L136),
[Responses conversion](../../src/codex-direct.ts#L13), and
[OpenRouter streaming request](../../src/openrouter-stream.ts#L6).

This is a bounded loop, not a promise of a final answer. The default is four
provider steps, including the first. On the last step, another tool call can
execute and the loop can then end with `Tool iteration limit reached` without a
further model call. An explicit clock denial or unavailable clock call can now
return a matching unsuccessful result for provider continuation, while action
admission stays closed. Unexpected authorization failures and live restriction
failures still terminate work. Cancellation, a provider or stream
error, invalid replay, unavailable skills, and persistence failure are other
possible interruptions. Failed main-chat turns roll message history back while
attempting to retain accounting and events. See [limits and errors](../../src/runtime.ts#L232),
[clock admission](../../src/runtime.ts#L169),
[direct response validation](../../src/codex-direct.ts#L37), and
[OpenRouter stream validation](../../src/openrouter-stream.ts#L70).

### What the reported greeting does and does not establish

The owner reports creating an agent with empty Instructions, sending hello,
seeing a clock call, and receiving no useful answer. This is a report, not a
reproduction. The base prompt is a plausible contributor to an unwarranted
clock call. A model-specific tendency, provider behavior, or other request
context could also contribute. The missing answer could involve any of the
continuation or display paths above, but no cause is established.

To distinguish them later, preserve the selected provider and model, tool mode,
permission and approval state, captured instruction and offered-tool versions,
command status, tool start/result and approval outcome, provider-step count,
continuation response or error, and final persisted versus displayed answer.
Use redacted diagnostic evidence and avoid credentials or private conversation
content. In particular, distinguish a clock *start* from a successful clock
result, and a missing provider continuation from a continuation that was not
shown. This research did not access the owner's session or logs.

## OpenClaw

OpenClaw builds a product-owned prompt with operational guidance and workspace
context; editable workspace files include `AGENTS.md`, `SOUL.md`, `IDENTITY.md`,
and `USER.md`. The file distinction is useful but not a strict division of
content: persona and operating guidance can overlap. Its
[workspace loader](https://github.com/openclaw/openclaw/blob/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba/src/agents/bootstrap-files.ts#L275-L290)
reads bootstrap files and its
[run resolver](https://github.com/openclaw/openclaw/blob/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba/src/agents/bootstrap-files.ts#L400-L409)
constructs bounded context. The [workspace guide](https://docs.openclaw.ai/concepts/agent-workspace)
explains the files and direct editing. Bootstrap modes, subagent filters,
truncation, hooks, and native Codex handling qualify when edits appear. The
[agent-loop guide](https://docs.openclaw.ai/concepts/agent-loop) describes
per-run resolution, while the [system-prompt guide](https://docs.openclaw.ai/concepts/system-prompt)
documents the route-specific exceptions. No ordering of natural-language text
alone proves that conflicting instructions are safely enforced.

The pinned [builder](https://github.com/openclaw/openclaw/blob/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba/src/agents/system-prompt.ts#L365-L391)
derives guidance from available tool names. It places base and workspace context
in a stable prompt section, then a boundary followed by capability-sensitive
guidance. The [source](https://github.com/openclaw/openclaw/blob/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba/src/agents/system-prompt.ts#L594-L665)
shows this order. The live [prompt documentation](https://docs.openclaw.ai/concepts/system-prompt)
describes pinned prompt sections on supported direct Anthropic and native OpenAI
Responses routes, and later instruction messages for refreshed sections. It
places current date and timezone in turn runtime context instead of repeatedly
rewriting the system prompt. Exact time is available through a tool when
needed. This is route-specific design, not a guarantee of cache reuse.

For the embedded agent loop, the pinned
[agent-core loop](https://github.com/openclaw/openclaw/blob/6c1bad522ef03fe8ca32d08adf7c60bfa2bc74ba/packages/agent-core/src/agent-loop.ts#L250-L385)
handles tool calls and tool results within a continuing loop. The
[loop guide](https://docs.openclaw.ai/concepts/agent-loop) describes streamed
assistant and tool events, final reply shaping, and a fallback warning for some
otherwise silent tool failures. Different harnesses, hooks, policies, and
abort paths can change the outcome; the presence of a loop does not prove a
useful final answer for every call.

## Hermes Agent

Hermes loads an owner-editable `SOUL.md` for identity, falling back to a built-in
identity when it cannot load a nonempty file. Project instructions are a
separate input. The pinned [loader](https://github.com/NousResearch/hermes-agent/blob/74915d7af8d3115c3eb821893f3c01ab783146a5/agent/prompt_builder.py#L1512-L1560)
and [identity selection](https://github.com/NousResearch/hermes-agent/blob/74915d7af8d3115c3eb821893f3c01ab783146a5/agent/system_prompt.py#L540-L565)
show that distinction. The [earlier research](agent-instruction-files.md#hermes-agent-identity-and-project-context)
discusses project-file precedence, limits, and the distinction between home and
project scope. Read the [current context-file guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files)
for current supported paths and discovery behavior.

The pinned [builder](https://github.com/NousResearch/hermes-agent/blob/74915d7af8d3115c3eb821893f3c01ab783146a5/agent/system_prompt.py#L738-L805)
assembles stable identity and tool/model guidance, then caller and project
context, then skills, memory and user snapshots, timestamp and runtime hints.
Enabled capabilities affect guidance. The live [assembly guide](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly)
separates that retained system prompt from API-call-time additions, including
some plugin and recall context. Its introductory tier list and later prose
about the skills index do not agree on its tier; the pinned source places
`skills_prompt` in `volatile_parts`. Treat source as evidence for this revision,
not the inconsistent sentence in the live guide.

Hermes favors stable session snapshots. The [sessions guide](https://hermes-agent.nousresearch.com/docs/user-guide/sessions)
says `hermes sessions refresh-prompts` requests a rebuild on the next turn while
preserving history and tool list. Its memory documentation describes snapshots
that stay fixed until a rebuild; tool results can still report current state.
This differs from Staf's accepted next-message configuration semantics. Do not
adopt Hermes refresh timing without revisiting that decision. See also
[Hermes prompt customization](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly#supported-prompt-customization-surfaces).

The pinned [conversation loop](https://github.com/NousResearch/hermes-agent/blob/74915d7af8d3115c3eb821893f3c01ab783146a5/agent/conversation_loop.py#L1745-L1789)
chooses a tool round when the model returns calls and a final-response handler
otherwise. The [tool round](https://github.com/NousResearch/hermes-agent/blob/74915d7af8d3115c3eb821893f3c01ab783146a5/agent/turn_tool_round.py#L104-L145)
stages the assistant call and handles matching tool results, including invalid
calls. The [agent-loop guide](https://hermes-agent.nousresearch.com/docs/developer-guide/agent-loop)
describes execution, result insertion, and another API request. Limits,
failures, and interrupts still qualify continuation.

## Cache behavior by route

A prompt cache generally concerns reusable input prefixes, not durable memory or
response caching. Tool schemas, instructions, and earlier messages can all
matter. Stable bytes and a stable local key are useful properties to inspect;
none proves that a provider stored or reused a prefix.

**Staf direct Codex.** [`responsesRequest`](../../src/codex-direct.ts#L25)
sorts function definitions by name, hashes JSON containing session ID, model,
composed instructions, and sorted functions, and sends the resulting
`prompt_cache_key`. A change to one of those inputs changes the hash except for
theoretical hash collisions. Reasoning effort is sent separately and is not in
the local key. History and dynamic request context are not in that key, so the
same key does not establish identical provider input. Direct usage parsing can
record provider-reported cached input tokens when supplied.
[Source](../../src/codex-direct.ts#L30). This is Staf's ChatGPT-plan direct
Responses route, so do not assume every API pricing, retention, or eligibility
statement applies to it without route-specific confirmation.

[OpenAI's current API prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
describes matching prefixes, stable tools, eligibility and usage reporting. It
distinguishes GPT-5.6 and later cache controls from earlier models, where a
stable `prompt_cache_key` helps route related requests. Minimum sizes, retention,
and controls depend on the model and route. API documentation is evidence for
that API, not proof of a cache hit, pricing, or savings on Staf's direct
ChatGPT-plan connection.

**Staf OpenRouter.** The current [non-streaming](../../src/providers.ts#L37)
and [streaming](../../src/openrouter-stream.ts#L12) request bodies send model,
system message, history and tools, with optional reasoning. They do not send
`session_id`, `prompt_cache_key`, or `cache_control`. This does not establish
that caching is disabled: [OpenRouter's guide](https://openrouter.ai/docs/guides/best-practices/prompt-caching)
describes provider-dependent implicit caching, explicit cache controls, and
best-effort sticky routing. Its `session_id` can guide routing but does not
itself prove a hit. Anthropic-compatible routes have different breakpoint and
minimum-length rules from implicit providers. Check the selected route and
current documentation rather than extrapolating one provider's settings.
Staf parses optional OpenRouter `cached_tokens`, `cache_write_tokens`, and
reported account-credit cost through [`httpUsage`](../../src/usage.ts#L36).
Missing metrics are unavailable, not zero, and cache writes may cost money.

Changing `soul.md`, model, provider, offered tool definitions, or their order can
change the prefix or routing. Other changes, including replay scrubbing,
recall, skill catalogs, task notices, compaction or history transforms, can
change matching even if the direct key remains the same. An instruction edit
can preserve an earlier matching prefix; it does not prove a total miss. The
existing warning requirement should describe possible impact and leave measured
hits and savings to actual provider telemetry.

## A candidate structure for Staf

The following is a recommendation for evaluation, not selected product policy
or a new file layout. Preserve service-owned configuration and action authority.

1. **Product-owned operational core.** A short, versioned baseline describes
   Staf's role, how to use actually offered capabilities, how to respond after
   tool results, and how to report a blocked or failed action. Evaluate whether
   time guidance should say to use a clock when current time is needed rather
   than inviting it for an ordinary greeting.
2. **Owner-editable standing guidance.** Insert the captured `soul.md` as a
   clearly identified agent-specific block. Blank guidance remains valid. Keep
   structured provider, model and tool settings in `agent.toml`.
3. **Offered capabilities and task context.** Supply actual tool schemas and
   capability-specific guidance from the service's current work context. Add
   current-turn facts, recall, skills, and task notices in clearly labeled
   appropriate request messages, with trust boundaries intact. Avoid embedding
   a ticking timestamp in a shared stable prefix.
4. **History and tool continuation.** Retain the user request, assistant calls,
   and matching tool results in provider-appropriate form, then request a final
   answer unless an explicit failure, interruption, or other policy ends work.

Choose deterministic ordering and record which input changed, without logging
private prompt contents. A changed owner instruction must take effect for the
next accepted message under the current decision, even if that sacrifices cache
reuse. Prompt wording can guide a model but cannot grant tool access, override
approval, or replace service checks. Adapter-specific message placement and
cache mechanics need their own evaluation; a single conceptual order does not
imply identical wire representations across providers.

## Decisions still open

- Which product operational instructions should exist, and which, if any, can
  the owner inspect or edit globally? How are defaults and overrides scoped,
  reset, and migrated? Does an editable core supplement or replace product
  guidance, and how are conflicts explained?
- What behavior is desired for a greeting, current-time question, and a blocked
  or failed clock request? How should a failed continuation appear to the user?
- Which context belongs in a system instruction, a developer instruction,
  a user-context message, or a tool result for each supported route? How should
  the service label owner guidance versus untrusted recalled content?
- Which changes merit a cache-impact warning, where should it appear, and what
  information should it give without claiming a miss or savings?
- How much prompt inspection and version metadata should the owner see, and
  how should privacy and redaction constrain diagnostics?

## Bounded evaluation plan

This plan is proposed for later authorized work. No tests, provider calls, or
session access were performed for this note.

1. Capture and compare serialized requests with scripted providers for both
   chat and task paths. Cover empty and edited Instructions, provider and model
   changes, Direct/Hybrid/Code tool modes, and capability eligibility. Check
   actual instruction text, schema ordering, and the provider-specific message
   representations. Assert next-message edits and in-flight captured settings
   separately. Compare the complete reusable prefix, not just the local key.
2. Script a plain greeting and an explicit time question. Verify request
   construction and test product behavior using deterministic provider outputs:
   a clock call, result, and continuation; a direct final answer; blocked and
   invalid calls; a provider error; cancellation; and calls until the iteration
   limit. Confirm the persisted event, message, and displayed outcome where the
   test scope supports it. These scripts exercise control flow; they do not
   measure a model's tendency to call clock or answer quality.
3. Compare repeated turns with unchanged inputs, then vary one factor at a time:
   soul text, model, provider, tool mode or schema, skill catalog, recall,
   prior skill-result replay, and task notices. Inspect both the direct cache key
   and request prefixes. Verify that any warning matches observed input changes,
   not an asserted provider cache miss.
4. With separate owner authorization and a defined budget, run model-backed
   trials across selected provider/model routes. Include ordinary greetings,
   requests that need the current time, questions that mention time but do not
   require a clock, and tool-result follow-up. Record the prompts, offered tools,
   outcomes, repetitions, failures, and quality rubric. Compare baseline and
   candidate wording without claiming universal model behavior.
5. In a separately authorized cache experiment, use eligible request sizes and
   matched repeated turns within each route's documented retention window.
   Record resolved provider/model, request and prefix changes, time, optional
   cache-read and cache-write usage, and reported cost where available. Compare
   baseline and changed-prompt cases and state missing metrics and routing drift.
   Distinguish reported cached tokens from actual cost savings, and do not
   extrapolate one provider or subscription route to another.

Static inspection and scripted tests can establish construction and control
flow in their exercised conditions. They cannot establish real cache hits,
latency or cost savings, provider availability, or model answer quality.
