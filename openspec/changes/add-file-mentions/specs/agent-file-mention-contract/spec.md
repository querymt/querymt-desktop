# Spec Delta

## Purpose

Defines what QueryMT Desktop requires from the QueryMT agent for `@` file mentions: a side-effect-free workspace file query over ACP, and resolution of `file://` resource links in prompts on the node that owns the session.

## ADDED Requirements

### Requirement: Agent advertises the workspace file query
An agent that implements the workspace file query SHALL list `querymt/workspace/files` in the `methods` of its `querymt/capabilities` response. A client SHALL NOT call the method when it is not listed.

#### Scenario: Capability present
- **WHEN** the desktop connects to an agent with the feature
- **THEN** `querymt/capabilities` lists `querymt/workspace/files`

#### Scenario: Legacy agent
- **WHEN** the desktop connects to an agent without the feature
- **THEN** the method is not listed and the desktop does not call it

### Requirement: Workspace file query by session or cwd
`querymt/workspace/files` SHALL accept either a `session_id` or an absolute `cwd`, plus an optional `query` string and `limit`. With a `session_id`, it SHALL answer from the index of the node that owns the session, including remote/mesh sessions. With only a `cwd`, it SHALL answer for the local node. It SHALL NOT create, resume, or modify a session.

#### Scenario: Remote session
- **WHEN** the client queries with the `session_id` of a session that lives on a mesh peer
- **THEN** the results come from the peer's workspace index for that session's cwd

#### Scenario: Before a session exists
- **WHEN** the client queries with `cwd: "/repo"` and no `session_id`
- **THEN** the agent returns entries under `/repo` and no session appears in `session/list`

#### Scenario: Unknown session
- **WHEN** the `session_id` is not known to the agent
- **THEN** the request fails with an ACP resource-not-found error

### Requirement: Query results are scoped, ranked, and bounded
Results SHALL contain only entries at or below the requested working directory and inside its workspace root, honoring the same ignore rules as the workspace index. Each entry SHALL carry its path relative to the working directory, its absolute path, and whether it is a directory. Entries SHALL be ranked by match quality against `query` and truncated to `limit`, which the agent SHALL cap. The response SHALL report whether results were truncated.

#### Scenario: Relative to a subdirectory cwd
- **WHEN** the workspace root is `/repo` and the query uses `cwd: "/repo/crates/agent"`
- **THEN** entries are relative to `/repo/crates/agent` and none lie outside it

#### Scenario: Ignored files excluded
- **WHEN** `target/` is gitignored
- **THEN** no entry under `target/` is returned

#### Scenario: Oversized limit
- **WHEN** the client asks for `limit: 100000`
- **THEN** the agent returns at most its cap and sets the truncated flag if more matched

### Requirement: Index-not-ready is distinguishable
When the workspace index for the requested cwd is still building, the query SHALL return a not-ready result instead of an empty list. The agent SHALL notify clients when the index becomes ready.

#### Scenario: First query on a large repo
- **WHEN** the client queries immediately after creating a session in a repo whose index is still building
- **THEN** the response indicates not-ready, and a readiness notification follows when the index is built

### Requirement: Agent resolves file resource links in prompts
For each `resource_link` with a `file://` URI in a prompt, steer, or queued input, the agent SHALL resolve the path on the node that owns the session. It SHALL give the model that file's content (or, for a directory, its listing) for that turn, together with the path, in place of a provider URL attachment. Content SHALL be bounded by the agent's read limits and marked as truncated when cut.

#### Scenario: Text file mention
- **WHEN** a prompt contains `resource_link` `file:///repo/src/a.ts`
- **THEN** the model input for that turn contains the path and content of `/repo/src/a.ts`, and no URL attachment is sent to the provider

#### Scenario: Image file mention
- **WHEN** the link points to a PNG and the model supports images
- **THEN** the model receives it as an image input

#### Scenario: Large file
- **WHEN** the file exceeds the read limit
- **THEN** the model receives the leading part with a truncation note naming the path so it can read the rest with tools

### Requirement: Resource link resolution is sandboxed
The agent SHALL resolve `file://` links only after canonicalizing them, and only when they lie within the session's workspace root. Links outside the root, links that do not exist, or links with non-`file` schemes SHALL NOT cause file reads. They SHALL instead be passed to the model as a textual reference with a reason, and SHALL NOT fail the prompt.

#### Scenario: Path traversal
- **WHEN** a link is `file:///repo/../etc/passwd`
- **THEN** the file is not read and the model sees the reference marked as outside the workspace

#### Scenario: Missing file
- **WHEN** the linked file was deleted before submission
- **THEN** the prompt is accepted and the model sees the reference marked as not found

### Requirement: Resolved content is stable across replay
The agent SHALL capture resolved mention content when the input is submitted, and SHALL reuse that captured content when rebuilding model context for later turns, compaction, or session reload, rather than re-reading the file. The user message echoed and replayed to clients SHALL still contain the original `resource_link` blocks.

#### Scenario: File changes after send
- **WHEN** a mentioned file is edited by a later tool call
- **THEN** the context rebuilt for subsequent turns still contains the content as of submission for that user message

#### Scenario: Echo preserves the link
- **WHEN** the client reloads the session history
- **THEN** the user message contains the original `resource_link` blocks
