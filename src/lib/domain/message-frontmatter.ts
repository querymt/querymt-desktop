import { isMap, parseDocument } from 'yaml';

export type MessageFrontMatter = {
  /** Exact prefix, including delimiters and original line endings. */
  source: string;
  yaml: string;
};

export function extractMessageFrontMatter(text: string): { body: string; frontMatter: MessageFrontMatter | null } {
  const opening = /^\uFEFF?---[\t ]*\r?\n/.exec(text);
  if (!opening) return { body: text, frontMatter: null };

  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(text);
  // An incomplete prefix may still be ordinary Markdown; never swallow its body.
  if (!match) return { body: text, frontMatter: null };

  const end = match.index + match[0].length;
  return {
    body: text.slice(end),
    frontMatter: { source: text.slice(0, end), yaml: text.slice(opening[0].length, match.index) }
  };
}

/** Validation is for explicit developer inspection, not a prerequisite for hiding metadata. */
export function validateMessageFrontMatter(source: string): string | null {
  if (source.length > 64 * 1024) return 'Metadata is too large to validate (limit: 65,536 characters). Raw YAML is preserved below.';
  try {
    const document = parseDocument(source, { schema: 'core', strict: true, uniqueKeys: true });
    const issues = [...document.errors, ...document.warnings];
    if (issues.length) return issues.map((issue) => issue.message).join('\n');
    if (!isMap(document.contents)) return 'Expected a YAML mapping of metadata keys and values.';
    // Inspect the syntax tree only: do not construct objects or expand YAML aliases.
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Unable to validate YAML metadata.';
  }
}
