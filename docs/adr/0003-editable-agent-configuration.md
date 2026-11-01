# Keep agent configuration in directly editable files

Accepted in the GUI and agent-management interview on 2026-11-01. The shared
service implements file-backed configuration for fresh instances.

Agent configuration files are authoritative. The GUI, CLI, and future clients
edit the same configuration through the shared service, while terminal tools and
external agents can maintain the files directly. Conversations and operational
records remain in the shared instance database, and provider credentials remain
in the instance credential store. This replaces database-owned profiles as the
target design because direct file maintenance is an explicit owner requirement.
A separate exported copy would require reconciliation between two editable
configurations. Separate agent databases and processes are not required.

The service validates saved configuration before accepting the next message.
Existing work retains its captured settings. Invalid files stay intact and block
new messages for the affected agent with an actionable error. Concurrent client
edits report conflicts and preserve unsaved edits. Each agent has a directory
keyed by its stable ID, so renaming preserves the path. Agent Settings and the
CLI expose the path. Structured settings belong in agent.toml. One soul.md holds
personality, role, and standing guidance, with one Instructions editor in the GUI.
Legacy text consolidation is outside this delivery's scope. The service publishes
both files through an atomic revision-directory pointer, as described in the
[architecture](../architecture.md#local-shared-instance-preview).

See the [interview decisions](../decisions.md#chat-gui-polish-and-agent-terminology)
and [copied creation defaults](0002-copy-bot-creation-defaults.md).

## Revision: direct editing and recovery

For issue #28, the owner chose ordinary direct edits instead of the proposed
checkout and explicit publish workflow. The service validates files before new
work, rejects stale client saves, and retains observed valid configurations for
recovery. Direct file writes are last-write-wins. A version overwritten before
the service observes it cannot be recovered, and separate writes to the two
files do not form an atomic pair. See [usage](../usage.md#agent-configuration-files).
