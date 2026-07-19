<script lang="ts">
  import { goto } from '$app/navigation';
  import InboxList from '$lib/components/primitives/InboxList.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { InboxItem } from '$lib/domain/types';
  import { inboxStore } from '$lib/stores/inbox.svelte';

  async function openSession(item: InboxItem) {
    if (!item.agentId || !item.sessionId) {
      return;
    }

    await goto(`/sessions/${encodeURIComponent(item.agentId)}/${encodeURIComponent(item.sessionId)}`);
  }
</script>

<div class="agents-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Inbox"
      description="Permission and elicitation requests that need human attention."
    />
  </div>

  <div class="agents-unified-panel">
    <InboxList
      items={inboxStore.items}
      onAction={(itemId, actionId) => inboxStore.handleAction(itemId, actionId)}
      onFieldChange={(itemId, fieldKey, value) => inboxStore.updateField(itemId, fieldKey, value)}
      onCustomFieldToggle={(itemId, fieldKey, active) => inboxStore.setCustomFieldActive(itemId, fieldKey, active)}
      onCustomFieldChange={(itemId, fieldKey, value) => inboxStore.updateCustomField(itemId, fieldKey, value)}
      onOpenSession={(item) => openSession(item)}
    />
  </div>
</div>
