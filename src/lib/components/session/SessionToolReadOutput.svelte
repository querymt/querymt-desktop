<script lang="ts">
  import type { ReadFileOutputView } from '$lib/domain/session-tool-read-output';
  import {
    darkTheme,
    escapeHtml,
    getHighlighter,
    languageFromPath,
    lightTheme,
    loadLanguage,
    tokenToHtml
  } from './shiki';

  let { view }: { view: ReadFileOutputView } = $props();

  let highlighted = $state<string[] | null>(null);
  let rootStyle = $state('');

  const sections = $derived.by(() => {
    let cursor = 0;
    return view.sections.map((section) => ({
      path: section.path,
      rows: section.lines.map((line) => {
        const index = cursor++;
        return {
          number: line.lineNumber ?? '',
          html: highlighted?.[index] || (escapeHtml(line.text) || '\n')
        };
      })
    }));
  });

  $effect(() => {
    const currentView = view;
    highlighted = null;
    rootStyle = '';

    if (currentView.sections.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const highlighter = await getHighlighter();
        const perLineHtml: string[] = [];
        const rootVars: Record<string, string> = {};
        for (const section of currentView.sections) {
          const source = section.lines.map((line) => line.text).join('\n');
          const language = languageFromPath(section.path);
          if (!language || !source.trim()) {
            section.lines.forEach(() => perLineHtml.push(''));
            continue;
          }
          await loadLanguage(highlighter, language);
          if (cancelled) return;
          const result = highlighter.codeToTokens(source, {
            lang: language,
            themes: { light: lightTheme, dark: darkTheme },
            defaultColor: false
          });
          if (cancelled) return;
          for (const tokens of result.tokens) {
            perLineHtml.push(tokens.map(tokenToHtml).join('') || '\n');
          }
          Object.assign(rootVars, result.rootStyle ?? {});
        }
        if (cancelled) return;
        highlighted = perLineHtml;
        rootStyle = cssDeclarations(rootVars);
      } catch (error) {
        console.warn('Failed to highlight read output', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function cssDeclarations(style?: Record<string, string>): string {
    if (!style) return '';
    return Object.entries(style)
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
  }
</script>

<div class="session-tool-read-output" style={rootStyle}>
  {#each sections as section, sectionIndex (sectionIndex)}
    {#if sections.length > 1}
      <div class="session-tool-read-section" title={section.path}>{section.path}</div>
    {/if}
    <pre class="session-tool-read-code">{#each section.rows as row, index (index)}<span class="session-tool-read-row"><span class="session-tool-read-number">{row.number}</span><span class="session-tool-read-text">{@html row.html}</span></span>{/each}</pre>
  {/each}
</div>
