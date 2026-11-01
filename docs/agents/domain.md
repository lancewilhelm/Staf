# Domain docs

This repository uses a single-context layout.

## Before exploring

Read relevant entries in `docs/decisions.md`, which holds existing
implementation decisions. Read the root `GLOSSARY.md` and relevant
ADRs in `docs/adr/` when present.

Proceed silently when glossary or ADR files are absent.
Create them lazily through domain-modeling when terms or decisions
are resolved.

## Layout

- `GLOSSARY.md`: shared domain vocabulary.
- `docs/decisions.md`: existing implementation decision records.
- `docs/adr/NNNN-short-title.md`: future standalone ADRs.

Preserve existing decision records and link related ADRs.

`docs/session-architecture.md` contains design proposals; verify
implementation before describing a proposal as runtime behavior.

## Consumer rules

Use glossary terms consistently in issues, code, tests, and proposals.
Surface conflicts with recorded decisions explicitly, including the
reason for reopening them.
