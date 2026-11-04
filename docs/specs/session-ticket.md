## What to build

Fresh conversation sessions for each agent, with original history search and
explicit source references. Follow the parent specification and owner decision
that compaction is forbidden. Preserve the current chat workflow.

## Acceptance criteria

- [ ] Preserve existing visible history, private replay, usage, commands, and
  Stop records in an initial session through a backed-up migration.
- [ ] Create a fresh session through the paired API and GUI. Creation is
  retry-safe, checks the expected active session, and refuses active work.
- [ ] Fresh provider context contains standing instructions and current memory
  behavior, with no previous-session messages, replay, events, or summary.
- [ ] Commands capture session identity and verify it on retries. Stale clients
  cannot submit to a different session. Keep agent-wide busy/Stop behavior.
- [ ] List, inspect, and search original sessions through scoped service APIs
  and a keyboard-usable History view. Browsing does not change active context.
- [ ] Expose bounded same-agent message references with stable message/session
  identities. Retain source originals. Do not add direct model tools.
- [ ] Scope drafts and recovery by dataset, agent, and session, preserving
  uncertain older drafts rather than silently moving them.
- [ ] Verify real persistence, held-provider races, migration, restart,
  cross-client stale state, and provider requests with offline fixtures.
- [ ] Document actual behavior and integration notes. Run type checks and
  focused tests. Keep branch committed and ready for integration.

## Blocked by

None. The coordinator handles cross-feature references after integration.
