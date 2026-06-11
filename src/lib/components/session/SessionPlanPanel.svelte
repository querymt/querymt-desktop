<script lang="ts">
  import { CheckSquare2 } from '@lucide/svelte';
  import Shimmer from '$lib/components/ai-elements/shimmer.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let { session }: { session: ActiveSessionViewModel } = $props();

  const planStats = $derived.by(() => ({
    total: session.plans.length,
    completed: session.plans.filter((entry) => entry.status === 'completed').length
  }));
</script>

<section class="surface-muted p-4">
  <div class="mb-3 row-tight text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
    <CheckSquare2 size={14} />
    <span>Plan</span>
  </div>
  {#if session.plans.length === 0}
    <div class="muted text-sm">No active plan.</div>
  {:else}
    <div class="mb-3 flex items-center justify-between text-xs text-[var(--muted)]">
      <span>{planStats.completed} / {planStats.total} complete</span>
      {#if session.runState === 'thinking' || session.runState === 'tool-running'}
        <Shimmer text="Updating plan…" class="text-xs" />
      {/if}
    </div>
    <div class="space-y-2">
      {#each session.plans as entry}
        <div class="session-plan-card">
          <div class="text-sm">{entry.content}</div>
          <div class="muted mt-2 text-xs">{entry.status} / {entry.priority}</div>
        </div>
      {/each}
    </div>
  {/if}
</section>
