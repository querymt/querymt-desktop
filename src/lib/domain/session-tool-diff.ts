import { structuredPatch } from 'diff';
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

type ReplacementEdit = { oldText: string; newText: string };

type SnippetHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  added: number;
  deleted: number;
  lines: string[];
};

type ReceiptHunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  added: number;
  deleted: number;
};

export function buildSessionToolDiffs(
  name: string,
  status: SessionToolCallItem['status'],
  rawArguments: string | null | undefined,
  rawResult?: string | null
): SessionToolDiffFile[] {
  if (status !== 'completed' || !isEditToolName(name)) return [];
  const args = parseObject(rawArguments);
  if (!args || !isSuccessfulToolResult(name, args, rawResult)) return [];

  if (name === 'write_file') {
    const file = buildWriteFilePatch(args);
    return file ? [file] : [];
  }

  return buildReplacementPatches(args, parseEditReceipt(rawResult));
}

function isSuccessfulToolResult(
  name: string,
  args: Record<string, unknown>,
  rawResult?: string | null
): boolean {
  const result = rawResult?.trim();
  if (!result) return true;
  if (name === 'edit' || name === 'multiedit') return result.startsWith('OK ');
  if (name === 'replace_symbol')
    return result.startsWith('OK ') || /^Updated [1-9]\d* symbol\(s\)\.(?:\r?\n|$)/.test(result);
  if (name === 'write_file') return result.startsWith('OK ') || isWriteFileJsonResult(args, result);
  return false;
}

function isWriteFileJsonResult(args: Record<string, unknown>, result: string): boolean {
  try {
    const parsed: unknown = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    const requestedPath = toolFilePath(args);
    if (!requestedPath) return false;
    return (
      typeof record.path === 'string' &&
      record.path.trim() !== '' &&
      typeof record.bytes === 'number' &&
      Number.isFinite(record.bytes) &&
      record.bytes >= 0 &&
      normalizePatchPath(record.path.trim()) === normalizePatchPath(requestedPath)
    );
  } catch {
    return false;
  }
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

function buildReplacementPatches(
  args: Record<string, unknown>,
  receipts: Map<string, ReceiptHunk[]> | null
): SessionToolDiffFile[] {
  const parentPath = toolFilePath(args) || 'file';
  const grouped = new Map<string, ReplacementEdit[]>();
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
    const patch = buildUnifiedPatch(path, edits, receipts?.get(normalizePatchPath(path)) ?? []);
    if (patch) files.push({ path, patch });
  }
  return files;
}

function pushEdit(grouped: Map<string, ReplacementEdit[]>, path: string, pair: ReplacementEdit) {
  const current = grouped.get(path);
  if (current) current.push(pair);
  else grouped.set(path, [pair]);
}

function buildUnifiedPatch(path: string, edits: ReplacementEdit[], receipts: ReceiptHunk[]): string | null {
  const snippets: SnippetHunk[] = [];
  for (const edit of edits) {
    const hunk = buildSnippetHunk(edit.oldText, edit.newText);
    if (hunk) snippets.push(hunk);
  }
  if (snippets.length === 0) return null;

  const hunks = tryAnchorHunks(snippets, receipts) ?? snippets;
  const normalizedPath = normalizePatchPath(path);
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    ...hunks.flatMap((hunk) => [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines])
  ].join('\n');
}

function buildSnippetHunk(oldText: string, newText: string): SnippetHunk | null {
  const oldSnippet = normalizeSnippet(oldText);
  const newSnippet = normalizeSnippet(newText);
  let patch;
  try {
    patch = structuredPatch('', '', oldSnippet, newSnippet, undefined, undefined, { context: Infinity });
  } catch {
    return null;
  }
  const hunk = patch.hunks[0];
  if (!hunk) return null;

  const lines = hunk.lines.filter((line) => !line.startsWith('\\'));
  const stats = hunkLineStats(lines);
  return {
    oldStart: hunk.oldLines === 0 ? 0 : hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newLines === 0 ? 0 : hunk.newStart,
    newLines: hunk.newLines,
    added: stats.added,
    deleted: stats.deleted,
    lines
  };
}

function normalizeSnippet(value: string): string {
  if (!value) return '';
  return value.endsWith('\n') ? value : `${value}\n`;
}

function hunkLineStats(lines: string[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of lines) {
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) deleted += 1;
  }
  return { added, deleted };
}

function parseEditReceipt(rawResult?: string | null): Map<string, ReceiptHunk[]> | null {
  const text = rawResult?.trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? '';
  if (!/^OK paths=\d+ edits=\d+ added=\d+ deleted=\d+$/.test(firstLine)) return null;

  const files = new Map<string, ReceiptHunk[]>();
  let currentPath: string | null = null;
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pathMatch = /^P (.+)$/.exec(trimmed);
    if (pathMatch) {
      currentPath = normalizePatchPath(pathMatch[1].trim());
      if (!files.has(currentPath)) files.set(currentPath, []);
      continue;
    }
    const hunkMatch = /^H \S+ old=(\d+),(\d+) new=(\d+),(\d+) \+(\d+) -(\d+)$/.exec(trimmed);
    if (!hunkMatch || !currentPath) continue;
    files.get(currentPath)?.push({
      oldStart: Number(hunkMatch[1]),
      oldCount: Number(hunkMatch[2]),
      newStart: Number(hunkMatch[3]),
      newCount: Number(hunkMatch[4]),
      added: Number(hunkMatch[5]),
      deleted: Number(hunkMatch[6])
    });
  }
  return files;
}

function tryAnchorHunks(snippets: SnippetHunk[], receipts: ReceiptHunk[]): SnippetHunk[] | null {
  if (receipts.length === 0 || snippets.length !== receipts.length) return null;
  if (hasDuplicateSignatures(snippets) || hasDuplicateReceiptSignatures(receipts)) return null;
  if (snippets.every((snippet, index) => signaturesMatch(snippet, receipts[index]!))) {
    return applyReceiptStarts(snippets, receipts);
  }

  const unused = new Set(receipts.map((_, index) => index));
  const matched: Array<{ snippet: SnippetHunk; receiptIndex: number }> = [];
  for (const snippet of snippets) {
    let found = -1;
    for (const index of unused) {
      if (signaturesMatch(snippet, receipts[index]!)) {
        found = index;
        break;
      }
    }
    if (found < 0) return null;
    unused.delete(found);
    matched.push({ snippet, receiptIndex: found });
  }

  matched.sort((left, right) => left.receiptIndex - right.receiptIndex);
  return applyReceiptStarts(
    matched.map((item) => item.snippet),
    matched.map((item) => receipts[item.receiptIndex]!)
  );
}

function applyReceiptStarts(snippets: SnippetHunk[], receipts: ReceiptHunk[]): SnippetHunk[] | null {
  if (!receiptRangesAreValid(receipts)) return null;
  return snippets.map((snippet, index) => {
    const receipt = receipts[index]!;
    return { ...snippet, oldStart: receipt.oldStart, newStart: receipt.newStart };
  });
}

function signaturesMatch(snippet: SnippetHunk, receipt: ReceiptHunk): boolean {
  return (
    snippet.oldLines === receipt.oldCount &&
    snippet.newLines === receipt.newCount &&
    snippet.added === receipt.added &&
    snippet.deleted === receipt.deleted
  );
}

function hasDuplicateSignatures(hunks: SnippetHunk[]): boolean {
  return hasDuplicateKeys(hunks.map(snippetSignatureKey));
}

function hasDuplicateReceiptSignatures(hunks: ReceiptHunk[]): boolean {
  return hasDuplicateKeys(hunks.map(receiptSignatureKey));
}

function snippetSignatureKey(hunk: SnippetHunk): string {
  return `${hunk.oldLines},${hunk.newLines},+${hunk.added}-${hunk.deleted}`;
}

function receiptSignatureKey(hunk: ReceiptHunk): string {
  return `${hunk.oldCount},${hunk.newCount},+${hunk.added}-${hunk.deleted}`;
}

function hasDuplicateKeys(keys: string[]): boolean {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function receiptRangesAreValid(hunks: ReceiptHunk[]): boolean {
  for (let index = 1; index < hunks.length; index += 1) {
    const previous = hunks[index - 1]!;
    const current = hunks[index]!;
    if (hunkSideEnd(previous.oldStart, previous.oldCount) > hunkSideStart(current.oldStart, current.oldCount)) return false;
    if (hunkSideEnd(previous.newStart, previous.newCount) > hunkSideStart(current.newStart, current.newCount)) return false;
  }
  return true;
}

function hunkSideStart(start: number, count: number): number {
  return start - (count === 0 ? 0 : 1);
}

function hunkSideEnd(start: number, count: number): number {
  return hunkSideStart(start, count) + count;
}

function normalizePatchPath(path: string): string {
  return path.replace(/^\/+/, '') || 'file';
}
