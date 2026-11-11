# Proposal

## Why

The session composer has no `@` file mentions. Users have to type or paste paths by hand, and the model gets no reliable signal about which files they mean. The legacy agent dashboard had this feature. It was removed with that dashboard (`ac0e5538 refactor(agent): remove legacy dashboard`) and never moved to ACP. The agent still builds a gitignore-aware workspace file index for every session, but ACP has no method to query it.

ACP itself has no file completion; neither the v2 spec nor any RFD covers it. ACP does make `resource_link` a baseline prompt content type that every agent must support. Because the agent owns the workspace (local, remote/mesh, or behind the embedded dashboard), the mention should be sent as a reference (`resource_link`) that the agent resolves on its own side. The client never reads the file.

## What Changes

- Typing `@` in the session composer opens a keyboard-navigable list of files and directories under the session's working directory. The list is filtered as the user types and served by the agent's workspace index.
- A selected mention stays visible as `@relative/path` in the prompt text. On send, it becomes an ACP `resource_link` block carrying the agent-built `file://` URI for that path on the agent's machine. This applies to normal prompts, steer, and queue.
- New QueryMT ACP extension `querymt/workspace/files`: a side-effect-free, fuzzy-ranked (frizbee), bounded query of the workspace index, keyed by an existing session or by a `cwd` (before a session exists). Each entry carries a ready-to-send `file://` URI. Agents advertise it, together with the `querymt/workspace/indexReady` notification, in `querymt/capabilities`. The desktop hides the feature when it is missing.
- The agent resolves `file://` resource links in prompts on the node that owns the session. Both the link and the workspace root are canonicalized before the sandbox check. The agent snapshots the referenced content when the input is accepted, so replaying history doesn't reread changed files, and the snapshot is counted in context-size estimates. It also stops forwarding `file://` links to providers as unusable URL attachments. Links with other schemes are unchanged.
- User messages in the transcript show `file://` mentions as file chips. The expanded content stays hidden from the user, optimistic echo matching handles the new block shape, and existing `attachment:///` link echoes keep their current handling.
- Maintained libraries replace hand-written helpers:
  - agent: `frizbee` (ranking), `typed-path` (cross-OS remote paths), `url` (file URIs), `dunce` (canonicalization), `moka` (relay cache);
  - desktop: runed `resource()` (debounced, stale-safe fetching) and bits-ui `Popover`/`Tooltip`.
- Out of scope: mentions of non-file resources (symbols, sessions, URLs), file completion before a session exists for remote/mesh targets, and changes to the ACP standard.

## Capabilities

### New Capabilities

- `desktop-file-mentions`: `@` completion in the composer, how mentions are sent as `resource_link`, and how they render in the transcript.
- `agent-file-mention-contract`: what the desktop requires from the QueryMT agent. This covers the workspace file query extension and how `file://` resource links in prompts are resolved.

### Modified Capabilities

None. The existing specs (`reconnectable-acp-elicitations`, `session-mode-preferences`) don't change.

## Impact

- Desktop: `src/lib/components/primitives/SessionComposer.svelte` (plus a new mention popup component), `src/lib/querymt/querymt-extensions.ts`, `src/lib/querymt/acp-client.ts` (`buildPromptContent`, steer/queue parameters, capability gating), `src/lib/stores/agents.svelte.ts` (send paths, draft mentions, optimistic transcript echo), `src/lib/domain/session-updates.ts` / `types.ts` (`file://` `resource_link` normalization), transcript rendering, and their tests. New direct dependency: `runed` (already installed transitively by bits-ui).
- Agent (companion work in the sibling checkout `${QUERYMT_AGENT_REPO}`):
  - `crates/agent/src/agent/handle/ext.rs` + a new handler, and `crates/agent/src/control/capabilities.rs`;
  - the session actor's prompt/submit handlers, and the existing `GetFileIndex` mesh message, whose response gains an optional `cwd`;
  - `crates/agent/src/model.rs` (`convert_prompt_blocks`) and the context-size estimators in compaction, maintenance and the delegation summarizer;
  - generated typeshare types;
  - new direct dependencies `frizbee` and `typed-path`.
- Wire: one new QueryMT extension method and one notification. Standard ACP `resource_link` blocks are used for mentions, with no new `_meta` conventions. Older agents without the capability get no `@` popup, so nothing breaks.
- This change lives in the desktop OpenSpec root and its apply scope is querymt-desktop. Agent work needs a separately authorized companion change before the end-to-end acceptance checks can pass.
