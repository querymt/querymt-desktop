import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const codeToHtml = vi.fn(
  () => '<pre><code class="language-ts">const value = 1;</code></pre>'
);

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

import { enhanceCodeBlocks } from './code-blocks';

describe('enhanceCodeBlocks', () => {
  beforeEach(() => {
    codeToHtml.mockClear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
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
