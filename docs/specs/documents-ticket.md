## What to build

A scoped document library with original uploads, readable passages, local search,
source locations, protected downloads, and a reusable Documents view.

## Acceptance criteria

- [ ] Import UTF-8 text, Markdown, CSV, and text-layer PDFs without a provider.
  Bound original bytes, PDF pages, extracted text, parser time, and output.
- [ ] Preserve original bytes and exact digest with extracted passages and
  locations within the instance backup/recovery boundary.
- [ ] List documents, search bounded original excerpts, inspect sources, retire
  documents, and download originals through paired same-agent APIs and GUI.
- [ ] Reject malformed, encrypted, empty/unreadable, unsupported, and excessive
  inputs clearly without partial accepted records or arbitrary filesystem access.
- [ ] Repeated import operations do not duplicate sources. Retiring a source
  removes it from future search/selection without changing captured provenance.
- [ ] Validate access and audience at the service boundary. Protect upload and
  download routes with existing pairing/origin rules and dedicated body limits.
- [ ] Export typed service/capability adapters and a DocumentsView reference
  event for selected excerpts. Do not create direct provider tools.
- [ ] Test real PDF/text extraction, persistence/restart, retirement, limits,
  retry identity, agent isolation, and revoked access with disposable instances.
- [ ] Provide a usable accessible view with current themes and narrow layout.
  Document supported formats, limits, extraction dependencies, and evidence.

## Blocked by

None. The coordinator handles cross-feature references after integration.
