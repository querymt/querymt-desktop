import { getContext, setContext } from 'svelte';

export type ToolContentPart = 'result' | 'arguments';

/** Fetches the complete result or arguments of a tool call a load truncated. */
export type ToolContentFetcher = (toolCallId: string, part: ToolContentPart) => Promise<string>;

export const TOOL_CONTENT_CONTEXT_KEY = Symbol('session-tool-content');
const KEY = TOOL_CONTENT_CONTEXT_KEY;

/** Provide the fetcher through a getter so prop changes stay reactive. */
export function provideToolContentFetcher(read: () => ToolContentFetcher | null | undefined): void {
  setContext(KEY, read);
}

export function useToolContentFetcher(): () => ToolContentFetcher | null {
  const read = getContext<(() => ToolContentFetcher | null | undefined) | undefined>(KEY);
  return () => read?.() ?? null;
}
