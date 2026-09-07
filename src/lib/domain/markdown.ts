import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Assistant content sometimes writes fence meta as `start:end:path` or
// `start:path`; display it as `path:start-end` so the file leads the label.
// Anything else (plain language, `path:start-end`) passes through unchanged.
export function normalizeCodeFenceMeta(meta: string): string {
  const trimmed = meta.trim();
  const linesFirst = /^(\d{1,6})(?::(\d{1,6}))?:(.+)$/.exec(trimmed);
  if (!linesFirst) return trimmed;
  const [, start, end, path] = linesFirst;
  return end ? `${path}:${start}-${end}` : `${path}:${start}`;
}

// Rewrites lines-first fence info strings (` ```496:499:path `) inside raw
// markdown to `path:start-end`, so copied markdown matches the rendered
// labels. Only opening fences with lines-first info are touched.
export function normalizeMarkdownCodeFences(markdown: string): string {
  if (!/^[ \t]{0,3}[`~]{3,}\d/m.test(markdown)) return markdown;

  const lines = markdown.split('\n');
  let open: { char: string; length: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!match) continue;
    const [, indent, marker, info] = match;
    if (!open) {
      open = { char: marker[0], length: marker.length };
      const normalized = normalizeCodeFenceMeta(info);
      if (normalized !== info) lines[i] = `${indent}${marker}${normalized}`;
    } else if (marker[0] === open.char && marker.length >= open.length && info.trim() === '') {
      open = null;
    }
  }
  return lines.join('\n');
}

function renderCodeBlock(code: string, language: string): string {
  const langClass = language ? ` language-${escapeHtml(language)}` : '';
  const label = language ? escapeHtml(normalizeCodeFenceMeta(language)) : '';
  const header = `<div class="code-block-header"><span class="code-block-language">${label}</span><button class="code-block-copy" type="button" data-code-copy aria-label="Copy code">Copy</button></div>`;
  return `<div class="code-block-shell">${header}<pre><code class="${langClass.trim()}">${escapeHtml(code.trimEnd())}</code></pre></div>`;
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      return renderCodeBlock(text, lang ?? '');
    },
    table(token) {
      let header = '';
      let cell = '';
      for (let j = 0; j < token.header.length; j++) {
        cell += this.tablecell(token.header[j]);
      }
      header += this.tablerow({ text: cell });

      let body = '';
      for (let j = 0; j < token.rows.length; j++) {
        const row = token.rows[j];
        cell = '';
        for (let k = 0; k < row.length; k++) {
          cell += this.tablecell(row[k]);
        }
        body += this.tablerow({ text: cell });
      }
      if (body) body = `<tbody>${body}</tbody>`;

      const tableHtml = `<table>\n<thead>\n${header}</thead>\n${body}</table>\n`;
      return `<div class="markdown-table-wrap">${tableHtml}</div>`;
    }
  }
});

const MARKDOWN_CACHE_LIMIT = 256;
const markdownHtmlCache = new Map<string, string>();

export type StreamingMarkdownParts = {
  frozenHtml: string;
  tailText: string;
};

const MARKDOWN_PURIFY_CONFIG = {
  ADD_ATTR: ['target', 'rel', 'class', 'type', 'data-code-copy', 'aria-label'],
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'hr',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'del',
    'span',
    'button',
    'div'
  ]
};

export function renderMarkdownToHtml(markdown: string): string {
  const source = markdown.replace(/\r\n/g, '\n');
  const cached = markdownHtmlCache.get(source);
  if (cached !== undefined) return cached;

  const raw = marked.parse(source, { async: false }) as string;
  const html = DOMPurify.sanitize(raw, MARKDOWN_PURIFY_CONFIG);
  markdownHtmlCache.set(source, html);
  if (markdownHtmlCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownHtmlCache.keys().next().value;
    if (oldest !== undefined) markdownHtmlCache.delete(oldest);
  }
  return html;
}

function parseFenceMarker(line: string): { char: '`' | '~'; length: number; info: string } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[2];
  return { char: marker[0] as '`' | '~', length: marker.length, info: match[3] };
}

function findUnclosedFenceIndex(source: string): number {
  let fenceStart = -1;
  let open: { char: '`' | '~'; length: number } | null = null;
  let offset = 0;
  while (offset <= source.length) {
    const lineEnd = source.indexOf('\n', offset);
    const end = lineEnd === -1 ? source.length : lineEnd;
    const line = source.slice(offset, end);
    const marker = parseFenceMarker(line);
    if (marker) {
      if (!open) {
        open = marker;
        fenceStart = offset;
      } else if (
        marker.char === open.char &&
        marker.length >= open.length &&
        marker.info.trim() === ''
      ) {
        open = null;
        fenceStart = -1;
      }
    }
    if (lineEnd === -1) break;
    offset = lineEnd + 1;
  }
  return fenceStart;
}

export function splitStreamingMarkdown(markdown: string): StreamingMarkdownParts {
  const source = markdown.replace(/\r\n/g, '\n');
  const fenceStart = findUnclosedFenceIndex(source);
  let frozenMarkdown = '';
  let tailText = source;

  if (fenceStart >= 0) {
    frozenMarkdown = source.slice(0, fenceStart).replace(/\n+$/, '');
    tailText = source.slice(fenceStart);
  } else {
    const splitAt = source.lastIndexOf('\n\n');
    if (splitAt === -1) {
      frozenMarkdown = '';
      tailText = source;
    } else {
      frozenMarkdown = source.slice(0, splitAt);
      tailText = source.slice(splitAt + 2);
    }
  }

  return {
    frozenHtml: frozenMarkdown.trim() ? renderMarkdownToHtml(frozenMarkdown) : '',
    tailText
  };
}