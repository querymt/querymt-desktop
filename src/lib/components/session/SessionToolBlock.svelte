<script lang="ts">
  import { AlertTriangle, CheckCircle2, ChevronDown, LoaderCircle, TerminalSquare } from '@lucide/svelte';
  import type { SessionToolCallItem } from '$lib/domain/types';

  let {
    tool,
    open = false
  }: {
    tool: SessionToolCallItem;
    open?: boolean;
  } = $props();

  let detailsOpen = $state(false);
  let userToggled = $state(false);
  let lastToolStateKey = $state('');

  $effect(() => {
    const nextKey = `${tool.id}:${tool.status}:${open ? 'open' : 'closed'}`;
    if (nextKey !== lastToolStateKey) {
      lastToolStateKey = nextKey;
      if (!userToggled || open) {
        detailsOpen = open;
      }
      if (open) {
        userToggled = false;
      }
    }
  });

  const statusLabel = $derived(tool.status.replace('_', ' '));

  function handleToggle(event: Event) {
    const target = event.currentTarget as HTMLDetailsElement;
    detailsOpen = target.open;
    userToggled = true;
  }
</script>

<details
  class={`details-reset session-tool-block ${tool.status === 'failed' ? 'session-tool-block-failed' : tool.status === 'in_progress' ? 'session-tool-block-running' : tool.status === 'completed' ? 'session-tool-block-complete' : ''}`}
  bind:open={detailsOpen}
  ontoggle={handleToggle}
>
  <summary class="session-tool-summary">
    <span class="session-tool-status-rail" aria-hidden="true"></span>
    <div class="session-tool-summary-main">
      <span class="session-tool-icon">
        {#if tool.status === 'failed'}
          <AlertTriangle size={14} />
        {:else if tool.status === 'in_progress'}
          <LoaderCircle size={14} class="animate-spin" />
        {:else if tool.status === 'completed'}
          <CheckCircle2 size={14} />
        {:else}
          <TerminalSquare size={14} />
        {/if}
      </span>
      <div class="session-tool-summary-copy">
        <div class="session-tool-title">{tool.title}</div>
        <div class="session-tool-summary-meta">{tool.kind ?? 'tool'} · {statusLabel}</div>
      </div>
    </div>
    <span class="session-tool-disclosure" aria-hidden="true"><ChevronDown size={14} /></span>
  </summary>

  {#if tool.arguments || tool.result}
    <div class="session-tool-content">
      {#if tool.arguments}
        <div class="session-tool-detail">
          <div class="session-tool-detail-label">Parameters</div>
          <pre>{tool.arguments}</pre>
        </div>
      {/if}
      {#if tool.result}
        <div class="session-tool-detail">
          <div class="session-tool-detail-label">Result</div>
          <pre>{tool.result}</pre>
        </div>
      {/if}
    </div>
  {/if}
</details>
