# Tasks

## 1. Coordinate the Agent Contract (external dependency)

The agent repository identified by `${QUERYMT_AGENT_REPO}` is outside this repo-local change's allowed edit roots; the variable denotes the root of the sibling QueryMT agent checkout. These tasks require a separately authorized companion change there; do not edit it as part of a desktop-only apply.

- [ ] 1.1 Agree on the `querymt/workspace/files` request/response shape (D1), the `querymt/workspace/indexReady` notification (D4), and the capability entry; verify typeshare-generated request/response types exist and a serde round-trip test covers `ready`, `not_ready`, and `truncated`.
- [ ] 1.2 In the agent companion change, implement the handler with local-session, remote-session (`get_file_index`), and cwd-only routing, cwd filtering, and limit capping (D2); verify agent tests for subdirectory cwd scoping, gitignored exclusion, unknown session (resource-not-found), cwd-only query creating no session, and a mesh test against a remote session.
- [ ] 1.3 In the agent companion change, add subsequence ranking (D3); verify unit tests that basename and contiguous matches outrank scattered matches and an empty query returns shallow entries first.
- [ ] 1.4 In the agent companion change, list the method in `querymt/capabilities` and forward `WorkspaceIndexReady` as `querymt/workspace/indexReady` on stdio and WebSocket; verify capability and notification tests in `crates/agent/src/agent/handle/tests`.
- [ ] 1.5 In the agent companion change, resolve `file://` `resource_link` blocks at submission for prompt, steer, and queue into persisted `MentionContext` parts with canonicalize-and-root sandboxing, keeping original blocks in `MessagePart::Prompt` (D5); verify tests for text, image, directory, truncation, `..` traversal, symlink escape, missing file, and non-`file` schemes not failing the prompt.
- [ ] 1.6 In the agent companion change, make `convert_prompt_blocks` emit a textual reference instead of a `MediaSource::Url` attachment for `file://` links and include `MentionContext` content in rebuilt context; verify a test where the file changes after submission yet the rebuilt context keeps the submitted snapshot, and replayed history still contains the original `resource_link`.
- [ ] 1.7 Regenerate the agent's typeshare output and copy it to `src/lib/querymt/generated/types.ts` in this repository; verify `npm run check` passes with the new types.

## 2. Desktop Extension Client (this repository)

- [ ] 2.1 Add `QMT_METHOD_WORKSPACE_FILES`, `QMT_NOTIFICATION_WORKSPACE_INDEX_READY`, a `workspaceFiles()` method in `src/lib/querymt/querymt-extensions.ts`, and route the notification through the ACP client's extension notification handling; verify unit tests in `src/lib/querymt/querymt-extensions.test.ts` (or the ACP client tests) for wire method naming, response parsing, and notification dispatch.
- [ ] 2.2 Expose a `supportsWorkspaceFiles` capability check on the ACP client/agents store derived from `querymt/capabilities` `methods`; verify tests that a legacy capabilities response reports unsupported.

## 3. Mention Controller and Composer UI (this repository)

- [ ] 3.1 Implement a pure `MentionController` (trigger detection, token range, debounced query with sequence numbers, selection, accepted mentions, accept/drill-down, active-mention extraction with dedup) under `src/lib/domain/`; verify unit tests for word-start vs email triggers, stale-response discard, `not_ready` retry on readiness, directory drill-down, and edited-away mentions being excluded.
- [ ] 3.2 Add `MentionPopup.svelte` and wire the controller into `SessionComposer.svelte` so open-popup keys (Arrow/Enter/Tab/Escape) take precedence over send and mode cycling; pass query target (`session_id`, or `cwd` for a local launch target, disabled for remote launch targets and unsupported agents); verify `SessionComposer.test.ts` cases for Enter-accepts-not-sends, Escape-closes, Tab-drills-directory, no popup without capability, and indexing state.
- [ ] 3.3 Thread accepted mentions from the composer through both route pages (`src/routes/+page.svelte`, `src/routes/sessions/[agentId]/[sessionId]/+page.svelte`) into `PromptSendOptions.mentions`, and clear them with the draft after send; verify component tests that sending emits mentions and the draft reset clears them.

## 4. Sending and Transcript (this repository)

- [ ] 4.1 Extend `buildPromptContent` in `src/lib/querymt/acp-client.ts` to append `resource_link` blocks with `file://` URIs (POSIX and Windows paths, percent-encoded) for new prompts, steer, and queue; verify `acp-client.test.ts` cases for two mentions, duplicates, Windows drive paths, and steer/queue payloads.
- [ ] 4.2 Add `SessionResourceLinkBlock` to `src/lib/domain/types.ts`, parse it in `normalizeContentBlock`, match it by `uri` in `contentBlocksMatch`, and include links in optimistic user messages in `agents.svelte.ts`; verify `session-updates` and `agents.svelte.test.ts` cases that an echoed mention prompt reconciles to one message and replayed history keeps the link.
- [ ] 4.3 Render link blocks as file chips (name plus full-path tooltip) in `SessionTurn.svelte` and ensure agent-attached mention content is not shown as user text; verify a component test rendering a user message with a `resource_link`.

## 5. Cross-Repository Verification

- [ ] 5.1 With the agent companion work present, run `npm run check` and `npm run test:ui`, then manually send a prompt with a file and a directory mention to a local session and confirm the model answers from the file content without a tool call.
- [ ] 5.2 Repeat against a remote/mesh session and the embedded dashboard build; verify completion lists the peer's files and the mention resolves on the peer.
- [ ] 5.3 Connect the new desktop to an agent without the capability; verify no popup appears, `@` types normally, and prompts send unchanged.
