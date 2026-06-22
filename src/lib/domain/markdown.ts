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

function renderCodeBlock(code: string, language: string): string {
  const langClass = language ? ` language-${escapeHtml(language)}` : '';
  const label = language ? escapeHtml(language) : '';
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
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, MARKDOWN_PURIFY_CONFIG);
}