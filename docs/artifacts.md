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

Provenance accepts only messages belonging to the specified session and agent.
The capability adapter checks the active session and the pending command's
captured session on every operation. The component accepts `botId`, optional
`initialText` and `initialProvenance`; mount a fresh component for a new prefill.
It emits `reference` with `{kind: 'artifact-revision', artifactId, revision}`
and `back`. The coordinator owns toolbar mounting, completed-assistant-message
saving, and reference selection.

Schema version 34 reconciles the session, document, artifact, and reference
tables after the protected upgrade backup, including datasets written by
isolated feature branches. Existing session mappings and replay are retained.
The offline service tests exercise real SQLite, synthetic chat, paired-client
access, conflict/retry behavior, downloads and restart; they do not establish
live provider behavior or the final integrated GUI journey.
