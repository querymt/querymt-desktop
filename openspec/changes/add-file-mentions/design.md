# Design

## Context

See proposal.md (Why). Relevant current state:

- **Agent index exists, not exposed.** `SessionMaterializer` initializes a per-root `WorkspaceHandle` in the background (`session_materializer.rs` ~1622) into `runtime.workspace_handle`. `FileIndex { files: Vec<FileIndexEntry{path,is_dir}>, root }` is gitignore-aware and watched. `SessionActor` already answers kameo `GetFileIndex` / `ReadRemoteFile` (`session_actor.rs` 2061/2088), and `RemoteSessionRef` already has `get_file_index()` / `read_remote_file()`. Nothing on the ACP surface calls them. `GetFileIndexResponse` (`file_proxy.rs`) carries `files`, `generated_at` and `workspace_root`, but not the session's cwd. `WorkspaceIndexReady` is emitted as a persisted event of a session (`session_actor.rs` ~1927).
- **Index pool is bounded.** `WorkspaceIndexManagerActor` keeps at most 5 indexes, with a 15-minute idle TTL and LRU eviction (`workspace_manager_actor.rs`).
- **Prompt path.** Prompts are stored verbatim as `MessagePart::Prompt { blocks }` / `Steering { blocks }` and converted on every context rebuild by `model.rs::convert_prompt_blocks`. That function maps every `ResourceLink` to a `MediaSource::Url` attachment, which providers can't use for `file://`. Context-size estimates for compaction (`compaction.rs` ~588), maintenance (`maintenance.rs` ~277) and the delegation summarizer use `render_prompt_for_llm`, which only sees prompt blocks.
- **Existing sandbox code is not safe to copy as-is.** `ReadRemoteFile` canonicalizes the target but compares it against a root that is not canonicalized. That rejects every path under a symlinked root, such as macOS `/var` → `/private/var`.
- **Attachment echoes already use `resource_link`.** The agent echoes desktop attachments as bare `resource_link` blocks with `attachment:///` URIs. The desktop reconciles them through `readRawAttachmentIdentity` (`agents.svelte.ts` ~6927; test `agents.svelte.test.ts` ~8448).
- **Legacy reference.** The deleted `ui/mentions.rs` (`ac0e5538^`) resolved paths, sandboxed them, called `render_read_output`, then embedded `Resource`/`Image` blocks, with a remote path via `read_remote_file`. Its cwd filtering (`filter_index_for_cwd_entries`) is reusable. It lived in the dashboard WebSocket server.
- **Desktop.** `SessionComposer.svelte` is a plain `<textarea>` whose keydown handles send, Cmd-M, Cmd-T, and Tab mode cycling. `acp-client.ts::buildPromptContent` builds text + `image`/`resource` blocks. `steerSession`/`queueSession` take positional arguments rather than `PromptSendOptions`. `normalizeContentBlock` drops `resource_link`. Drafts are preserved when a send fails preflight. Extensions go through `QuerymtExtensions.call()`, and the capability list comes from `querymt/capabilities` at connect time.
- **ACP.** No file-completion method exists in v1, v2 or any RFD. `resource_link` is baseline in prompts. The draft `session/options` RFD sets the precedent for a side-effect-free query keyed by `cwd` and optional `sessionId`.
- **Libraries already available.** Agent: `ignore`, `notify`, `infer`, `dunce`, `url`, `moka` are direct dependencies; `typed-path` 0.12 is transitive. Desktop: `bits-ui` 2.x (Popover, Tooltip) is direct; `runed` 0.35 is transitive through bits-ui.

## Goals / Non-Goals

**Goals:**
- One mention path for local, remote/mesh, and embedded-dashboard sessions: the client never reads the file.
- Interactive completion latency on repos with 100k+ indexed entries, without shipping the index to the client.
- Mention content is deterministic per message (snapshot), so replay and compaction don't drift.
- Use maintained libraries for fuzzy matching, cross-OS paths, file URIs, caching and fetch scheduling instead of hand-written equivalents.

**Non-Goals:**
- Tuning fuzzy ranking beyond frizbee's scoring plus a basename boost and deterministic tie-breaks.
- Live push of index deltas to the client.
- Rich inline editor (contenteditable tokens). Mentions stay plain text in the textarea.
- Frecency or git-status-aware ranking.

## Decisions

### D1. Server-side query, not a shipped index
`querymt/workspace/files` takes `{ session_id? | cwd?, query?, limit? }`. Exactly one of `session_id` and `cwd` is required. `limit` defaults to 50 and is capped at 200. The response is `{ status: "ready" | "not_ready", workspace_root?, cwd?, entries: [{ path, abs_path, uri, name, is_dir }], truncated }`.
- `path` is relative to `cwd` and always `/`-separated, for display and insertion. `abs_path` is native to the agent's OS. `uri` is the `file://` URI for that path, built by the agent. `name` is the basename.
- *Why the agent builds `uri`:* only the agent knows which OS the path belongs to. Client-side builders, including `vscode-uri`, apply the client's OS rules and get Windows peer paths wrong from macOS. This removes `pathToFileUri` from the desktop.
- *Why server-side:* the legacy design shipped the whole index, which is several MB of JSON per session over stdio/WebSocket and gets worse with relays. Debounced per-keystroke queries keep payloads tiny. *Alternative:* ship the index once and filter on the client. Rejected because of payload size and staleness, and because remote sessions would need a delta protocol.
- `not_ready` is a status rather than an error, so the UI can show "Indexing…" without error plumbing.
- Errors:
  - Unknown `session_id` returns ACP `ResourceNotFound`. `session_ref_for_agent_session` returns `invalid_params` today, so the handler maps it.
  - Passing both `session_id` and `cwd`, or neither, returns `invalid_params`.
  - A `cwd` that is not an absolute existing directory, or is a filesystem root, returns `invalid_params`.

### D2. Routing
- **`session_id`, local session:** read `runtime.workspace_handle` and filter to the session's cwd.
- **`session_id`, remote session:** call `get_file_index()` on the owning node, then filter and rank on the relay node. This avoids a new mesh message.
  - The relay needs the session's cwd. Add `cwd: Option<String>` to `GetFileIndexResponse` with `#[serde(default)]`. If a peer doesn't send it, use `workspace_root`.
  - Remote paths are handled with **`typed-path`** (`Utf8TypedPath::derive(workspace_root)` + `strip_prefix` / `join`), so a Windows peer's paths parse correctly on a Unix relay and vice versa. `typed-path` becomes a direct dependency.
  - The entry `uri` is built from the typed path's components with **`url`** (`Url::parse("file:///")` + `path_segments_mut().extend(..)`), not from `std::path`.
  - Cache the fetched remote index in **`moka::future::Cache`**, keyed by `session_id`, with a 5-second `time_to_live`. Invalidate it when `indexReady` arrives for that session.
  - `FileProxyError::IndexNotReady` maps to `status: "not_ready"`.
- **`cwd` only:** call `get_or_create_workspace_with_timeout(resolve_workspace_root(cwd))` on the local node, returning `not_ready` until the index exists. This creates no session. It may warm an index in the pool, which is bounded at 5 indexes and evicts the least recently used. That's acceptable because the launch composer will create a session there anyway.
- Filtering to `cwd` reuses the legacy `filter_index_for_cwd_entries` logic.

### D3. Ranking with frizbee
Use **`frizbee`**: MIT licensed, SIMD Smith-Waterman with affine gaps and optional typo tolerance, used by skim, atuin, blink.cmp and fff. Pin the minor version and keep ranking in one module.
- **Path pass:** `Matcher::new(query, &config).match_list(&relative_paths)`.
- **Basename pass:** run the same needle over the basenames of the path-pass matches only.
- **Rank:** path score plus basename score (saturating). Break ties by `exact`, then shallower depth, then shorter path, then lexicographic order, so output is deterministic. Truncate to `limit` and set `truncated` if more matched.
- **Typos:** `max_typos = query_chars / 4`, so queries shorter than 4 characters must match exactly as a subsequence. This follows frizbee's documented per-needle pattern.
- **Empty query:** skip the matcher and list the shallowest entries first, then lexicographically.
- **Delimiters:** verify that `/` and `.` earn frizbee's delimiter bonus (segment-start matches). If they don't, configure it.
- Single-threaded `match_list` is the default. Switch to `match_list_parallel` only if the 100k-entry benchmark needs it.
- *Alternatives:*
  - `nucleo-matcher`: path-aware config, but MPL-2.0 and slower in frizbee's published benchmarks. Rejected.
  - A hand-written subsequence scorer: rejected as reinventing the wheel.
  - `fff-search`: rejected because it would replace the agent's index and watcher instead of complementing them.

### D4. Readiness notification
- Forward `WorkspaceIndexReady` as the extension notification `querymt/workspace/indexReady { session_id, workspace_root }` on stdio and WebSocket, the same way `runtimeChanged` is forwarded. The agent emits it for both local and remote sessions. The desktop re-queries an open `not_ready` list when `session_id` matches.
- Queries keyed only by `cwd` have no session, so they get no event. The desktop re-polls at most once per second while the list is open and `not_ready`, and also re-queries when the user changes the query.
- *Alternative:* emit readiness from the workspace manager per root. Deferred (Open Questions).

### D5. Expand links at submission, store the expansion with the message
When a prompt, steer, or queue request is **accepted**, and before `MessagePart::Prompt` / `Steering` is built, the session actor on the owning node resolves each `ResourceLink`:
- **Non-`file` schemes** are left unchanged and keep today's conversion.
- **`file` scheme:**
  - Parse the URI with `url::Url`.
  - A host other than empty or `localhost` makes the link `Unresolved { reason: "non-local host" }`. This check is explicit because `to_file_path` accepts UNC hosts on Windows.
  - `Url::to_file_path()` does the percent-decoding and drive-letter handling.
- **Sandbox:**
  - `dunce::canonicalize` both the target and `resolve_workspace_root(cwd)`, then require `starts_with`. Otherwise the link becomes `Unresolved { reason: "outside workspace" }`. A missing file becomes `Unresolved { reason: "not found" }`.
  - Read the **canonical** path, not the original one, so a symlink swapped after the check can't redirect the read.
- **Read:** `render_read_output(canonical, 0, DEFAULT_READ_LIMIT)`. Directories render as a listing.
- **Budget:**
  - Text: at most 64 KiB per mention and 256 KiB across all mentions in one input, further clamped by `max_prompt_bytes` when it is set. Cut content keeps a truncation note naming the path, so the model can read the rest with tools.
  - Images go through the existing `validate_image` / `validate_attachment_size` checks. Failures become `Unresolved` with a reason.

Persisted:
- `MessagePart::Prompt { blocks }` / `Steering { blocks }` with the **original** blocks, so echo and replay keep `resource_link`.
- A new `MessagePart::MentionContext { uri, content: Text | Image | Unresolved { reason } }` per link. `to_chat_message` places these after the prompt or steering part as `[Mentioned file: <path>]\n<content>`. If the current model can't take images, an `Image` snapshot becomes a textual reference with a reason at that point. `MentionContext` is never sent to clients as `user_message_chunk`.

**Timing:** queued input is captured when the queue request is accepted, not when it is dequeued, so the content matches what the user referenced at send time.

**Conversion and estimates:**
- `convert_prompt_blocks` stops emitting `MediaSource::Url` for `file://` links and emits `[File reference: <path>]` instead. This also covers histories persisted before the change. Non-`file` links are unchanged.
- The context-size estimates in compaction, maintenance and the delegation summarizer include `MentionContext` content.

**Rationale and alternatives:**
- *Why snapshot:* converting on every rebuild would re-read files that tools have since edited, which changes earlier turns and breaks prompt caching.
- *Alternative:* rewrite the prompt into embedded `Resource` blocks, as the legacy dashboard did. Rejected because echo and replay would show file content as user content and lose the link identity the desktop renders as a chip.
- *Alternative:* a bare path reference, letting the model call `read_tool`. Rejected as the default because it costs a tool round-trip per mention. It remains the fallback for unresolved or truncated links.

### D6. Desktop mention model
**`MentionController`** is pure TS with no fetching. It owns:
- trigger detection from `(text, caret)`: `@` at the start of the text or after whitespace, with the query being the non-whitespace characters up to the caret;
- the active token range and the selected index;
- accepted mentions `{ text, uri, name, isDir }`;
- accept and drill-down;
- extraction of the active mentions.

**Query fetching** lives in a small `.svelte.ts` module built on **runed `resource()`**:
- It uses `debounce: 80`, keyed on the query target and query.
- runed aborts the previous fetch's `AbortSignal`, but still stores a late result unless the fetcher throws, and ACP extension calls can't be cancelled on the wire. So the fetcher checks `signal.aborted` after awaiting and throws an `AbortError`, which runed ignores.
- `refetch()` serves the `indexReady` retry and the 1-second cwd-only polling.
- `runed` becomes a direct dependency, at the version bits-ui already brings in.

**Insertion:**
- Enter, or Tab on a file, replaces the token with `@<path> ` and records a mention. Enter on a directory inserts `@<dir>/ ` and records a directory mention.
- Tab on a directory inserts `@<dir>/` with no space, records nothing, and keeps the list open, querying inside it.
- Paths containing whitespace are inserted as `@"<path>" ` and recorded with that exact text.

**Active mentions at send:** recorded mentions whose exact text appears with a token boundary on both sides. Before it: the start of the text or whitespace. After it: the end of the text, whitespace, or one of `, ; : ! ? ) .` that is itself followed by whitespace or the end of the text. So `@a.ts` does not match inside `@a.tsx` or `@a.ts/`. Deduplicate by `uri`. This avoids tracking offsets through arbitrary textarea edits.

**Lifecycle:** accepted mentions are stored with the draft, next to `composerPrompt`. They're cleared with the draft after a successful send, kept when a failed send keeps the draft, and cleared when the launch target or cwd changes.

**`MentionPopup.svelte`:**
- Uses **bits-ui `Popover`** with `customAnchor` set to the composer, `trapFocus={false}`, and `onOpenAutoFocus` prevented, so focus stays in the textarea.
- The list is a plain `role="listbox"`, and the textarea gets `aria-activedescendant`.
- *Alternative:* bits-ui `Command`. Rejected because its keyboard navigation is bound to its own root/input, while here focus stays in the textarea, the controller owns the selection, and filtering happens on the server.
- `customAnchor` also accepts a measurable rect, which leaves room for caret positioning later.

**Key handling:** `handlePromptKeydown` delegates to the controller first. While the list is open, the controller consumes Arrow/Enter/Tab/Escape before the send-shortcut and mode-cycle branches.

**Query target:** an active session uses `session_id`. The launch composer uses `cwd` only when the selected target is the local node. For a remote target the popup is disabled (non-goal per proposal).

**Send:**
- `PromptSendOptions` gains `mentions: { uri, name }[]`, and `steerSession` / `queueSession` gain the same parameter.
- `buildPromptContent` appends `{ type: 'resource_link', uri, name }` after attachments, using the agent-provided `uri` verbatim. The desktop never builds a URI.
- No capability gate is needed for sending, because `resource_link` is baseline ACP.

### D7. Transcript rendering and echo
- Add `SessionResourceLinkBlock { type: 'resource_link', uri, name, title? }` to `SessionContentBlock`. It is used **only for `file://` URIs**.
- Other `resource_link` blocks, including `attachment:///` echoes, keep today's handling: `normalizeContentBlock` drops them and `readRawAttachmentIdentity` reconciles them.
- `contentBlocksMatch` compares links by `uri`.
- `SessionTurn.svelte` renders a chip with the file name and a bits-ui `Tooltip` showing the full path decoded from the URI.
- Optimistic messages include the link blocks so echo reconciliation matches.

## Risks / Trade-offs

- **Remote query ships the full index across the mesh per keystroke.** → Debounce on the client and use the moka TTL cache on the relay. Add a ranked mesh message later if it's measured as slow.
- **Adding `cwd` to `GetFileIndexResponse` changes the mesh wire format.** → `#[serde(default)]` covers self-describing codecs. If the mesh codec isn't self-describing, add a new message instead. Verify in task 1.2.
- **Mention text collides with literal `@foo` the user typed without accepting.** → Only accepted mentions are recorded. Unaccepted `@foo` stays plain text.
- **Large mentions blow the context.** → Per-mention and total caps, `max_prompt_bytes`, and a truncation note pointing at tools.
- **Persisted image snapshots grow the session DB.** → They're bounded by the existing attachment size validation. Storing by content hash is a later optimization.
- **Sandbox bypass via symlinks or TOCTOU.** → Canonicalize both sides with `dunce` and read the canonical path.
- **Warming an index for a cwd-only query can evict an idle pooled index.** → The pool is bounded with LRU eviction, and sessions keep their own handles.
- **Cwd-only queries can list any directory to any connected client.** → This is the same trust level as `session/new` with that cwd. Filesystem roots are rejected.
- **frizbee typo tolerance adds noisy matches.** → `max_typos` scales with query length. Tune it with the ranking tests.
- **frizbee doesn't normalize Unicode.** → NFD file names may not match NFC queries. Accepted for v1.
- **frizbee is pre-1.0.** → Pin the minor version. Ranking is isolated in one module.
- **Older agents receive `resource_link` from a new desktop.** → The desktop only offers mentions when `querymt/workspace/files` is advertised, and that ships together with expansion in the same agent release.
- **Older desktops or other ACP clients sending `file://` links.** → They now get real expansion instead of a broken URL attachment, which is a strict improvement.
- **`MessagePart::MentionContext` is a persisted schema addition.** → It's a new serde-tagged variant. Older agents can't read sessions written by newer ones, which is the same forward-compat stance as other part additions. No migration is needed.

## Migration Plan

1. Ship the agent with the method, notification, expansion, capability entry and the new `frizbee` / `typed-path` dependencies. Regenerate typeshare types into `src/lib/querymt/generated/types.ts`.
2. Ship the desktop, with `runed` added as a direct dependency, gated on the capability. Bump the embedded-UI pin in the agent afterwards.
3. Rollback: the desktop hides the feature when the capability is absent. Disabling the agent method alone is enough.

## Open Questions

- Should a ranked `QueryFileIndex` mesh message replace shipping the full remote index? Decide after measuring on a large remote repo. This doesn't change the wire contract to the desktop.
- Should the workspace manager emit per-root readiness so cwd-only queries can stop polling?
- Should the transcript chip open the file (local only) or just show the path? It can be decided during UI review.
