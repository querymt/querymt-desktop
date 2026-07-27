<script lang="ts">
  import { goto } from '$app/navigation';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const connectedAgentCount = $derived(agentsStore.connectedAgents.length);
  const disconnected = $derived(connectedAgentCount === 0);

  async function createWorkspaceSession(cwd: string) {
    agentsStore.setComposerCwd(cwd);
    await goto('/');
    agentsStore.requestPromptFocus();
  }

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
      workspaceGroups={agentsStore.workspaceSessionGroups}
      loading={agentsStore.loading}
      error={agentsStore.error}
      emptyMessage="Start a task and its conversation will appear here."
      {disconnected}
      showAgentNames={connectedAgentCount > 1}
      onRefresh={() => agentsStore.refreshAllSessions()}
      onCreateSession={() => goto('/')}
      onOpenAgents={() => goto('/agents')}
      onOpenWorkspace={(cwd: string) => agentsStore.loadWorkspaceSessions(cwd)}
      onCreateWorkspaceSession={(cwd: string) => createWorkspaceSession(cwd)}
      onLoadMoreWorkspace={(cwd: string) => agentsStore.loadMoreWorkspaceSessions(cwd)}
      onOpenSession={(session: DesktopSessionSummary) => openSession(session)}
      canDeleteSession={(session: DesktopSessionSummary) => agentsStore.canDeleteSession(session.agentId)}
      onDeleteSession={(session: DesktopSessionSummary) => agentsStore.deleteSession(session.agentId, session.sessionId)}
    />
  </div>
</div>
