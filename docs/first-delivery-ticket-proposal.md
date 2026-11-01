# First connected bot delivery ticket proposal

Status: owner-approved breakdown, 2026-10-30. The three delivery slices remain
the milestone structure. The [published implementation issues](https://github.com/lancewilhelm/Staf/issues/19)
are the current tracker records. Acceptance criteria describe future behavior.

## 1. [Connect clients to a named bot and shared chat](https://github.com/lancewilhelm/Staf/issues/20)

**Slice:** Connected bot and chat.

**Blocked by:** None.

Start a foreground instance, pair a browser and CLI client, create a named bot,
and continue its persistent main chat from either client. Offer deterministic
offline execution and clear provider readiness. Resolve pairing and transport
protection for the supported LAN path. Prove that reconnect and lost
acknowledgments do not silently duplicate submissions, that a competing chat
request is busy without losing unsent text, and that existing CLI conversation
files remain untouched. Include real temporary durable storage and tests across
both clients. Retain existing provider paths.

## 2. [Manage bot configuration and lifecycle across clients](https://github.com/lancewilhelm/Staf/issues/21)

**Slice:** Connected bot and chat.

**Blocked by:** Ticket 1.

Edit bot instructions, soul and copied model configuration from shared state.
Show conflicts for stale edits. Preserve identity and history on rename, allow
duplicate names with disambiguation, and support idle-only archive and restore.
Prove default changes affect future bots only, running work retains its captured
configuration, and missing provider setup does not prevent profile editing.
Task-specific archive and snapshot cases must be verified again when ticket 3
adds tasks.

## 3. [Run and inspect background work while chat remains available](https://github.com/lancewilhelm/Staf/issues/22)

**Slice:** Background work and Activity.

**Blocked by:** Ticket 1.

Start one read-only task per bot, keep main chat responsive, and show the same
actual progress and outcome in web Activity and CLI. Enforce approval and
permission rules, support explicit task direction and stop-and-replace, show
stopping truthfully, preserve late results and usage, and retain interrupted
work after restart with explicit linked retry. Test cancellation through the
selected adapter, including the known OpenRouter transport abort gap. Prove chat
progress with a controlled task gate, not a timed sleep. Include the adjustable
five-minute execution default excluding approval waits.

## 4. [Set up and verify providers on a remote instance](https://github.com/lancewilhelm/Staf/issues/23)

**Slice:** Installation and recovery.

**Blocked by:** Ticket 1.

Give an owner using a browser or CLI on another machine a supported way to
configure the instance's Codex and OpenRouter providers and understand readiness
or failure. Design and verify the remote Codex authorization path instead of
assuming the existing host-loopback callback works remotely. Keep credentials
out of clients and bot snapshots. Offline tests cover setup behavior. A supported
setup path and a basic live conversation for each provider, including remote setup
where applicable, are acceptance checks that require separate authorization.
Record an unrun or failed live check as an acceptance gap.

## 5. [Install and recover the native Linux instance](https://github.com/lancewilhelm/Staf/issues/24)

**Slice:** Installation and recovery.

**Blocked by:** Tickets 2 and 3.

Install the service on Linux, start it after reboot, inspect its status and logs,
and perform an owner-initiated update with a recoverable backup before a stored
format change. Restore the instance on a replacement host, including bots, chat,
settings and task history. Verify the complete path on a Linux VM and record
actual results. Provider reauthentication after restore is acceptable.

## 6. [Install and recover the Docker instance](https://github.com/lancewilhelm/Staf/issues/25)

**Slice:** Installation and recovery.

**Blocked by:** Tickets 2 and 3.

Run the same service and configuration in Docker with persistent state. Perform
an owner-initiated update and recoverable backup, then restore bots, chat,
settings and task history to a replacement instance. Verify persistence and
restore in an actual container and record results. This ticket does not require
native Linux service installation; ticket 5 and this ticket can proceed in
parallel after their common blockers close.

## Whole-delivery acceptance

The specification is accepted only after the complete owner journey works and
the required offline, Linux, Docker and separately authorized live-provider
checks pass. Native and Docker work can proceed while remote provider setup is
underway. No ticket's completion should be inferred from a mock, draft or this
proposal. Later MVP questions remain outside these blockers.
