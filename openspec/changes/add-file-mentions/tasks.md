# Tasks

## 1. Coordinate the Agent Contract (external dependency)

The agent repository identified by `${QUERYMT_AGENT_REPO}` is outside the allowed edit roots of this repo-local change. The variable denotes the root of the sibling QueryMT agent checkout. These tasks require a separately authorized companion change there. Do not edit that repository as part of a desktop-only apply.

- [x] 1.1 Agree on the request/response shape of `querymt/workspace/files`, including `uri` and `name` per entry and the error mapping (D1). Agree on the `querymt/workspace/indexReady { session_id, workspace_root }` notification (D4) and the capability entries.
  - Verify: typeshare-generated request, response and notification types exist.
  - Verify: a serde round-trip test covers `ready`, `not_ready`, and `truncated`.
- [x] 1.2 In the agent companion change, implement the handler with local-session, remote-session and cwd-only routing (D2):
  - add an optional `cwd` field to `GetFileIndexResponse` with `#[serde(default)]`, and confirm the mesh codec tolerates it;
  - use `typed-path` for remote cwd filtering and `url` for building entry URIs;
  - add the `moka` TTL cache on the relay node;
  - map unknown sessions to `ResourceNotFound` and invalid targets to `invalid_params`;
  - cap `limit`.

  Verify agent tests for:
  - subdirectory cwd scoping;
  - gitignored exclusion;
  - unknown session (resource-not-found);
  - both or neither target, and a relative, missing or filesystem-root cwd (invalid-params);
  - a cwd-only query creating no session;
  - a mesh test against a remote session;
  - a unit test that turns Windows-style remote paths into correct relative paths and URIs on a Unix host.
- [x] 1.3 In the agent companion change, add `frizbee` as a pinned direct dependency and implement ranking in one module (D3):
  - a path pass;
  - a basename pass over the path-pass matches;
  - typo budget `query_chars / 4`;
  - deterministic tie-breaks;
  - shallow-first listing for an empty query.

  Verify:
  - unit tests that a basename match outranks a scattered match (`mod` → `src/model.rs` before `src/m/o/d/x.rs`), that `/`-segment starts get a bonus, that output is identical across runs, and that an empty query returns shallow entries first;
  - a benchmark over 100k synthetic paths that stays well under the 80 ms debounce budget.
- [x] 1.4 In the agent companion change:
  - list the method and notification in `querymt/capabilities`;
  - forward `WorkspaceIndexReady` for local and remote sessions as `querymt/workspace/indexReady` on stdio and WebSocket.

  Verify capability and notification tests in `crates/agent/src/agent/handle/tests`, including a remote session's readiness reaching a local client.
- [x] 1.5 In the agent companion change, resolve `file://` `resource_link` blocks when prompt, steer and queue requests are accepted, producing persisted `MentionContext` parts and keeping the original blocks in `MessagePart::Prompt` / `Steering` (D5):
  - parse with `url::Url::to_file_path`, rejecting non-local hosts;
  - `dunce::canonicalize` both the target and the root, and read the canonical path;
  - apply the per-mention and total caps;
  - run images through the existing image validation.

  Verify tests for:
  - text, image and directory mentions;
  - truncation of one file, and of the total across files;
  - `..` traversal and symlink escape;
  - a workspace root reached through a symlink;
  - a missing file;
  - a `file://host/...` link;
  - non-`file` schemes keeping their existing handling;
  - a queued input capturing content at enqueue time.
- [x] 1.6 In the agent companion change, make `convert_prompt_blocks` emit a textual reference instead of a `MediaSource::Url` attachment, for `file://` links only. Include `MentionContext` content in rebuilt context, degrading image snapshots to a textual reference for models without image support, and in the context-size estimates of compaction, maintenance and the delegation summarizer.
  - Verify a test where the file changes after submission but the rebuilt context keeps the submitted snapshot.
  - Verify replayed history still contains the original `resource_link` and no `MentionContext` content.
  - Verify the compaction estimate grows with mention size.
  - Verify an image snapshot sent to a text-only model becomes a reference.
- [x] 1.7 Regenerate the agent's typeshare output and copy it to `src/lib/querymt/generated/types.ts` in this repository.
  - Verify `npm run check` passes with the new types.

## 2. Desktop Extension Client (this repository)

- [x] 2.1 Add `QMT_METHOD_WORKSPACE_FILES`, `QMT_NOTIFICATION_WORKSPACE_INDEX_READY` and a `workspaceFiles()` method in `src/lib/querymt/querymt-extensions.ts`. Route the notification through the ACP client's extension notification handling.
  - Verify unit tests in `src/lib/querymt/querymt-extensions.test.ts` (or the ACP client tests) for wire method naming, response parsing including `uri`/`name`, and notification dispatch.
- [x] 2.2 Expose a `supportsWorkspaceFiles` capability check on the ACP client/agents store, derived from the `methods` in `querymt/capabilities`.
  - Verify tests that a legacy capabilities response reports unsupported.

## 3. Mention Controller and Composer UI (this repository)

- [x] 3.1 Implement a pure `MentionController` under `src/lib/domain/` (D6). It covers:
  - trigger detection;
  - the token range;
  - selection;
  - accepted mentions keyed by `uri`;
  - accept, directory drill-down, and quoted insertion for paths with whitespace;
  - active-mention extraction with token-boundary matching and dedup.

  Verify unit tests for:
  - word-start vs email triggers;
  - Enter vs Tab on files and directories;
  - quoted paths;
  - edited-away and extended (`@a.ts` → `@a.tsx`) mentions being excluded;
  - trailing punctuation still matching;
  - dedup by `uri`.
- [x] 3.2 Add `runed` as a direct dependency, at the version bits-ui brings in. Implement the query module (`.svelte.ts`) with runed `resource()` (`debounce: 80`):
  - the fetcher throws `AbortError` when its signal was aborted while it awaited;
  - `refetch()` runs on a matching `indexReady` notification;
  - cwd-only queries re-poll at most once per second while `not_ready` and the list is open.

  Verify tests for:
  - stale-response discard (`ab` resolving after `abc`);
  - `not_ready` retry on `indexReady` for the matching session, and no retry for another session;
  - cwd-only polling stopping when the list closes.
- [x] 3.3 Add `MentionPopup.svelte` using bits-ui `Popover` (`customAnchor` set to the composer, `trapFocus={false}`, `onOpenAutoFocus` prevented) with a `role="listbox"` list and `aria-activedescendant` on the textarea. Wire it into `SessionComposer.svelte` so open-list keys (Arrow/Enter/Tab/Escape) take precedence over send and mode cycling. Pass the query target: `session_id`; or `cwd` for a local launch target; disabled for remote launch targets and unsupported agents.
  - Verify `SessionComposer.test.ts` cases for:
    - Enter accepting rather than sending;
    - Escape closing;
    - Tab drilling into a directory;
    - focus staying in the textarea;
    - no list without the capability;
    - no list for a remote launch target;
    - the indexing state.
- [x] 3.4 Store accepted mentions with the composer draft in `agents.svelte.ts`. Thread them from the composer through both route pages (`src/routes/+page.svelte`, `src/routes/sessions/[agentId]/[sessionId]/+page.svelte`) into the send paths. Clear them after a successful send and when the launch target or cwd changes, and keep them when a failed send keeps the draft.
  - Verify component/store tests that sending emits mentions, that a successful send clears them, that a failed preflight keeps them, and that changing the launch cwd discards them.

## 4. Sending and Transcript (this repository)

- [x] 4.1 Add `mentions` to `PromptSendOptions` and to `steerSession` / `queueSession`, and extend `buildPromptContent` in `src/lib/querymt/acp-client.ts` to append `resource_link` blocks using the agent-provided `uri` verbatim.
  - Verify `acp-client.test.ts` cases for two mentions, mentions alongside attachments, the URI passing through unchanged, and steer/queue payloads.
- [x] 4.2 Add `SessionResourceLinkBlock` to `src/lib/domain/types.ts`, and in `normalizeContentBlock` parse only `file://` links into it. Match it by `uri` in `contentBlocksMatch`, and include links in optimistic user messages in `agents.svelte.ts`.
  - Verify `session-updates` and `agents.svelte.test.ts` cases:
    - an echoed mention prompt reconciles to one message;
    - replayed history keeps the link;
    - the existing `attachment:///` `resource_link` echo test still reconciles and produces no link block.
- [x] 4.3 Render `file://` link blocks as file chips (name, plus a bits-ui `Tooltip` with the full path) in `SessionTurn.svelte`.
  - Verify a component test rendering a user message with a `resource_link`, and one confirming that an `attachment:///` link renders no chip.

## 5. Cross-Repository Verification

- [ ] 5.1 With the agent companion work present, run `npm run check` and `npm run test:ui`. Then manually send a prompt with a file mention and a directory mention to a local session, and confirm the model answers from the file content without a tool call.
- [ ] 5.2 Repeat against a remote/mesh session and the embedded dashboard build. Verify completion lists the peer's files, ranking matches the local results, and the mention resolves on the peer.
- [ ] 5.3 Connect the new desktop to an agent without the capability. Verify no list appears, `@` types normally, and prompts send unchanged.
- [ ] 5.4 Map each scenario in `specs/agent-file-mention-contract/spec.md` to a named test in the agent companion change, and record the mapping in that change's PR description.
