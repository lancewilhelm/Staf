# Conversation sessions

An agent's **Session history** control starts a named fresh conversation and
opens or searches original messages. A fresh session retains the agent's soul,
configuration and memory, but begins with no previous messages, provider replay,
execution events or summaries. Nothing is compacted, automatically truncated,
or automatically carried over. Browsing history does not change active context.

Starting a session is refused while that agent has a pending chat command. It
uses the current session as an optimistic precondition and a retained operation
ID for retries. If creation is uncertain, retry the control to check the same
operation. Commands capture a session at acceptance. An explicit stale session
is rejected; older clients that omit it capture the then-current session. A
retry of an existing command checks the original command and session first.
Stop remains agent-wide for the active command.

Browser drafts are stored per dataset, agent, session and tab. Drafts from an
earlier session and pre-session drafts remain in **Earlier browser records** for
copying; they are not automatically submitted to the new session. For a
session-scoped saved submission, use **Check original submission** to inspect
the original command without retargeting it. A selection in
history emits a stable session-message reference and displays its identity; it
also attempts to copy it. This feature does not yet attach that reference to a
chat request. The integration coordinator owns that flow.

The paired API exposes `GET/POST /api/bots/:botId/sessions`,
`GET /api/bots/:botId/sessions/:sessionId?offset=0&limit=100`, and
`GET /api/bots/:botId/session-search?q=...`. Reads are paged to at most 200
messages, searches return at most 100 matches and a bounded excerpt. Session listing is paged to at most 200 sessions. Public history uses visible message
records; private provider replay and encrypted reasoning are not returned.
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
verify a live provider, billing, or remote deployment. Coordinator integration
should document these controls in the consolidated usage, reference and
architecture pages, connect reference selection to the shared chat toolbar,
reconcile migration versions 31–33, and verify combined workflows.
