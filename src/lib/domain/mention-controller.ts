/**
 * Pure model for `@` file mentions in the composer. It does no fetching and
 * holds no framework state: the composer owns the text, the caret and the list
 * of accepted mentions, and asks this module what to do with them.
 */

import type {
  QuerymtWorkspaceFilesRequest,
  QuerymtWorkspaceFilesResponse,
  QuerymtWorkspaceIndexReadyNotification
} from '$lib/querymt/querymt-extensions';

/** Where completions come from: the connected agent's workspace file query. */
export interface MentionQuerySource {
  query(request: QuerymtWorkspaceFilesRequest): Promise<QuerymtWorkspaceFilesResponse>;
  /** Subscribes to `querymt/workspace/indexReady`; returns an unsubscribe function. */
  onIndexReady(handler: (notification: QuerymtWorkspaceIndexReadyNotification) => void): () => void;
}

/** Exactly one of `session_id` (active session) or `cwd` (local launch target). */
export type MentionTarget = { session_id: string; cwd?: undefined } | { cwd: string; session_id?: undefined };

/** A completion entry as returned by the agent (`querymt/workspace/files`). */
export interface MentionEntry {
  /** `/`-separated path relative to the query cwd. */
  path: string;
  /** Agent-built `file://` URI, sent verbatim as a `resource_link`. */
  uri: string;
  name: string;
  isDir: boolean;
}

/** A mention the user accepted: the exact prompt text bound to its agent-provided URI. */
export interface AcceptedMention {
  text: string;
  uri: string;
  name: string;
  isDir: boolean;
}

/** The `@query` token under the caret. `[start, end)` is the range to replace. */
export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
  quoted: boolean;
}

export type MentionAcceptKey = 'enter' | 'tab';

export interface MentionAcceptResult {
  text: string;
  caret: number;
  mentions: AcceptedMention[];
  /** True after a directory drill-down: the list stays open and queries inside it. */
  keepOpen: boolean;
}

const MAX_TOKEN_SCAN = 512;
const TRAILING_PUNCTUATION = new Set([',', ';', ':', '!', '?', ')', '.']);

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

/**
 * Detects an `@` mention token ending at `caret`. The `@` must start the text or
 * follow whitespace, so `foo@bar.com` never triggers. The query is the run of
 * non-whitespace characters up to the caret; after `@"` it may contain spaces
 * until the closing quote.
 */
export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret < 0 || caret > text.length) return null;
  const limit = Math.max(0, caret - MAX_TOKEN_SCAN);
  for (let i = caret - 1; i >= limit; i -= 1) {
    const char = text[i];
    if (char === '\n') return null;
    if (char !== '@') continue;
    if (i > 0 && !isWhitespace(text[i - 1])) continue;
    const segment = text.slice(i + 1, caret);
    const quoted = segment.startsWith('"');
    if (quoted ? segment.slice(1).includes('"') : /\s/.test(segment)) return null;
    let end = caret;
    if (!quoted) while (end < text.length && !isWhitespace(text[end])) end += 1;
    return { start: i, end, query: quoted ? segment.slice(1) : segment, quoted };
  }
  return null;
}

function displayPath(entry: MentionEntry): string {
  const base = entry.path.replace(/\/+$/, '');
  return entry.isDir ? `${base}/` : base;
}

/** Text inserted for an entry. Paths with whitespace use the quoted form `@"path"`. */
export function mentionText(entry: MentionEntry): string {
  const path = displayPath(entry);
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/**
 * Applies an accepted entry to the prompt text.
 *
 * - Enter, or Tab on a file: inserts `@<path> ` and records the mention.
 * - Tab on a directory: inserts `@<dir>/` with no space, records nothing and
 *   keeps the list open so it can query inside the directory.
 */
export function acceptMention(
  text: string,
  trigger: MentionTrigger,
  entry: MentionEntry,
  key: MentionAcceptKey,
  mentions: AcceptedMention[]
): MentionAcceptResult {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);

  if (entry.isDir && key === 'tab') {
    const path = displayPath(entry);
    // An unclosed quote keeps the token open while drilling into a spaced path.
    const inserted = /\s/.test(path) ? `@"${path}` : `@${path}`;
    return { text: before + inserted + after, caret: before.length + inserted.length, mentions, keepOpen: true };
  }

  const inserted = mentionText(entry);
  const separator = isWhitespace(after[0]) ? '' : ' ';
  const caretOffset = before.length + inserted.length + (isWhitespace(after[0]) ? 1 : separator.length);
  const next: AcceptedMention = { text: inserted, uri: entry.uri, name: entry.name, isDir: entry.isDir };
  return {
    text: `${before}${inserted}${separator}${after}`,
    caret: caretOffset,
    mentions: [...mentions.filter((mention) => mention.uri !== entry.uri || mention.text !== inserted), next],
    keepOpen: false
  };
}

/** True when `mention.text` appears in `text` as a whole token. */
export function mentionIsPresent(text: string, mention: string): boolean {
  if (!mention) return false;
  let from = 0;
  for (;;) {
    const index = text.indexOf(mention, from);
    if (index < 0) return false;
    from = index + 1;
    if (index > 0 && !isWhitespace(text[index - 1])) continue;
    const end = index + mention.length;
    const next = text[end];
    if (next === undefined || isWhitespace(next)) return true;
    if (TRAILING_PUNCTUATION.has(next)) {
      const afterPunctuation = text[end + 1];
      if (afterPunctuation === undefined || isWhitespace(afterPunctuation)) return true;
    }
  }
}

/** Recorded mentions still present in `text`, de-duplicated by URI. */
export function extractActiveMentions(text: string, mentions: AcceptedMention[]): AcceptedMention[] {
  const seen = new Set<string>();
  const active: AcceptedMention[] = [];
  for (const mention of mentions) {
    if (seen.has(mention.uri) || !mentionIsPresent(text, mention.text)) continue;
    seen.add(mention.uri);
    active.push(mention);
  }
  return active;
}

/** Keyboard state for the open completion list; the composer renders it. */
export class MentionController {
  trigger: MentionTrigger | null = null;
  selectedIndex = 0;
  /** Set when the user pressed Escape; suppresses the list until the token changes. */
  private dismissedKey: string | null = null;

  /** Recomputes the token for the current text and caret; resets selection when the query changes. */
  update(text: string, caret: number): MentionTrigger | null {
    const next = detectMentionTrigger(text, caret);
    const key = next ? `${next.start}:${next.query}` : null;
    const previousKey = this.trigger ? `${this.trigger.start}:${this.trigger.query}` : null;
    if (key !== previousKey) this.selectedIndex = 0;
    // Escape only suppresses the token it was pressed on; leaving the token re-arms the list.
    if (!next || (this.dismissedKey !== null && key !== this.dismissedKey)) this.dismissedKey = null;
    this.trigger = next;
    return this.isOpen ? next : null;
  }

  get isOpen(): boolean {
    if (!this.trigger) return false;
    return this.dismissedKey !== `${this.trigger.start}:${this.trigger.query}`;
  }

  dismiss() {
    if (this.trigger) this.dismissedKey = `${this.trigger.start}:${this.trigger.query}`;
  }

  /** Moves the selection by `delta`, wrapping within `count` entries. */
  move(delta: number, count: number) {
    if (count <= 0) {
      this.selectedIndex = 0;
      return;
    }
    this.selectedIndex = (((this.selectedIndex + delta) % count) + count) % count;
  }

  accept(
    text: string,
    entries: MentionEntry[],
    key: MentionAcceptKey,
    mentions: AcceptedMention[]
  ): MentionAcceptResult | null {
    const entry = entries[this.selectedIndex];
    if (!this.trigger || !this.isOpen || !entry) return null;
    this.selectedIndex = 0;
    return acceptMention(text, this.trigger, entry, key, mentions);
  }

  reset() {
    this.trigger = null;
    this.selectedIndex = 0;
    this.dismissedKey = null;
  }
}
