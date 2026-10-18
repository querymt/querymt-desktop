<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { LoaderCircle, RefreshCw } from '@lucide/svelte';
  import { goto } from '$app/navigation';
  import DesktopSessionList from '$lib/components/primitives/DesktopSessionList.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { WorkspaceSessionGroup } from '$lib/domain/sessions';
  import type { DesktopSessionSummary } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { SESSION_CATALOG_FRESH_MS } from '$lib/stores/session-catalog-cache';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';

  const connectedAgentCount = $derived(agentsStore.connectedAgents.length);
  const disconnected = $derived(connectedAgentCount === 0);
  const refreshing = $derived(agentsStore.sessionCatalogLoading && agentsStore.sessionCatalog.length > 0);
  const catalogTrigger = $derived(JSON.stringify([
    agentsStore.sessionBrowser.resolution, agentsStore.sessionBrowser.archive,
    agentsStore.connectedAgents.map((agent) => [agent.id, agentsStore.connectionStates[agent.id] === 'initialized' || agentsStore.connectionStates[agent.id] === 'loading-sessions', agentsStore.canSetSessionLifecycle(agent.id)]),
    chatPreferencesStore.showRemoteSessions, chatPreferencesStore.remoteSessionPeers,
    agentsStore.sessionLifecycleRevision
  ]));

  $effect(() => {
    void catalogTrigger;
    untrack(() => { void agentsStore.ensureSessionCatalog(); });
  });

  onMount(() => {
    const frame = requestAnimationFrame(() => {
      const viewport = document.querySelector<HTMLElement>('.app-shell-custom-titlebar') ?? window;
      viewport.scrollTo({ top: agentsStore.sessionBrowser.scrollTop });
    });
    const reconcile = () => {
      if (!document.hidden) void agentsStore.ensureSessionCatalog();
    };
    const timer = setInterval(reconcile, SESSION_CATALOG_FRESH_MS);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reconcile);
    };
  });

  async function createWorkspaceSession(group: WorkspaceSessionGroup, targetNodeId?: string) {
    const remoteNodeId = targetNodeId && targetNodeId !== 'local' ? targetNodeId
      : !targetNodeId && group.location === 'remote' && group.remoteMachines?.length === 1
        ? group.remoteMachines[0].id : null;
    const owner = group.sessions.find((session) => remoteNodeId
      ? session.location === 'remote' && session.remoteNodeId === remoteNodeId
      : session.location !== 'remote');
    agentsStore.setComposerCwd(group.cwd);
    agentsStore.setComposerAgent(owner?.agentId ?? null);
    agentsStore.setComposerTarget(remoteNodeId ?? 'local');
    await goto('/');
    agentsStore.requestPromptFocus();
  }

  async function openSession(session: DesktopSessionSummary) {
    const viewport = document.querySelector<HTMLElement>('.app-shell-custom-titlebar');
    agentsStore.sessionBrowser.scrollTop = viewport?.scrollTop ?? window.scrollY;
    await goto(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
  }

  async function deleteSession(session: DesktopSessionSummary) {
    await agentsStore.deleteSession(session.agentId, session.sessionId);
    await agentsStore.refreshSessionCatalog();
  }
</script>

<div class="sessions-page">
  <div class="page-toolbar sessions-page-toolbar">
    <SectionHeader title="Sessions" description="Manage your working sessions and browse conversation history." />
    <div class="compact-toolbar sessions-page-actions">
      <IconTooltipButton
        label={refreshing ? 'Refreshing sessions' : 'Refresh sessions'}
        icon={refreshing ? LoaderCircle : RefreshCw}
        iconClass={refreshing ? 'animate-spin' : ''}
        size={16}
        disabled={agentsStore.sessionCatalogLoading}
        onclick={() => agentsStore.refreshSessionCatalog()}
      />
    </div>
  </div>
  <div class="sessions-unified-panel">
    <DesktopSessionList
      sessions={agentsStore.sessionCatalog}
      bind:browserState={agentsStore.sessionBrowser}
      catalogComplete={true}
      hasAnySessions={agentsStore.sessionCatalogHasSessions}
      loading={agentsStore.sessionCatalogLoading}
      loadedSessionCount={agentsStore.sessionCatalogLoadedCount}
      error={agentsStore.sessionCatalogError}
      excludedAgents={agentsStore.sessionCatalogExcludedAgents}
      supportedAgentCount={agentsStore.sessionCatalogSupportedAgentCount}
      emptyMessage="Start a task and its conversation will appear here."
      {disconnected}
      showAgentNames={connectedAgentCount > 1}
      showRemoteSessions={chatPreferencesStore.showRemoteSessions}
      showToolbarRefresh={false}
      onRefresh={() => agentsStore.refreshSessionCatalog()}
      onCreateSession={() => goto('/')}
      onOpenAgents={() => goto('/agents')}
      onCreateWorkspaceSession={createWorkspaceSession}
      onOpenSession={openSession}
      canManageLifecycle={(session) => agentsStore.canSetSessionLifecycle(session.agentId) && session.remoteConnectionState !== 'disconnected'}
      lifecyclePending={agentsStore.sessionLifecyclePending}
      lifecycleErrors={agentsStore.sessionLifecycleErrors}
      onSetLifecycle={(session, patch) => agentsStore.setSessionLifecycle(session.agentId, session.sessionId, patch)}
      canDeleteSession={(session) => session.location !== 'remote' && agentsStore.canDeleteSession(session.agentId)}
      onDeleteSession={deleteSession}
    />
  </div>
</div>
