# Workspace feature integration contracts

This document assigns integration seams for the parallel implementation.
The product contract is [the specification](../specs/sessions-documents-artifacts.md).
The tracked specification is [#67](https://github.com/lancewilhelm/Staf/issues/67).
Sessions are [#68](https://github.com/lancewilhelm/Staf/issues/68), documents
are [#69](https://github.com/lancewilhelm/Staf/issues/69), artifacts are
[#70](https://github.com/lancewilhelm/Staf/issues/70), and integration is
[#71](https://github.com/lancewilhelm/Staf/issues/71).

## Shared ownership

Each implementer owns a feature module, route handling, a reusable Vue component,
focused tests, and a feature usage page. The coordinator owns final cross-feature
context references, consolidated documentation, toolbar integration, and review
fixes. The original plan assigned Code Mode registration here; registration now
belongs to the separate adoption feature. Small shared-file insertions are expected.

Use these independent migration slots: 31 for conversation sessions, 32 for
documents, and 33 for artifacts. Each branch may set its own maximum version;
integration sets 34 and retains all three guarded schema additions. Put each
feature's table definitions in its own module. Preserve protected backups.

The final integration additionally reserves migration 34 for captured command
references and schema reconciliation. It sets the final maximum to 34 and
installs any missing feature schemas from isolated development branches after
the protected upgrade backup. Isolated feature version numbers are not releases.

## Conversation sessions

The sessions implementer owns session binding of visible messages, commands,
response progress, and private provider replay. Keep the existing single-agent
API compatible with its active session. Add explicit session list/create/read
and bounded history search operations under `/api/bots/:botId/`.

Session creation accepts a stable operation ID and expected active session ID.
Commands can carry an explicit session ID. The controller must always send it.
Legacy callers that omit it capture the active session at acceptance. An
explicit stale session ID must fail. Repeating a prior command checks its
original session before consulting the current active session.

Export `SessionHistory.vue` and a service API for listing, searching, and reading
original messages. The component can emit a `reference` event containing
`{kind: 'session-message', sessionId, messageId}`. Add deterministic copy/open
behavior even before the coordinator connects reference selection to chat.

## Document sources

The documents implementer owns a separate document store/schema and scoped
Instance methods, protected API routes, extraction, search, original download,
and `DocumentsView.vue`. Reserve `/api/bots/:botId/documents` and subordinate
routes. Keep upload-specific body limits confined to these routes.

Store original bounded bytes and extracted passages durably in the instance
backup boundary. The first version may use SQLite blobs to keep publication
and backup atomic. Use an maintained PDF text parser with documented native
and Docker requirements. Limit input bytes, pages, extracted text, execution
time, and search output. Empty or unreadable PDFs must produce clear errors.

The view accepts `botId` and emits `reference` containing
`{kind: 'document-excerpt', documentId, excerptId}`. It should provide list,
upload, search, source inspection, retirement, and authenticated download.

## Artifacts

The artifacts implementer owns a separate artifact store/schema and scoped
Instance methods, protected API routes, and `ArtifactsView.vue`. Reserve
`/api/bots/:botId/artifacts` and subordinate routes. Keep dedicated body limits.

The view accepts `botId` and optional initial content/provenance. It provides
create, list, preview, revision selection, edit, and authenticated download.
Text, Markdown, and CSV are the supported formats. Use at most 1 MiB per revision.
All content and filenames are untrusted data. Use existing Markdown rendering.

Source provenance is optional `{sessionId, messageId}` and must be validated
against the same agent when present. The coordinator will add a Save artifact
action beside completed assistant messages after the session branch merges.
The view may emit a `reference` containing
`{kind: 'artifact-revision', artifactId, revision}`.

## Explicit reference integration

The coordinator will combine those three discriminated reference shapes in a
shared contract. A command captures and fingerprints its resolved references.
Only bounded, explicitly selected excerpts enter the provider request. Keep
reference context separate from original messages and retained memory.

Feature model capabilities must be scoped by an immutable captured
`{botId, sessionId, commandId, signal}`. Recheck active work and authority for
every call. The factory exposes service-owned operations independently of model
calling style. The owner's 2026-11-04 decision supersedes this plan's earlier
prohibition on additional direct tools. Later Direct, Hybrid, and Code Mode
adapters must share those operations, accepted context, authority, and action
records. PR #72 adds no selector or model-tool registrations. See the
[executable-contract compatibility notes](workspace-code-mode-integration.md).

## Review and delivery

Do not create a feature PR or push to main. Commit the isolated feature branch,
run focused real checks, and report its commit and integration notes. Do not
spawn subagents. The coordinator integrates, runs full checks, opens one PR,
and obtains independent Standards and Spec reviews.
