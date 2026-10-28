export const EDIT_TOOLS = new Set(['edit', 'multiedit', 'replace_symbol', 'write_file']);

export function isEditToolName(name: string): boolean {
  return EDIT_TOOLS.has(name);
}

export function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function optionalString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === 'string') return value[key];
  }
  return null;
}

/**
 * Reads an array of objects. Historical records written before argument
 * normalisation may hold the array as a JSON string (a model mistake that is now
 * repaired before execution), so a string that decodes to an array is accepted.
 */
export function asObjectArray(value: unknown): Record<string, unknown>[] | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const items = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  return items.length > 0 ? items : null;
}

export function splitLines(value: string): string[] {
  if (!value) return [];
  return value.endsWith('\n') ? value.slice(0, -1).split('\n') : value.split('\n');
}

export function countLines(value: string): number {
  return splitLines(value).length;
}

/**
 * Tool arguments are read in both naming styles: canonical snake_case (current
 * effective records) and historical camelCase / short forms (records stored before
 * the canonical naming release, which are never rewritten).
 */
export function toolFilePath(value: Record<string, unknown>): string {
  return stringValue(value.path) || stringValue(value.filePath) || stringValue(value.file_path) || stringValue(value.file);
}

export function replacementPair(value: Record<string, unknown>): { oldText: string; newText: string } | null {
  const oldText = optionalString(value, ['old_string', 'oldString', 'old_str', 'oldText', 'old_text']);
  const newText = optionalString(value, ['new_string', 'newString', 'new_str', 'newText', 'new_text']);
  if (oldText === null && newText === null) return null;
  return { oldText: oldText ?? '', newText: newText ?? '' };
}
