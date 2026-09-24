<script lang="ts">
  import { LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const connectedAgentCount = $derived(agentsStore.connectedAgents.length);
  const disconnected = $derived(connectedAgentCount === 0);
  const refreshing = $derived(agentsStore.loading && agentsStore.workspaceSessionGroups.length > 0);

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
  <div class="page-toolbar sessions-page-toolbar">
    <SectionHeader
      title="Sessions"
      description="Browse conversations grouped by workspace."
    />

    <div class="compact-toolbar sessions-page-actions">
      <IconTooltipButton
        label={refreshing ? 'Refreshing sessions' : 'Refresh sessions'}
        icon={refreshing ? LoaderCircle : RefreshCw}
        iconClass={refreshing ? 'animate-spin' : ''}
        size={16}
        disabled={agentsStore.loading}
        onclick={() => agentsStore.refreshAllSessions()}
      />
    </div>
  </div>

  <div class="sessions-unified-panel">
    <DesktopSessionList
      workspaceGroups={agentsStore.workspaceSessionGroups}
      loading={agentsStore.loading}
      error={agentsStore.error}
      emptyMessage="Start a task and its conversation will appear here."
      {disconnected}
      showAgentNames={connectedAgentCount > 1}
      showToolbarRefresh={false}
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
