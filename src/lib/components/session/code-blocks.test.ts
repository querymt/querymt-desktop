import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const codeToHtml = vi.fn(
  () => '<pre><code class="language-ts">const value = 1;</code></pre>'
);
const mermaidInitialize = vi.fn();
const mermaidRender = vi.fn(async (_id: string, source: string) => ({
  svg: `<svg data-mermaid-source="${source}"><g></g></svg>`
}));

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('shiki/core', () => ({
  createHighlighterCore: async () => ({
    codeToHtml,
    loadLanguage: async () => undefined
  })
}));

vi.mock('shiki/engine/javascript', () => ({
  createJavaScriptRegexEngine: () => ({})
}));

vi.mock('@shikijs/themes/github-light', () => ({ default: { name: 'github-light' } }));
vi.mock('@shikijs/themes/github-dark', () => ({ default: { name: 'github-dark' } }));
vi.mock('@shikijs/langs/typescript', () => ({ default: { name: 'typescript' } }));

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitialize,
    render: mermaidRender
  }
}));

import { enhanceCodeBlocks } from './code-blocks';

describe('enhanceCodeBlocks', () => {
  beforeEach(() => {
    codeToHtml.mockClear();
    mermaidInitialize.mockClear();
    mermaidRender.mockClear();
    mermaidRender.mockResolvedValue({
      svg: '<svg data-mermaid-source="flowchart TD\n  A-->B"><g></g></svg>'
    });
    document.documentElement.dataset.theme = 'light';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    delete document.documentElement.dataset.theme;
  });

  it('disconnects the mutation observer while replacing a highlighted block', async () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakeObserver {
      constructor(private readonly callback: MutationCallback) {}
      observe = observe;
      disconnect = disconnect;
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('MutationObserver', FakeObserver);

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-ts">const value = 1;</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    expect(observe).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(codeToHtml).toHaveBeenCalledTimes(1));
    expect(disconnect).toHaveBeenCalled();
    expect(observe.mock.calls.length).toBeGreaterThan(1);
    action.destroy?.();
  });

  it('does not highlight codes that already have a shiki state', async () => {
    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-ts" data-shiki-state="highlighted">const value = 1;</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await Promise.resolve();
    expect(codeToHtml).not.toHaveBeenCalled();
    action.destroy?.();
  });

  it('renders mermaid fences as diagrams and keeps the source for copy', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><div class="code-block-header"><span class="code-block-language">mermaid</span><button class="code-block-copy" type="button" data-code-copy aria-label="Copy code">Copy</button></div><pre><code class="language-mermaid">flowchart TD\n  A--&gt;B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    expect(codeToHtml).not.toHaveBeenCalled();
    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        look: 'classic',
        flowchart: { look: 'classic' },
        sequence: { look: 'classic' },
        class: { look: 'classic' },
        secure: expect.arrayContaining([
          'secure',
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'suppressErrorRendering',
          'maxEdges',
          'theme',
          'themeCSS',
          'themeVariables',
          'fontFamily',
          'altFontFamily',
          'look'
        ])
      })
    );
    const lightConfig = mermaidInitialize.mock.calls[0]?.[0] as {
      themeVariables: {
        primaryColor: string;
        mainBkg: string;
        nodeBkg: string;
        actorBkg: string;
        primaryTextColor: string;
      };
    };
    expect(lightConfig.themeVariables.primaryColor).toBe('#ffffff');
    expect(lightConfig.themeVariables.mainBkg).toBe(lightConfig.themeVariables.primaryColor);
    expect(lightConfig.themeVariables.nodeBkg).toBe(lightConfig.themeVariables.primaryColor);
    expect(lightConfig.themeVariables.actorBkg).toBe(lightConfig.themeVariables.primaryColor);
    expect(lightConfig.themeVariables.primaryTextColor).toBe('#241f31');
    const diagram = document.querySelector('.mermaid-diagram');
    const source = document.querySelector<HTMLElement>('.code-block-shell pre');
    const header = document.querySelector('.code-block-header');
    const toggle = header?.querySelector<HTMLButtonElement>('[data-mermaid-source-toggle]');
    const copy = header?.querySelector<HTMLButtonElement>('[data-code-copy]');
    expect(diagram?.querySelector('svg')).not.toBeNull();
    expect(source?.hidden).toBe(false);
    expect(source?.classList.contains('mermaid-source')).toBe(true);
    expect(source?.id).toBeTruthy();
    expect(diagram?.getAttribute('role')).toBe('img');
    expect(diagram?.getAttribute('aria-label')).toBe('Mermaid diagram');
    expect(diagram?.getAttribute('aria-describedby')).toBe(source?.id);
    expect(toggle).not.toBeNull();
    expect(toggle?.nextElementSibling).toBe(copy);
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('Show source');
    expect(toggle?.querySelector('svg')).not.toBeNull();
    expect(toggle?.innerHTML).toContain('m14.5 4-5 16');

    copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('flowchart TD\n  A-->B');
    action.destroy?.();
  });

  it('toggles mermaid source in the code block bar without copying', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><div class="code-block-header"><span class="code-block-language">mermaid</span><button class="code-block-copy" type="button" data-code-copy aria-label="Copy code">Copy</button></div><pre><code class="language-mermaid">flowchart TD\n  A--&gt;B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(document.querySelector('[data-mermaid-source-toggle]')).not.toBeNull());
    const shell = document.querySelector<HTMLElement>('.code-block-shell');
    const toggle = document.querySelector<HTMLButtonElement>('[data-mermaid-source-toggle]');
    const copy = document.querySelector<HTMLButtonElement>('[data-code-copy]');

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(shell?.dataset.mermaidView).toBe('source');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Show diagram');
    expect(toggle?.innerHTML).toContain('M21.21 15.89');
    expect(toggle?.innerHTML).not.toContain('m14.5 4-5 16');
    expect(shell?.querySelector('pre.mermaid-source')).not.toBeNull();
    expect(shell?.querySelector('.mermaid-diagram')).not.toBeNull();
    expect(writeText).not.toHaveBeenCalled();

    copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('flowchart TD\n  A-->B');

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(shell?.dataset.mermaidView).toBe('diagram');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('Show source');
    expect(toggle?.innerHTML).toContain('m14.5 4-5 16');
    expect(toggle?.innerHTML).not.toContain('M21.21 15.89');
    expect(shell?.querySelector('pre.mermaid-source')).not.toBeNull();
    expect(shell?.querySelector('.mermaid-diagram')).not.toBeNull();
    expect(writeText).toHaveBeenCalledTimes(1);
    action.destroy?.();
  });

  it('leaves mermaid source visible when rendering fails', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('bad diagram'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-mermaid">not a diagram</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() =>
      expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-state')).toBe('error')
    );
    expect(document.querySelector('.mermaid-diagram')).toBeNull();
    expect(document.querySelector('[data-mermaid-source-toggle]')).toBeNull();
    expect(document.querySelector<HTMLElement>('.code-block-shell pre')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('.code-block-shell pre')?.classList.contains('mermaid-source')).toBe(
      false
    );
    expect(document.querySelector('.code-block-shell pre')?.textContent).toContain('not a diagram');
    warn.mockRestore();
    action.destroy?.();
  });

  it('does not reconnect the mutation observer after destroy during mermaid render', async () => {
    const disconnect = vi.fn();
    const observe = vi.fn();
    class FakeObserver {
      constructor(private readonly callback: MutationCallback) {}
      observe = observe;
      disconnect = disconnect;
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal('MutationObserver', FakeObserver);

    let resolveRender: ((value: { svg: string }) => void) | undefined;
    const pendingRender = new Promise<{ svg: string }>((resolve) => {
      resolveRender = resolve;
    });
    mermaidRender.mockImplementationOnce(async () => pendingRender);

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-mermaid">flowchart TD\n  A-->B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    const observeCallsAtDestroy = observe.mock.calls.length;
    action.destroy?.();
    resolveRender?.({ svg: '<svg data-mermaid-source="flowchart TD\n  A-->B"><g></g></svg>' });

    await mermaidRender.mock.results[0]?.value;
    await Promise.resolve();
    await Promise.resolve();
    expect(observe.mock.calls.length).toBe(observeCallsAtDestroy);
    expect(host.querySelector('.mermaid-diagram')).toBeNull();
    expect(host.querySelector('.mermaid-source')).toBeNull();
  });

  it('discards a stale mermaid SVG when the color scheme flips mid-render', async () => {
    let resolveFirst: ((value: { svg: string }) => void) | undefined;
    const firstRender = new Promise<{ svg: string }>((resolve) => {
      resolveFirst = resolve;
    });
    mermaidRender.mockImplementationOnce(async () => firstRender).mockResolvedValue({
      svg: '<svg data-mermaid-theme="dark"><g></g></svg>'
    });

    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-mermaid">flowchart TD\n  A-->B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    document.documentElement.dataset.theme = 'dark';
    resolveFirst?.({ svg: '<svg data-mermaid-theme="light"><g></g></svg>' });

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).toBe('dark')
    );
    expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-theme')).toBe('dark');
    expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-state')).toBe('rendered');
    action.destroy?.();
  });

  it('ignores a superseded mermaid SVG when overlapping theme paints resolve out of order', async () => {
    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><pre><code class="language-mermaid">flowchart TD\n  A-->B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-state')).toBe('rendered')
    );

    const pending: Array<() => void> = [];
    mermaidRender.mockImplementation(async () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
      const svg = `<svg data-mermaid-theme="${theme}"><g></g></svg>`;
      return new Promise<{ svg: string }>((resolve) => {
        pending.push(() => resolve({ svg }));
      });
    });

    const shell = document.querySelector<HTMLElement>('.code-block-shell');
    document.documentElement.dataset.theme = 'dark';
    await vi.waitFor(() => expect(pending.length).toBe(1));

    if (shell) shell.dataset.mermaidTheme = 'dark';
    document.documentElement.dataset.theme = 'light';
    await vi.waitFor(() => expect(pending.length).toBe(2));

    pending[1]?.();
    await vi.waitFor(() =>
      expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).toBe('light')
    );
    expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).not.toBe('dark');

    pending[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).toBe('light');
    expect(shell?.dataset.mermaidTheme).toBe('light');
    expect(shell?.getAttribute('data-mermaid-state')).toBe('rendered');
    expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).not.toBe('dark');
    action.destroy?.();
  });

  it('re-renders mermaid diagrams when the color scheme changes', async () => {
    document.body.innerHTML =
      '<div class="host"><div class="code-block-shell"><div class="code-block-header"><span class="code-block-language">mermaid</span><button class="code-block-copy" type="button" data-code-copy aria-label="Copy code">Copy</button></div><pre><code class="language-mermaid">flowchart TD\n  A-->B</code></pre></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(1));
    const toggle = document.querySelector<HTMLButtonElement>('[data-mermaid-source-toggle]');
    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-view')).toBe('source');
    mermaidRender.mockResolvedValue({
      svg: '<svg data-mermaid-theme="dark"><g></g></svg>'
    });
    document.documentElement.dataset.theme = 'dark';

    await vi.waitFor(() => expect(mermaidRender).toHaveBeenCalledTimes(2));
    const darkConfig = mermaidInitialize.mock.calls.find((call) => {
      const themeVariables = (call[0] as { themeVariables?: { primaryTextColor?: string } })
        ?.themeVariables;
      return themeVariables?.primaryTextColor === '#f5f5f5';
    })?.[0] as {
      theme: string;
      look: string;
      themeVariables: {
        primaryColor: string;
        mainBkg: string;
        nodeBkg: string;
        actorBkg: string;
        primaryTextColor: string;
      };
    };
    expect(darkConfig).toEqual(
      expect.objectContaining({
        theme: 'base',
        look: 'classic',
        flowchart: { look: 'classic' },
        sequence: { look: 'classic' },
        class: { look: 'classic' }
      })
    );
    expect(darkConfig.themeVariables.primaryColor).toBe('#272727');
    expect(darkConfig.themeVariables.mainBkg).toBe(darkConfig.themeVariables.primaryColor);
    expect(darkConfig.themeVariables.nodeBkg).toBe(darkConfig.themeVariables.primaryColor);
    expect(darkConfig.themeVariables.actorBkg).toBe(darkConfig.themeVariables.primaryColor);
    expect(darkConfig.themeVariables.primaryTextColor).toBe('#f5f5f5');
    expect(document.querySelector('.mermaid-diagram svg')?.getAttribute('data-mermaid-theme')).toBe('dark');
    expect(document.querySelectorAll('[data-mermaid-source-toggle]')).toHaveLength(1);
    expect(document.querySelector('.code-block-shell')?.getAttribute('data-mermaid-view')).toBe('source');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    action.destroy?.();
  });

  it('wraps tables in a pinned copy-button shell', async () => {
    document.body.innerHTML =
      '<div class="host"><div class="markdown-table-wrap"><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>alpha</td></tr></tbody></table></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);

    const shell = document.querySelector('.markdown-table-shell');
    expect(shell).not.toBeNull();
    expect(shell?.querySelector('table')).not.toBeNull();

    const button = shell?.querySelector<HTMLButtonElement>('[data-table-copy]');
    expect(button).not.toBeNull();
    expect(button?.querySelector('svg')).not.toBeNull();
    expect(button?.querySelector('.markdown-table-copy-label')?.textContent).toBe('Copy');

    // Wrappers added later (streaming html swaps) get the same treatment
    // once; already-enhanced wrappers are not re-wrapped.
    const late = document.createElement('div');
    late.className = 'markdown-table-wrap';
    host.appendChild(late);
    await vi.waitFor(() => expect(document.querySelectorAll('.markdown-table-shell')).toHaveLength(2));
    expect(document.querySelectorAll('[data-table-copy]')).toHaveLength(2);
    action.destroy?.();
  });

  it('copies tables as markdown from the shell copy button', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    document.body.innerHTML =
      '<div class="host"><div class="markdown-table-wrap"><table><thead><tr><th>Name | x</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>1</td></tr><tr><td>beta</td><td>2</td></tr></tbody></table></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);
    const button = document.querySelector<HTMLButtonElement>('[data-table-copy]');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

    expect(writeText).toHaveBeenCalledWith(
      '| Name \\| x | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |'
    );
    expect(document.querySelector('.markdown-table-copy-label')?.textContent).toBe('Copied');
    action.destroy?.();
  });

  it('does not write to the clipboard when the shell has no table', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    document.body.innerHTML =
      '<div class="host"><div class="markdown-table-wrap"></div></div>';
    const host = document.querySelector('.host') as HTMLElement;
    const action = enhanceCodeBlocks(host);
    const button = document.querySelector<HTMLButtonElement>('[data-table-copy]');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(writeText).not.toHaveBeenCalled();
    expect(document.querySelector('.markdown-table-copy-label')?.textContent).toBe('Copy');
    action.destroy?.();
  });
});
