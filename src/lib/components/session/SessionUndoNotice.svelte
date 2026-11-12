<script lang="ts">
  import { ChevronDown, Redo2, TriangleAlert, Undo2 } from '@lucide/svelte';
  import type { SessionUndoNotice } from '$lib/domain/session-undo';

  let {
    notice,
    redoAvailable = false,
    onRedo
  }: {
    notice: SessionUndoNotice;
    redoAvailable?: boolean;
    onRedo?: () => void | Promise<void>;
  } = $props();

  let expanded = $state(false);
  const panelId = $props.id();

  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const title = $derived(
    notice.recovery
      ? 'Undo failed part-way'
      : notice.revertedTurns > 0
        ? `${plural(notice.revertedTurns, 'turn')} undone`
        : 'Undone'
  );
  const detail = $derived(
    !notice.recovery && notice.files.length > 0 ? `${plural(notice.files.length, 'file')} restored` : null
  );
  const hint = $derived(
    notice.recovery
      ? 'Restoring puts the workspace back to how it was before that undo. Sending a new prompt discards this option.'
      : 'Sending a new prompt permanently discards the undone turns.'
  );
</script>

<section
  class="session-undo-notice"
  class:session-undo-notice-recovery={notice.recovery}
  role="status"
  aria-label={title}
  data-undo-notice
>
  <div class="session-undo-notice-header">
    <span class="session-undo-notice-mark" aria-hidden="true">
      {#if notice.recovery}<TriangleAlert size={14} />{:else}<Undo2 size={14} />{/if}
    </span>
    <span class="session-undo-notice-title">{title}</span>
    {#if detail}<span class="session-undo-notice-detail">{detail}</span>{/if}
    {#if notice.files.length > 0}
      <button
        type="button"
        class="session-undo-notice-btn"
        aria-expanded={expanded}
        aria-controls={panelId}
        onclick={() => (expanded = !expanded)}
      >
        {expanded ? 'Hide files' : 'Show files'}
        <ChevronDown size={12} class={expanded ? 'session-undo-notice-chevron-open' : ''} aria-hidden="true" />
      </button>
    {/if}
    {#if redoAvailable}
      <button type="button" class="session-undo-notice-btn session-undo-notice-redo" onclick={() => onRedo?.()}>
        <Redo2 size={12} aria-hidden="true" />
        {notice.recovery ? 'Restore workspace' : 'Redo'}
      </button>
    {/if}
  </div>
  {#if notice.recovery && notice.message}
    <p class="session-undo-notice-text">{notice.message}</p>
  {/if}
  <p class="session-undo-notice-text session-undo-notice-hint">{hint}</p>
  {#if expanded && notice.files.length > 0}
    <ul id={panelId} class="session-undo-notice-files">
      {#each notice.files as file (file)}
        <li>{file}</li>
      {/each}
    </ul>
  {/if}
</section>
