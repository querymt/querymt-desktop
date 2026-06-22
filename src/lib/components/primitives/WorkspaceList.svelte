<script lang="ts">
  import type { WorkspaceItem } from '$lib/domain/types';

  let {
    items,
    loading = false,
    error = null,
    onAddWorkspace = null,
    onUseWorkspace = null
  }: {
    items: WorkspaceItem[];
    loading?: boolean;
    error?: string | null;
    onAddWorkspace?: (() => void | Promise<void>) | null;
    onUseWorkspace?: ((item: WorkspaceItem) => void | Promise<void>) | null;
  } = $props();
</script>

<section class="settings-section">
  <div class="settings-section-header settings-section-header-action">
    <div>
      <h2>Folders</h2>
      <p>Desktop folders available as workspace context.</p>
    </div>
    {#if onAddWorkspace}
      <button class="action-btn action-btn-primary" disabled={loading} onclick={onAddWorkspace}>
        {loading ? 'Picking...' : 'Pick folder'}
      </button>
    {/if}
  </div>

  {#if error}
    <div class="alert-error settings-section-message">{error}</div>
  {/if}

  {#if items.length === 0}
    <div class="empty-state">
      <div class="text-sm font-medium">No workspaces added yet</div>
      <div class="panel-copy mt-1">Pick a folder to create the first desktop workspace context.</div>
    </div>
  {:else}
    <div class="mesh-item-list">
      {#each items as item}
        <article class="mesh-item-row">
          <div class="mesh-item-main">
            <div class="mesh-item-title">{item.name}</div>
            <div class="mesh-item-description">{item.path}</div>
            <div class="mesh-item-meta">{item.status} · default runtime {item.defaultRuntime}</div>
          </div>
          {#if onUseWorkspace}
            <div class="mesh-item-actions">
              <button class="action-btn" type="button" onclick={() => onUseWorkspace?.(item)}>
                Use
              </button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
