<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowLeft, MessagesSquare, RefreshCw } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import StickySessionComposer from '$lib/components/session/StickySessionComposer.svelte';
  import { formatSessionTimestamp, getSessionById, getSessionWorkspaceName } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const agentId = $derived(decodeURIComponent(page.params.agentId ?? ''));
  const sessionId = $derived(decodeURIComponent(page.params.sessionId ?? ''));
  const selectedSession = $derived(getSessionById(agentsStore.sessionsByAgent[agentId] ?? [], sessionId, agentId));
  const showAgentBadges = $derived(agentsStore.configs.length > 1);
  let composerAnchor = $state<HTMLDivElement | null>(null);
  let showStickyComposer = $state(false);

  onMount(() => {
    let destroyed = false;

    const updateStickyComposer = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 320;
      showStickyComposer = !nearBottom;
    };

    const initialize = async () => {
      await ensureSessionLoaded();
      if (destroyed) {
        return;
      }
      await tick();
      agentsStore.requestPromptFocus();
      composerAnchor?.scrollIntoView({ block: 'end' });
      updateStickyComposer();
    };

    void initialize();
    window.addEventListener('scroll', updateStickyComposer, { passive: true });
    window.addEventListener('resize', updateStickyComposer);

    return () => {
      destroyed = true;
      window.removeEventListener('scroll', updateStickyComposer);
      window.removeEventListener('resize', updateStickyComposer);
    };
  });

  async function ensureSessionLoaded() {
    await agentsStore.loadSession(agentId, sessionId);
  }

  async function refreshSession() {
    await agentsStore.refreshSessionsForAgent(agentId);
    await ensureSessionLoaded();
  }
</script>

  <div class="session-page page-width-wide">

  <div class="page-toolbar">
    <button class="action-btn" type="button" onclick={() => goto('/sessions')}>
      <ArrowLeft size={16} />
      <span>Back to sessions</span>
    </button>

    <IconTooltipButton label="Refresh session" icon={RefreshCw} size={16} onclick={() => refreshSession()} />
  </div>

  <div class="page-toolbar">
    <SectionHeader
      eyebrow="Session detail"
      title={selectedSession?.title ?? 'Session'}
      description="A calmer chat view with conversation first, supporting activity second, and the reply docked at the bottom."
    />

    <div class="status-strip">
      <span class="status-item">
        <MessagesSquare size={14} />
        <strong>{selectedSession?.status ?? 'unknown'}</strong>
      </span>
      {#if selectedSession}
        <span class="status-item"><strong>{selectedSession.agentName}</strong> agent</span>
        <span class="status-item"><strong>{getSessionWorkspaceName(selectedSession.cwd)}</strong> workspace</span>
        <span class="status-item"><strong>{formatSessionTimestamp(selectedSession.updatedAt)}</strong></span>
      {/if}
    </div>
  </div>

  <div class="session-page-content">
    <ActiveSessionView
      session={agentsStore.activeSession}
      sessionConfigPending={agentsStore.sessionConfigPending}
      onConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
      onCancel={() => agentsStore.cancelActiveSession()}
    />

     {#if selectedSession}
       <div bind:this={composerAnchor} class="session-composer-anchor">
         <SessionComposer
           compact={true}
           sessionOnly={true}
           prompt={agentsStore.composerPrompt}
           loading={agentsStore.loading}
           error={agentsStore.error}
           activeSessionId={agentsStore.activeSessionId}
           promptFocusToken={agentsStore.promptFocusToken}
           modelOptions={agentsStore.modelsByAgent[agentId] ?? []}
           selectedModelId={agentsStore.composerModelId}
           modelInfo={agentsStore.modelInfoByAgent[agentId] ?? {}}
           recentModels={agentsStore.getRecentModels(agentId)}
           modelLoading={!!agentsStore.modelLoadingByAgent[agentId]}
           agentLabel={showAgentBadges ? selectedSession.agentName : null}
           onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
           onModelChange={(value) => agentsStore.setComposerModel(value)}
            onRefreshModels={() => agentsStore.refreshModelsForAgent(agentId)}
            sessionConfigOptions={agentsStore.activeSession.configOptions}
            sessionConfigPending={agentsStore.sessionConfigPending}
            onSessionConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
            onDismissError={() => agentsStore.clearError()}
            onSendPrompt={() => agentsStore.sendPromptToActiveSession()}

         />
       </div>

       <StickySessionComposer
         visible={showStickyComposer}
         prompt={agentsStore.composerPrompt}
         loading={agentsStore.loading}
         onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
         onSendPrompt={() => agentsStore.sendPromptToActiveSession()}
         onExpand={() => {
           composerAnchor?.scrollIntoView({ behavior: 'smooth', block: 'end' });
           agentsStore.requestPromptFocus();
         }}
       />
     {/if}

  </div>
</div>
