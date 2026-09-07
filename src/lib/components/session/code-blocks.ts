import { browser } from '$app/environment';

const lightTheme = 'github-light';
const darkTheme = 'github-dark';
let highlighterPromise: Promise<ShikiHighlighter> | null = null;
const loadedLanguages = new Set<HighlightLanguage>();

type ShikiHighlighter = {
  codeToHtml: (
    code: string,
    options: {
      lang: string;
      themes: { light: string; dark: string };
      defaultColor: false;
    }
  ) => string;
  loadLanguage: (...langs: unknown[]) => Promise<void>;
};

type LanguageModule = { default: unknown };

type HighlightLanguage =
  | 'bash'
  | 'c'
  | 'cpp'
  | 'css'
  | 'diff'
  | 'go'
  | 'html'
  | 'java'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'lua'
  | 'markdown'
  | 'nix'
  | 'python'
  | 'ruby'
  | 'rust'
  | 'svelte'
  | 'toml'
  | 'tsx'
  | 'typescript'
  | 'yaml';

const languageLoaders: Record<HighlightLanguage, () => Promise<LanguageModule>> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  lua: () => import('@shikijs/langs/lua'),
  markdown: () => import('@shikijs/langs/markdown'),
  nix: () => import('@shikijs/langs/nix'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  svelte: () => import('@shikijs/langs/svelte'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml')
};

const supportedLanguages = new Set<string>(Object.keys(languageLoaders));

const languageAliases: Record<string, HighlightLanguage> = {
  cplusplus: 'cpp',
  cxx: 'cpp',
  js: 'javascript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash'
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getHighlighter() {
  highlighterPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('@shikijs/themes/github-light'),
    import('@shikijs/themes/github-dark')
  ]).then(async ([{ createHighlighterCore }, { createJavaScriptRegexEngine }, githubLight, githubDark]) => {
    return createHighlighterCore({
      themes: [githubLight.default, githubDark.default],
      langs: [],
      engine: createJavaScriptRegexEngine()
    }) as Promise<ShikiHighlighter>;
  });

  return highlighterPromise;
}

async function loadLanguage(highlighter: ShikiHighlighter, language: HighlightLanguage) {
  if (loadedLanguages.has(language)) return;

  const registration = await languageLoaders[language]();
  await highlighter.loadLanguage(registration.default);
  loadedLanguages.add(language);
}

function normalizeLanguage(language: string): HighlightLanguage | null {
  const normalized = language.trim().toLowerCase().replace(/^language-/, '');
  if (!normalized) return null;

  const aliased = languageAliases[normalized] ?? normalized;
  return supportedLanguages.has(aliased) ? (aliased as HighlightLanguage) : null;
}

function languageFromCodeElement(code: HTMLElement) {
  for (const className of code.classList) {
    if (className.startsWith('language-')) {
      return className.slice('language-'.length);
    }
  }

  return '';
}

async function highlightCodeBlock(code: HTMLElement, observer?: MutationObserver, root?: HTMLElement) {
  if (code.dataset.shikiState === 'highlighted' || code.dataset.shikiState === 'loading') return;

  const language = normalizeLanguage(languageFromCodeElement(code));
  if (!language) {
    code.dataset.shikiState = 'plain';
    return;
  }

  code.dataset.shikiState = 'loading';
  const source = code.textContent ?? '';

  try {
    const highlighter = await getHighlighter();
    await loadLanguage(highlighter, language);
    const html = highlighter.codeToHtml(source, {
      lang: language,
      themes: {
        light: lightTheme,
        dark: darkTheme
      },
      defaultColor: false
    });
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const highlightedPre = template.content.querySelector('pre');
    const currentPre = code.closest('pre');

    if (!highlightedPre || !currentPre) {
      code.innerHTML = escapeHtml(source);
      code.dataset.shikiState = 'plain';
      return;
    }

    const highlightedCode = highlightedPre.querySelector<HTMLElement>('code');
    highlightedPre.classList.add('code-block-highlighted');
    highlightedPre.dataset.shikiState = 'highlighted';
    if (highlightedCode) {
      highlightedCode.dataset.shikiState = 'highlighted';
    }
    observer?.disconnect();
    currentPre.replaceWith(highlightedPre);
    if (observer && root) observer.observe(root, { childList: true, subtree: true });
  } catch (error) {
    console.warn('Failed to highlight code block with Shiki', error);
    code.innerHTML = escapeHtml(source);
    code.dataset.shikiState = 'plain';
  }
}

function highlightCodeBlocks(node: HTMLElement, observer?: MutationObserver) {
  if (!browser) return;

  for (const code of node.querySelectorAll<HTMLElement>('.code-block-shell pre code')) {
    void highlightCodeBlock(code, observer, node);
  }
}

const TABLE_COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

function tableToMarkdown(table: HTMLTableElement): string {
  const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th, thead td'));
  const cellText = (cell: HTMLTableCellElement) =>
    (cell.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replaceAll('|', '\\|');

  const lines: string[] = [];
  if (headerCells.length > 0) {
    lines.push(`| ${headerCells.map(cellText).join(' | ')} |`);
    lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`);
  }

  for (const row of table.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('th, td'));
    if (cells.length === 0) continue;
    lines.push(`| ${cells.map(cellText).join(' | ')} |`);
  }

  return lines.join('\n');
}

// Wrap each table wrapper in a shell that owns the pinned copy button. The
// shell does not scroll, so the button stays fixed at the visible corner
// while a wide table scrolls underneath.
function enhanceTables(root: HTMLElement) {
  for (const wrap of root.querySelectorAll<HTMLElement>('.markdown-table-wrap')) {
    if (wrap.dataset.tableShellApplied === 'true') continue;
    wrap.dataset.tableShellApplied = 'true';

    const shell = document.createElement('div');
    shell.className = 'markdown-table-shell';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-table-copy';
    button.setAttribute('data-table-copy', '');
    button.setAttribute('aria-label', 'Copy table');
    button.insertAdjacentHTML('beforeend', TABLE_COPY_ICON);

    const label = document.createElement('span');
    label.className = 'markdown-table-copy-label';
    label.textContent = 'Copy';
    button.appendChild(label);

    wrap.replaceWith(shell);
    shell.appendChild(button);
    shell.appendChild(wrap);
  }
}

export function enhanceCodeBlocks(node: HTMLElement) {
  if (!browser) {
    return {};
  }

  async function handleClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;

    const tableButton = target?.closest<HTMLButtonElement>('[data-table-copy]');
    if (tableButton) {
      const table = tableButton.closest('.markdown-table-shell')?.querySelector('table');
      const markdown = table instanceof HTMLTableElement ? tableToMarkdown(table) : '';
      if (!markdown) return;

      await navigator.clipboard.writeText(markdown);
      const label = tableButton.querySelector('.markdown-table-copy-label');
      if (label) label.textContent = 'Copied';
      window.setTimeout(() => {
        if (label) label.textContent = 'Copy';
      }, 1200);
      return;
    }

    const button = target?.closest<HTMLButtonElement>('[data-code-copy]');
    if (!button) return;

    const code = button.closest('.code-block-shell')?.querySelector('code')?.textContent;
    if (!code) return;

    await navigator.clipboard.writeText(code);
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Copy';
    }, 1200);
  }

  const observer = new MutationObserver(() => {
    highlightCodeBlocks(node, observer);
    enhanceTables(node);
  });

  node.addEventListener('click', handleClick);
  enhanceTables(node);
  highlightCodeBlocks(node, observer);
  observer.observe(node, { childList: true, subtree: true });

  return {
    destroy() {
      observer.disconnect();
      node.removeEventListener('click', handleClick);
    }
  };
}
