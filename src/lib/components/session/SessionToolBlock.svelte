<script lang="ts">
  import { AlertTriangle, CheckCircle2, LoaderCircle, TerminalSquare } from '@lucide/svelte';
  import type { SessionToolCallItem } from '$lib/domain/types';

  let {
    tool,
    open = false
  }: {
    tool: SessionToolCallItem;
    open?: boolean;
  } = $props();
</script>

<details class={`details-reset session-tool-block ${tool.status === 'failed' ? 'session-tool-block-failed' : tool.status === 'in_progress' ? 'session-tool-block-running' : tool.status === 'completed' ? 'session-tool-block-complete' : ''}`} {open}>
  <summary class="session-tool-summary">
    <div class="session-tool-summary-main">
      <span class="session-tool-icon">
        {#if tool.status === 'failed'}
          <AlertTriangle size={14} />
        {:else if tool.status === 'in_progress'}
          <LoaderCircle size={14} />
        {:else if tool.status === 'completed'}
          <CheckCircle2 size={14} />
        {:else}
          <TerminalSquare size={14} />
        {/if}
      </span>
      <div>
        <div class="text-sm font-medium">{tool.title}</div>
        <div class="session-tool-summary-meta">{tool.kind ?? 'tool'} · {tool.status}</div>
      </div>
    </div>
    <span class="badge">{tool.status}</span>
  </summary>

  <div class="session-tool-content">
    {#if tool.arguments}
      <div>
        <div class="muted mb-1 uppercase tracking-[0.16em]">Parameters</div>
        <pre class="surface-muted overflow-x-auto p-3 whitespace-pre-wrap">{tool.arguments}</pre>
      </div>
    {/if}
    {#if tool.result}
      <div>
        <div class="muted mb-1 uppercase tracking-[0.16em]">Result</div>
        <pre class="surface-muted overflow-x-auto p-3 whitespace-pre-wrap">{tool.result}</pre>
      </div>
    {/if}
  </div>
</details>
