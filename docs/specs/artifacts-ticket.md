## What to build

A revisioned artifact workspace for text, Markdown, and CSV deliverables, with
safe previews, conflict-aware editing, source provenance, and exact downloads.

## Acceptance criteria

- [ ] Create, list, inspect, edit, preview, and download artifacts through
  protected same-agent service APIs and a reusable Artifacts view.
- [ ] Persist immutable content revisions of at most 1 MiB, fixed supported
  formats, source provenance when present, and creation/update metadata.
- [ ] Mutations have stable operation identities and optimistic revision checks.
  Exact retries succeed once; changed inputs and stale saves report conflicts.
- [ ] Validate source session/message provenance against the addressed agent.
  Retain all prior revisions and the unsaved GUI draft on conflict or failure.
- [ ] Use existing safe Markdown rendering, escaped plain text/CSV previews,
  authenticated exact-byte downloads, fixed content types, and safe filenames.
- [ ] Export typed scoped capability/service adapters for Code Mode and a view
  reference event for a particular artifact revision. No direct provider tools.
- [ ] Test original/revised downloads, optimistic conflicts, retry identity,
  persistence/restart, same-agent provenance, cross-client and revoked access.
- [ ] Keep the component keyboard usable with current themes and narrow layout.
  Document actual behavior, supported formats, limits, and integration notes.

## Blocked by

None. The coordinator connects session provenance and Save artifact in chat.
