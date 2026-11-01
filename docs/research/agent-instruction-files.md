# Agent instruction files: OpenClaw and Hermes

Checked 2026-11-01 against official documentation and the default-branch source
heads of [OpenClaw](https://github.com/openclaw/openclaw/tree/b2bfad1071b0cac22de5c80c19c28a0cce37216d)
and [NousResearch Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/944799abc0a8b23d24e59f320d1c48498789c87c).
This research informed Q18; the subsequent owner decision is recorded below.
Upstream behavior can
vary by version, runtime, and configuration. No live agent was run.

## Comparison

| Responsibility | OpenClaw | Hermes Agent |
| --- | --- | --- |
| Persona and identity | Workspace `SOUL.md` holds persona, tone, and boundaries; `IDENTITY.md` holds name and other identity details. | `$HERMES_HOME/SOUL.md` supplies the primary identity. |
| Operating instructions | Workspace `AGENTS.md` holds rules and workflows. An execution folder can also provide project-specific `AGENTS.md`. | `SOUL.md` can hold standing behavior; project instructions use `.hermes.md`, `AGENTS.md`, or compatible alternatives. |
| User and memory | `USER.md` describes the user; `MEMORY.md` and `memory/YYYY-MM-DD.md` hold retained knowledge. | `memories/USER.md` and `memories/MEMORY.md` contain a user profile and agent memory. |
| Tools and model | `openclaw.json` supplies model and tool policy, with defaults and per-agent overrides. `AGENTS.md` tool notes are guidance. | `config.yaml` supplies model, provider, and toolsets; `.env` holds secrets. |

The names above are recognized by their respective loaders, not arbitrary Markdown
names. Both products also support other context mechanisms. The table summarizes
the default designs, not every integration. [OpenClaw workspace](https://docs.openclaw.ai/concepts/agent-workspace),
[OpenClaw agent settings](https://docs.openclaw.ai/gateway/config-agents/entries-and-multi-agent),
[Hermes file map](https://hermes-agent.nousresearch.com/docs/user-guide/which-file-does-what),
[Hermes configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration).

## OpenClaw: workspace instructions and persona

OpenClaw's [workspace guide](https://docs.openclaw.ai/concepts/agent-workspace)
assigns operating instructions to `AGENTS.md` and persona to `SOUL.md`. Its
[AGENTS template](https://docs.openclaw.ai/reference/templates/AGENTS) includes
workspace rules, memory practices, and action guidance. Its [SOUL template](https://docs.openclaw.ai/reference/templates/SOUL)
also contains behavioral boundaries and working guidance. The distinction is
useful for organization, but the content can overlap. `IDENTITY.md` adds a
separate name and presentation, while `USER.md` contains user context. The
`## Tools` section of `AGENTS.md` records local conventions; actual availability
is controlled by tool policy, not by that text.

The [prompt documentation](https://docs.openclaw.ai/concepts/system-prompt#workspace-bootstrap-injection)
lists `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, initial `BOOTSTRAP.md`,
and existing `MEMORY.md` as bootstrap inputs. The [workspace loader](https://github.com/openclaw/openclaw/blob/b2bfad1071b0cac22de5c80c19c28a0cce37216d/src/agents/workspace.ts#L862-L918)
reads recognized files and preserves missing-file diagnostics. An additional
execution folder can contribute its `AGENTS.md`, without replacing the agent
workspace's identity files. Worktree and native Codex cases differ, as the
prompt documentation explains. Do not interpret insertion order as a guaranteed
semantic priority between conflicting natural-language instructions.

In the embedded runtime, normal bootstrap injection defaults to `always`, subject
to context mode and filters. `continuation-skip` and `never` change that behavior;
subagents and other runtimes have different filters. `skipBootstrap` stops starter
file creation, not injection of existing files. OpenClaw normally resolves
bootstrap context per run, so edits can be picked up on a later run under the
active mode; this is not a guarantee for every harness or injection mode.
[Bootstrap configuration](https://docs.openclaw.ai/gateway/config-agents/workspace-and-bootstrap),
[agent loop](https://docs.openclaw.ai/concepts/agent-loop),
[loader filters](https://github.com/openclaw/openclaw/blob/b2bfad1071b0cac22de5c80c19c28a0cce37216d/src/agents/workspace.ts#L920-L977).

The documented default limits are 20,000 characters per bootstrap file and 60,000
total, with a separate 4,000-character `USER.md` limit. Truncation is signaled
and does not change the file. Daily memory is normally retrieved on demand;
startup after `/new` or `/reset` can add recent daily memory. `MEMORY.md` is
intended for the private main session, and native Codex has a distinct on-demand
memory path. Skills use an injected index and on-demand file reads. [System prompt](https://docs.openclaw.ai/concepts/system-prompt#workspace-bootstrap-injection),
[workspace file map](https://docs.openclaw.ai/concepts/agent-workspace#workspace-file-map).

Owners can edit workspace files directly or in **Settings > Agents > Files**.
Model and tool settings have separate configuration and UI controls; credentials
and sessions live outside the workspace. OpenClaw's default soul template asks
the agent to evolve that file and tell the user when it changes. That is a
prompt instruction, not evidence that an agent always has permission to write
it. Access depends on the actual tool and sandbox policies. [Workspace guide](https://docs.openclaw.ai/concepts/agent-workspace),
[SOUL template](https://docs.openclaw.ai/reference/templates/SOUL),
[tool configuration](https://docs.openclaw.ai/gateway/config-tools).

## Hermes: agent identity and project context

Hermes loads `SOUL.md` from the active Hermes home, not the current project. It
replaces the built-in identity when nonempty and readable. Hermes seeds a starter
without overwriting an existing file; empty or unreadable content falls back to
the built-in identity. A temporary `/personality` preset is a separate session
overlay. [Personality documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/personality),
[identity loader](https://github.com/NousResearch/hermes-agent/blob/944799abc0a8b23d24e59f320d1c48498789c87c/agent/prompt_builder.py#L1512-L1560),
[identity selection](https://github.com/NousResearch/hermes-agent/blob/944799abc0a8b23d24e59f320d1c48498789c87c/agent/system_prompt.py#L546-L556).

Hermes separates that portable identity from project rules. It picks one project
context type in order: `.hermes.md` or `HERMES.md`, the `AGENTS.md` chain,
`CLAUDE.md`, then Cursor rules. `AGENTS.override.md` wins over `AGENTS.md` in
the same directory. Nested instructions can be discovered as tools visit paths.
The pinned [loader](https://github.com/NousResearch/hermes-agent/blob/944799abc0a8b23d24e59f320d1c48498789c87c/agent/prompt_builder.py#L1580-L1607)
walks the Git-root-to-current-directory `AGENTS.md` chain at startup. The
[context guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files#directory-chain-git-root--working-directory)
also explicitly documents that chain. Its supported-file table and progressive
discovery section use current-directory shorthand, so read those alongside the
chain section. The scope separation is substantive: a project can change
without changing the agent's home identity.

The default context-file cap scales with model context, from 20,000 to 500,000
characters, unless configured. Oversized files lose middle content in the prompt
and get a marker; the file remains readable in full. Hermes scans context files.
User-authored soul matches warn and load, while project files and third-party
distribution-owned soul files can be blocked. [Configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration#context-file-truncation),
[security guide](https://hermes-agent.nousresearch.com/docs/user-guide/security),
[truncation code](https://github.com/NousResearch/hermes-agent/blob/944799abc0a8b23d24e59f320d1c48498789c87c/agent/prompt_builder.py#L1034-L1054).

`memories/USER.md` and `memories/MEMORY.md` are separate, normally enabled
snapshots assembled for the session. The memory tool can update them; optional
write approval changes that workflow. `config.yaml` controls model, provider,
and toolsets; `.env` and auth storage hold credentials. The active profile is a
separate Hermes home with its own settings, secrets, memory, and sessions. That
home isolation is independent of why identity and project instructions have
different prompt scopes. [File map](https://hermes-agent.nousresearch.com/docs/user-guide/which-file-does-what),
[configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration),
[profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

Owners can edit files directly, manage settings with the CLI, and edit a bot's
full soul and model settings in Hermes Desktop's Bot Mode. A session normally
retains its assembled context after file edits. Start a new session, or use
`hermes sessions refresh-prompts` for a long-running gateway session to pick up
updated files on its next turn. The security documentation says file-tool writes
to the owner's `SOUL.md` require approval; this statement does not establish the
behavior of every possible tool or plugin. [Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode),
[file map and refresh](https://hermes-agent.nousresearch.com/docs/user-guide/which-file-does-what),
[security](https://hermes-agent.nousresearch.com/docs/user-guide/security).

The [prompt-assembly guide](https://hermes-agent.nousresearch.com/docs/developer-guide/prompt-assembly)
says skipping context files also skips the soul. The pinned
[identity-selection code](https://github.com/NousResearch/hermes-agent/blob/944799abc0a8b23d24e59f320d1c48498789c87c/agent/system_prompt.py#L546-L556)
has an additional `load_soul_identity` override, so that statement is not
unconditional. This comparison does not establish which callers set that override.

## Implications for Staf

Staf's [glossary](../../GLOSSARY.md) distinguishes soul from instructions, and
the [initial contract](../first-delivery-bot-contract.md#profile-and-creation-defaults)
stores them separately. The current [interview record](../decisions.md#chat-gui-polish-and-agent-terminology)
leaves consolidation open. [ADR-0003](../adr/0003-editable-agent-configuration.md)
already accepts authoritative files, a stable agent-ID directory, `agent.toml`,
shared service writes, and direct terminal edits. It also specifies valid changes
for the next message, captured settings for ongoing work, actionable invalid-file
errors, and conflict preservation. Conversations and operational records stay in
the shared database, and secrets stay outside agent files. Creation needs only a
name; shared connections support per-agent provider and model choices. These are
target design agreements, not proof of implemented file-backed behavior.

**Inference:** The smallest suitable option is one owner-authored Markdown
instruction file per agent, alongside `agent.toml`. Optional headings can make
personality and role guidance easy to find without requiring either section.
This matches the same owner, agent scope, and edit lifecycle currently described
for both Staf texts. Hermes does not show that two documents are needed for that
case: its important split is between agent identity and a changing project.
OpenClaw shows a readable split, but its own templates overlap. Neither proves
that separate files improve Staf's simple creation and settings experience.

The tradeoff is that separate documents make the conceptual distinction visible
and allow independent editing or replacement. One document avoids forcing the
owner to decide which of two files holds overlapping guidance, but headings and
conflicting text still need human judgment. This comparison does not recommend
arbitrary extra files, project-context discovery, or automatic self-modification.
Permissions remain enforced separately from editable instruction text.

At the time of this comparison, the open choices were whether to merge and what
to call the document
(`soul.md` may suggest personality alone), and whether optional headings are
helpful. If merged, migration must preserve existing soul and role instruction
text exactly, without summarizing or silently discarding either, and retain their
distinguishable origins for review. The ordering and separator need an explicit
choice; this note does not decide them. Confidence is moderate: the source
comparison supports a simpler default, but it cannot decide the owner's preferred
editing experience or establish model behavior from file structure alone.


## Subsequent owner decision

On 2026-11-01 the owner selected one soul.md for agent personality, role, and
standing guidance, alongside agent.toml for structured settings. Preserve existing
soul and role text when consolidating them. See [ADR-0003](../adr/0003-editable-agent-configuration.md)
and the [consolidated plan](../chat-polish-plan.md). This records a design decision,
not runtime implementation.
