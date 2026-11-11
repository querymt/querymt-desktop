# Spec Delta

## Purpose

Lets users reference workspace files and directories from the session composer with `@` mentions, completed from the agent's workspace index and sent to the agent as ACP `resource_link` references.

## ADDED Requirements

### Requirement: Typing @ opens file completion
When the agent advertises the workspace file query and the composer has a working directory, typing `@` at the start of the prompt or after whitespace SHALL open a completion list of files and directories under that working directory. An `@` inside a word (for example an email address) SHALL NOT open it.

#### Scenario: Mention trigger at word start
- **WHEN** the user types `look at @src` in a session whose cwd is `/repo`
- **THEN** a completion list opens showing entries under `/repo` that match `src`

#### Scenario: Email address does not trigger
- **WHEN** the user types `mail foo@bar.com`
- **THEN** no completion list opens

#### Scenario: Agent without the capability
- **WHEN** the connected agent does not advertise the workspace file query
- **THEN** typing `@` inserts a plain `@` and no completion list opens

### Requirement: Completion filters as the user types
The list SHALL be refreshed from the agent as the query after `@` changes, SHALL show at most a bounded number of ranked entries, SHALL distinguish directories from files, and SHALL ignore responses to queries the user has already typed past.

#### Scenario: Stale response discarded
- **WHEN** the user types `@ab` then `@abc` and the response for `ab` arrives after the response for `abc`
- **THEN** the list shows only the results for `abc`

#### Scenario: Index still building
- **WHEN** the agent reports the workspace index is not ready
- **THEN** the list shows an indexing state instead of an empty result, and retries once the index is ready or the query changes

### Requirement: Completion is keyboard-operable
While the list is open, ArrowUp/ArrowDown SHALL move the selection, Enter and Tab SHALL accept the selected entry, and Escape SHALL close the list without changing the prompt. While the list is open these keys SHALL NOT send the prompt or cycle the session mode.

#### Scenario: Enter accepts instead of sending
- **WHEN** the list is open and the user presses Enter
- **THEN** the selected entry is inserted and the prompt is not sent

#### Scenario: Escape closes
- **WHEN** the list is open and the user presses Escape
- **THEN** the list closes, the typed `@query` text remains, and no mention is recorded

### Requirement: Accepting an entry inserts a visible mention
Accepting an entry SHALL replace the `@query` token with `@<path relative to cwd>` followed by a space and SHALL record a mention binding that text to the entry's absolute path on the agent's machine. Accepting a directory SHALL insert `@<dir>/`; Tab on a directory SHALL keep the list open to drill into it.

#### Scenario: File accepted
- **WHEN** the user accepts `src/lib/a.ts` from `@a.t` in cwd `/repo`
- **THEN** the prompt contains `@src/lib/a.ts ` and a mention for `/repo/src/lib/a.ts` is recorded

#### Scenario: Directory drill-down
- **WHEN** the user presses Tab on directory `src/lib`
- **THEN** the prompt contains `@src/lib/` and the list shows entries under `src/lib`

### Requirement: Mentions are sent as resource links
On send, the prompt SHALL contain the full text block unchanged plus one ACP `resource_link` block per distinct mention still present in the text. Each link SHALL have an absolute `file://` URI on the agent's machine and the file name as `name`. This SHALL apply to new prompts, steer, and queue. A mention whose text the user edited or deleted SHALL NOT be sent.

#### Scenario: Prompt with two mentions
- **WHEN** the user sends `compare @a.ts and @b.ts` in cwd `/repo`
- **THEN** the prompt is one text block followed by `resource_link` blocks for `file:///repo/a.ts` and `file:///repo/b.ts`

#### Scenario: Duplicate mention
- **WHEN** the same file is mentioned twice
- **THEN** exactly one `resource_link` is sent for it

#### Scenario: Mention text edited away
- **WHEN** the user accepts `@a.ts` and then deletes that text before sending
- **THEN** no `resource_link` for `a.ts` is sent

### Requirement: Mentions render as file chips in the transcript
User messages containing `resource_link` blocks SHALL display a chip per link showing the file name and full path, both in the optimistic message and in the agent's echo or replayed history, without duplicating the message. Embedded resource content the agent attached for a mention SHALL NOT be shown as user-authored text.

#### Scenario: Optimistic echo reconciles
- **WHEN** a prompt with a mention is sent and the agent echoes the user message
- **THEN** the transcript shows one user message with one file chip

#### Scenario: History replay
- **WHEN** a session containing a mention prompt is reopened
- **THEN** the user message shows the same file chip
