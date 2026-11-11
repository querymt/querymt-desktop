# Proposal

## Why

The session composer has no `@` file mentions. Users have to type or paste paths by hand, and the model gets no reliable signal about which files they mean. The legacy agent dashboard had this feature. It was removed with that dashboard (`ac0e5538 refactor(agent): remove legacy dashboard`) and never moved to ACP. The agent still builds a gitignore-aware workspace file index for every session, but ACP has no method to query it.

ACP itself has no file completion; neither the v2 spec nor any RFD covers it. ACP does make `resource_link` a baseline prompt content type that every agent must support. Because the agent owns the workspace (local, remote/mesh, or behind the embedded dashboard), the mention should be sent as a reference (`resource_link`) that the agent resolves on its own side. The client never reads the file.

## What Changes

- Typing `@` in the session composer opens a keyboard-navigable list of files and directories under the session's working directory. The list is filtered as the user types and served by the agent's workspace index.
- A selected mention stays visible as `@relative/path` in the prompt text. On send, it becomes an ACP `resource_link` block with an absolute `file://` URI on the agent's machine. This applies to normal prompts, steer, and queue.
- New QueryMT ACP extension `querymt/workspace/files`: a side-effect-free, ranked, bounded query of the workspace index, keyed by an existing session or by a `cwd` (before a session exists). Agents advertise it in `querymt/capabilities`, and the desktop hides the feature when it is missing.
- The agent resolves `file://` resource links in prompts on the node that owns the session. Paths are sandboxed to the session's workspace root. The agent snapshots the referenced content at submission time, so replaying history doesn't reread changed files. It also stops forwarding `file://` links to providers as unusable URL attachments.
- User messages in the transcript show mentions as file chips. The expanded content stays hidden from the user, and optimistic echo matching handles the new block shapes.
- Out of scope: mentions of non-file resources (symbols, sessions, URLs), file completion before a session exists for remote/mesh targets, and changes to the ACP standard.

## Capabilities

### New Capabilities

- `desktop-file-mentions`: `@` completion in the composer, how mentions are sent as `resource_link`, and how they render in the transcript.
- `agent-file-mention-contract`: what the desktop requires from the QueryMT agent. This covers the workspace file query extension and how `file://` resource links in prompts are resolved.

### Modified Capabilities

None. The existing specs (`reconnectable-acp-elicitations`, `session-mode-preferences`) don't change.

## Impact

- Desktop: `src/lib/components/primitives/SessionComposer.svelte` (plus a new mention popup component), `src/lib/querymt/querymt-extensions.ts`, `src/lib/querymt/acp-client.ts` (`buildPromptContent`, capability gating), `src/lib/stores/agents.svelte.ts` (send paths, optimistic transcript echo), `src/lib/domain/session-updates.ts` / `types.ts` (`resource_link` normalization), transcript rendering, and their tests.
- Agent (companion work in the sibling checkout `${QUERYMT_AGENT_REPO}`): `crates/agent/src/agent/handle/ext.rs` + a new handler, `crates/agent/src/control/capabilities.rs`, the session actor's prompt/submit handlers and the existing `GetFileIndex` / `ReadRemoteFile` mesh messages, `crates/agent/src/model.rs` (`convert_prompt_blocks`), and generated typeshare types.
- Wire: one new QueryMT extension method plus `_meta` / `annotations` conventions on prompt blocks. Standard ACP blocks are used everywhere else. Older agents without the capability get no `@` popup, so nothing breaks.
- This change lives in the desktop OpenSpec root and its apply scope is querymt-desktop. Agent work needs a separately authorized companion change before the end-to-end acceptance checks can pass.
