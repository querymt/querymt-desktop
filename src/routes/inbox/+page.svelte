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

<div class="space-y-4">
  <SectionHeader
    eyebrow="Human loop"
    title="Inbox"
    description="Things that need human attention across agents and background work."
  />

  <InboxList
    items={inboxStore.items}
    onAction={(itemId, actionId) => inboxStore.handleAction(itemId, actionId)}
    onFieldChange={(itemId, fieldKey, value) => inboxStore.updateField(itemId, fieldKey, value)}
    onOpenSession={(item) => openSession(item)}
  />
</div>
