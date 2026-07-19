<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ArrowLeft, Bug, MessagesSquare, RefreshCw } from '@lucide/svelte';
  import { onMount, tick, untrack } from 'svelte';
  import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import InboxRequestCard from '$lib/components/primitives/InboxRequestCard.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import SessionScrollToBottomPill from '$lib/components/session/SessionScrollToBottomPill.svelte';
  import SessionTechnicalDetails from '$lib/components/session/SessionTechnicalDetails.svelte';
  import {
    getDistanceFromBottom,
    nextSessionChatPresentationState,
    nextSessionScrollMode,
    type SessionChatPresentationState,
    type SessionScrollMode
  } from '$lib/domain/session-scroll';
  import { formatSessionTimestamp, getSessionById, getSessionWorkspaceName } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { inboxStore } from '$lib/stores/inbox.svelte';

  const agentId = $derived(decodeURIComponent(page.params.agentId ?? ''));
  const sessionId = $derived(decodeURIComponent(page.params.sessionId ?? ''));
  const selectedSession = $derived(getSessionById(agentsStore.sessionsByAgent[agentId] ?? [], sessionId, agentId));
  const showAgentBadges = $derived(agentsStore.connectedAgents.length > 1);
  const pendingElicitations = $derived(inboxStore.pendingElicitationsForSession(agentId, sessionId));
  let sessionPage = $state<HTMLDivElement | null>(null);
  let sessionPageContent = $state<HTMLDivElement | null>(null);
  let scrollMode = $state<SessionScrollMode>('following');
  let chatPresentationState = $state<SessionChatPresentationState>('fixed-following');
  let dockAlignLeft = $state<number | null>(null);
  let dockAlignWidth = $state<number | null>(null);
  let debugEventsOpen = $state(false);
  let contentResizeObserver: ResizeObserver | null = null;
  let scrollViewport: HTMLElement | null = null;
  let viewportEventTarget: HTMLElement | Window | null = null;
  let followFrame: number | null = null;
  let programmaticScroll = false;
  let lastViewportScrollTop = 0;
  let sessionLoadToken = 0;
  let lastRequestedSessionKey: string | null = null;

  const debugEventsTooltip = $derived.by(() => {
    const count = agentsStore.activeSession.events.length;
    return count === 0 ? 'Debug events' : `Debug events (${count})`;
  });
  const composerCollapsed = $derived(chatPresentationState === 'fixed-free-compact');
  const latestVisible = $derived(chatPresentationState === 'fixed-free-compact');

  function syncDockAlign() {
    if (!sessionPage) return;
    const rect = sessionPage.getBoundingClientRect();
    dockAlignLeft = rect.left;
    dockAlignWidth = rect.width;
  }

  $effect(() => {
    composerCollapsed;
    void tick().then(() => {
      syncDockAlign();
      if (scrollMode === 'following') scheduleFollowScroll();
    });
  });

  $effect(() => {
    const nextAgentId = agentId;
    const nextSessionId = sessionId;
    if (!nextAgentId || !nextSessionId) {
      return;
    }

    const sessionKey = `${nextAgentId}:${nextSessionId}`;
    if (lastRequestedSessionKey === sessionKey) {
      return;
    }

    lastRequestedSessionKey = sessionKey;
    untrack(() => {
      void loadCurrentSession(nextAgentId, nextSessionId);
    });
  });

  onMount(() => {
    const onLayoutChange = () => syncDockAlign();

    setupScrollTracking();
    window.addEventListener('resize', onLayoutChange);

    return () => {
      sessionLoadToken += 1;
      disconnectScrollTracking();
      window.removeEventListener('resize', onLayoutChange);
    };
  });

  async function ensureSessionLoaded(agentIdToLoad = agentId, sessionIdToLoad = sessionId) {
    await agentsStore.loadSession(agentIdToLoad, sessionIdToLoad);
  }

  async function loadCurrentSession(agentIdToLoad: string, sessionIdToLoad: string) {
    if (!agentIdToLoad || !sessionIdToLoad) {
      return;
    }

    const token = ++sessionLoadToken;
    dockAlignLeft = null;
    dockAlignWidth = null;
    setScrollMode('following');
    programmaticScroll = false;

    await ensureSessionLoaded(agentIdToLoad, sessionIdToLoad);
    if (token !== sessionLoadToken || agentId !== agentIdToLoad || sessionId !== sessionIdToLoad) {
      return;
    }

    await tick();
    if (token !== sessionLoadToken || agentId !== agentIdToLoad || sessionId !== sessionIdToLoad) {
      return;
    }

    agentsStore.requestPromptFocus();
    setupScrollTracking();
    syncDockAlign();
    scrollToEnd('instant');
  }

  function setupScrollTracking() {
    disconnectScrollTracking();
    const viewport = resolveScrollViewport();
    scrollViewport = viewport.element;
    viewportEventTarget = viewport.eventTarget;
    lastViewportScrollTop = scrollViewport.scrollTop;
    viewportEventTarget.addEventListener('scroll', handleViewportScroll, { passive: true });
    viewportEventTarget.addEventListener('wheel', handleViewportWheel, { passive: true });
    viewportEventTarget.addEventListener('touchstart', cancelProgrammaticScroll, { passive: true });
    viewportEventTarget.addEventListener('pointerdown', cancelProgrammaticScroll, { passive: true });

    if (sessionPageContent && typeof ResizeObserver !== 'undefined') {
      contentResizeObserver = new ResizeObserver(() => {
        if (scrollMode === 'following') {
          scheduleFollowScroll();
          return;
        }

        if (scrollViewport) updateChatPresentation(getDistanceFromBottom(scrollViewport));
      });
      contentResizeObserver.observe(sessionPageContent, { box: 'border-box' });
    }
  }

  function disconnectScrollTracking() {
    viewportEventTarget?.removeEventListener('scroll', handleViewportScroll);
    viewportEventTarget?.removeEventListener('wheel', handleViewportWheel);
    viewportEventTarget?.removeEventListener('touchstart', cancelProgrammaticScroll);
    viewportEventTarget?.removeEventListener('pointerdown', cancelProgrammaticScroll);
    contentResizeObserver?.disconnect();
    contentResizeObserver = null;
    scrollViewport = null;
    viewportEventTarget = null;
    if (followFrame !== null) {
      cancelAnimationFrame(followFrame);
      followFrame = null;
    }
  }

  function resolveScrollViewport(): { element: HTMLElement; eventTarget: HTMLElement | Window } {
    const customShell = sessionPage?.closest<HTMLElement>('.app-shell-custom-titlebar');
    if (customShell) return { element: customShell, eventTarget: customShell };

    const element = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
    return { element, eventTarget: window };
  }

  function handleViewportScroll() {
    if (!scrollViewport) return;
    const scrollTop = scrollViewport.scrollTop;
    const direction = scrollTop < lastViewportScrollTop ? 'up' : scrollTop > lastViewportScrollTop ? 'down' : 'none';
    const distanceFromBottom = getDistanceFromBottom(scrollViewport);
    if (programmaticScroll) {
      lastViewportScrollTop = scrollTop;
      if (distanceFromBottom <= 16) {
        programmaticScroll = false;
      }
      return;
    }

    if (scrollMode === 'following' && scrollTop >= lastViewportScrollTop) {
      lastViewportScrollTop = scrollTop;
      return;
    }

    lastViewportScrollTop = scrollTop;
    setScrollMode(nextSessionScrollMode(scrollMode, distanceFromBottom, direction), distanceFromBottom);
    if (scrollMode === 'free') syncDockAlign();
  }

  function handleViewportWheel(event: Event) {
    programmaticScroll = false;
    if (!scrollViewport || scrollMode !== 'free' || !(event instanceof WheelEvent) || event.deltaY <= 0) return;

    const distanceFromBottom = getDistanceFromBottom(scrollViewport);
    const nextMode = nextSessionScrollMode(scrollMode, distanceFromBottom, 'down');
    setScrollMode(nextMode, distanceFromBottom);
    if (nextMode === 'following') {
      lastViewportScrollTop = scrollViewport.scrollTop;
    }
  }

  function cancelProgrammaticScroll() {
    programmaticScroll = false;
  }

  function setScrollMode(mode: SessionScrollMode, distanceFromBottom = 0) {
    scrollMode = mode;
    updateChatPresentation(distanceFromBottom);
  }

  function updateChatPresentation(distanceFromBottom: number) {
    chatPresentationState = nextSessionChatPresentationState(
      chatPresentationState,
      scrollMode,
      distanceFromBottom
    );
  }

  function scheduleFollowScroll() {
    if (followFrame !== null) return;
    followFrame = requestAnimationFrame(() => {
      followFrame = null;
      if (scrollMode === 'following') {
        scrollToEnd('instant');
      }
    });
  }

  function scrollToEnd(behavior: ScrollBehavior | 'instant') {
    const viewport = scrollViewport ?? resolveScrollViewport().element;
    if (behavior === 'instant') {
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }

  async function refreshSession() {
    await agentsStore.refreshSessionsForAgent(agentId);
    lastRequestedSessionKey = null;
    await loadCurrentSession(agentId, sessionId);
  }

  async function scrollToLatest() {
    setScrollMode('following');
    programmaticScroll = true;
    await tick();
    scrollToEnd('smooth');
    agentsStore.requestPromptFocus();
  }

  async function sendPrompt() {
    setScrollMode('following');
    await tick();
    scrollToEnd('instant');
    await agentsStore.sendPromptToActiveSession();
  }
</script>

<div
  bind:this={sessionPage}
  class={`session-page session-page-chat ${composerCollapsed ? 'session-page-composer-compact' : 'session-page-composer-expanded'}`}
>
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

  <div bind:this={sessionPageContent} class="session-page-content">
    <ActiveSessionView session={agentsStore.activeSession} onCancel={() => agentsStore.cancelActiveSession()} />

    {#if pendingElicitations.length > 0}
      <section class="settings-section session-elicitation-panel" aria-label="Session questions">
        <div class="settings-section-header">
          <div>
            <h2>Input needed</h2>
            <p>The agent is waiting for your response before it can continue.</p>
          </div>
        </div>
        <div class="space-y-3">
          {#each pendingElicitations as item}
            <InboxRequestCard
              {item}
              compact={true}
              onAction={(itemId, actionId) => inboxStore.handleAction(itemId, actionId)}
              onFieldChange={(itemId, fieldKey, value) => inboxStore.updateField(itemId, fieldKey, value)}
              onCustomFieldToggle={(itemId, fieldKey, active) =>
                inboxStore.setCustomFieldActive(itemId, fieldKey, active)}
              onCustomFieldChange={(itemId, fieldKey, value) =>
                inboxStore.updateCustomField(itemId, fieldKey, value)}
            />
          {/each}
        </div>
      </section>
    {/if}

    {#if selectedSession}
      {#if latestVisible}
        <SessionScrollToBottomPill
          visible={true}
          alignLeft={dockAlignLeft}
          alignWidth={dockAlignWidth}
          onScrollToBottom={() => void scrollToLatest()}
        />
      {/if}

      <SessionComposer
        docked={true}
        collapsed={composerCollapsed}
        dockAlignLeft={dockAlignLeft}
        dockAlignWidth={dockAlignWidth}
        compact={true}
        sessionOnly={true}
        chatView={true}
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
        onSendPrompt={() => sendPrompt()}
      />
    {/if}

    <div class="session-chat-end-anchor" aria-hidden="true"></div>
  </div>
</div>