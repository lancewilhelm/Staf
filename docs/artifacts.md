# Artifacts

Artifacts are agent-owned deliverables with immutable revisions. The reusable
`ArtifactsView` supports creating and inspecting plain text, Markdown, and CSV,
editing a selected revision, downloading exact UTF-8 bytes, and emitting a
reference to one revision. Each revision is limited to 1 MiB of UTF-8 content.
Names are labels, not paths. Downloads use fixed content types and sanitized
filenames; plain text and CSV previews are escaped. Markdown uses the shared
sanitizer with links and images disabled in artifact previews. No remote URL or
filesystem path is opened by this feature.

Each creation or edit requires an operation ID. A retry with identical input
returns the original result, including after a restart; reuse with changed input
conflicts. An edit includes its expected revision and conflicts if another
client has saved a newer revision. The editor keeps its draft on failure or
conflict; copy it before cancelling to inspect newer revisions. Saved revisions,
SHA-256 content digests, timestamps, and optional original session/message
provenance remain in the instance SQLite database and its normal backup boundary.

The paired, origin-checked HTTP routes are under `/api/bots/:botId/artifacts`.
`GET` lists artifacts and `POST` creates one; `GET` or `POST` on
`/:artifactId/revisions` lists or adds revisions; `GET` on
`/:artifactId/revisions/:revision` reads one, and its `/download` child returns
exact bytes. The instance also exposes typed agent-scoped create, revise, and
read methods and an active-command capability adapter for future Code Mode host
registration. No provider tools are registered by this feature.

On this branch provenance accepts only messages owned by the addressed agent
and its existing main chat ID. The integration must replace
`Instance.artifactSourceValid` and the capability adapter's session check with
the session branch's captured-session ownership validation. The component
accepts `botId`, optional `initialText` and `initialProvenance`; mount a fresh
component for a new prefill. It emits `reference` with
`{kind: 'artifact-revision', artifactId, revision}` and `back`. The coordinator
owns toolbar mounting, completed-assistant-message saving, and reference
selection. These are not wired in this feature branch.

The schema occupies migration slot 33. Integrating branches must retain the
guarded migrations for sessions (31), documents (32), and artifacts (33), keep
schema maximum 33, and preserve the existing protected upgrade and backup flow.
A database opened by this standalone branch is already marked version 33 but
does not contain slots 31 or 32. Integration must detect and install missing
session and document schemas for such databases, or use a compatible dataset
that has not been opened by this standalone branch.
The offline service tests exercise real SQLite, synthetic chat, paired-client
access, conflict/retry behavior, downloads and restart; they do not establish
live provider behavior or the final integrated GUI journey.
