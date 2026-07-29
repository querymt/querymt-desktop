<script lang="ts">
  import { AlertTriangle, CheckCircle2, LoaderCircle, PlugZap } from '@lucide/svelte';
  import InboxRequestCard from '$lib/components/primitives/InboxRequestCard.svelte';
  import type { InboxFormField, InboxItem } from '$lib/domain/types';

  let {
    items,
    loading = false,
    error = null,
    disconnected = false,
    onRetry = null,
    onOpenAgents = null,
    onAction = null,
    onFieldChange = null,
    onCustomFieldToggle = null,
    onCustomFieldChange = null,
    onOpenSession = null
  }: {
    items: InboxItem[];
    loading?: boolean;
    error?: string | null;
    disconnected?: boolean;
    onRetry?: (() => void | Promise<void>) | null;
    onOpenAgents?: (() => void | Promise<void>) | null;
    onAction?: ((itemId: string, actionId: string) => void | Promise<void>) | null;
    onFieldChange?: ((itemId: string, fieldKey: string, value: InboxFormField['value']) => void) | null;
    onCustomFieldToggle?: ((itemId: string, fieldKey: string, active: boolean) => void) | null;
    onCustomFieldChange?: ((itemId: string, fieldKey: string, value: string) => void) | null;
    onOpenSession?: ((item: InboxItem) => void | Promise<void>) | null;
  } = $props();

</script>

<section class="settings-section" aria-label="Requests">
  {#if loading && items.length === 0 && !error}
    <div class="state-skeleton-list" aria-label="Loading requests" aria-busy="true">
      {#each Array(2) as _}
        <div class="state-skeleton-row">
          <span class="state-skeleton-avatar"></span>
          <span class="state-skeleton-copy"><i></i><i></i></span>
          <span class="state-skeleton-actions"></span>
        </div>
      {/each}
    </div>
  {:else if error && items.length === 0}
    <div class="state-panel state-panel-error" role="alert">
      <span class="state-panel-icon"><AlertTriangle size={17} /></span>
      <div class="state-panel-copy"><strong>Requests are unavailable</strong><p>{error}</p></div>
      {#if onRetry}<button class="action-btn" type="button" onclick={onRetry}>Try again</button>{/if}
    </div>
  {:else if disconnected && items.length === 0}
    <div class="state-panel">
      <span class="state-panel-icon"><PlugZap size={17} /></span>
      <div class="state-panel-copy"><strong>No agents connected</strong><p>Connect an agent to receive permission and input requests.</p></div>
      {#if onOpenAgents}<button class="action-btn action-btn-primary" type="button" onclick={onOpenAgents}>Open agents</button>{/if}
    </div>
  {:else if items.length === 0}
    <div class="inbox-empty-state">
      <span class="state-panel-icon"><CheckCircle2 size={16} /></span>
      <span><strong>No requests need attention</strong><small>New permission and input requests will appear here.</small></span>
    </div>
  {:else}
    {#if error}
      <div class="state-inline-error" role="alert">
        <AlertTriangle size={15} />
        <span class="min-w-0 flex-1"><strong>Request status may be out of date.</strong> {error}</span>
        {#if onRetry}<button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={onRetry}>Retry</button>{/if}
      </div>
    {:else if loading}
      <div class="state-inline-progress" role="status"><LoaderCircle size={14} class="animate-spin" /><span>Refreshing agent connections…</span></div>
    {/if}
  {/if}

  <div class="space-y-3">
    {#each items as item}
      <InboxRequestCard
        {item}
        {onAction}
        {onFieldChange}
        {onCustomFieldToggle}
        {onCustomFieldChange}
        {onOpenSession}
      />
    {/each}
  </div>
</section>
