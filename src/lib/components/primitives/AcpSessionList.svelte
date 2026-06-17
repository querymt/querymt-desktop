<script lang="ts">
  import type { SessionInfo } from '@agentclientprotocol/sdk';

  export let sessions: SessionInfo[];
</script>

<div class="panel-strong overflow-hidden">
  <div class="border-b border-[var(--border)] px-4 py-3 text-sm font-medium">ACP sessions</div>
  <div class="divide-y divide-[var(--border)]">
    {#if sessions.length === 0}
      <div class="muted px-4 py-4 text-sm">No sessions returned yet.</div>
    {:else}
      {#each sessions as session}
        <div class="px-4 py-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium">{session.title ?? 'Untitled session'}</div>
              <div class="muted mt-1 text-xs">{session.sessionId}</div>
            </div>
            <span class="muted text-xs">{session.updatedAt ?? 'Unknown activity'}</span>
          </div>
          <div class="muted mt-2 text-sm">{session.cwd}</div>
        </div>
      {/each}
    {/if}
  </div>
</div>
