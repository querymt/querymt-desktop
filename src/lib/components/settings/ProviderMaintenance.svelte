<script lang="ts">
  import { ChevronDown, LoaderCircle, RefreshCw } from '@lucide/svelte';
  import type { PluginUpdateResult } from '$lib/querymt/generated/types';

  let {
    modelCount,
    refreshingModels = false,
    updatingPlugins = false,
    pluginProgress = null,
    lastPluginUpdate = null,
    error = null,
    message = null,
    onRefreshModels,
    onUpdatePlugins
  }: {
    modelCount: number;
    refreshingModels?: boolean;
    updatingPlugins?: boolean;
    pluginProgress?: {
      plugin_name: string;
      phase: string;
      percent?: number;
      message?: string;
    } | null;
    lastPluginUpdate?: PluginUpdateResult[] | null;
    error?: string | null;
    message?: string | null;
    onRefreshModels: () => void;
    onUpdatePlugins: () => void;
  } = $props();

  let open = $state(false);
  let resultDetailsOpen = $state(false);
  const failedUpdates = $derived(lastPluginUpdate?.filter((result) => !result.success) ?? []);
</script>

<section class="provider-maintenance">
  <button class="settings-advanced-trigger" type="button" aria-expanded={open} onclick={() => (open = !open)}>
    <span>
      <strong>Advanced maintenance</strong>
      <small>Refresh model availability and update provider plugins.</small>
    </span>
    <ChevronDown size={16} class={open ? 'settings-advanced-chevron-open' : ''} />
  </button>

  {#if open}
    <div class="provider-maintenance-content">
      <div class="settings-simple-row">
        <div class="settings-simple-main">
          <h3>Models</h3>
          <p>{modelCount} available {modelCount === 1 ? 'model' : 'models'} for the selected agent.</p>
        </div>
        <button class="action-btn" type="button" disabled={refreshingModels} onclick={onRefreshModels}>
          {#if refreshingModels}<LoaderCircle size={14} class="animate-spin" />{:else}<RefreshCw size={14} />{/if}
          {refreshingModels ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div class="settings-simple-row provider-maintenance-plugin-row">
        <div class="settings-simple-main">
          <h3>Plugins</h3>
          <p>Update installed provider integrations.</p>
        </div>
        <button class="action-btn" type="button" disabled={updatingPlugins} onclick={onUpdatePlugins}>
          {#if updatingPlugins}<LoaderCircle size={14} class="animate-spin" />{/if}
          {updatingPlugins ? 'Updating…' : 'Update'}
        </button>
      </div>

      {#if pluginProgress}
        <div class="provider-maintenance-progress" role="status">
          <div>
            <strong>{pluginProgress.plugin_name}</strong>
            <span>{pluginProgress.phase}{pluginProgress.percent != null ? ` · ${pluginProgress.percent.toFixed(0)}%` : ''}</span>
          </div>
          {#if pluginProgress.percent != null}<progress max="100" value={pluginProgress.percent}>{pluginProgress.percent}%</progress>{/if}
          {#if pluginProgress.message}<p>{pluginProgress.message}</p>{/if}
        </div>
      {/if}

      {#if error}<div class="alert-error provider-maintenance-message" role="alert">{error}</div>{/if}
      {#if message}<div class="alert-success provider-maintenance-message" role="status">{message}</div>{/if}

      {#if failedUpdates.length > 0}
        <div class="provider-maintenance-results">
          <button type="button" aria-expanded={resultDetailsOpen} onclick={() => (resultDetailsOpen = !resultDetailsOpen)}>
            {failedUpdates.length} plugin {failedUpdates.length === 1 ? 'update needs' : 'updates need'} attention
            <ChevronDown size={14} class={resultDetailsOpen ? 'settings-advanced-chevron-open' : ''} />
          </button>
          {#if resultDetailsOpen}
            <div class="provider-maintenance-result-list">
              {#each failedUpdates as result}
                <div><strong>{result.plugin_name}</strong><span>{result.message ?? 'Update failed.'}</span></div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
