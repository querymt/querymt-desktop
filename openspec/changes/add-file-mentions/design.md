# Design

## Context

See proposal.md (Why). Relevant current state:

- **Agent index exists, not exposed.** `SessionMaterializer` initializes a per-root `WorkspaceHandle` in the background (`session_materializer.rs` ~1622) into `runtime.workspace_handle`. `FileIndex { files: Vec<FileIndexEntry{path,is_dir}>, root }` is gitignore-aware and watched. `SessionActor` already answers kameo `GetFileIndex` / `ReadRemoteFile` (`session_actor.rs` 2061/2088), and `RemoteSessionRef` already has `get_file_index()` / `read_remote_file()`. Nothing on the ACP surface calls them. The `WorkspaceIndexReady` event exists.
- **Prompt path.** Prompts are stored verbatim as `MessagePart::Prompt { blocks }` / `Steering { blocks }` and converted on every context rebuild by `model.rs::convert_prompt_blocks`. That function currently maps `ResourceLink` to a `MediaSource::Url` attachment, which providers can't use for `file://`.
- **Legacy reference.** The deleted `ui/mentions.rs` (`ac0e5538^`) already did resolve, sandbox, `render_read_output`, then embedded `Resource`/`Image`, with a remote path via `read_remote_file`. We can reuse its logic, but it lived in the dashboard WebSocket server.
- **Desktop.** `SessionComposer.svelte` is a plain `<textarea>` whose keydown handles send, Cmd-M, Cmd-T, and Tab mode cycling. `acp-client.ts::buildPromptContent` builds text + `image`/`resource` blocks. `normalizeContentBlock` drops `resource_link`. Extensions go through `QuerymtExtensions.call()`, and the capability list comes from `querymt/capabilities` at connect time.
- **ACP.** No file-completion method exists in v1, v2 or any RFD. `resource_link` is baseline in prompts. The draft `session/options` RFD sets the precedent for a side-effect-free query keyed by `cwd` and optional `sessionId`.

## Goals / Non-Goals

**Goals:**
- One mention path for local, remote/mesh, and embedded-dashboard sessions: the client never reads the file.
- Interactive completion latency on repos with 100k+ indexed entries, without shipping the index to the client.
- Mention content is deterministic per message (snapshot), so replay and compaction don't drift.

**Non-Goals:**
- Fuzzy-matching quality on par with an IDE. Simple subsequence scoring is enough.
- Live push of index deltas to the client.
- Rich inline editor (contenteditable tokens). Mentions stay plain text in the textarea.

## Decisions

### D1. Server-side query, not a shipped index
`querymt/workspace/files` takes `{ session_id? | cwd?, query?, limit? (default 50, cap 200) }` and returns `{ status: "ready" | "not_ready", workspace_root, cwd, entries: [{ path, abs_path, is_dir }], truncated }`.
- *Why:* the legacy design sent the whole index, which is several MB of JSON per session over stdio/WebSocket and gets worse with relays. Querying per keystroke (debounced) keeps payloads tiny.
- *Alternative:* ship the index once and filter on the client. Rejected because of payload size and staleness, and because remote sessions would need a delta protocol.
- `not_ready` is a status rather than an error so the UI can show "Indexing…" without error plumbing.
- Paths: `path` is relative to `cwd` (for display/insertion), `abs_path` is native absolute (for the URI). This follows the ACP v2 rule that protocol paths are absolute.

### D2. Routing
- `session_id` given: resolve the session ref (`session_ref_for_agent_session`). If it's local, read `runtime.workspace_handle`. If it's remote, call `get_file_index()` on the owning node, then filter/rank locally on the relay node. Ranking on the receiving node avoids a new mesh message; the full list crossing the mesh once per query is acceptable for v1. A `query` mesh message is a later optimization (Open Questions).
- Only `cwd` given: `get_or_create_workspace_with_timeout(resolve_workspace_root(cwd))` on the local node, returning `not_ready` until the index exists. This is side-effect-free with respect to sessions. It may warm an index, which is intended, since the launch composer will create a session there anyway.
- Filtering to `cwd` reuses the legacy `filter_index_for_cwd_entries` logic.

### D3. Ranking
Case-insensitive subsequence match on the relative path, scoring basename hits, contiguous runs, segment-start matches, and shorter paths higher. An empty query lists the shallowest entries first. It's implemented in-crate (about 60 lines) with no new dependency. *Alternative:* `nucleo-matcher`, which is better quality but a new dependency, so it's deferred.

### D4. Readiness notification
Forward the existing `WorkspaceIndexReady { workspace_root }` event as the extension notification `querymt/workspace/indexReady` on stdio and WebSocket, the same way `runtimeChanged` is forwarded. The desktop retries an open `not_ready` popup when a matching root arrives, and otherwise on the next keystroke.

### D5. Expand links at submission, store the expansion with the message
On `SubmitSessionInput` / `Prompt` / steer / queue, before building `MessagePart::Prompt`, the session actor resolves each `file://` `ResourceLink`. It canonicalizes the path, checks it's under `resolve_workspace_root(cwd)`, and calls `render_read_output(path, 0, DEFAULT_READ_LIMIT)`. This runs on the owning node, which removes the need for `ReadRemoteFile` in the hot path. It persists:
- `MessagePart::Prompt { blocks }` with the **original** blocks, so the echo/replay keeps `resource_link` (spec: echo preserves the link).
- A new `MessagePart::MentionContext { uri, content: Text | Image | Unresolved{reason} }` per link, which `to_chat_message` converts into input parts after the prompt (`[Mentioned file: <path>]\n<content>`).

`convert_prompt_blocks` stops emitting `MediaSource::Url` for `file://` links and emits a short textual reference instead (`[File reference: <path>]`). This also covers histories persisted before the change.
- *Why snapshot:* converting on every rebuild would re-read files that tools have since edited, which changes earlier turns and breaks prompt caching.
- *Alternative:* rewrite the prompt into embedded `Resource` blocks, as the legacy dashboard did. Rejected because echo/replay would then show file content as user content and lose the link identity the desktop renders as a chip.
- *Alternative:* a bare path reference and let the model call `read_tool`. Rejected as the default because it costs an extra tool round-trip per mention, but this is the fallback for unresolved or truncated links.
- Directories: `render_read_output` already renders a listing.
- Budget: per-link `DEFAULT_READ_LIMIT` lines, plus the existing prompt byte limits (`max_prompt_bytes`) apply over the total. If they're exceeded, the content is truncated with a note naming the path.

### D6. Desktop mention model
- `MentionController` (pure TS, unit-testable) owns trigger detection from `(text, caret)`, the active token range, debounced query (about 80 ms) with a request sequence number to drop stale responses, the selected index, and accepted mentions `{ text: "@rel/path", absPath, isDir }`.
- At send time, the mentions to send are the recorded mentions whose exact `@rel/path` token still appears in the text (word-bounded). Deduplicate by `absPath`. This avoids tracking offsets through arbitrary textarea edits.
- `MentionPopup.svelte` is anchored to the composer (above the textarea, like the existing popovers) instead of caret-positioned. That's cheaper and good enough.
- Key handling: `handlePromptKeydown` delegates to the controller first. While it's open, the controller consumes Arrow/Enter/Tab/Escape before the send-shortcut and mode-cycle branches.
- Query target: an active session uses `session_id`. The launch composer uses `cwd` only when the selected target is the local node; for a remote target, the popup is disabled (non-goal per proposal).
- Send: `PromptSendOptions` gains `mentions: { uri, name }[]`. `buildPromptContent` appends `{ type: 'resource_link', uri: pathToFileUri(absPath), name: basename }` after attachments. No capability gate is needed because `resource_link` is baseline ACP.
- `pathToFileUri` handles Windows drive letters and percent-encoding, since agent paths are native to the agent's OS.

### D7. Transcript rendering and echo
Add `SessionResourceLinkBlock { type: 'resource_link', uri, name, title? }` to `SessionContentBlock`. `normalizeContentBlock` parses it, `contentBlocksMatch` compares links by `uri`, and `SessionTurn.svelte` renders a chip with the file name and a tooltip showing the full path. Optimistic messages include the link blocks so echo reconciliation matches.

## Risks / Trade-offs

- [Remote query ships the full index across the mesh per keystroke] → Debounce on the client. Cache on the relay node keyed by `(session_id, generated_at)` for a few seconds. Add a ranked mesh message later if it's measured as slow.
- [Mention text collides with literal user text like `@foo` the user typed without accepting] → Only accepted mentions are recorded. Unaccepted `@foo` stays plain text.
- [Large mentions blow the context] → Per-file read limit, total prompt byte limit, truncation note pointing at tools.
- [Sandbox bypass via symlinks] → Canonicalize before the root check (as legacy did). The root check runs on the canonical path.
- [Older agents receive `resource_link` from a new desktop] → The desktop only offers mentions when `querymt/workspace/files` is advertised, and that ships together with expansion in the same agent release.
- [Older desktops / other ACP clients sending `file://` links] → They now get real expansion instead of a broken URL attachment, which is a strict improvement.
- [`MessagePart::MentionContext` is a persisted schema addition] → Serde-tagged new variant. Older agents can't read sessions written by newer ones, which is the same forward-compat stance as other part additions. No migration is needed for existing data.

## Migration Plan

1. Ship the agent with the method, notification, expansion, and capability entry, and regenerate typeshare types into `src/lib/querymt/generated/types.ts`.
2. Ship the desktop gated on the capability. Bump the embedded-UI pin in the agent afterwards.
3. Rollback: the desktop hides the feature when the capability is absent. Disabling the agent method alone is enough.

## Open Questions

- Should a ranked `QueryFileIndex` mesh message replace shipping the full remote index? Decide after measuring on a large remote repo. This doesn't change the wire contract to the desktop.
- Should the transcript chip open the file (local only) or just show the path? It can be decided during UI review.
