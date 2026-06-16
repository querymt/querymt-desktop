<script lang="ts">
  import type { SessionItem } from '$lib/domain/types';

  export let sessions: SessionItem[];
</script>

<div class="panel-strong overflow-hidden">
  <div class="border-b border-[var(--border)] px-4 py-3 text-sm font-medium">Sessions</div>
  <div class="divide-y divide-[var(--border)]">
    {#each sessions as session}
      <div class="px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-medium">{session.title}</div>
            <div class="muted mt-1 text-xs">{session.runtime} / {session.workspace}</div>
          </div>
          <span class="badge">{session.status}</span>
        </div>
        <div class="muted mt-2 text-sm">{session.lastMessage}</div>
        <div class="muted mt-2 text-xs">Updated {session.updatedAt}</div>
      </div>
    {/each}
  </div>
</div>
