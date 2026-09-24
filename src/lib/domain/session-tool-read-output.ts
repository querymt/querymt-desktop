// Parses the structured outputs emitted by file/symbol reading tools.
//
// read_tool emits the tagged shape:
//
//   <path>/Users/me/project/src/app.ts</path>
//   <type>file</type>
//   <content>
//   00141|     use kameo::error::RemoteSendError;
//   (File has more lines. Use 'offset' parameter to read beyond line 215)
//   </content>
//
// get_function / get_symbol emit an untagged, possibly multi-file shape:
//
//   /Users/me/project/src/app.ts
//   - alpha [1-3] hash=... bytes=... lines=3
//   00001| fn alpha() {
//   00002|     println!("a");
//   00003| }
//
//   /Users/me/project/src/other.ts
//   - beta kind=function [1-2] hash=... bytes=... lines=2
//   00001| export const beta = 1;
//
// In both shapes line numbers sit before the first `|` of each numbered line;
// the remainder is the source text. Anything that does not match either shape
// returns null so the caller can fall back to rendering the raw text.

export type ReadFileOutputLine = {
  /** Line number as printed in the gutter (e.g. "00141"), or null for non-code rows. */
  lineNumber: string | null;
  /** Text after the line-number separator, with leading whitespace preserved. */
  text: string;
};

export type ReadFileOutputSection = {
  /** File path shown as the section label (or in the meta bar for single-section views). */
  path: string;
  lines: ReadFileOutputLine[];
  truncated: boolean;
};

export type ReadFileOutputView = {
  /** Primary path for the meta bar (first section path). */
  path: string;
  type: 'file' | 'directory' | 'other';
  sections: ReadFileOutputSection[];
  /** True when any section reported the source has more lines beyond the excerpt. */
  truncated: boolean;
};

const TRUNCATION_PREFIX = '(File has more lines.';

export function parseReadFileOutput(result: string | null | undefined): ReadFileOutputView | null {
  // Normalize line endings first so `\r\n` cannot leak into parsed text.
  const text = result?.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  const tagged = parseTaggedOutput(text);
  if (tagged) return tagged;

  return parseUntaggedOutput(text);
}

/**
 * Parses the tagged read_tool shape. The tags are anchored: the output must
 * start with `<path>`, header tags (`type`) are only read from the region
 * before the content block, and the content spans from the first
 * `<content>` to the last `</content>` — files that themselves contain those
 * tag strings must not corrupt the extraction.
 */
function parseTaggedOutput(text: string): ReadFileOutputView | null {
  if (!text.startsWith('<path>')) return null;
  const pathEnd = text.indexOf('</path>');
  if (pathEnd === -1) return null;
  const path = text.slice('<path>'.length, pathEnd).trim();
  if (!path) return null;

  const contentStart = text.indexOf('<content>', pathEnd);
  const headerRegion = contentStart === -1 ? text : text.slice(0, contentStart);
  const contentType = headerTagValue(headerRegion, 'type');
  if (contentStart === -1 && !contentType) return null;

  const type = contentType === 'file' || contentType === 'directory' ? contentType : 'other';
  const lines: ReadFileOutputLine[] = [];
  let truncated = false;

  if (contentStart !== -1) {
    const content = extractContent(text, contentStart);
    if (content !== null) {
      for (const rawLine of content.split('\n')) {
        if (rawLine.startsWith(TRUNCATION_PREFIX)) {
          truncated = true;
          continue;
        }
        lines.push(splitNumberedLine(rawLine));
      }
      trimTrailingBlankLines(lines);
    }
  }

  return {
    path,
    type,
    sections: [{ path, lines, truncated }],
    truncated
  };
}

function extractContent(text: string, contentStart: number): string | null {
  const bodyStart = contentStart + '<content>'.length;
  const closing = text.lastIndexOf('</content>');
  if (closing < bodyStart) return null;
  // Drop the single newline that directly follows the opening tag; the
  // tool always emits one before the first numbered row.
  let content = text.slice(bodyStart, closing);
  if (content.startsWith('\n')) content = content.slice(1);
  return content;
}

function headerTagValue(region: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(region);
  if (!match) return null;
  return match[1]!.trim();
}

/**
 * Parses the untagged get_function/get_symbol shape: sections introduced by an
 * absolute path line followed by `- ` metadata headers and `NNNNN|` numbered
 * rows. Returns null unless the text clearly matches (first line is a path
 * header and at least one numbered row exists).
 */
function parseUntaggedOutput(text: string): ReadFileOutputView | null {
  const lines = text.split('\n');
  const sections: ReadFileOutputSection[] = [];
  let current: ReadFileOutputSection | null = null;
  let sawNumberedLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] ?? '';
    if (isSectionHeader(line, next)) {
      current = { path: line.trim(), lines: [], truncated: false };
      sections.push(current);
      continue;
    }
    if (!current) return null;

    const numbered = matchNumberedLine(line);
    if (numbered) sawNumberedLine = true;
    current.lines.push(numbered ?? { lineNumber: null, text: line });
  }

  if (sections.length === 0 || !sawNumberedLine) return null;
  for (const section of sections) trimTrailingBlankLines(section.lines);

  return { path: sections[0]!.path, type: 'file', sections, truncated: false };
}

function isSectionHeader(line: string, next: string): boolean {
  if (!line.startsWith('/') || line.includes('|')) return false;
  return next.startsWith('- ') || Boolean(matchNumberedLine(next));
}

/**
 * Numbered rows must start with digits before the first `|`; anything else
 * (Markdown tables, gutter-less shell lines containing pipes) keeps its raw
 * text and renders with an empty gutter instead of a broken index number.
 */
function splitNumberedLine(rawLine: string): ReadFileOutputLine {
  return matchNumberedLine(rawLine) ?? { lineNumber: null, text: rawLine };
}

/** Numbered rows must start with digits before the `|`; free text is left alone. */
function matchNumberedLine(line: string): ReadFileOutputLine | null {
  const separator = line.indexOf('|');
  if (separator <= 0) return null;
  const lineNumber = line.slice(0, separator).trim();
  if (!/^\d+$/.test(lineNumber)) return null;
  return { lineNumber, text: line.slice(separator + 1) };
}

function trimTrailingBlankLines(lines: ReadFileOutputLine[]): void {
  while (lines.length > 0 && lines[lines.length - 1]!.text === '' && lines[lines.length - 1]!.lineNumber === null) {
    lines.pop();
  }
}
