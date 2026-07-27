<script lang="ts">
  import { AlertTriangle, FolderOpen, LoaderCircle, Trash2, X } from '@lucide/svelte';
  import { getContext } from 'svelte';
  import { Portal } from 'bits-ui';
  import type { WorkspaceItem } from '$lib/domain/types';

  let {
    items,
    loading = false,
    error = null,
    onAddWorkspace = null,
    onRetry = null,
    onUseWorkspace = null,
    onRemoveWorkspace = null
  }: {
    items: WorkspaceItem[];
    loading?: boolean;
    error?: string | null;
    onAddWorkspace?: (() => void | Promise<void>) | null;
    onRetry?: (() => void | Promise<void>) | null;
    onUseWorkspace?: ((item: WorkspaceItem) => void | Promise<void>) | null;
    onRemoveWorkspace?: ((item: WorkspaceItem) => void | Promise<void>) | null;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);
  let pendingRemoval = $state<WorkspaceItem | null>(null);

  async function confirmRemoval() {
    if (!pendingRemoval) return;
    const item = pendingRemoval;
    pendingRemoval = null;
    await onRemoveWorkspace?.(item);
  }
</script>

<section class="settings-section">
  <div class="settings-section-header settings-section-header-action">
    <div>
      <h2>Folders</h2>
      <p>Folders available as session context.</p>
    </div>
    {#if onAddWorkspace}
      <button class="action-btn action-btn-primary" disabled={loading} onclick={onAddWorkspace}>
        {loading ? 'Picking...' : 'Pick folder'}
      </button>
    {/if}
  </div>

  {#if loading && items.length === 0}
    <div class="state-skeleton-list" aria-label="Adding workspace" aria-busy="true">
      {#each Array(2) as _}
        <div class="state-skeleton-row">
          <span class="state-skeleton-avatar"></span>
          <span class="state-skeleton-copy"><i></i><i></i></span>
        </div>
      {/each}
    </div>
  {:else if error && items.length === 0}
    <div class="state-panel state-panel-error" role="alert">
      <span class="state-panel-icon"><AlertTriangle size={17} /></span>
      <div class="state-panel-copy">
        <strong>Workspace could not be added</strong>
        <p>{error}</p>
      </div>
      {#if onRetry}<button class="action-btn" type="button" onclick={onRetry}>Try again</button>{/if}
    </div>
  {:else if items.length === 0}
    <div class="state-panel">
      <span class="state-panel-icon"><FolderOpen size={17} /></span>
      <div class="state-panel-copy">
        <strong>No workspace folders yet</strong>
        <p>Add a folder to use it as context when starting a session.</p>
      </div>
      {#if onAddWorkspace}<button class="action-btn action-btn-primary" type="button" onclick={onAddWorkspace}>Pick folder</button>{/if}
    </div>
  {:else}
    {#if error}
      <div class="state-inline-error" role="alert">
        <AlertTriangle size={15} />
        <span class="min-w-0 flex-1"><strong>Workspace was not added.</strong> {error}</span>
        {#if onRetry}<button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={onRetry}>Retry</button>{/if}
      </div>
    {:else if loading}
      <div class="state-inline-progress" role="status"><LoaderCircle size={14} class="animate-spin" /><span>Opening folder picker…</span></div>
    {/if}
    <div class="mesh-item-list">
      {#each items as item}
        <article class="mesh-item-row">
          <div class="mesh-item-main">
            <div class="mesh-item-title">{item.name}</div>
            <div class="mesh-item-description">{item.path}</div>
            <div class="mesh-item-meta">{item.status} · default runtime {item.defaultRuntime}</div>
          </div>
          {#if onUseWorkspace || onRemoveWorkspace}
            <div class="mesh-item-actions">
              {#if onUseWorkspace}
                <button class="action-btn" type="button" onclick={() => onUseWorkspace?.(item)}>Use</button>
              {/if}
              {#if onRemoveWorkspace}
                <button class="icon-btn icon-btn-danger" type="button" aria-label={`Remove ${item.name} from QueryMT`} title="Remove from QueryMT" onclick={() => (pendingRemoval = item)}>
                  <Trash2 size={15} />
                </button>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

{#if pendingRemoval}
  <Portal to={overlayPortalTarget}>
    <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
      <button class="absolute inset-0 h-full w-full cursor-default" type="button" aria-label="Close remove workspace confirmation" onclick={() => (pendingRemoval = null)}></button>
      <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" aria-labelledby="remove-workspace-dialog-title" tabindex="-1" data-blocking-overlay="true">
        <div class="dialog-header">
          <div class="dialog-header-title-block">
            <div class="dialog-title" id="remove-workspace-dialog-title">Remove workspace?</div>
            <div class="dialog-subtitle">Remove “{pendingRemoval.name}” from QueryMT?</div>
          </div>
          <div class="dialog-header-actions">
            <button class="dialog-close-button" type="button" aria-label="Close remove workspace confirmation" onclick={() => (pendingRemoval = null)}><X size={16} /></button>
          </div>
        </div>
        <div class="dialog-body">
          <div class="dialog-form">
            <div class="dialog-row-group">
              <div class="dialog-row dialog-row-muted dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">Your files stay on disk</div>
                  <div class="dialog-row-description">Only this workspace shortcut is removed from the app. The folder and everything inside it are not changed.</div>
                </div>
              </div>
            </div>
            <div class="dialog-footer">
              <button class="action-btn" type="button" onclick={() => (pendingRemoval = null)}>Cancel</button>
              <button class="action-btn action-btn-danger" type="button" onclick={confirmRemoval}>Remove from QueryMT</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Portal>
{/if}
