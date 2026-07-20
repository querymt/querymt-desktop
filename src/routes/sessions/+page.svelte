<script lang="ts">
  import { goto } from '$app/navigation';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';

  async function openSession(session: DesktopSessionSummary) {
    await goto(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
  }
</script>

<div class="sessions-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Sessions"
      description="Browse conversations grouped by workspace."
    />
  </div>

  <div class="sessions-unified-panel">
    <DesktopSessionList
      sessions={agentsStore.sessions}
      loading={agentsStore.loading}
      error={agentsStore.error}
      emptyMessage="No sessions yet from the currently configured agents."
      onRefresh={() => agentsStore.refreshAllSessions()}
      onOpenSession={(session: DesktopSessionSummary) => openSession(session)}
      canDeleteSession={(session: DesktopSessionSummary) => agentsStore.canDeleteSession(session.agentId)}
      onDeleteSession={(session: DesktopSessionSummary) => agentsStore.deleteSession(session.agentId, session.sessionId)}
    />
  </div>
</div>
