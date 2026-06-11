<script lang="ts">
  import type { TimelineEvent } from '$lib/domain/types';

  export let events: TimelineEvent[];
</script>

<div class="panel-strong p-4">
  <div class="mb-4 text-sm font-medium">Run timeline</div>
  {#if events.length === 0}
    <div class="muted rounded-2xl border border-white/8 bg-black/10 px-4 py-3 text-sm">
      No live activity yet. Start a session or connect the runtime to populate this timeline.
    </div>
  {:else}
    <div class="space-y-4">
      {#each events as event}
        <div class="flex gap-3">
          <div class="mt-1 h-2.5 w-2.5 rounded-full bg-sky-300"></div>
          <div>
            <div class="flex items-center gap-3 text-sm">
              <span class="font-medium">{event.title}</span>
              <span class="muted text-xs">{event.when}</span>
            </div>
            <div class="muted mt-1 text-sm">{event.detail}</div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
