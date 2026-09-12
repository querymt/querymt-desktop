import {
  asObjectArray,
  isEditToolName,
  parseObject,
  replacementPair,
  splitLines,
  toolFilePath
} from '$lib/domain/session-tool-args';
import type { SessionToolCallItem } from '$lib/domain/types';

export type SessionToolDiffFile = {
  path: string;
  patch: string;
};

export function buildSessionToolDiffs(
  name: string,
  status: SessionToolCallItem['status'],
  rawArguments: string | null | undefined,
  rawResult?: string | null
): SessionToolDiffFile[] {
  if (status !== 'completed' || !isEditToolName(name)) return [];
  const args = parseObject(rawArguments);
  if (!args) return [];

  const result = rawResult?.trim();
  if (result && !result.startsWith('OK ')) return [];

  if (name === 'write_file') {
    const file = buildWriteFilePatch(args);
    return file ? [file] : [];
  }

  return buildReplacementPatches(args);
}

function buildWriteFilePatch(args: Record<string, unknown>): SessionToolDiffFile | null {
  const content = typeof args.content === 'string' ? args.content : typeof args.contents === 'string' ? args.contents : '';
  if (!content) return null;
  const path = toolFilePath(args) || 'file';
  const normalizedPath = normalizePatchPath(path);
  const lines = splitLines(content);
  const patch = [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`)
  ].join('\n');
  return { path, patch };
}

function buildReplacementPatches(args: Record<string, unknown>): SessionToolDiffFile[] {
  const parentPath = toolFilePath(args) || 'file';
  const grouped = new Map<string, Array<{ oldText: string; newText: string }>>();
  const items = asObjectArray(args.edits) ?? asObjectArray(args.replacements);

  if (items) {
    for (const item of items) {
      const pair = replacementPair(item);
      if (!pair) continue;
      pushEdit(grouped, toolFilePath(item) || parentPath, pair);
    }
  } else {
    const pair = replacementPair(args);
    if (pair) pushEdit(grouped, parentPath, pair);
  }

  const files: SessionToolDiffFile[] = [];
  for (const [path, edits] of grouped) {
    const patch = buildUnifiedPatch(path, edits);
    if (patch) files.push({ path, patch });
  }
  return files;
}

function pushEdit(
  grouped: Map<string, Array<{ oldText: string; newText: string }>>,
  path: string,
  pair: { oldText: string; newText: string }
) {
  const current = grouped.get(path);
  if (current) current.push(pair);
  else grouped.set(path, [pair]);
}

function buildUnifiedPatch(path: string, edits: Array<{ oldText: string; newText: string }>): string | null {
  if (edits.length === 0) return null;
  const normalizedPath = normalizePatchPath(path);
  const hunks: string[] = [];

  for (const { oldText, newText } of edits) {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    if (oldLines.length === 0 && newLines.length === 0) continue;
    // Snippets have no file positions. Keep every hunk at unified-diff
    // origin (line 1, or 0 for an empty side) so Pierre does not invent
    // collapsed gaps from a fake file cursor.
    const oldStart = oldLines.length === 0 ? 0 : 1;
    const newStart = newLines.length === 0 ? 0 : 1;
    hunks.push(
      `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`)
    );
  }

  if (hunks.length === 0) return null;
  return [`diff --git a/${normalizedPath} b/${normalizedPath}`, `--- a/${normalizedPath}`, `+++ b/${normalizedPath}`, ...hunks].join('\n');
}

function normalizePatchPath(path: string): string {
  return path.replace(/^\/+/, '') || 'file';
}
