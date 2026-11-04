# Conversation sessions

An agent's **Session history** control starts a named fresh conversation and
opens or searches original messages. A fresh session retains the agent's soul,
configuration and memory, but begins with no previous messages, provider replay,
execution events or summaries. Nothing is compacted, automatically truncated,
or automatically carried over. Browsing history does not change active context.

Starting a session is refused while that agent has a pending chat command or
queued, running, stopping, or waiting background work. It
uses the current session as an optimistic precondition and a retained operation
ID for retries. If creation is uncertain, retry the control to check the same
operation. Commands capture a session at acceptance. An explicit stale session
is rejected; older clients that omit it capture the then-current session. A
retry of an existing command checks the original command and session first.
Stop remains agent-wide for the active command.

Browser drafts are stored per dataset, agent, session and tab. Drafts from an
earlier session remain in **Earlier browser records** for copying, including
drafts containing selected sources without text. Older
pre-session keys recover automatically only when a stored command proves the
agent, current session, submitted text, and any saved source identities. Other
records remain separate and are not automatically submitted. Use **Check original
submission** to inspect a verifiable original command without retargeting it.
A selection in
history adds a stable session-message reference to the next draft. Search
results select an excerpt around the matching text, including a character
position for long messages. Opening a search result or cited source loads the
page containing its exact message and focuses it. The source selection is
visible before sending.

The paired API exposes `GET/POST /api/bots/:botId/sessions`,
`GET /api/bots/:botId/sessions/:sessionId?offset=0&limit=100`, and
`GET /api/bots/:botId/session-search?q=...`. Reads are paged to at most 200
messages. Optional `messageId` opens the page containing that same-session
message and returns the page `offset`. Searches return at most 100 matches and a bounded excerpt. Session listing is paged to at most 200 sessions. Public history uses visible message
records; private provider replay and encrypted reasoning are not returned.
The terminal captures a session and dataset at connection time. Unsent drafts
keep that identity through edits and retries. If the active session changes,
the terminal retains the draft and asks you to reopen; copying its text into a
new session is an explicit owner action. Older drafts with no verifiable
identity remain copy-only.

The internal `Instance` methods `currentSession`, `commandSession`,
`listSessions`, `readSession`, `searchSessions`, and `resolveSessionMessage`
provide the integration seam. `sessionCapabilities` scopes reads to a pending
captured agent, session, command and abort signal; it registers no model tools.

Schema migration 31 creates session, command and message ownership tables and
maps existing records to each agent's initial session. Existing private replay,
usage, progress, stops and command events remain in the database. Before opening
a file-backed older database, Staf makes its protected SQLite backup; session
creation retains the previous private replay with its original session. Existing
instance backup and development recovery procedures continue to cover the database.

The tests use disposable SQLite stores and synthetic providers. They do not
verify a live provider, billing, or remote deployment. The integrated served
journey checks history selection together with document sources, artifact
revisions, source inspection, reload, restart, and revoked access. Schema
version 34 reconciles missing feature tables after a protected backup.
