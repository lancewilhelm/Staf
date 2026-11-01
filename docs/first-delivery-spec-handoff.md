# First connected bot delivery specification

Status: accepted planning specification, 2026-10-30. Published as the
[delivery specification](https://github.com/lancewilhelm/Staf/issues/19). The
owner confirmed the first-delivery acceptance agreement and behavior-test seam.
This is not evidence that the feature
exists or that live checks have passed. The [accepted decisions](https://github.com/lancewilhelm/Staf/issues/1)
are the product authority where this draft is ambiguous.

## Problem statement

The owner cannot yet use web and CLI as clients of one always-on bot, keep
chatting while it performs background work, or inspect the same durable task
history after reconnecting. Current Staf has a local CLI, provider adapters,
conversation persistence, settings, usage accounting and a clock tool. It does
not yet have the shared service, bot profiles, Activity, pairing or SQLite store.

## Solution

Run a personal Staf instance on a Linux VM or in Docker. Pair the owner's web
and CLI clients to the instance. Create and configure named bots, continue their
main chats, and inspect and control one read-only background task per bot. Keep
chat, task records and Activity across client disconnections and instance
restarts. Offer owner-controlled installation, updates, backup and restore.

## User stories

1. As the owner, I want to install Staf on a Linux VM without a public domain, so that I can use it on my local network.
2. As the owner, I want a Docker alternative using the same configuration and API, so that I can choose how to host the instance.
3. As the owner, I want a service that can start after reboot and outlive my terminal, so that work does not depend on my login session.
4. As the owner, I want service status and logs, so that I can diagnose an unavailable instance.
5. As the owner, I want to configure the instance through CLI or browser before a model works, so that I can recover from provider setup problems.
6. As the owner, I want to pair each client with a one-time host code, so that only authorized clients can use my instance.
7. As the owner, I want to inspect and revoke clients, so that I can remove access from a device.
8. As the owner, I want to set up a supported provider from a different machine than the host, so that a remote VM remains usable.
9. As the owner, I want clear provider readiness and errors, so that Staf does not silently select a different provider.
10. As the owner, I want to create a bot with a name and instructions without a model request, so that setup works before provider credentials are ready.
11. As the owner, I want bots to copy creation defaults, so that later default changes do not silently change an existing bot.
12. As the owner, I want to edit a bot's instructions, soul and model settings, so that the bot can be customized independently.
13. As the owner, I want duplicate names to remain distinguishable, so that I can select the intended bot.
14. As the owner, I want renaming to preserve identity and chat history, so that a label change does not lose my work.
15. As the owner, I want conflicting profile edits reported, so that one client does not overwrite another client's newer changes.
16. As the owner, I want to archive and restore an idle bot without deleting its history, so that I can remove it from the active list safely.
17. As the owner, I want web and CLI to show the same persistent main chat, so that I can move between clients.
18. As the owner, I want a busy response and my unsent text preserved when another client is already chatting with the bot, so that I can retry deliberately.
19. As the owner, I want saved chat and work restored after reconnecting, so that a dropped connection does not lose context.
20. As the owner, I want uncertain submissions checked without silent resubmission, so that a lost acknowledgment does not duplicate work.
21. As the owner, I want one read-only background task per bot while chat remains responsive, so that I can continue the conversation during work.
22. As the owner, I want Activity to show actual task steps, results and errors, so that I can understand what happened.
23. As the owner, I want the CLI to list, inspect and follow the same tasks, so that task visibility does not depend on the web app.
24. As the owner, I want to explicitly direct or stop a task and see when it has actually stopped, so that acknowledgment is not confused with completion.
25. As the owner, I want a changed objective to stop the original task and create a linked replacement, so that I can trace both attempts.
26. As the owner, I want failed or interrupted work preserved and explicitly retried as a linked attempt, so that history remains truthful.
27. As the owner, I want current permissions and approval requirements enforced on the next action, so that an older work snapshot cannot bypass a restriction.
28. As the owner, I want an adjustable execution limit that excludes approval waits, so that runaway work requests a stop.
29. As the owner, I want updates to preserve my data and configuration, so that I can update when I choose.
30. As the owner, I want a recoverable backup before stored-format changes and a documented restore to another host, so that I can recover my bots and history.

## Implementation decisions

- The first delivery is a subset of the full MVP. One always-on instance owns canonical records in SQLite. Web and CLI call the same authenticated service. Exact HTTP routes, event transport, library choices, schema and service manager are implementation choices.
- Keep bot identity, main chat, messages, task attempts, Activity, command results and usage distinct. Save related changes atomically. Keep provider credentials separate from profiles and client-visible records.
- A bot owns a copy of its creation settings. An accepted turn or task captures the relevant profile revision and configuration. Live permission revocations and stricter approval settings still apply before the next action.
- Accept only one main-chat request per bot at a time. Another client gets a busy response and retains its unsent text for explicit retry. Background work remains independent. Service ordering must prevent a stale chat snapshot from erasing task events.
- Reconnect restores saved records. Check a submission when acknowledgment was lost and show uncertainty when necessary. Do not silently resend it or queue new offline submissions. Command IDs and stored results are the recommended implementation, not a separately approved product decision.
- A bot has at most one background task at a time. Activity records actual progress, errors and outcomes. Main chat receives brief announcements, requests for input and outcomes. A changed objective stops the current work before starting a linked replacement.
- A stop request prevents new steps and requests cancellation. Show stopping until execution settles. Preserve late output and completed outcomes. A disconnect does not stop work. A restart marks unfinished work interrupted; a retry is explicit and linked. The adjustable initial execution limit is five minutes, excluding approval waits.
- Support the accepted approval modes and permission boundaries. Task context and captured configuration do not confer permission. No shell or web execution is added by this delivery.
- The first delivery assumes a clean start. Leave existing conversation files unchanged; importing them is not required. Document context limits without inventing compaction behavior.
- Pairing, transport protection, credential storage, remote provider setup and backup mechanics must be designed and verified. A LAN deployment does not by itself establish secure access. Do not treat the current host-loopback Codex callback as a remote authorization solution.
- Begin desktop web interaction with the accepted side-by-side chat and Activity direction. CLI displays the same records. Exact commands, responsive behavior and visual polish remain implementation work.

## Testing decisions

Test observable outcomes rather than internal structure. The agreed main seam is the service command and query boundary, with real temporary SQLite storage, deterministic providers and a controllable clock. Hold a background task at a test gate and prove a main-chat response completes before releasing it. Check two clients against the same durable state. Reuse existing provider, conversation, settings, replay, usage, cancellation and CLI test patterns.

Cover bot identity, copied defaults and edit conflicts; chat concurrency; duplicate or uncertain submissions; actual task events; stop and late-result races; permission revocation; disconnect and restart; and preservation of usage and tool results on failures. Verify cancellation reaches the selected provider transport. In particular, address the known OpenRouter abort gap rather than assuming late-result suppression stops a request.

Run actual native Linux and Docker installation and recovery checks, including service reboot, client pairing and revocation, persistent storage, update backup and restore. Before complete-delivery acceptance, verify a supported setup path and a basic live conversation for Codex and OpenRouter, including remote setup where applicable. Live sign-in and inference require separate authorization. Report an unrun or failed check as an acceptance gap. Existing local or mocked tests do not prove remote operation.

## Out of scope

Memory retrieval, automatic skill lifecycle, shell and web execution, recurring schedules, bot collaboration, automatic soul evolution, household accounts, native mobile, Electron, automatic conversation import and automatic task continuation after restart. These exclusions do not remove the associated requirements from the full MVP.

## Further notes

Deliver three user-visible slices: connected bot and chat, background work and Activity, then installation and recovery. Each has checks and can start when its own genuine prerequisites are met. Detailed tickets may split these slices further. The complete owner journey and its evidence are the delivery acceptance target.

The owner approved the behavior-test seam and the six-ticket breakdown. No provider requests, deployment or runtime tests were performed while drafting this specification.
