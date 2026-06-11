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

<div class="panel-strong overflow-hidden">
  <div class="flex items-center justify-between gap-4 border-b border-white/8 px-4 py-3">
    <div>
      <div class="text-sm font-medium">Workspaces</div>
      <div class="muted mt-1 text-xs">Desktop folders and quick context shortcuts.</div>
    </div>
    {#if onAddWorkspace}
      <button class="action-btn !px-3 !py-1.5 text-xs" disabled={loading} onclick={onAddWorkspace}>
        {loading ? 'Picking…' : 'Pick folder'}
      </button>
    {/if}
  </div>

  {#if error}
    <div class="border-b border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
  {/if}

  <div class="divide-y divide-white/8">
    {#if items.length === 0}
      <div class="muted px-4 py-5 text-sm">No workspaces added yet. Pick a folder to create the first desktop workspace context.</div>
    {/if}

    {#each items as item}
      <article class="px-4 py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-sm font-semibold">{item.name}</h3>
            <p class="muted mt-1 text-sm">{item.path}</p>
          </div>
          <span class="badge">{item.status}</span>
        </div>
        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="muted text-xs">Default runtime: {item.defaultRuntime}</div>
          {#if onUseWorkspace}
            <button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={() => onUseWorkspace?.(item)}>
              Use in session
            </button>
          {/if}
        </div>
      </article>
    {/each}
  </div>
</div>
