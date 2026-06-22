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

async function highlightCodeBlock(code: HTMLElement) {
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
    currentPre.replaceWith(highlightedPre);
  } catch (error) {
    console.warn('Failed to highlight code block with Shiki', error);
    code.innerHTML = escapeHtml(source);
    code.dataset.shikiState = 'plain';
  }
}

function highlightCodeBlocks(node: HTMLElement) {
  if (!browser) return;

  for (const code of node.querySelectorAll<HTMLElement>('.code-block-shell pre code')) {
    void highlightCodeBlock(code);
  }
}

export function enhanceCodeBlocks(node: HTMLElement) {
  if (!browser) {
    return {};
  }

  async function handleClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
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

  const observer = new MutationObserver(() => highlightCodeBlocks(node));

  node.addEventListener('click', handleClick);
  highlightCodeBlocks(node);
  observer.observe(node, { childList: true, subtree: true });

  return {
    destroy() {
      observer.disconnect();
      node.removeEventListener('click', handleClick);
    }
  };
}
