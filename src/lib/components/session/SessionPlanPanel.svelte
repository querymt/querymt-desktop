<script lang="ts">
  import { CheckCircle2, CheckSquare2, Circle, Flame, LoaderCircle, MinusCircle } from '@lucide/svelte';
  import Shimmer from '$lib/components/ai-elements/shimmer.svelte';
  import type { ActiveSessionViewModel, SessionPlanEntry } from '$lib/domain/types';

  let { session }: { session: ActiveSessionViewModel } = $props();

  const planStats = $derived.by(() => ({
    total: session.plans.length,
    completed: session.plans.filter((entry) => entry.status === 'completed').length
  }));

  function statusMeta(status: SessionPlanEntry['status']) {
    switch (status) {
      case 'completed':
        return { label: 'Completed', tone: 'session-plan-chip-complete', icon: CheckCircle2, spin: false };
      case 'in_progress':
        return { label: 'In progress', tone: 'session-plan-chip-running', icon: LoaderCircle, spin: true };
      default:
        return { label: 'Pending', tone: 'session-plan-chip-pending', icon: Circle, spin: false };
    }
  }

  function priorityMeta(priority: SessionPlanEntry['priority']) {
    switch (priority) {
      case 'high':
        return { label: 'High', tone: 'session-plan-chip-high', icon: Flame };
      case 'medium':
        return { label: 'Medium', tone: 'session-plan-chip-medium', icon: MinusCircle };
      default:
        return { label: 'Low', tone: 'session-plan-chip-low', icon: Circle };
    }
  }
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
        {@const status = statusMeta(entry.status)}
        {@const priority = priorityMeta(entry.priority)}
        <div class="session-plan-card">
          <div class="text-sm">{entry.content}</div>
          <div class="session-plan-card-meta">
            <span class={`session-plan-chip ${status.tone}`}>
              <status.icon size={13} class={status.spin ? 'animate-spin' : undefined} />
              <span>{status.label}</span>
            </span>
            <span class={`session-plan-chip ${priority.tone}`}>
              <priority.icon size={13} />
              <span>{priority.label}</span>
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>
