# Code Mode and programmatic tool calling

Checked 2026-11-03. This is exploratory research, not an accepted decision or a
specification. It compares published documentation with static Staf source at
`9eb4272` and proposes a bounded future experiment. No Staf runtime, generated
script, or sandbox was executed, and no Staf provider was contacted. Upstream
documentation and implementations can change.

The owner selected general architecture fit and tradeoffs as the investigation's
focus. Performance and catalog size are evaluation criteria, not the reason to
adopt this design. The investigation compares keeping direct tools, making code
execution the primary interface, and supporting both through one service-owned
capability contract. This scope choice is not an adoption decision.

The [deeper adoption investigation](code-mode-adoption.md) follows implementation
source for local runtimes, approval and replay behavior, and a path through the
skills for evaluating Code Mode as the primary interface.

## What changes

In [Philipp Schmid's November 1 article](https://www.philschmid.de/code-mode),
the model emits a short program through an `exec` tool. The program combines
structured host capabilities, processes their results, and returns a selected
output. Schmid predicts that agents will increasingly use this pattern. That is
a third-party thesis, not evidence that one tool is the right interface for
every agent. His example labels itself pseudocode; its model and API names are
not verified here. The article's performance and adoption claims are not used as
Staf evidence.

Here `exec` means a model-facing entry point for orchestrating capabilities.
It need not execute a host shell or expose a terminal. One outward tool can
invoke many typed functions, each with its own authority and result. A script
can branch, loop, call functions concurrently, and filter intermediate results
without asking the model to choose after each call. This trades model turns and
context for code execution, debugging, and a larger host-policy burden. Direct
calls remain useful when a result needs model judgment or user feedback before
the next action, or when there are only a few small calls. [Anthropic's guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
identifies these as weaker fits for programmatic calling.

## Where it fits in Staf today

The current [runtime](../../src/runtime.ts) offers `clock` and conditionally
offers `read_web`, `search_web`, `run_scratch_shell`, and `select_skill` in main
chat. Task execution has additional owner-question and agent-collaboration
callbacks. Main-chat background-task creation is deferred. This is a small
catalog, so large-catalog token savings are not yet a demonstrated Staf need.

`runTurn` builds tool declarations, executes requested calls sequentially, and
adds their string results to provider history. Its default limit is four
provider steps. [ToolDefinition](../../src/types.ts) describes input parameters
but has no output schema. A typed Code Mode bridge would need structured result
contracts, runtime validation, and a limit on child calls within each script.
The existing provider-step limit would not bound a script's loop.

The [shared service](../../src/instance-service.ts) already routes web, search,
and scratch-shell operations through [ActionBroker](../../src/action-broker.ts).
The broker checks policy before approval and again before dispatch, and records
action outcomes in [ActionJournal](../../src/action-journal.ts). Cancellation and
scope checks also exist in the service callbacks. These are useful integration
points, although they do not establish a general script-execution boundary.
Clock authorization and skill availability have their own checks in the runtime.

The [scratch-shell component](../../src/shell-sandbox.ts) runs bounded commands
in Docker. The shared service supplies a temporary scratch workspace, and the
component disables network access. It does not expose a typed callback bridge
for orchestrating Staf tools. Supporting Code Mode would require that bridge and
an evaluated execution runtime. The existing command sandbox alone does not
provide the proposed behavior.

## What implementations show

[Cloudflare Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
combines tools behind a code tool and can expose typed methods. Its connector
runtime can search and describe selected capabilities rather than place the
whole catalog in context. Cloudflare also documents a separate search-and-execute
pattern for large OpenAPI descriptions. Its [MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/)
labels Code Mode experimental. The documented Worker executor blocks direct
outbound `fetch()` and `connect()` by default, while host callbacks provide
selected external operations. This is Cloudflare's hosted implementation, not
proof that the same boundary exists in a local Node process.

[Anthropic programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
runs generated code in its code execution container. The application opts each
eligible tool into programmatic calls; the API pauses for application-provided
tool results and identifies the parent code call in the child call's `caller`
field. Intermediate programmatic results go to the code, with final output
entering model context. Each child call still counts against tool rate limits.
This is a provider-specific managed option, with its own supported models,
message formats, tool restrictions, container lifetime, and data handling. It
does not establish a provider-neutral Staf contract.

The [Pydantic AI harness Code Mode implementation](https://github.com/pydantic/pydantic-ai-harness/blob/main/pydantic_ai_harness/code_mode/README.md)
uses Monty to run a subset of Python. It exposes tools to code and documents
restrictions on imports, asynchronous operations, and access to the environment
and filesystem. Its handling of tools that require approval also depends on an
inline deferred-call handler. This is evidence for another implementation, not a
claim that Staf uses Pydantic AI or that its approval behavior transfers.

## Contracts and the host boundary

**Staf inference:** If Staf investigates this pattern, the shared service should
continue to own capability definitions and dispatch. Provider adapters would
translate the outer call and results as needed. One outer tool must not turn
many underlying actions into one undifferentiated permission. At every host
call, validate the capability name and arguments, apply agent permissions, task
scope, and any applicable approval grant, and enforce limits before the action.
The broader [approval decisions](../decisions.md#mvp-approval-modes-and-permission-boundaries)
describe accepted requirements. The supported controls inspected above are
implemented, but a new code tool would still need its own integration and proof.
Cloudflare explicitly says its wrapper does not provide durable approval for
each upstream call and places authorization in the upstream handler or host
callback. [Cloudflare guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/#sandbox-and-authorization-boundary).

A useful capability description includes input types, result shape, errors,
side effects, and limits. Generated declarations alone do not validate runtime
values. Discovery can expose a small catalog first and reveal selected schemas
on demand, but a small catalog may be clearer without search. MCP supports an
optional `outputSchema` for structured results; its availability and shape
depend on the server and protocol version. Text-only or missing schemas need an
explicit fallback, not invented types. Validate both inputs and structured
outputs at the host boundary, and treat external data as untrusted. [MCP tool
output documentation](https://php.sdk.modelcontextprotocol.io/servers/tools/),
[Anthropic result guidance](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling).

Keep credentials in the service or another trusted host component. The executor
receives only the data and narrowly scoped operations it needs; it should not
receive raw keys, environment secrets, arbitrary filesystem access, or unrestricted
network access. A trusted callback can attach a credential to an authorized
request, but it must also prevent arbitrary destinations and secret-bearing
results. Filtering output reduces context and accidental disclosure; it does not
make a hostile script safe, prevent it from reading everything the host gives
it, or undo upstream work. Cloudflare's example keeps its bearer token in the
host callback and warns against exposing secrets in schemas or results.
[Cloudflare guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/#protect-the-api).

A single outer call must not hide child actions from the owner. Record parent and
child identities, capability, sanitized arguments, approval outcome, timing,
status, and errors as appropriate for Staf's Activity and privacy policy. Show
actual actions and concise status in chat, consistent with the
[simple-chat decision](../decisions.md#simple-chat-before-background-task-workflows).
Do not present an executor's filtered summary as the full action record. Details
of persistence, redaction, and presentation remain design questions.

Stop needs to cancel the executor and propagate cancellation to pending host
calls where supported. Limit wall time, CPU, memory, output size, call count,
concurrency, and per-capability usage on the host, including repeated child
calls. Cancellation is not rollback: a child action may already have completed
or may complete after cancellation. Preserve partial outcomes and distinguish
unknown from failed. Retrying an entire script can repeat side effects; use
stable operation identity and idempotency where an operation supports them, or
require reconciliation before retry. Monty's documentation gives a concrete
example: cancelling a feed does not cancel an in-flight mounted filesystem
operation, and a write may finish later. [Monty filesystem](https://github.com/pydantic/monty/blob/main/docs/filesystem.md#io-timeouts-and-cancellation).

Cross-call state needs an explicit owner, scope, expiration, size limit, and
cleanup rule. A fresh executor per call avoids implicit shared state, but loses
intermediate values. If state survives, isolate it by instance, agent, and
conversation or work scope, prevent another caller from reading it, and define
behavior on restart and cancellation. Do not treat cached code state as durable
conversation history or authorization. Anthropic documents optional container
reuse and expiration, illustrating that state lifetime is an implementation
choice rather than an inherent property of Code Mode. [Anthropic container
lifecycle](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling).

## Local and self-hosted execution

Node's [`node:vm` documentation](https://nodejs.org/api/vm.html) explicitly says
the module is not a security mechanism and must not run untrusted code. The
article's `vm` sketch is not a safe sandbox recipe. A different global object,
timeout, or restricted imports alone does not establish isolation.

Monty is a candidate for a local restricted-language experiment. Its [security
model](https://github.com/pydantic/monty/blob/main/docs/security.md) describes
interpreter-level isolation, not an OS sandbox. It has no ambient filesystem,
network, environment, or process access without supplied host mechanisms, but
those callbacks run with host authority. Its Python subset limits compatibility,
and interpreter defects and resource exhaustion remain risks. Its [core
README](https://github.com/pydantic/monty/blob/main/crates/monty/README.md)
recommends worker subprocesses for untrusted code because a process abort in the
in-process interpreter also takes down the host. Evaluate the exact version,
bindings, maintenance, and limits before relying on it.

A hardened local container is another candidate, with an unprivileged identity,
no host mounts or credentials, denied network, restricted system calls, and
resource limits, plus a narrow host bridge. Containers share a kernel; Docker
warns that capabilities, mounts, and kernel vulnerabilities can undermine
isolation. Configuration, daemon access, lifecycle, platform availability, and
updates add operational work. On macOS, Docker Desktop runs Linux containers in
a VM, with separately configured host file sharing. Neither a container nor a VM
makes unsafe host callbacks safe. [Docker security](https://docs.docker.com/engine/security/),
[Docker Desktop isolation](https://docs.docker.com/faqs/platform/#containers).
A stronger isolation runtime such as [gVisor](https://gvisor.dev/docs/architecture_guide/intro/)
adds a userspace kernel boundary but adds platform and compatibility constraints.
None of these options has been validated for Staf here.

## Architecture fit and tradeoffs

Staf's accepted [dispatch decision](../decisions.md#keep-conversation-state-and-tool-dispatch-in-staf)
keeps conversation state, tool IDs, and dispatch in Staf across providers. Its
simple-chat direction puts actual tool use in the message list. These choices
are compatible with a code executor, provided the shared service continues to
authorize and record every underlying action. Code Mode changes how an agent
combines capabilities. It does not require a new conversation owner, a separate
database per agent, an Activity screen, or an MCP server.

The following alternatives are Staf design inferences, not evaluated results.

| Model-facing interface | Architectural benefit | Architectural cost |
| --- | --- | --- |
| Direct tools | Keeps today's execution model and exposes each requested action directly. | Dependent calls and transformations often require another model step. |
| Code execution as the primary interface | Gives compound operations one consistent programming interface. | Every tool task depends on code generation and an executor, including simple actions. Script failures and partial completion need explicit handling. |
| Direct tools plus code execution | Allows a bounded experiment and incremental adoption using the same underlying operations. | Adds two invocation paths. Routing and equivalent policy enforcement need proof. |

**Recommended direction to evaluate:** define one service-owned capability
contract that both direct calls and a future code bridge could invoke. The
contract would own validated inputs, structured outputs, effects, limits, and
dispatch through the existing authorization paths. A small isolated executor
could then orchestrate those capabilities without receiving the `Instance`
object, credentials, or unrestricted host access. Provider adapters would keep
their protocol-translation role. A provider-managed execution feature is a
different deployment choice and should not determine Staf's internal contract.

This separates two decisions: whether Staf needs clearer capability contracts,
and whether generated programs are a useful way to invoke them. The existing
string-result boundary is relevant to the first decision even if Code Mode is
not adopted. A general plugin framework or a large registry is not required to
evaluate either question.

Before choosing a default interface, evaluate these architectural boundaries:

- **Authority:** each host call uses the same permissions and applicable
  approvals as its direct equivalent. Approving a script does not bypass checks
  on the actions it later requests.
- **Lifecycle:** Stop ends new dispatch, interrupts pending work where possible,
  and retains completed or uncertain child outcomes. Restart cannot silently
  replay a partly completed script.
- **State:** executor-local values are distinct from conversation history,
  retained memory, and durable action records. A first experiment can discard
  them when the invocation ends.
- **Deployment:** the executor must fit the self-hosted instance and have a
  maintained isolation boundary. The existing scratch-shell path supplies useful
  lifecycle experience but does not supply the required tool bridge.
- **Observability:** the owner can inspect actual child actions in chat even
  when the model receives only filtered script output.

The architectural payoff is conditional. A shared capability contract with
replaceable invocation methods could make Staf easier to extend. An executor
with separate tool definitions, permission logic, or history would instead add
another runtime to keep consistent.

## A bounded architecture experiment

The first experiment should test these boundaries before optimizing research
speed. A read-only source workflow gives the executor dependent calls and
structured data without adding write-recovery semantics to the initial scope.

A future offline, read-only experiment could compare direct calls with a single
code call for searching fixture sources, reading selected pages, and returning
bounded excerpts with source URLs. Use the same inputs, expected answers,
approval policy, and host-side action trace for both paths. Give the executor
no credentials, network, shell, or host mounts.
Use a separately evaluated isolation boundary, not `node:vm`. Include malformed
inputs, denied calls, repeated calls, output limits, cancellation, and partial
results. Compare answer correctness, child-call visibility, failure behavior,
context size, and elapsed time with setup costs stated. A scripted driver can
prove orchestration behavior, but measuring model round trips, answer quality,
and token use needs a separate authorized model-backed comparison. Predefine a
small sample and report failures and environment details. Fixture results would
not establish production security, provider compatibility, or live performance.

## Open questions

- Should code execution become the primary model-facing interface, remain an
  optional invocation method, or be deferred after capability-contract work?
- Which isolation boundary and supported platforms meet Staf's local deployment
  needs, and who maintains and updates it?
- How should approval, cancellation, partial outcomes, and trace redaction work
  when a script requests multiple actions concurrently?
- Should any state persist between calls, and what are its exact scope and
  deletion rules?
- Which output schemas and provider adapters are available in practice, and how
  should Staf handle unsupported or unstructured results?
- Which representative workflows would reveal a meaningful architectural
  advantage or unnecessary complexity compared with direct service calls?
