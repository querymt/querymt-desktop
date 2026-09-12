<script lang="ts">
  import { FileDiff, getSingularPatch } from '@pierre/diffs';
  import { appearanceStore } from '$lib/stores/appearance.svelte';

  let { patch, hideFileHeader = false }: { patch: string; hideFileHeader?: boolean } = $props();

  let host: HTMLDivElement | undefined = $state();
  let errorMessage = $state<string | null>(null);

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
    disableFileHeader: hideFileHeader
  });

  $effect(() => {
    const el = host;
    const nextPatch = patch;
    const nextOptions = options;
    if (!el) return;

    let instance: FileDiff | null = null;
    try {
      const container = document.createElement('diffs-container');
      container.className = 'session-tool-diff-container';
      el.replaceChildren(container);
      instance = new FileDiff(nextOptions, undefined, true);
      instance.hydrate({
        fileDiff: getSingularPatch(nextPatch),
        fileContainer: container
      });
      errorMessage = null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Unable to render diff preview.';
      el.replaceChildren();
      instance?.cleanUp();
      instance = null;
    }

    return () => {
      instance?.cleanUp();
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
