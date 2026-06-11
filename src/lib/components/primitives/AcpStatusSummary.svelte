<script lang="ts">
  import { CircleAlert } from '@lucide/svelte';
  import type { AgentConfig, AgentConnectionState, AgentControlHealth } from '$lib/domain/types';

  let {
    agents,
    connectionStates,
    controlHealth,
    errors
  }: {
    agents: AgentConfig[];
    connectionStates: Record<string, AgentConnectionState>;
    controlHealth: Record<string, AgentControlHealth>;
    errors: Record<string, string | null>;
  } = $props();
</script>

<div class="panel px-4 py-3">
  <div class="page-toolbar">
    <div>
      <div class="text-sm font-medium">Online agents</div>
      <div class="panel-copy mt-1">All enabled agents auto-start and contribute sessions here.</div>
    </div>

    <div class="status-strip">
      {#each agents as agent}
        <span class="status-item">
          <strong>{agent.name}</strong>
          <span>{connectionStates[agent.id] ?? 'idle'}</span>
          <span>{controlHealth[agent.id]?.state ?? 'unknown'}</span>
        </span>
      {/each}
    </div>
  </div>

  {#if Object.values(errors).some(Boolean)}
    <div class="mt-3 space-y-2">
      {#each agents as agent}
        {#if errors[agent.id]}
          <div class="flex items-start gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <CircleAlert size={16} class="mt-0.5 shrink-0" />
            <span><strong>{agent.name}:</strong> {errors[agent.id]}</span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>
