export const WORKSPACE_SUGGESTION_LIMIT = 8;

/**
 * Paths offered when a workspace input is empty: workspaces the user saved on the Workspaces
 * page first, then folders recently used for sessions. Duplicates (ignoring trailing slashes)
 * are dropped, keeping the first occurrence, and the list is capped.
 */
export function mergeWorkspaceSuggestions(
  saved: ReadonlyArray<{ path: string }>,
  recent: readonly string[],
  limit = WORKSPACE_SUGGESTION_LIMIT
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...saved.map((item) => item.path), ...recent]) {
    const path = raw.trim();
    if (!path) continue;
    const key = path.length > 1 ? path.replace(/\/+$/, '') : path;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(path);
    if (merged.length >= limit) break;
  }
  return merged;
}
