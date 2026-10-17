import { beforeEach, describe, expect, it, vi } from 'vitest';

const prepareDiffRenderer = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./SessionToolPatchDiff.svelte', () => ({ default: {}, prepareDiffRenderer }));

beforeEach(() => {
  vi.resetModules();
  prepareDiffRenderer.mockReset().mockResolvedValue(undefined);
});

describe('diff renderer preloading', () => {
  it('shares one preparation between hover, focus, and opening', async () => {
    const { loadSessionToolPatchDiff, preloadSessionToolPatchDiff } = await import('./session-tool-patch-diff');
    preloadSessionToolPatchDiff();
    preloadSessionToolPatchDiff();
    const opening = loadSessionToolPatchDiff();
    expect(loadSessionToolPatchDiff()).toBe(opening);
    await opening;
    expect(prepareDiffRenderer).toHaveBeenCalledTimes(1);
  });

  it('waits for worker preparation before returning the renderer', async () => {
    let finish!: () => void;
    prepareDiffRenderer.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve(undefined); }));
    const { loadSessionToolPatchDiff } = await import('./session-tool-patch-diff');
    const ready = vi.fn();
    const loading = loadSessionToolPatchDiff().then(ready);
    await vi.waitFor(() => expect(prepareDiffRenderer).toHaveBeenCalledTimes(1));
    expect(ready).not.toHaveBeenCalled();
    finish();
    await loading;
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('handles a speculative failure and retries when the user opens', async () => {
    prepareDiffRenderer.mockRejectedValueOnce(new Error('preparation failed'));
    const { loadSessionToolPatchDiff, preloadSessionToolPatchDiff } = await import('./session-tool-patch-diff');
    preloadSessionToolPatchDiff();
    await vi.waitFor(() => expect(prepareDiffRenderer).toHaveBeenCalledTimes(1));
    await loadSessionToolPatchDiff();
    expect(prepareDiffRenderer).toHaveBeenCalledTimes(2);
  });
});
