<script lang="ts">
  import { ChevronRight, FileCode2, GitCommitHorizontal, X } from '@lucide/svelte';
  import { onDestroy, untrack } from 'svelte';
  import { getTurnChangedFileCount, type SessionConversationTurn } from '$lib/domain/session-conversation';
  import { buildSessionTurnDiffs } from '$lib/domain/session-tool-diff';
  import { loadSessionToolPatchDiff } from './session-tool-patch-diff';

  let { id, turn, open = true, onClose }: {
    id: string;
    turn: SessionConversationTurn;
    open?: boolean;
    onClose: () => void;
  } = $props();

  let panel: HTMLElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();
  let visible = $state(false);
  let layoutReady = $state(false);
  let animation: Animation | undefined;
  let scrollRoot: HTMLDivElement | undefined = $state();
  let openingFrame = 0;
  let PatchDiff = $state<typeof import('./SessionToolPatchDiff.svelte').default | null>(null);
  let loadError = $state(false);
  let displayedTurnId: string | null = null;
  let collapsedPaths = $state<ReadonlySet<string>>(new Set());
  const files = $derived(layoutReady ? buildSessionTurnDiffs(turn) : []);
  const fileCount = $derived(layoutReady ? files.length : getTurnChangedFileCount(turn));

  onDestroy(() => {
    cancelAnimationFrame(openingFrame);
    animation?.cancel();
  });

  $effect(() => {
    if (!open) layoutReady = true;
  });

  $effect(() => {
    const node = panel;
    const nextOpen = open;
    if (!node) return;
    untrack(() => animatePanel(node, nextOpen));
  });

  function finishOpening() {
    // Paint the settled layout before parsing patches or mounting the renderer.
    openingFrame = requestAnimationFrame(() => {
      if (open) layoutReady = true;
    });
  }

  $effect(() => {
    if (turn.id === displayedTurnId) return;
    displayedTurnId = turn.id;
    collapsedPaths = new Set();
    if (scrollRoot) scrollRoot.scrollTop = 0;
  });

  $effect(() => {
    if (!layoutReady || files.length === 0) return;
    // Track reopening to retry failures without discarding the prepared DOM.
    void open;
    let disposed = false;
    loadError = false;
    loadSessionToolPatchDiff().then(
      (module) => { if (!disposed) PatchDiff = module.default; },
      () => { if (!disposed) loadError = true; }
    );
    return () => { disposed = true; };
  });

  function animatePanel(node: HTMLElement, nextOpen: boolean) {
    cancelAnimationFrame(openingFrame);
    if (!nextOpen && !visible) return;
    const styles = getComputedStyle(node);
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 0 : parseFloat(styles.getPropertyValue('--app-panel-duration')) || 180;
    const offscreen = `translateX(${node.getBoundingClientRect().width + 16}px)`;
    const from = animation ? styles.transform : nextOpen ? offscreen : 'translateX(0)';
    animation?.cancel();
    visible = true;
    const nextAnimation = node.animate(
      [{ transform: from }, { transform: nextOpen ? 'translateX(0)' : offscreen }],
      { duration, easing: styles.getPropertyValue('--app-panel-easing').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    animation = nextAnimation;
    if (nextOpen) closeButton?.focus({ preventScroll: true });
    nextAnimation.onfinish = () => {
      if (animation !== nextAnimation) return;
      if (nextOpen) finishOpening();
      else visible = false;
      nextAnimation.cancel();
      animation = undefined;
    };
  }

  function toggleFile(path: string) {
    const next = new Set(collapsedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    collapsedPaths = next;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<aside
  {id}
  bind:this={panel}
  class="session-turn-diff-panel"
  class:session-turn-diff-panel-preloading={!visible}
  aria-label="Turn diff"
  aria-hidden={!open}
  inert={!open}
>
  <div bind:this={scrollRoot} class="session-turn-diff-panel-body" aria-busy={!layoutReady || (files.length > 0 && !PatchDiff && !loadError)}>
    {#if !layoutReady}
      <p class="session-turn-diff-empty" role="status">Preparing diff preview...</p>
    {:else if files.length === 0}
      <p class="session-turn-diff-empty">Diff preview unavailable. The saved tool calls do not contain enough source content to display these changes.</p>
    {:else}
      {#if loadError}
        <p class="session-tool-diff-error" role="alert">Unable to load diff preview. Close and reopen the panel to retry.</p>
      {/if}
      {#each files as file, index (file.path)}
        {@const expanded = !collapsedPaths.has(file.path)}
        <section class="session-turn-diff-file" aria-label={file.path}>
          <button
            class="session-turn-diff-file-header"
            type="button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${file.path}`}
            aria-expanded={expanded}
            aria-controls={`${id}-file-${index}`}
            onclick={() => toggleFile(file.path)}
          >
            <ChevronRight size={14} class="session-turn-diff-file-chevron" aria-hidden="true" />
            <FileCode2 size={15} aria-hidden="true" />
            <span class="session-turn-diff-file-path">{file.path}</span>
            <span class="session-tool-change-stats" aria-hidden="true">
              <span class="session-tool-change-added">+{file.added}</span>
              <span class="session-tool-change-removed">-{file.removed}</span>
            </span>
          </button>
          <div id={`${id}-file-${index}`} class="session-turn-diff-file-content" hidden={!expanded}>
            {#if expanded && PatchDiff}
              {#each file.changes as change, changeIndex (change.id)}
                <section
                  class="session-turn-diff-change"
                  aria-label={`Change ${changeIndex + 1} of ${file.changes.length} in ${file.path}`}
                >
                  {#if file.changes.length > 1}
                    <h3 class="session-turn-diff-change-header">
                      <GitCommitHorizontal size={13} aria-hidden="true" />
                      Change {changeIndex + 1} of {file.changes.length}
                    </h3>
                  {/if}
                  <PatchDiff patch={change.patch} hideFileHeader={true} {scrollRoot} />
                </section>
              {/each}
            {:else if expanded && !loadError}
              <div class="session-turn-diff-loading" role="status" aria-label={`Loading diff for ${file.path}`}>
                <p class="session-turn-diff-empty">Loading diff preview...</p>
                {#each [0, 1, 2, 3] as line (line)}
                  <span class="session-turn-diff-loading-line" aria-hidden="true"></span>
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/each}
    {/if}
  </div>
  <div class="session-turn-diff-panel-controls">
    <button
      bind:this={closeButton}
      class="session-turn-diff-close"
      type="button"
      aria-label="Close turn diff"
      onclick={onClose}
    >
      <X size={16} aria-hidden="true" />
    </button>
    {#if fileCount !== null}
      <span class="session-turn-diff-file-count">{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
    {/if}
  </div>
</aside>
