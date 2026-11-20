# Spec Delta

## Purpose

Defines what QueryMT Desktop requires from the QueryMT agent for `@` file mentions: a side-effect-free workspace file query over ACP, and resolution of `file://` resource links in prompts on the node that owns the session.

## ADDED Requirements

### Requirement: Agent advertises the workspace file query
An agent that implements the workspace file query SHALL list `querymt/workspace/files` in the `methods` and `querymt/workspace/indexReady` in the `notifications` of its `querymt/capabilities` response. A client SHALL NOT call the method when it is not listed.

#### Scenario: Capability present
- **WHEN** the desktop connects to an agent with the feature
- **THEN** `querymt/capabilities` lists `querymt/workspace/files` and `querymt/workspace/indexReady`

#### Scenario: Legacy agent
- **WHEN** the desktop connects to an agent without the feature
- **THEN** the method is not listed and the desktop does not call it

### Requirement: Workspace file query by session or cwd
`querymt/workspace/files` SHALL accept exactly one of `session_id` or `cwd`, plus an optional `query` string and `limit`. With a `session_id`, it SHALL answer from the index of the node that owns the session, including remote/mesh sessions. With only a `cwd`, it SHALL answer for the local node, and the `cwd` SHALL be an absolute path to an existing directory that is not a filesystem root. The query SHALL NOT create, resume, or modify a session.

#### Scenario: Remote session
- **WHEN** the client queries with the `session_id` of a session that lives on a mesh peer
- **THEN** the results come from the peer's workspace index for that session's cwd

#### Scenario: Remote peer on a different OS
- **WHEN** the session lives on a Windows peer and the query is answered by a macOS or Linux node
- **THEN** each entry's relative path uses `/` separators, and its absolute path and URI are valid for the Windows peer

#### Scenario: Before a session exists
- **WHEN** the client queries with `cwd: "/repo"` and no `session_id`
- **THEN** the agent returns entries under `/repo` and no session appears in `session/list`

#### Scenario: Unknown session
- **WHEN** the `session_id` is not known to the agent
- **THEN** the request fails with an ACP resource-not-found error

#### Scenario: Invalid target
- **WHEN** the request has both `session_id` and `cwd`, neither of them, a relative `cwd`, a `cwd` that is not an existing directory, or a filesystem-root `cwd`
- **THEN** the request fails with an ACP invalid-params error

### Requirement: Query results are scoped
Results SHALL contain only entries at or below the requested working directory and inside its workspace root, honoring the same ignore rules as the workspace index. Each entry SHALL carry its `/`-separated path relative to the working directory, its absolute path on the agent's machine, an agent-built `file://` URI for that path, its name, and whether it is a directory.

#### Scenario: Relative to a subdirectory cwd
- **WHEN** the workspace root is `/repo` and the query uses `cwd: "/repo/crates/agent"`
- **THEN** entries are relative to `/repo/crates/agent` and none lie outside it

#### Scenario: Ignored files excluded
- **WHEN** `target/` is gitignored
- **THEN** no entry under `target/` is returned

#### Scenario: Entry carries a URI
- **WHEN** the query returns `src/a.ts` for cwd `/repo`
- **THEN** the entry's URI is `file:///repo/src/a.ts` and its name is `a.ts`

### Requirement: Query results are ranked and bounded
Entries SHALL be ranked by fuzzy match quality against `query`, with matches on the file name ranked above equivalent matches spread across directories, and ties broken deterministically. An empty `query` SHALL list the shallowest entries first. Results SHALL be truncated to `limit`, which the agent SHALL cap, and the response SHALL report whether results were truncated.

#### Scenario: Basename match ranks first
- **WHEN** the query is `mod` and the index contains `src/model.rs` and `src/m/o/d/x.rs`
- **THEN** `src/model.rs` is ranked above `src/m/o/d/x.rs`

#### Scenario: Empty query
- **WHEN** the query is empty
- **THEN** entries directly in the working directory are listed before deeper entries

#### Scenario: Oversized limit
- **WHEN** the client asks for `limit: 100000`
- **THEN** the agent returns at most its cap and sets the truncated flag if more matched

### Requirement: Index-not-ready is distinguishable
When the workspace index for the requested cwd is still building, the query SHALL return a not-ready result instead of an empty list. When the index for a session becomes ready, the agent SHALL send `querymt/workspace/indexReady` with that session's id and its workspace root. This applies to local and remote sessions.

#### Scenario: First query on a large repo
- **WHEN** the client queries immediately after creating a session in a repo whose index is still building
- **THEN** the response indicates not-ready, and an `indexReady` notification for that session follows when the index is built

#### Scenario: Cwd-only query while indexing
- **WHEN** the client queries by `cwd` while that root is still indexing
- **THEN** the response indicates not-ready, and a later query returns entries once the index is built

### Requirement: Agent resolves file resource links in prompts
For each `resource_link` with a `file://` URI in a prompt, steer, or queued input, the agent SHALL resolve the path on the node that owns the session when the input is accepted. Instead of a provider URL attachment, it SHALL give the model, for that turn, the path together with the file's content, the image itself for an image, or the listing for a directory.

#### Scenario: Text file mention
- **WHEN** a prompt contains `resource_link` `file:///repo/src/a.ts`
- **THEN** the model input for that turn contains the path and content of `/repo/src/a.ts`, and no URL attachment is sent to the provider

#### Scenario: Directory mention
- **WHEN** a prompt contains `resource_link` `file:///repo/src`
- **THEN** the model input for that turn contains the path and a listing of `/repo/src`

#### Scenario: Image file mention
- **WHEN** the link points to a PNG and the model supports images
- **THEN** the model receives it as an image input

#### Scenario: Image mention without image support
- **WHEN** the link points to a PNG and the model does not support images
- **THEN** the model receives a textual reference to the path with a reason, and the prompt is not rejected

#### Scenario: Queued input
- **WHEN** a queued input mentions a file that a tool edits before the input is dequeued
- **THEN** the model receives the content as of when the queue request was accepted

### Requirement: Mention content is bounded
Resolved text content SHALL be bounded by a per-mention limit and by a total limit across all mentions in one input. Content that is cut SHALL carry a truncation note naming the path.

#### Scenario: Large file
- **WHEN** the file exceeds the per-mention limit
- **THEN** the model receives the leading part with a truncation note naming the path so it can read the rest with tools

#### Scenario: Many mentions
- **WHEN** one input mentions several files whose combined content exceeds the total limit
- **THEN** the content beyond the total limit is cut, and each affected mention carries a truncation note naming its path

### Requirement: Non-file resource links are unchanged
A `resource_link` whose URI scheme is not `file` SHALL keep the handling it had before this change.

#### Scenario: Non-file link unchanged
- **WHEN** a prompt contains a `resource_link` with an `https` URI
- **THEN** it is handled exactly as before this change

### Requirement: Resource link resolution is sandboxed
The agent SHALL canonicalize both the linked path and the session's workspace root before comparing them. It SHALL read only links whose canonical path lies within the canonical root, and SHALL read from the canonical path. The following `file://` links SHALL NOT cause file reads:
- links outside the root;
- links that do not exist;
- links whose URI names a non-local host.

They SHALL instead be passed to the model as a textual reference with a reason, and SHALL NOT fail the prompt.

#### Scenario: Path traversal
- **WHEN** a link is `file:///repo/../etc/passwd`
- **THEN** the file is not read and the model sees the reference marked as outside the workspace

#### Scenario: Symlink escape
- **WHEN** a link points to `/repo/link` and `link` is a symlink to `/etc`
- **THEN** nothing is read and the model sees the reference marked as outside the workspace

#### Scenario: Symlinked workspace root
- **WHEN** the session cwd is reached through a symlink (for example macOS `/var` → `/private/var`) and the link names a file inside it
- **THEN** the file is read normally

#### Scenario: Missing file
- **WHEN** the linked file was deleted before submission
- **THEN** the prompt is accepted and the model sees the reference marked as not found

#### Scenario: Remote host URI
- **WHEN** a link is `file://server/share/a.txt`
- **THEN** nothing is read and the model sees the reference marked as a non-local host

### Requirement: Resolved content is stable across replay
The agent SHALL capture resolved mention content when the input is accepted. It SHALL reuse that captured content, rather than re-reading the file, when:
- rebuilding model context for later turns;
- compacting;
- reloading the session;
- estimating context size.

The user message echoed and replayed to clients SHALL contain the original `resource_link` blocks and SHALL NOT contain the captured content.

#### Scenario: File changes after send
- **WHEN** a mentioned file is edited by a later tool call
- **THEN** the context rebuilt for subsequent turns still contains the content as of submission for that user message

#### Scenario: Echo preserves the link
- **WHEN** the client reloads the session history
- **THEN** the user message contains the original `resource_link` blocks and no user-visible block carries the mentioned file's content

#### Scenario: Compaction accounts for mentions
- **WHEN** a session's prompts include large mentioned files
- **THEN** the context-size estimate used to trigger compaction includes the captured mention content
