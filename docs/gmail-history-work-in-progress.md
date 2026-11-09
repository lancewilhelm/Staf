# Gmail history work in progress

This document describes the Gmail history implementation and its evidence
limits. See [Gmail setup](usage.md#gmail-plugin) for owner controls.

The history component records an account's initial history ID without emitting
existing messages. It collects all pages of a subsequent scan before atomically
committing the returned cursor and unique message IDs to SQLite. A failed scan
does not advance the cursor. A Gmail history 404 records an unknown interval
instead of silently replacing the cursor. The service owns the schema, scheduled
polling and lifecycle checks. A stored message ID is not proof that the message
was in the inbox, inspected, or processed by an agent.

Each started history scan records its start and outcome in the instance
database. The plugin status API returns the 30 most recent scans. A scan left
running by a service restart is marked interrupted. The records contain no mail
content or raw provider errors. They describe history scans, not agent review or
Slack delivery. The separately enabled inbox assistant can notify Slack about a continuing failure.

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

The history component itself does not classify email. The separately enabled inbox assistant requires explicit provider and model permission before sending message content for assessment. A classifier cannot judge sensitivity without accessing data and can make mistakes. Tests use synthetic data and do not establish Google behavior.
