# Register workspace methods with Code Mode

The workspace implementation supplies scoped application methods. The separately
developed Code Mode registry and gateway register them and apply their action
policy. This change does not import a design sketch as runtime code or register
additional direct provider tools.

`workspaceCapabilities(instance, scope)` takes the service-owned
`{botId, sessionId, commandId, signal}` captured for an accepted command. It copies
those values, checks the pending command's audience and session, and returns
session, document, and artifact adapters. Every call checks authority again.
Stop or an aborted signal blocks further calls. Guest code cannot replace this
context. The entry point is `src/workspace-capabilities.ts`; feature-owned types
live in the session, document, artifact, and portable reference modules.

| Suggested capability | Application method | Effect |
| --- | --- | --- |
| `sessions.list` | `sessions.list(offset, limit)` | Read session metadata. |
| `sessions.search` | `sessions.search(query)` | Read bounded matching excerpts. |
| `sessions.read` | `sessions.read(sessionId, offset, limit)` | Read an explicit original session page. |
| `sessions.resolve` | `sessions.resolve(reference)` | Read an original message excerpt. |
| `documents.list` | `documents.list(offset)` | Read active source metadata. |
| `documents.search` | `documents.search(query)` | Read matching passages. |
| `documents.resolve` | `documents.resolve(documentId, excerptId)` | Read an active passage. |
| `artifacts.read` | `artifacts.read(id, revision)` | Read one immutable revision. |
| `artifacts.create` | `artifacts.create(input)` | Create a deliverable. |
| `artifacts.revise` | `artifacts.revise(id, input)` | Append an immutable revision. |
| `sources.resolve` | `resolve(reference)` | Read an explicit source excerpt. |

All methods above belong to the captured factory result. They are scoped to its
agent. The proposed Code Mode `applicationCapability` contract describes
input/output codecs, effect/resource declarations, a scope guard, and an invoke
callback. Those registry exports do not yet exist on this branch. The host must
validate inputs and structured outputs, enforce result/step limits, and recheck
live scope before dispatch and recovery receipt release. Constructing the scoped
factory checks authority without fetching source content or repeating a mutation,
so it can support the registry's scope guard.

Use the host-minted operation identity for artifact creation and revision. The
feature's durable fingerprint makes an exact retry return its accepted revision;
changed input conflicts. The host still applies approval, denial, expiry,
uncertainty, and action journaling. Feature methods cannot bypass those decisions.

Offline integration tests invoke real scoped methods with a pending command,
mutate the caller's original context, and request Stop. The audience stays
captured and later reads and writes stop. Service and browser tests separately
exercise explicit references without an executor. Actual host registration,
sandbox execution, and live model use remain Code Mode verification work.
