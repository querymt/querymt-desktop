import { resource } from 'runed';
import type { MentionEntry, MentionQuerySource, MentionTarget } from '$lib/domain/mention-controller';

export type MentionQueryStatus = 'idle' | 'loading' | 'ready' | 'not_ready' | 'error';

export const MENTION_QUERY_DEBOUNCE_MS = 80;
export const MENTION_POLL_INTERVAL_MS = 1000;
export const MENTION_RESULT_LIMIT = 50;

interface QueryResult {
  key: string;
  status: 'ready' | 'not_ready';
  entries: MentionEntry[];
  truncated: boolean;
}

export interface MentionQueryOptions {
  source: () => MentionQuerySource | null;
  /** Null disables the query (no session, remote launch target, ...). */
  target: () => MentionTarget | null;
  /** The text after `@`, or null while the list is closed. */
  query: () => string | null;
}

function abortError(): DOMException {
  return new DOMException('Superseded mention query', 'AbortError');
}

function requestKey(target: MentionTarget, query: string): string {
  return `${target.session_id ? `s:${target.session_id}` : `c:${target.cwd}`}\u0000${query}`;
}

/**
 * Debounced, stale-safe completion query on runed `resource()`. Must be created
 * during component initialisation (it registers effects).
 *
 * runed stores a late result unless the fetcher throws, and ACP extension calls
 * cannot be cancelled on the wire, so the fetcher re-checks after awaiting that
 * it was not aborted and that the inputs still match, and throws an
 * `AbortError` (which runed ignores) otherwise.
 */
export function createMentionQuery(options: MentionQueryOptions) {
  const latestKey = () => {
    const target = options.target();
    const query = options.query();
    return target && query !== null && options.source() ? requestKey(target, query) : null;
  };

  const result = resource(
    [options.source, options.target, options.query],
    async ([source, target, query], _previous, { signal }): Promise<QueryResult | null> => {
      if (!source || !target || query === null) return null;
      const key = requestKey(target, query);
      const response = await source.query({ ...target, query, limit: MENTION_RESULT_LIMIT });
      if (signal.aborted || latestKey() !== key) throw abortError();
      return {
        key,
        status: response.status,
        truncated: response.truncated,
        entries: response.entries.map((entry) => ({
          path: entry.path,
          uri: entry.uri,
          name: entry.name,
          isDir: entry.is_dir
        }))
      };
    },
    { debounce: MENTION_QUERY_DEBOUNCE_MS }
  );

  const currentResult = () => {
    const current = result.current;
    // Results for another target/query are stale; never present them as current.
    return current && current.key === latestKey() ? current : null;
  };

  const status = (): MentionQueryStatus => {
    const key = latestKey();
    if (key === null) return 'idle';
    if (result.error) return 'error';
    return currentResult()?.status ?? 'loading';
  };

  // `indexReady` for the matching session re-queries an open, not-ready list.
  $effect(() => {
    const source = options.source();
    if (!source) return;
    return source.onIndexReady((notification) => {
      const target = options.target();
      if (!target?.session_id || target.session_id !== notification.session_id) return;
      if (options.query() === null) return;
      void result.refetch();
    });
  });

  // A cwd-only query has no session to notify it: re-poll while open and not ready.
  $effect(() => {
    const target = options.target();
    if (!target?.cwd || options.query() === null || status() !== 'not_ready') return;
    const timer = setInterval(() => void result.refetch(), MENTION_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  return {
    get status() {
      return status();
    },
    get entries(): MentionEntry[] {
      return currentResult()?.entries ?? [];
    },
    get truncated() {
      return currentResult()?.truncated ?? false;
    },
    refetch: () => result.refetch()
  };
}
