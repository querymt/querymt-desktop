<script lang="ts">
  import { goto } from '$app/navigation';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';

  async function openSession(session: DesktopSessionSummary) {
    await goto(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
  }
</script>

<div class="space-y-5 page-width-wide">
  <h1 class="text-2xl font-semibold tracking-tight text-[var(--text)]">Sessions</h1>

  <DesktopSessionList
    sessions={agentsStore.sessions}
    loading={agentsStore.loading}
    error={agentsStore.error}
    emptyMessage="No sessions yet from the currently configured agents."
    onRefresh={() => agentsStore.refreshAllSessions()}
    onOpenSession={(session: DesktopSessionSummary) => openSession(session)}
  />
</div>
