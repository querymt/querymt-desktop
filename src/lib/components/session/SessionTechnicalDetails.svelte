<script lang="ts">
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let { session }: { session: ActiveSessionViewModel } = $props();
</script>

<details class="details-reset surface-muted p-4">
  <summary class="text-sm font-medium">Debug events</summary>
  <div class="mt-3 space-y-2">
    {#if session.events.length === 0}
      <div class="muted text-sm">No technical events recorded yet.</div>
    {:else}
      {#each session.events as event}
        <div class="surface-muted px-3 py-2">
          <div class="muted mb-1 text-[11px] uppercase tracking-[0.16em]">{event.kind}</div>
          <div class="whitespace-pre-wrap text-sm">{event.text}</div>
        </div>
      {/each}
    {/if}
  </div>
</details>
