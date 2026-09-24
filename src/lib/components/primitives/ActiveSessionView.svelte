<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import SessionTurnNavigationRail from '$lib/components/session/SessionTurnNavigationRail.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { getForkTarget } from '$lib/domain/session-fork';
  import { canUndoToMessage, isTurnReverted } from '$lib/domain/session-undo';
  import {
    SESSION_TURN_NAV_VISIBLE_GAP,
    absoluteContentOffset,
    activeSessionTurnNavId,
    adjacentResponseNavId,
    alignedScrollTop,
    buildSessionTurnNavigation,
    estimateSessionTurnNavRanges,
    scrollViewportOriginTop,
    sessionTurnNavRoughOffset,
    sessionTurnNavTargetOffset,
    visibleContentInset,
    type SessionTurnPartHeightMap
  } from '$lib/domain/session-turn-navigation';
  import {
    SESSION_TURN_GAP,
    getConversationViewport,
    windowSessionTurns,
    type SessionTurnHeightMap,
    type SessionTurnWindowViewport
  } from '$lib/domain/session-turn-window';
  import { observeScrollSettle } from '$lib/domain/session-scroll';
  import type { PromptFailure } from '$lib/domain/prompt-errors';
  import type { ActiveSessionViewModel, SessionImageBlock, SessionImageGalleryItem } from '$lib/domain/types';

  let {
    session,
    undoSupported = false,
    forkSupported = false,
    forkPending = false,
    promptFailure = null,
    promptRetryPending = false,
    onRetryPrompt,
    onDismissPromptFailure,
    onUndo,
    onRedo,
    onFork,
    onDisclosureChange,
    onManualNavigate,
    onManualNavigateComplete
  }: {
    session: ActiveSessionViewModel;
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    promptFailure?: PromptFailure | null;
    promptRetryPending?: boolean;
    onRetryPrompt?: (() => void | Promise<void>) | null;
    onDismissPromptFailure?: (() => void) | null;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
    onFork?: (messageId: string) => void;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
    onManualNavigate?: (() => void) | null;
    onManualNavigateComplete?: (() => void) | null;
  } = $props();

  function imageName(block: SessionImageBlock, index: number): string {
    return block.name || `Image attachment ${index + 1}`;
  }

  function imageKey(block: SessionImageBlock, location: string): string {
    const identity = block.id ? `id:${block.id}` : block.uri ? `uri:${block.uri}` : 'native';
    return `chat-image:${location}:${identity}`;
  }

  let failedImageKeys = $state<ReadonlySet<string>>(new Set());
  let failureSessionId: string | null = null;
  let conversationRoot: HTMLElement | null = $state(null);
  let turnHeights = $state<SessionTurnHeightMap>({});
  let partHeights = $state<SessionTurnPartHeightMap>({});
  let viewport = $state<SessionTurnWindowViewport>({ top: 0, height: 0 });
  let visibleInset = $state(SESSION_TURN_NAV_VISIBLE_GAP);
  let activeReadY = $state(0);
  let heightSessionId: string | null = null;
  let pendingNavId: string | null = null;
  let pendingNavToken = 0;
  let navInFlight = false;
  let cancelNavSettle: (() => void) | null = null;

  function handleImageFailure(key: string) {
    if (failedImageKeys.has(key)) return;
    failedImageKeys = new Set([...failedImageKeys, key]);
  }

  const turns = $derived(buildSessionConversation(session));
  const windowedTurns = $derived(windowSessionTurns(turns, viewport, turnHeights, { gap: SESSION_TURN_GAP }));
  const navItems = $derived(buildSessionTurnNavigation(turns));
  const navRanges = $derived(
    estimateSessionTurnNavRanges(navItems, turnHeights, partHeights, { gap: SESSION_TURN_GAP })
  );
  const activeNavId = $derived(activeSessionTurnNavId(navRanges, activeReadY));
  const previousResponseId = $derived(adjacentResponseNavId(navItems, activeNavId, 'previous'));
  const nextResponseId = $derived(adjacentResponseNavId(navItems, activeNavId, 'next'));
  const imageGallery = $derived.by(() => {
    const items: SessionImageGalleryItem[] = [];
    for (const turn of turns) {
      turn.user?.blocks?.forEach((block, blockIndex) => {
        if (block.type !== 'image' || !block.data || block.unavailable) return;
        items.push({
          key: imageKey(block, `${turn.id}:user:${turn.user!.id}:block:${blockIndex}`),
          name: imageName(block, blockIndex),
          block
        });
      });
      turn.content.forEach((content, contentIndex) => {
        if (content.type !== 'assistant') return;
        content.blocks?.forEach((block, blockIndex) => {
          if (block.type !== 'image' || !block.data || block.unavailable) return;
          items.push({
            key: imageKey(block, `${turn.id}:assistant:${content.id}:content:${contentIndex}:block:${blockIndex}`),
            name: imageName(block, blockIndex),
            block
          });
        });
      });
    }
    return items;
  });
  $effect(() => {
    const sessionId = session.sessionId;
    if (sessionId === failureSessionId) return;
    failureSessionId = sessionId;
    failedImageKeys = new Set();
  });

  $effect(() => {
    const sessionId = session.sessionId;
    if (sessionId === heightSessionId) return;
    heightSessionId = sessionId;
    turnHeights = {};
    partHeights = {};
    viewport = { top: 0, height: 0 };
    visibleInset = SESSION_TURN_NAV_VISIBLE_GAP;
    activeReadY = 0;
    pendingNavId = null;
    pendingNavToken += 1;
    cancelManualNavigate();
  });

  function resolveScrollViewport(): {
    element: HTMLElement;
    eventTarget: HTMLElement | Window;
    custom: boolean;
  } {
    const customShell = conversationRoot?.closest<HTMLElement>('.app-shell-custom-titlebar');
    if (customShell) return { element: customShell, eventTarget: customShell, custom: true };
    const element = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
    return { element, eventTarget: window, custom: false };
  }

  function viewportOrigin(element: HTMLElement, custom: boolean): number {
    return scrollViewportOriginTop(element.getBoundingClientRect().top, custom);
  }

  function measureVisibleInset(origin: number): number {
    const header =
      conversationRoot?.closest('.session-page')?.querySelector('.session-header') ??
      document.querySelector('.session-header');
    return visibleContentInset(header?.getBoundingClientRect().bottom, origin);
  }

  function conversationContentOffset(element: HTMLElement, origin: number): number {
    if (!conversationRoot) return 0;
    return absoluteContentOffset(
      element.scrollTop,
      conversationRoot.getBoundingClientRect().top,
      origin
    );
  }

  function syncViewport() {
    if (!conversationRoot) return;
    const { element, custom } = resolveScrollViewport();
    const origin = viewportOrigin(element, custom);
    visibleInset = measureVisibleInset(origin);
    const contentOffset = conversationContentOffset(element, origin);
    viewport = getConversationViewport(contentOffset, element.scrollTop, element.clientHeight);
    activeReadY = Math.max(0, element.scrollTop + visibleInset - contentOffset);
  }

  function measureVisibleTurns() {
    if (!conversationRoot) return;
    const nextTurns = { ...turnHeights };
    const nextParts = { ...partHeights };
    let turnsChanged = false;
    let partsChanged = false;
    for (const node of conversationRoot.querySelectorAll<HTMLElement>('[data-turn-id]')) {
      const id = node.dataset.turnId;
      if (!id) continue;
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0 && nextTurns[id] !== height) {
        nextTurns[id] = height;
        turnsChanged = true;
      }
    }
    for (const node of conversationRoot.querySelectorAll<HTMLElement>('[data-turn-part-id]')) {
      const id = node.dataset.turnPartId;
      if (!id) continue;
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0 && nextParts[id] !== height) {
        nextParts[id] = height;
        partsChanged = true;
      }
    }
    if (turnsChanged) turnHeights = nextTurns;
    if (partsChanged) partHeights = nextParts;
  }

  function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function findTurnPartNode(id: string): HTMLElement | null {
    if (!conversationRoot) return null;
    for (const node of conversationRoot.querySelectorAll<HTMLElement>('[data-turn-part-id]')) {
      if (node.dataset.turnPartId === id) return node;
    }
    return null;
  }

  function applyNavScroll(element: HTMLElement, top: number, behavior: ScrollBehavior) {
    element.scrollTo({ top, behavior });
    syncViewport();
    measureVisibleTurns();
  }

  function abortNavSettle() {
    cancelNavSettle?.();
    cancelNavSettle = null;
  }

  function beginManualNavigate() {
    completeManualNavigate();
    navInFlight = true;
    onManualNavigate?.();
  }

  function completeManualNavigate() {
    abortNavSettle();
    if (!navInFlight) return;
    navInFlight = false;
    onManualNavigateComplete?.();
  }

  function cancelManualNavigate() {
    abortNavSettle();
    navInFlight = false;
  }

  function watchNavSettle(token: number) {
    abortNavSettle();
    const { eventTarget } = resolveScrollViewport();
    cancelNavSettle = observeScrollSettle(eventTarget, () => {
      cancelNavSettle = null;
      if (token !== pendingNavToken) return;
      completeManualNavigate();
    });
  }

  onMount(() => () => cancelManualNavigate());

  function scrollToMountedPart(
    element: HTMLElement,
    origin: number,
    node: HTMLElement,
    behavior: ScrollBehavior
  ) {
    applyNavScroll(
      element,
      alignedScrollTop(
        absoluteContentOffset(element.scrollTop, node.getBoundingClientRect().top, origin),
        measureVisibleInset(origin)
      ),
      behavior
    );
  }

  function scrollToEstimatedOffset(
    element: HTMLElement,
    origin: number,
    conversationOffset: number,
    behavior: ScrollBehavior
  ) {
    applyNavScroll(
      element,
      alignedScrollTop(
        conversationContentOffset(element, origin) + conversationOffset,
        measureVisibleInset(origin)
      ),
      behavior
    );
  }

  function navigateToNavItem(id: string) {
    if (!conversationRoot) return;
    const { element, custom } = resolveScrollViewport();
    const origin = viewportOrigin(element, custom);
    const finalBehavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    pendingNavToken += 1;
    const token = pendingNavToken;
    pendingNavId = id;
    beginManualNavigate();

    const mounted = findTurnPartNode(id);
    if (mounted) {
      if (token !== pendingNavToken) return;
      pendingNavId = null;
      watchNavSettle(token);
      scrollToMountedPart(element, origin, mounted, finalBehavior);
      return;
    }

    const rough = sessionTurnNavRoughOffset(navItems, navRanges, id);
    if (rough == null) {
      if (token !== pendingNavToken) return;
      pendingNavId = null;
      completeManualNavigate();
      return;
    }
    scrollToEstimatedOffset(element, origin, rough, 'auto');

    void tick().then(() => {
      if (token !== pendingNavToken || pendingNavId !== id) return;
      requestAnimationFrame(() => {
        if (token !== pendingNavToken || pendingNavId !== id) return;
        const { element: latestElement, custom: latestCustom } = resolveScrollViewport();
        const latestOrigin = viewportOrigin(latestElement, latestCustom);
        measureVisibleTurns();
        syncViewport();
        if (token !== pendingNavToken || pendingNavId !== id) return;
        pendingNavId = null;
        const node = findTurnPartNode(id);
        if (node) {
          watchNavSettle(token);
          scrollToMountedPart(latestElement, latestOrigin, node, finalBehavior);
          return;
        }
        const exact = sessionTurnNavTargetOffset(navRanges, id);
        if (exact == null) {
          completeManualNavigate();
          return;
        }
        watchNavSettle(token);
        scrollToEstimatedOffset(latestElement, latestOrigin, exact, finalBehavior);
      });
    });
  }

  // Conversation unmounts this root while the session is empty, so bind
  // scroll/resize measurement to the root itself. onMount ran too early on
  // first load and never observed the later-mounted transcript.
  $effect(() => {
    const root = conversationRoot;
    if (!root) return;
    const { eventTarget } = resolveScrollViewport();
    const onScroll = () => {
      syncViewport();
      measureVisibleTurns();
    };
    syncViewport();
    measureVisibleTurns();
    eventTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(root);
    const frame = requestAnimationFrame(onScroll);
    return () => {
      cancelAnimationFrame(frame);
      eventTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      observer?.disconnect();
    };
  });

  const busy = $derived(
    ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState) ||
      session.undo.pendingOperation !== null ||
      forkPending
  );

  // Fork/undo unlock only after the session has stayed quiet for a short
  // settle window. Agents that resolve the prompt request before their turn
  // finishes emitting updates flip runState busy → completed while content is
  // still arriving, and the settled-turn action row would flash back in
  // between updates. Any new session activity restarts the hold.
  const SESSION_ACTION_SETTLE_MS = 1200;

  let turnActionsSettled = $state(false);
  let turnActionsSettleTimer: ReturnType<typeof setTimeout> | null = null;

  const sessionActivitySignature = $derived.by(() => {
    const lastTranscript = session.transcript.at(-1);
    const lastTool = session.toolCalls.at(-1);
    return [
      session.runState,
      session.transcript.length,
      lastTranscript?.id ?? '',
      lastTranscript?.text.length ?? 0,
      session.toolCalls.length,
      lastTool?.id ?? '',
      lastTool?.status ?? ''
    ].join('|');
  });

  $effect(() => {
    void sessionActivitySignature;
    if (turnActionsSettleTimer !== null) {
      clearTimeout(turnActionsSettleTimer);
      turnActionsSettleTimer = null;
    }
    if (busy) {
      turnActionsSettled = false;
      return;
    }
    // New activity while unlocked restarts the hold: keep fork and undo
    // unavailable until this hold settles too.
    turnActionsSettled = false;
    turnActionsSettleTimer = setTimeout(() => {
      turnActionsSettleTimer = null;
      turnActionsSettled = true;
    }, SESSION_ACTION_SETTLE_MS);
    return () => {
      if (turnActionsSettleTimer !== null) {
        clearTimeout(turnActionsSettleTimer);
        turnActionsSettleTimer = null;
      }
    };
  });
</script>

<div class="session-detail-shell">
  <section class="session-conversation-column">
    <Conversation
      class="session-conversation"
      empty={turns.length === 0}
      emptyTitle="No conversation yet"
      emptyDescription="Send a prompt below to start streaming messages, reasoning, and activities into this view."
    >
      <div bind:this={conversationRoot} class="session-conversation-window">
        {#each windowedTurns as item (item.type === 'turn' ? item.turn.id : item.key)}
          {#if item.type === 'spacer'}
            <div class="session-turn-spacer" style={`height:${item.height}px`} aria-hidden="true"></div>
          {:else}
            {@const turn = item.turn}
            {@const forkTarget = getForkTarget(turn)}
            {@const reverted = turn.user?.messageId ? isTurnReverted(session, turn.user.messageId) : false}
            <SessionTurn
              {turn}
              {imageGallery}
              {failedImageKeys}
              onImageFailure={handleImageFailure}
              {reverted}
              promptFailure={turn.user?.eventIndex === promptFailure?.turnEventIndex ? promptFailure : null}
              retryPending={promptRetryPending}
              {onRetryPrompt}
              {onDismissPromptFailure}
              forkAvailable={Boolean(forkSupported && !busy && turnActionsSettled && !reverted && forkTarget)}
              {forkPending}
              onFork={() => forkTarget && onFork?.(forkTarget.messageId)}
              undoAvailable={Boolean(
                undoSupported &&
                  !busy &&
                  turnActionsSettled &&
                  !session.undo.pendingOperation &&
                  turn.user?.messageId &&
                  canUndoToMessage(session, turn.user.messageId)
              )}
              undoPending={session.undo.pendingOperation === 'undo'}
              {onUndo}
              {onDisclosureChange}
            />
          {/if}
        {/each}
      </div>
    </Conversation>
  </section>
  {#if navItems.length > 0}
    <SessionTurnNavigationRail
      items={navItems}
      activeId={activeNavId}
      {previousResponseId}
      {nextResponseId}
      {visibleInset}
      onNavigate={navigateToNavItem}
    />
  {/if}
</div>
