# Fresh sessions, document sources, and artifacts

Status: implementation and offline verification are in progress in
[PR #72](https://github.com/lancewilhelm/Staf/pull/72). The acceptance criteria
remain the review contract. Code Mode host registration is a separate integration.

## Problem statement

An agent currently has one growing conversation. The owner wants fresh sessions
and tools for referring to original older sessions. The owner explicitly rejects
compaction. Staf also needs source documents and durable deliverables so useful
work can extend beyond text in a chat.

## Solution

Keep the agent's identity, soul, memory, and provider settings across sessions.
Starting a session preserves the previous conversation and creates empty active
conversation context. Let the owner search old sessions and select exact source
messages. Add an agent document library and a revisioned artifact workspace.
Expose all three through the shared service and protected owner interface.

## User stories

1. As the owner, I can start a fresh session without losing an older conversation.
2. I can name sessions, list them, and inspect their original messages.
3. I can search an agent's older sessions and open the matching source message.
4. I can reference selected messages in a fresh conversation without replaying
   the entire old session.
5. I can see which sources I selected before sending a message.
6. A second paired client sees the same sessions and accepted work.
7. A stale client cannot silently send an old draft into a different session.
8. Retrying an uncertain command preserves its captured session and references.
9. I can upload text, Markdown, CSV, and text-based PDFs to an agent library.
10. I can search extracted passages and open their original source and location.
11. I can reference selected document passages in a chat.
12. An agent cannot read another agent's documents or sessions through these tools.
13. Unsupported, encrypted, malformed, or excessive documents fail clearly.
14. Removing a document excludes it from future search and selection while
    preserving the provenance of previously accepted work.
15. I can save a completed assistant message as an artifact.
16. I can create and edit text, Markdown, and CSV artifacts without a provider.
17. I can inspect and download a particular immutable artifact revision.
18. A stale edit reports a conflict and retains the unsaved draft.
19. Artifacts retain their source session and message when supplied.
20. Sessions, sources, artifacts, and references survive instance restart.
21. Pairing revocation protects source and artifact reads as well as writes.
22. All views remain usable with a keyboard, narrow viewport, and existing themes.

## Implementation decisions

- No compaction, automatic summarization, truncation, automatic session rollover,
  or automatic replay of previous sessions. A fresh session retains standing
  instructions and existing memory behavior. It starts with no prior messages,
  provider replay, or execution events from the previous session.
- The owner explicitly creates sessions. Older sessions are inspectable;
  inspecting them does not move the active session or change provider context.
  Keep current Main chat routes compatible with the active session.
- Capture session identity at command acceptance. Include it and explicit
  reference identities in retry validation. Preserve per-agent busy and Stop
  behavior. Starting a session during an active command reports a conflict.
- Retain existing chats and private replay in their initial session during a
  protected migration. Keep consumption attributed to the session where observed.
- Draft identity includes the dataset, agent, and session. Retain or explain
  earlier drafts instead of resubmitting them to a new session.
- A reference identifies an original session message, document passage, or
  artifact revision. Resolve references within the addressed agent. Capture the
  accepted source identity and bounded excerpt. Label source text as untrusted
  data and expose exact provenance. Explicit source inclusion must not change
  the original source or imply a memory write.
- Document imports are bounded and local. Support UTF-8 text, Markdown, CSV,
  and PDF text layers. OCR, remote URL imports, image analysis, embeddings,
  cloud storage, and new account connections are outside this version.
- Keep each original document and its extracted passages, digest, name, type,
  and location metadata. Use finite byte, page, output, and search limits.
  PDF extraction must have bounded resource use and interruption behavior.
- Search uses local deterministic text matching. It must return real source
  locations and escaped excerpts. Do not promise semantic retrieval.
- All paired clients retain the existing single-owner authority. Model access
  is limited to the captured agent and work scope. Source data does not grant
  permissions or instructions.
- Artifacts are bounded UTF-8 text, Markdown, or CSV. Each save creates an
  immutable revision. Mutations use operation identities and optimistic
  revision checks. Previews render data safely and downloads use authentication,
  fixed content types, and safe filenames.
- Keep a small feature toolbar in chat. Put session history, documents, and
  artifacts in reusable views. Preserve chat streaming, Stop, drafts, provider
  selection, memory navigation, and the existing visual language.
- The feature services are independent of the generated-code executor. Export
  typed, scoped capability adapters for Code Mode. Do not introduce another
  model-facing direct-tool interface. Any final Code Mode registration must
  use its authoritative host bridge and action policy.
- Native and Docker installations use the same persisted instance data.
  Include the new data in the existing backup and recovery boundary.
- Deliver one integration PR, left open for review. Parallel implementation
  branches do not merge themselves to main.

## Testing decisions

The primary boundary is a real disposable instance and its paired HTTP API.
Use actual SQLite persistence, original bytes, deterministic fixtures, and
synthetic providers. Preserve the full existing offline suite.

- Prove migration, restart, session isolation, stale-client rejection, exact-ID
  retries, Stop, and captured-session identity with held provider calls.
- Inspect provider requests to prove a fresh session excludes old history and
  includes only explicitly selected, bounded source excerpts.
- Prove document extraction and locations with real small PDF and text fixtures.
  Exercise malformed input, limits, agent isolation, retirement, and revocation.
- Prove artifact creation, revisions, stale saves, exact downloads, source
  attribution, retry identity, restart, and cross-client behavior.
- Exercise the served GUI with keyboard actions and source navigation. Check
  narrow and existing appearance modes. Run the documented check, test, and
  relevant GUI journeys after integration.
- Keep offline, browser, Docker, and live-provider evidence distinct. Do not
  authenticate or make live or billable requests for verification.

## Out of scope

Compaction, summaries, automatic forgetting, organization permissions, external
connections, a general filesystem browser, arbitrary host writes, binary office
document generation, OCR, and replacing the ongoing Code Mode or avatar work.

## Definition of done

With a disposable instance, create an agent and a conversation, start a fresh
session, and demonstrate through a captured provider request that the new turn
contains no old conversation. Search and explicitly reference an old message.
Upload and search a text-based PDF, then include a cited passage in a turn.
Save the completed response as an artifact, revise it, and download both exact
revisions. Repeat the reads from a second paired client after restart. The
required checks and independent Standards and Spec reviews pass, or any remaining
limitation is identified explicitly in the open draft PR.
