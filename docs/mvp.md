# MVP decisions and current delivery

This document records user decisions. It is not a claim that every item exists.
Hermes is the primary reference for basic agent behavior. Staf remains a project
built from the ground up, with usability before full Hermes parity.

## Required MVP

- Codex and OpenRouter are the initial providers. Codex uses direct Responses,
  not CLI exec or app-server. LM Studio and other local providers come later;
  existing LM Studio code remains available.
- Persistent chats and sessions retain history and consumption across restarts.
- An ordinary scheduler and event loop runs without an LLM polling for time.
- Tool execution includes shell, web search and source reading, memory, and skill
  discovery/use. An approval and rules pipeline must accompany executable tools
  from the start. This requirement does not authorize arbitrary host actions now.
- A useful chat UI and Activity visibility are essential to the MVP. The CLI
  remains an access point, not a reason to defer app usability indefinitely.
- Natural-language requests should select relevant skills. Slash commands must
  not be mandatory for ordinary skill use.

## Delivered in this implementation

The direct adapter and in-process sign-in have offline tests. The default
Codex registry path no longer launches the CLI or app-server. On 2026-10-26,
user-authorized `gpt-6-luna` requests with an existing Staf grant verified text,
a saved-history follow-up and a resumed clock-tool round trip. Fresh browser
registration and live refresh rotation remain unverified; see
[verification and remaining gaps](direct-responses.md#verification-and-remaining-gaps).
OpenRouter, saved sessions, settings, context display and usage are implemented.
Clock is the only executable Staf tool. The existing CLI is the current UI.

The scheduler, shell/web/memory/skill tools, approval rules engine and app Activity
view are not implemented by this change. They remain required MVP work. Automatic
skill creation, review and retirement remain undecided. History, memory, skills
and permissions are separate concerns; a transcript is not a memory system or a
permission grant.

## Deferred provider work

The direct provider supports one registration per data directory. An account-switch
UI and server-side grant revocation are not implemented; local logout removes
local tokens only. Automatic transport retries are also not implemented. Their
policies and priority remain open.

Before adding writable tools, define approval rules, durable side-effect tracking
and recovery so an interrupted or retried turn cannot silently repeat a write.
The current reversible clock read does not establish those guarantees. Usage and
metadata remain provider-specific; no account-wide quota or billing reconciliation
is implemented. See [usage accounting](usage-accounting.md).

## Architecture to keep open

Each bot has a main coordinating chat and may have separate sessions. Background
tasks and observable inter-bot messages remain long-term architecture, with
expectation-driven handoff. Activity should show real messages, steps, tool
outcomes and results, not fabricated hidden reasoning. See
[session architecture](session-architecture.md).

Future desktop, mobile and CLI clients share authoritative service state. They
must not invent conflicting local task histories or copy credentials to every
client. The service topology and storage schema remain open; no migration is
performed here.

Hooks, triggers and sensing should cover schedules, events, conditions and
lifecycle hooks. Their design needs deduplication, freshness and health signals,
bounded runs and protection against self-trigger loops. Linked apps and services
are called **Connections**. Their implementation is after MVP. Event and
permission interfaces should still accommodate webhooks, polling and future
adapters. No Connection or external account was configured here.

Dedicated execution environments and shared-desktop takeover belong to later
vision. They are not a prerequisite for the current direct-provider work and
were not implemented or provisioned.
