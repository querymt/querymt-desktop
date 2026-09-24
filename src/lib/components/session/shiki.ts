// Shared lazy-loaded Shiki highlighter used by markdown code blocks and the
// session tool visualizations. The highlighter singleton and languages are
// created on first use so nothing loads until a code block needs it.

export const lightTheme = 'github-light';
export const darkTheme = 'github-dark';

export type ShikiToken = {
  content: string;
  htmlStyle?: Record<string, string>;
};

export type ShikiTokensResult = {
  tokens: ShikiToken[][];
  rootStyle?: Record<string, string>;
};

type DualThemeOptions = {
  lang: string;
  themes: { light: string; dark: string };
  defaultColor: false;
};

export type ShikiHighlighter = {
  codeToHtml: (code: string, options: DualThemeOptions) => string;
  codeToTokens: (code: string, options: DualThemeOptions) => ShikiTokensResult;
  loadLanguage: (...langs: unknown[]) => Promise<void>;
};

export type HighlightLanguage =
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

let highlighterPromise: Promise<ShikiHighlighter> | null = null;
const loadedLanguages = new Set<HighlightLanguage>();

type LanguageModule = { default: unknown };

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

const fileExtensionLanguages: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  css: 'css',
  cxx: 'cpp',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  lua: 'lua',
  mjs: 'javascript',
  cjs: 'javascript',
  nix: 'nix',
  py: 'python',
  pyi: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  svelte: 'svelte',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  zsh: 'bash'
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getHighlighter() {
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

export async function loadLanguage(highlighter: ShikiHighlighter, language: HighlightLanguage) {
  if (loadedLanguages.has(language)) return;

  const registration = await languageLoaders[language]();
  await highlighter.loadLanguage(registration.default);
  loadedLanguages.add(language);
}

export function normalizeLanguage(language: string): HighlightLanguage | null {
  const normalized = language.trim().toLowerCase().replace(/^language-/, '');
  if (!normalized) return null;

  const aliased = languageAliases[normalized] ?? normalized;
  return supportedLanguages.has(aliased) ? (aliased as HighlightLanguage) : null;
}

/** Infers a supported highlight language from a file path's extension. */
export function languageFromPath(path: string): HighlightLanguage | null {
  const filename = path.replaceAll('\\', '/').split('/').pop() ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  const mapped = fileExtensionLanguages[extension];
  return mapped ? normalizeLanguage(mapped) : null;
}

/** Renders one Shiki token as HTML carrying the dual-theme CSS custom properties. */
export function tokenToHtml(token: ShikiToken): string {
  const content = escapeHtml(token.content);
  const style = token.htmlStyle;
  if (!style) return content;
  const declarations = Object.entries(style)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return declarations ? `<span style="${declarations}">${content}</span>` : content;
}
