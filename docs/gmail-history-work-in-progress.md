# Gmail history work in progress

This document describes the internal, unintegrated history implementation.
Staf can manage a Gmail connection, but cannot search mail or monitor an inbox
yet. See [Gmail setup](usage.md#gmail-plugin) for the connection's limits.

The history component records an account's initial history ID without emitting
existing messages. It collects all pages of a subsequent scan before atomically
committing the returned cursor and unique message IDs to SQLite. A failed scan
does not advance the cursor. A Gmail history 404 records an unknown interval
instead of silently replacing the cursor. The caller must install its schema,
provide an authorized transport, and own scheduling and lifecycle controls;
none of those are wired into the instance yet. A stored message ID is not proof
that the message was inspected or processed.

The experimental transport requests unfiltered `messageAdded` history and
records all message IDs as candidates. Gmail's history response typically
provides message IDs without label details; its release notes describe returned
labels as current state. An archived message must therefore not be discarded by
filtering on its current `INBOX` label. Candidates may include sent or draft
messages; historical inbox membership is unknown and must not be represented as
established. Expired history requires an explicit
reconciliation design because a full sync cannot establish which messages
arrived in the missing interval. See Google's [history reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
and [synchronization guide](https://developers.google.com/workspace/gmail/api/guides/sync),
and its [release notes](https://developers.google.com/workspace/gmail/release-notes).

Before any real mail is processed, the owner's boundary for sending private
email to a model provider remains to be resolved. A classifier cannot judge
sensitivity without accessing data. Service action integration, visible
inspection, durable processing identity, and monitoring remain to be built.
The current tests use synthetic data and do not establish Google behavior.
