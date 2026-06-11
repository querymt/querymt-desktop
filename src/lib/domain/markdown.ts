function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function applyInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function renderMarkdownToHtml(markdown: string): string {
  const source = markdown.replace(/\r\n/g, '\n');
  const blocks: string[] = [];
  let cursor = 0;

  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  for (const match of source.matchAll(fencePattern)) {
    const index = match.index ?? 0;
    blocks.push(renderMarkdownBlocks(source.slice(cursor, index)));
    blocks.push(renderCodeBlock(match[2] ?? '', match[1]?.trim() ?? ''));
    cursor = index + match[0].length;
  }
  blocks.push(renderMarkdownBlocks(source.slice(cursor)));

  return blocks.join('');
}

function renderCodeBlock(code: string, language: string): string {
  const langClass = language ? ` language-${escapeHtml(language)}` : '';
  const label = language ? `<div class="code-block-header">${escapeHtml(language)}</div>` : '';
  return `<div class="code-block-shell">${label}<pre><code class="${langClass.trim()}">${highlightCode(code.trimEnd(), language)}</code></pre></div>`;
}

function renderMarkdownBlocks(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const blocks = escaped.split(/\n\s*\n+/);

  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      const lines = trimmed.split('\n');
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        const items = lines
          .map((line) => line.replace(/^[-*]\s+/, ''))
          .map((line) => `<li>${applyInlineMarkdown(line)}</li>`)
          .join('');
        return `<ul>${items}</ul>`;
      }

      if (/^#{1,4}\s+/.test(lines[0])) {
        const level = Math.min(4, lines[0].match(/^#+/)?.[0].length ?? 1);
        const content = lines[0].replace(/^#{1,4}\s+/, '');
        return `<h${level}>${applyInlineMarkdown(content)}</h${level}>`;
      }

      return `<p>${applyInlineMarkdown(lines.join('<br />'))}</p>`;
    })
    .join('');
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
