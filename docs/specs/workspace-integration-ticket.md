## What to build

Integrate fresh sessions, document sources, and revisioned artifacts into the
existing workspace and expose their bounded service contracts for Code Mode.

## Acceptance criteria

- [ ] Integrate the three implementation branches and all protected migrations.
- [ ] Provide a compact chat toolbar with History, Documents, and Artifacts.
  Add Save artifact beside completed assistant messages.
- [ ] Explicitly select source messages, document passages, and artifact
  revisions as references. Show pending references before Send.
- [ ] Capture and fingerprint accepted references with the command/session.
  Resolve only original same-agent sources and include bounded source context
  as untrusted data without changing originals or creating retained memory.
- [ ] Export scoped service adapters independently of model calling style.
  Later Direct, Hybrid, and Code Mode registration must share service operations,
  accepted context, per-call authority, action records, and cancellation.
  The owner's revised decision supersedes the earlier direct-tool prohibition.
  Selector and model-tool registration remain separate adoption work.
- [ ] Preserve streaming, Stop, draft recovery, provider choices, memory, themes,
  and existing instance APIs. Run full checks and relevant served GUI journeys.
- [ ] Complete independent Standards and Spec reviews and fix accepted findings.
- [ ] Update usage, reference, architecture, development instructions, and
  consequential decisions with exact implemented behavior and evidence limits.
- [ ] Open one linked PR referencing the parent and implementation tickets,
  leave it open, and provide normal reusable manual test steps.

## Blocked by

The fresh-session, document-source, and artifact tickets in this specification.
