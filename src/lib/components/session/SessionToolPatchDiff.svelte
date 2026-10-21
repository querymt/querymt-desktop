<script module lang="ts">
  import { WorkerPoolManager } from '@pierre/diffs/worker';
  import DiffWorker from '@pierre/diffs/worker/worker.js?worker';

  let workers: WorkerPoolManager | undefined;
  let workerReady: Promise<void> | undefined;

  export function prepareDiffRenderer() {
    if (typeof Worker === 'undefined') return Promise.resolve();
    workerReady ??= (async () => {
      const pool = new WorkerPoolManager(
        { workerFactory: () => new DiffWorker(), poolSize: 2 },
        { theme: { dark: 'github-dark', light: 'github-light' }, lineDiffType: 'word-alt' }
      );
      try {
        await pool.initialize();
        workers = pool;
      } catch {
        // Retain the non-worker renderer on hosts that cannot start workers.
        pool.terminate();
        workerReady = undefined;
      }
    })();
    return workerReady;
  }
</script>

<script lang="ts">
  import { FileDiff, VirtualizedFileDiff, Virtualizer, getSingularPatch } from '@pierre/diffs';
  import { appearanceStore } from '$lib/stores/appearance.svelte';

  let { patch, hideFileHeader = false, scrollRoot }: {
    patch: string;
    hideFileHeader?: boolean;
    scrollRoot?: HTMLElement;
  } = $props();

  let host: HTMLDivElement | undefined = $state();
  let errorMessage = $state<string | null>(null);

  // Primitive derivations stop equivalent parent props from rebuilding the renderer.
  const sourcePatch = $derived(patch);
  const disableFileHeader = $derived(hideFileHeader);
  const rendererRoot = $derived(scrollRoot);
  const options = $derived({
    theme: { dark: 'github-dark', light: 'github-light' },
    themeType: appearanceStore.resolvedTheme,
    diffStyle: 'unified' as const,
    diffIndicators: 'bars' as const,
    lineDiffType: 'word-alt' as const,
    overflow: 'wrap' as const,
    disableLineNumbers: false,
    useCSSClasses: true,
    disableBackground: true,
    disableFileHeader
  });

  $effect(() => {
    const el = host;
    const nextPatch = sourcePatch;
    const nextOptions = options;
    const root = rendererRoot;
    if (!el) return;

    let instance: FileDiff | null = null;
    let virtualizer: Virtualizer | null = null;
    try {
      const container = document.createElement('diffs-container');
      container.className = 'session-tool-diff-container';
      el.replaceChildren(container);
      const fileDiff = getSingularPatch(nextPatch);
      if (root) {
        virtualizer = new Virtualizer({ overscrollSize: 300, intersectionObserverMargin: 600 });
        virtualizer.setup(root);
        instance = new VirtualizedFileDiff(nextOptions, virtualizer, { lineHeight: 18, paddingTop: 0, paddingBottom: 0 }, workers, true);
        instance.render({ fileDiff, fileContainer: container });
      } else {
        instance = new FileDiff(nextOptions, workers, true);
        instance.hydrate({ fileDiff, fileContainer: container });
      }
      errorMessage = null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to render diff preview.';
      el.replaceChildren();
      instance?.cleanUp();
      virtualizer?.cleanUp();
      instance = null;
      virtualizer = null;
    }

    return () => {
      instance?.cleanUp();
      virtualizer?.cleanUp();
    };
  });
</script>

<div
  class="session-tool-diff"
  class:session-tool-diff-no-header={hideFileHeader}
  data-testid="session-tool-diff"
  bind:this={host}
></div>
{#if errorMessage}
  <p class="session-tool-diff-error">{errorMessage}</p>
{/if}
