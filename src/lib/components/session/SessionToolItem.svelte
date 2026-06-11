<script lang="ts">
  import { Wrench } from '@lucide/svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';
  import type { SessionToolCallItem } from '$lib/domain/types';

  let {
    tool,
    activeToolCallId = null,
    orphaned = false
  }: {
    tool: SessionToolCallItem;
    activeToolCallId?: string | null;
    orphaned?: boolean;
  } = $props();
</script>

<article class="session-message session-message-tool-item">
  <div class="session-message-header">
    <div class="session-message-meta">
      <span class="session-message-avatar"><Wrench size={14} /></span>
      <div>
        <div class="session-message-role">Tool activity</div>
        <div class="session-message-role-subtle">
          {#if orphaned}
            Standalone tool output
          {:else}
            Linked tool output
          {/if}
        </div>
      </div>
    </div>
    {#if orphaned}
      <span class="badge">standalone</span>
    {/if}
  </div>

  <SessionToolBlock tool={tool} open={tool.id === activeToolCallId || tool.status === 'in_progress' || tool.status === 'failed'} />
</article>
