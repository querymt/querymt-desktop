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
});
