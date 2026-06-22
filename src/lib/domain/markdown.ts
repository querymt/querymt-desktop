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

function highlightCode(code: string, language: string): string {
  const escaped = escapeHtml(code);
  const normalized = language.toLowerCase();

  if (['ts', 'tsx', 'js', 'jsx', 'javascript', 'typescript'].includes(normalized)) {
    return escaped
      .replace(/\b(const|let|var|function|return|async|await|import|from|export|type|interface|class|new|if|else|for|while|try|catch)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|'[^']*?'|`[^`]*?`)/g, '<span class="tok-string">$1</span>')
      .replace(/\b(true|false|null|undefined)\b/g, '<span class="tok-literal">$1</span>');
  }

  if (['rs', 'rust'].includes(normalized)) {
    return escaped
      .replace(/\b(fn|let|mut|pub|impl|struct|enum|trait|use|mod|match|if|else|for|while|loop|async|await|return|Self|self)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(&quot;[^&]*?&quot;)/g, '<span class="tok-string">$1</span>');
  }

  if (['sh', 'bash', 'zsh', 'shell'].includes(normalized)) {
    return escaped
      .replace(/\b(cd|ls|git|npm|cargo|pnpm|yarn|echo|export|source)\b/g, '<span class="tok-keyword">$1</span>')
      .replace(/(#.*)$/gm, '<span class="tok-comment">$1</span>');
  }

  return escaped;
}

function renderCodeBlock(code: string, language: string): string {
  const langClass = language ? ` language-${escapeHtml(language)}` : '';
  const label = language ? escapeHtml(language) : '';
  const header = `<div class="code-block-header"><span class="code-block-language">${label}</span><button class="code-block-copy" type="button" data-code-copy aria-label="Copy code">Copy</button></div>`;
  return `<div class="code-block-shell">${header}<pre><code class="${langClass.trim()}">${highlightCode(code.trimEnd(), language)}</code></pre></div>`;
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