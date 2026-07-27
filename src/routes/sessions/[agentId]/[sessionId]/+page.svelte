<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick, untrack } from 'svelte';
  import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
  import InboxRequestCard from '$lib/components/primitives/InboxRequestCard.svelte';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import SessionScrollToBottomPill from '$lib/components/session/SessionScrollToBottomPill.svelte';
  import SessionForkDialog from '$lib/components/session/SessionForkDialog.svelte';
  import SessionHeader from '$lib/components/session/SessionHeader.svelte';
  import SessionTechnicalDetails from '$lib/components/session/SessionTechnicalDetails.svelte';
  import SessionUndoDialog from '$lib/components/session/SessionUndoDialog.svelte';
  import {
    getDistanceFromBottom,
    nextSessionChatPresentationState,
    nextSessionScrollMode,
    type SessionChatPresentationState,
    type SessionScrollMode
  } from '$lib/domain/session-scroll';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { formatSessionTimestamp, getSessionById, getSessionWorkspaceName } from '$lib/domain/sessions';
  import { getForkTarget, getLatestForkTarget, type SessionForkTarget } from '$lib/domain/session-fork';
  import { getCurrentUndoTarget, getUndoAffectedTurnCount, getUndoableSessionTurns, isTurnReverted } from '$lib/domain/session-undo';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
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
  let followScrollVersion = 0;
  let programmaticScroll = false;
  let lastViewportScrollTop = 0;
  let sessionLoadToken = 0;
  let lastRequestedSessionKey: string | null = null;
  let undoDialogOpen = $state(false);
  let undoTargetMessageId = $state<string | null>(null);
  let forkDialogOpen = $state(false);
  let forkTarget = $state<SessionForkTarget | null>(null);

  const debugEventsTooltip = $derived.by(() => {
    const count = agentsStore.activeSession.events.length;
    return count === 0 ? 'Debug events' : `Debug events (${count})`;
  });
  const composerCollapsed = $derived(chatPresentationState === 'fixed-free-compact');
  const undoSupported = $derived(agentId ? agentsStore.canUseSessionUndo(agentId) : false);
  const forkSupported = $derived(agentId ? agentsStore.canForkSession(agentId) : false);
  const undoTarget = $derived(
    undoTargetMessageId
      ? getUndoableSessionTurns(agentsStore.activeSession).find((turn) => turn.messageId === undoTargetMessageId) ?? null
      : null
  );
  const undoAffectedTurns = $derived(
    undoTargetMessageId ? getUndoAffectedTurnCount(agentsStore.activeSession, undoTargetMessageId) : 0
  );
  const latestVisible = $derived(chatPresentationState === 'fixed-free-compact');
  const sessionTurns = $derived(buildSessionConversation(agentsStore.activeSession));
  const currentUndoTarget = $derived(getCurrentUndoTarget(agentsStore.activeSession));
  const revertedMessageIds = $derived(
    new Set(
      sessionTurns
        .filter((turn) => turn.user?.messageId && isTurnReverted(agentsStore.activeSession, turn.user.messageId))
        .map((turn) => turn.user!.messageId!)
    )
  );
  const latestForkTarget = $derived(getLatestForkTarget(sessionTurns, revertedMessageIds));
  const sessionOperationBusy = $derived(
    ['submitting', 'thinking', 'streaming', 'tool-running'].includes(agentsStore.activeSession.runState) ||
      agentsStore.activeSession.undo.pendingOperation !== null ||
      agentsStore.forkPending
  );
  const latestContentSignature = $derived.by(() => {
    const transcript = agentsStore.activeSession.transcript;
    const lastTranscriptItem = transcript.at(-1);
    const tools = agentsStore.activeSession.toolCalls;
    const pendingIds = pendingElicitations.map((item) => item.id).join(',');
    return [
      transcript.length,
      lastTranscriptItem?.id ?? '',
      lastTranscriptItem?.text.length ?? 0,
      tools.map((tool) => `${tool.id}:${tool.status}:${tool.result?.length ?? 0}`).join(','),
      pendingIds
    ].join('|');
  });

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
    latestContentSignature;
    if (scrollMode !== 'following') return;

    void tick().then(() => {
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || isEditableTarget(event.target)) return;
      if (event.shiftKey) {
        if (undoSupported && agentsStore.activeSession.undo.stack.length > 0) {
          event.preventDefault();
          void agentsStore.redoActiveSession();
        }
        return;
      }
      const target = getUndoableSessionTurns(agentsStore.activeSession);
      const frontier = agentsStore.activeSession.undo.stack.at(-1);
      const frontierIndex = frontier ? target.findIndex((turn) => turn.messageId === frontier) : target.length;
      const latest = target.slice(0, frontierIndex >= 0 ? frontierIndex : target.length).at(-1);
      if (undoSupported && latest) {
        event.preventDefault();
        openUndoDialog(latest.messageId);
      }
    };

    setupScrollTracking();
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      sessionLoadToken += 1;
      disconnectScrollTracking();
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  function openForkDialog(messageId: string) {
    const turn = buildSessionConversation(agentsStore.activeSession).find(
      (candidate) => candidate.forkMessageId === messageId
    );
    const target = turn ? getForkTarget(turn) : null;
    if (!target) return;
    forkTarget = target;
    forkDialogOpen = true;
  }

  async function confirmFork() {
    if (!forkTarget) return;
    const forkedSessionId = await agentsStore.forkActiveSessionAt(forkTarget.messageId);
    if (!forkedSessionId) return;
    forkDialogOpen = false;
    forkTarget = null;
    await goto(`/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(forkedSessionId)}`);
  }

  function openUndoDialog(messageId: string) {
    undoTargetMessageId = messageId;
    undoDialogOpen = true;
  }

  async function confirmUndo() {
    if (!undoTargetMessageId) return;
    const success = await agentsStore.undoActiveSessionTo(undoTargetMessageId);
    if (success) {
      undoDialogOpen = false;
      undoTargetMessageId = null;
    }
  }

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
    followScrollVersion += 1;
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
    followScrollVersion += 1;
    if (followFrame !== null) return;
    requestFollowScrollFrame();
  }

  function requestFollowScrollFrame() {
    followFrame = requestAnimationFrame(() => {
      const requestedVersion = followScrollVersion;
      if (scrollMode !== 'following') {
        followFrame = null;
        return;
      }

      scrollToEnd('instant');
      followFrame = requestAnimationFrame(() => {
        if (scrollMode === 'following') scrollToEnd('instant');
        followFrame = null;
        if (scrollMode === 'following' && followScrollVersion !== requestedVersion) {
          requestFollowScrollFrame();
        }
      });
    });
  }

  function scrollToEnd(behavior: ScrollBehavior | 'instant') {
    const viewport = scrollViewport ?? resolveScrollViewport().element;
    if (behavior === 'instant') {
      viewport.scrollTop = viewport.scrollHeight;
      lastViewportScrollTop = viewport.scrollTop;
      return;
    }

    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }

  function handleElicitationAction(itemId: string, actionId: string) {
    const keepFollowing = scrollMode === 'following';
    if (keepFollowing) programmaticScroll = true;
    inboxStore.handleAction(itemId, actionId);
    if (!keepFollowing) return;

    void tick().then(() => {
      if (scrollMode === 'following') scheduleFollowScroll();
    });
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
  <SessionHeader
    session={agentsStore.activeSession}
    title={selectedSession?.title ?? 'Session'}
    workspace={selectedSession ? getSessionWorkspaceName(selectedSession.cwd) : 'Unknown workspace'}
    agentName={selectedSession?.agentName ?? 'Unknown agent'}
    updatedAt={selectedSession ? formatSessionTimestamp(selectedSession.updatedAt) : 'Not loaded'}
    summaryStatus={selectedSession?.status ?? 'idle'}
    debugLabel={debugEventsTooltip}
    {undoSupported}
    {forkSupported}
    forkPending={agentsStore.forkPending}
    canUndo={undoSupported && currentUndoTarget !== null && !sessionOperationBusy}
    canRedo={undoSupported && agentsStore.activeSession.undo.stack.length > 0 && !sessionOperationBusy}
    canFork={forkSupported && latestForkTarget !== null && !sessionOperationBusy}
    onBack={() => goto('/sessions')}
    onRefresh={() => refreshSession()}
    onDebug={() => (debugEventsOpen = true)}
    onUndo={() => currentUndoTarget && openUndoDialog(currentUndoTarget.messageId)}
    onRedo={() => void agentsStore.redoActiveSession()}
    onFork={() => latestForkTarget && openForkDialog(latestForkTarget.messageId)}
  />

  <SessionTechnicalDetails session={agentsStore.activeSession} bind:open={debugEventsOpen} />

  <div bind:this={sessionPageContent} class="session-page-content">
    <ActiveSessionView
      session={agentsStore.activeSession}
      {undoSupported}
      {forkSupported}
      forkPending={agentsStore.forkPending}
      onCancel={() => agentsStore.cancelActiveSession()}
      onUndo={openUndoDialog}
      onRedo={() => void agentsStore.redoActiveSession()}
      onFork={openForkDialog}
    />

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
              onAction={handleElicitationAction}
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
        sendShortcut={chatPreferencesStore.sendShortcut}
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

  <SessionForkDialog
    bind:open={forkDialogOpen}
    sourceTitle={selectedSession?.title ?? 'this session'}
    target={forkTarget}
    pending={agentsStore.forkPending}
    onConfirm={confirmFork}
  />

  <SessionUndoDialog
    bind:open={undoDialogOpen}
    prompt={undoTarget?.text ?? ''}
    affectedTurns={undoAffectedTurns}
    pending={agentsStore.activeSession.undo.pendingOperation === 'undo'}
    onConfirm={confirmUndo}
  />
</div>