# Spec Delta

## Purpose

Lets users reference workspace files and directories from the session composer with `@` mentions. Completions come from the agent's workspace index, and mentions are sent to the agent as ACP `resource_link` references.

## ADDED Requirements

### Requirement: Typing @ opens file completion
When the agent advertises the workspace file query and the composer has a query target, typing `@` at the start of the prompt or after whitespace SHALL open a completion list of files and directories under the target's working directory. The query target is the active session, or the working directory of a local launch target. An `@` inside a word, such as an email address, SHALL NOT open the list. For a remote launch target before a session exists, the list SHALL NOT open.

#### Scenario: Mention trigger at word start
- **WHEN** the user types `look at @src` in a session whose cwd is `/repo`
- **THEN** a completion list opens showing entries under `/repo` that match `src`

#### Scenario: Email address does not trigger
- **WHEN** the user types `mail foo@bar.com`
- **THEN** no completion list opens

#### Scenario: Agent without the capability
- **WHEN** the connected agent does not advertise the workspace file query
- **THEN** typing `@` inserts a plain `@` and no completion list opens

#### Scenario: Remote launch target
- **WHEN** the launch composer targets a remote node and no session exists yet
- **THEN** typing `@` inserts a plain `@` and no completion list opens

### Requirement: Completion filters as the user types
The list SHALL be refreshed from the agent, debounced, as the query after `@` changes. It SHALL show the agent's ranked entries up to a bounded count, SHALL distinguish directories from files, and SHALL ignore responses to queries the user has already typed past.

#### Scenario: Stale response discarded
- **WHEN** the user types `@ab` then `@abc` and the response for `ab` arrives after the response for `abc`
- **THEN** the list shows only the results for `abc`

#### Scenario: Index still building for a session
- **WHEN** the agent reports the workspace index is not ready for the active session
- **THEN** the list shows an indexing state instead of an empty result, and re-queries when an `indexReady` notification for that session arrives or the query changes

#### Scenario: Index still building before a session exists
- **WHEN** the agent reports not-ready for a cwd-only query
- **THEN** the list shows an indexing state and re-queries at most once per second while it stays open

### Requirement: Completion is keyboard-operable
While the list is open:
- ArrowUp/ArrowDown SHALL move the selection.
- Enter and Tab SHALL accept the selected entry.
- Escape SHALL close the list without changing the prompt.
- None of these keys SHALL send the prompt or cycle the session mode.

Focus SHALL stay in the prompt text area.

#### Scenario: Enter accepts instead of sending
- **WHEN** the list is open and the user presses Enter
- **THEN** the selected entry is inserted and the prompt is not sent

#### Scenario: Escape closes
- **WHEN** the list is open and the user presses Escape
- **THEN** the list closes, the typed `@query` text remains, and no mention is recorded

### Requirement: Accepting an entry inserts a visible mention
Accepting an entry with Enter, or a file with Tab, SHALL:
- replace the `@query` token with `@<path relative to cwd>` (with a trailing `/` for a directory) followed by a space;
- close the list;
- record a mention binding that text to the entry's agent-provided URI.

Tab on a directory SHALL instead insert `@<dir>/` without a trailing space, record nothing, and keep the list open showing entries inside that directory. A path containing whitespace SHALL be inserted in quoted form, `@"<path>"`.

#### Scenario: File accepted
- **WHEN** the user accepts `src/lib/a.ts` from `@a.t` in cwd `/repo`
- **THEN** the prompt contains `@src/lib/a.ts ` and a mention for `file:///repo/src/lib/a.ts` is recorded

#### Scenario: Directory drill-down
- **WHEN** the user presses Tab on directory `src/lib`
- **THEN** the prompt contains `@src/lib/`, no mention is recorded, and the list shows entries under `src/lib`

#### Scenario: Directory accepted
- **WHEN** the user presses Enter on directory `src/lib`
- **THEN** the prompt contains `@src/lib/ ` and a mention for that directory is recorded

#### Scenario: Path with spaces
- **WHEN** the user accepts `docs/my notes.md`
- **THEN** the prompt contains `@"docs/my notes.md" ` and a mention for it is recorded

### Requirement: Mentions are sent as resource links
On send, the prompt SHALL contain the full text block unchanged, followed by one ACP `resource_link` block per distinct mention still present in the text. Each link SHALL use the agent-provided `file://` URI verbatim and the entry's name as `name`. This SHALL apply to new prompts, steer, and queue.

#### Scenario: Prompt with two mentions
- **WHEN** the user sends `compare @a.ts and @b.ts` in cwd `/repo`
- **THEN** the prompt is one text block followed by `resource_link` blocks for `file:///repo/a.ts` and `file:///repo/b.ts`

#### Scenario: Duplicate mention
- **WHEN** the same file is mentioned twice
- **THEN** exactly one `resource_link` is sent for it

#### Scenario: Steer and queue
- **WHEN** the user steers or queues input containing an accepted mention
- **THEN** the steer or queue request carries the same `resource_link` block as a new prompt would

### Requirement: Only mentions still present in the text are sent
A recorded mention SHALL count as present only when its exact text appears as a whole token: preceded by the start of the text or whitespace, and followed by the end of the text, whitespace, or trailing punctuation. A mention whose text the user edited or deleted SHALL NOT be sent.

#### Scenario: Trailing punctuation
- **WHEN** the user accepts `@a.ts` and sends `look at @a.ts, please`
- **THEN** a `resource_link` for `a.ts` is sent

#### Scenario: Mention text edited away
- **WHEN** the user accepts `@a.ts` and then deletes that text before sending
- **THEN** no `resource_link` for `a.ts` is sent

#### Scenario: Mention text extended
- **WHEN** the user accepts `@a.ts` and then edits it to `@a.tsx`
- **THEN** no `resource_link` for `a.ts` is sent

### Requirement: Mentions follow the draft
Recorded mentions SHALL be kept and cleared together with the composer draft:
- **After a successful send:** cleared.
- **After a send that fails while keeping the draft:** kept.
- **When the launch target or its working directory changes:** cleared.

#### Scenario: Failed send keeps mentions
- **WHEN** a send with a mention fails preflight and the draft is preserved
- **THEN** sending again still includes the mention's `resource_link`

#### Scenario: Launch cwd changes
- **WHEN** the user records a mention in the launch composer and then changes the working directory
- **THEN** the recorded mention is discarded

### Requirement: Mentions render as file chips in the transcript
User messages containing `resource_link` blocks with `file://` URIs SHALL show a chip per link with the file name and, on hover, the full path. This SHALL hold for the optimistic message and for the agent's echo or replayed history, without duplicating the message. `resource_link` blocks with other schemes, including `attachment:///` echoes of attachments, SHALL keep their existing handling and SHALL NOT render as file chips.

#### Scenario: Optimistic echo reconciles
- **WHEN** a prompt with a mention is sent and the agent echoes the user message
- **THEN** the transcript shows one user message with one file chip

#### Scenario: History replay
- **WHEN** a session containing a mention prompt is reopened
- **THEN** the user message shows the same file chip

#### Scenario: Attachment echo unchanged
- **WHEN** the agent echoes an image attachment as a `resource_link` with an `attachment:///` URI
- **THEN** the optimistic attachment message reconciles as before and no file chip is shown
