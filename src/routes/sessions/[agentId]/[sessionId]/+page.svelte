<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowLeft, Bug, MessagesSquare, RefreshCw } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import SessionScrollToBottomPill from '$lib/components/session/SessionScrollToBottomPill.svelte';
  import SessionTechnicalDetails from '$lib/components/session/SessionTechnicalDetails.svelte';
  import { formatSessionTimestamp, getSessionById, getSessionWorkspaceName } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const agentId = $derived(decodeURIComponent(page.params.agentId ?? ''));
  const sessionId = $derived(decodeURIComponent(page.params.sessionId ?? ''));
  const selectedSession = $derived(getSessionById(agentsStore.sessionsByAgent[agentId] ?? [], sessionId, agentId));
  const showAgentBadges = $derived(agentsStore.configs.length > 1);
  let composerAnchor = $state<HTMLDivElement | null>(null);
  let showDockedComposer = $state(false);
  let dockAlignLeft = $state<number | null>(null);
  let dockAlignWidth = $state<number | null>(null);
  let debugEventsOpen = $state(false);

  const debugEventsTooltip = $derived.by(() => {
    const count = agentsStore.activeSession.events.length;
    return count === 0 ? 'Debug events' : `Debug events (${count})`;
  });

  function syncDockAlign() {
    if (!composerAnchor) return;
    const rect = composerAnchor.getBoundingClientRect();
    dockAlignLeft = rect.left;
    dockAlignWidth = rect.width;
  }

  onMount(() => {
    let destroyed = false;
    let anchorObserver: IntersectionObserver | null = null;

    const onLayoutChange = () => {
      if (showDockedComposer) {
        syncDockAlign();
      }
    };

    const initialize = async () => {
      await ensureSessionLoaded();
      if (destroyed) {
        return;
      }
      await tick();
      agentsStore.requestPromptFocus();
      composerAnchor?.scrollIntoView({ block: 'end' });

      if (composerAnchor) {
        anchorObserver = new IntersectionObserver(
          ([entry]) => {
            const anchorInView = entry.isIntersecting && entry.intersectionRatio > 0.12;
            if (anchorInView) {
              showDockedComposer = false;
            } else {
              syncDockAlign();
              showDockedComposer = true;
            }
          },
          { root: null, threshold: [0, 0.12, 0.35, 1], rootMargin: '0px 0px 0px 0px' }
        );
        anchorObserver.observe(composerAnchor);
      }
    };

    void initialize();
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('scroll', onLayoutChange, { passive: true });

    return () => {
      destroyed = true;
      anchorObserver?.disconnect();
      anchorObserver = null;
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange);
    };
  });

  async function ensureSessionLoaded() {
    await agentsStore.loadSession(agentId, sessionId);
  }

  async function refreshSession() {
    await agentsStore.refreshSessionsForAgent(agentId);
    await ensureSessionLoaded();
  }

  async function scrollToLatest() {
    composerAnchor?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    await tick();
    agentsStore.requestPromptFocus();
  }
</script>

<div class="session-page session-page-chat">
  <div class="page-toolbar">
    <button class="action-btn" type="button" onclick={() => goto('/sessions')}>
      <ArrowLeft size={16} />
      <span>Back to sessions</span>
    </button>

    <div class="compact-toolbar">
      <IconTooltipButton
        label={debugEventsTooltip}
        icon={Bug}
        size={16}
        onclick={() => (debugEventsOpen = true)}
      />
      <IconTooltipButton label="Refresh session" icon={RefreshCw} size={16} onclick={() => refreshSession()} />
    </div>
  </div>

  <SessionTechnicalDetails session={agentsStore.activeSession} bind:open={debugEventsOpen} />

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
    <ActiveSessionView session={agentsStore.activeSession} onCancel={() => agentsStore.cancelActiveSession()} />

    {#if selectedSession}
      <div
        bind:this={composerAnchor}
        class={`session-composer-anchor ${showDockedComposer ? 'session-composer-anchor-offscreen' : ''}`}
      >
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
          attachments={agentsStore.promptAttachments}
          onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
          onModelChange={(value) => agentsStore.setComposerModel(value)}
          onRefreshModels={() => agentsStore.refreshModelsForAgent(agentId)}
          sessionConfigOptions={agentsStore.activeSession.configOptions}
          sessionConfigPending={agentsStore.sessionConfigPending}
          onSessionConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
          onAddAttachments={(items) => agentsStore.addPromptAttachments(items)}
          onRemoveAttachment={(id) => agentsStore.removePromptAttachment(id)}
          onDismissError={() => agentsStore.clearError()}
          onSendPrompt={() => agentsStore.sendPromptToActiveSession()}
        />
      </div>

      {#if showDockedComposer}
        <SessionScrollToBottomPill
          visible={showDockedComposer}
          alignLeft={dockAlignLeft}
          alignWidth={dockAlignWidth}
          onScrollToBottom={() => void scrollToLatest()}
        />
        <SessionComposer
          docked={true}
          dockAlignLeft={dockAlignLeft}
          dockAlignWidth={dockAlignWidth}
          compact={true}
          sessionOnly={true}
          prompt={agentsStore.composerPrompt}
          loading={agentsStore.loading}
          error={agentsStore.error}
          activeSessionId={agentsStore.activeSessionId}
          modelOptions={agentsStore.modelsByAgent[agentId] ?? []}
          selectedModelId={agentsStore.composerModelId}
          modelInfo={agentsStore.modelInfoByAgent[agentId] ?? {}}
          recentModels={agentsStore.getRecentModels(agentId)}
          modelLoading={!!agentsStore.modelLoadingByAgent[agentId]}
          agentLabel={showAgentBadges ? selectedSession.agentName : null}
          attachments={agentsStore.promptAttachments}
          onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
          onModelChange={(value) => agentsStore.setComposerModel(value)}
          onRefreshModels={() => agentsStore.refreshModelsForAgent(agentId)}
          sessionConfigOptions={agentsStore.activeSession.configOptions}
          sessionConfigPending={agentsStore.sessionConfigPending}
          onSessionConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
          onAddAttachments={(items) => agentsStore.addPromptAttachments(items)}
          onRemoveAttachment={(id) => agentsStore.removePromptAttachment(id)}
          onDismissError={() => agentsStore.clearError()}
          onSendPrompt={() => agentsStore.sendPromptToActiveSession()}
        />
      {/if}
    {/if}
  </div>
</div>