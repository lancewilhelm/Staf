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
Slack delivery; they do not yet generate failure notifications.

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

The broader policy for private email remains unresolved. The current chat action
requires an explicit per-agent provider and model decision before sending data
to a model. A classifier cannot judge sensitivity without accessing data; no
automatic classifier runs here. Tests use synthetic data and do not establish
Google behavior.
