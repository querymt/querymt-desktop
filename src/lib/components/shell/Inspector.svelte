<script lang="ts">
  import { goto } from '$app/navigation';
  import type { InboxItem, TimelineEvent } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { inboxStore } from '$lib/stores/inbox.svelte';

  async function openSession(item: InboxItem) {
    if (!item.agentId || !item.sessionId) {
      return;
    }

    await goto(`/sessions/${encodeURIComponent(item.agentId)}/${encodeURIComponent(item.sessionId)}`);
  }

  const recentEvents = $derived.by(() => {
    const events: TimelineEvent[] = [];

    if (inboxStore.actionableItems.length > 0) {
      events.push({
        id: 'inspector-inbox',
        title: 'Inbox waiting',
        detail: `${inboxStore.actionableItems.length} live request(s) need approval or input.`,
        when: 'Now',
        kind: 'approval'
      });
    }

    if (agentsStore.activeSessionId && agentsStore.activeAgentId) {
      events.push({
        id: 'inspector-session',
        title: 'Active session',
        detail: `${agentsStore.activeSession.events.length} event(s) have streamed into the current session.`,
        when: 'Live',
        kind: 'run'
      });
    }

    for (const config of agentsStore.configs) {
      const status = agentsStore.statuses[config.id];
      if (!status) {
        continue;
      }

      if (status.state === 'running') {
        events.push({
          id: `inspector-${config.id}`,
          title: `${config.name} online`,
          detail: status.message,
          when: 'Live',
          kind: 'run'
        });
      } else if (status.state === 'failed') {
        events.push({
          id: `inspector-${config.id}-failed`,
          title: `${config.name} needs attention`,
          detail: status.lastError || status.message,
          when: 'Now',
          kind: 'warning'
        });
      }
    }

    return events.slice(0, 3);
  });
</script>

<aside class="panel flex h-full flex-col gap-4 p-4">
  <div>
    <div class="text-sm font-medium">Inspector</div>
    <div class="muted text-xs">Context, alerts, and recent activity.</div>
  </div>

  <section class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <div class="text-xs uppercase tracking-[0.2em] text-slate-400">Pending inbox</div>
      <span class="badge">{inboxStore.pendingCount}</span>
    </div>

    {#if inboxStore.actionableItems.length > 0}
      {#each inboxStore.actionableItems.slice(0, 2) as item}
        <div class="rounded-2xl border border-white/8 bg-white/4 p-3">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>{item.title}</span>
            <span class="badge">{item.type}</span>
          </div>
          <div class="muted mt-1 text-xs">{item.detail}</div>
          {#if item.agentName}
            <div class="muted mt-1 text-xs">{item.agentName}</div>
          {/if}
          {#if item.sessionId && item.agentId}
            <div class="mt-3">
              <button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={() => openSession(item)}>
                Open session
              </button>
            </div>
          {/if}
        </div>
      {/each}
    {:else}
      <div class="rounded-2xl border border-white/8 bg-white/4 p-3">
        <div class="text-sm font-medium">No live requests</div>
        <div class="muted mt-1 text-xs">Permission and elicitation requests will appear here once an agent needs input.</div>
      </div>
    {/if}
  </section>

  <section class="space-y-3">
    <div class="text-xs uppercase tracking-[0.2em] text-slate-400">Recent events</div>
    {#if recentEvents.length === 0}
      <div class="rounded-2xl border border-white/8 bg-white/4 p-3">
        <div class="text-sm font-medium">No live activity</div>
        <div class="muted mt-1 text-xs">Start a configured agent to populate live activity here.</div>
      </div>
    {:else}
      {#each recentEvents as event}
        <div class="rounded-2xl border border-white/8 bg-white/4 p-3">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>{event.title}</span>
            <span class="muted text-xs">{event.when}</span>
          </div>
          <div class="muted mt-1 text-xs">{event.detail}</div>
        </div>
      {/each}
    {/if}
  </section>
</aside>
