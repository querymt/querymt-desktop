<script lang="ts">
  import InboxRequestCard from '$lib/components/primitives/InboxRequestCard.svelte';
  import type { InboxFormField, InboxItem } from '$lib/domain/types';

  let {
    items,
    onAction = null,
    onFieldChange = null,
    onCustomFieldToggle = null,
    onCustomFieldChange = null,
    onOpenSession = null
  }: {
    items: InboxItem[];
    onAction?: ((itemId: string, actionId: string) => void | Promise<void>) | null;
    onFieldChange?: ((itemId: string, fieldKey: string, value: InboxFormField['value']) => void) | null;
    onCustomFieldToggle?: ((itemId: string, fieldKey: string, active: boolean) => void) | null;
    onCustomFieldChange?: ((itemId: string, fieldKey: string, value: string) => void) | null;
    onOpenSession?: ((item: InboxItem) => void | Promise<void>) | null;
  } = $props();

</script>

<section class="settings-section">
  <div class="settings-section-header">
    <div>
      <h2>Requests</h2>
      <p>Permission and elicitation requests from active agents.</p>
    </div>
  </div>

  {#if items.length === 0}
    <div class="empty-state">
      <div class="text-sm font-medium">No requests need attention</div>
      <div class="panel-copy mt-1">Permission and elicitation requests will appear here while an active agent needs your input.</div>
    </div>
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
