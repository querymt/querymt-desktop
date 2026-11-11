<script lang="ts">
  import { File, Folder } from '@lucide/svelte';
  import { Popover } from 'bits-ui';
  import type { MentionEntry } from '$lib/domain/mention-controller';
  import type { MentionQueryStatus } from '$lib/domain/mention-query.svelte';

  let {
    open,
    entries,
    status,
    selectedIndex,
    anchor,
    listboxId,
    optionId,
    onSelect,
    onHover = null
  }: {
    open: boolean;
    entries: MentionEntry[];
    status: MentionQueryStatus;
    selectedIndex: number;
    anchor: HTMLElement | null;
    listboxId: string;
    optionId: (index: number) => string;
    onSelect: (index: number) => void;
    onHover?: ((index: number) => void) | null;
  } = $props();

  $effect(() => {
    if (!open) return;
    document.getElementById(optionId(selectedIndex))?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<Popover.Root {open}>
  <Popover.Portal>
    <Popover.Content
      class="mention-popup panel-strong"
      customAnchor={anchor}
      side="top"
      align="start"
      sideOffset={6}
      trapFocus={false}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      interactOutsideBehavior="ignore"
      escapeKeydownBehavior="ignore"
    >
      {#if status === 'not_ready'}
        <p class="mention-popup-state" role="status">Indexing…</p>
      {:else if status === 'error'}
        <p class="mention-popup-state" role="status">Could not load files.</p>
      {:else if entries.length === 0}
        <p class="mention-popup-state" role="status">{status === 'loading' ? 'Searching…' : 'No matching files.'}</p>
      {/if}
      {#if entries.length > 0}
        <ul id={listboxId} class="mention-popup-list" role="listbox" aria-label="Files and directories">
          {#each entries as entry, index (entry.uri)}
            <li
              id={optionId(index)}
              class="mention-popup-option"
              class:mention-popup-option-selected={index === selectedIndex}
              role="option"
              aria-selected={index === selectedIndex}
              onmousedown={(event) => {
                // Keep focus in the textarea.
                event.preventDefault();
                onSelect(index);
              }}
              onmouseenter={() => onHover?.(index)}
            >
              {#if entry.isDir}<Folder size={14} aria-hidden="true" />{:else}<File size={14} aria-hidden="true" />{/if}
              <span class="mention-popup-name">{entry.name}</span>
              <small class="mention-popup-path">{entry.path}</small>
            </li>
          {/each}
        </ul>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  :global(.mention-popup) {
    z-index: 60;
    width: min(32rem, 90vw);
    max-height: 16rem;
    overflow-y: auto;
    padding: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .mention-popup-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .mention-popup-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.5rem;
    border-radius: 8px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .mention-popup-option-selected {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }
  .mention-popup-name {
    font-weight: 600;
    white-space: nowrap;
  }
  .mention-popup-path {
    min-width: 0;
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mention-popup-state {
    margin: 0;
    padding: 0.4rem 0.5rem;
    color: var(--muted);
    font-size: 0.8125rem;
  }
</style>
