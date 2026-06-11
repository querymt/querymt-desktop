<script lang="ts">
  import { goto } from '$app/navigation';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import AcpStatusSummary from '$lib/components/primitives/AcpStatusSummary.svelte';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';

  async function openSession(session: DesktopSessionSummary) {
    await goto(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
  }
</script>

<div class="space-y-4 page-width-wide">
  <SectionHeader
    eyebrow="Organized history"
    title="Sessions"
    description="All online agents are initialized automatically. This page stays focused on the session list only."
  />

  <AcpStatusSummary
    agents={agentsStore.configs.filter((config) => config.enabled)}
    connectionStates={agentsStore.connectionStates}
    controlHealth={agentsStore.controlHealthByAgent}
    errors={agentsStore.agentErrors}
  />

  <DesktopSessionList
    sessions={agentsStore.sessions}
    loading={agentsStore.loading}
    error={agentsStore.error}
    emptyMessage="No sessions yet from the currently configured agents."
    onRefresh={() => agentsStore.refreshAllSessions()}
    onOpenSession={(session: DesktopSessionSummary) => openSession(session)}
  />
</div>
