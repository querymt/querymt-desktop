<script lang="ts">
  import { tick } from 'svelte';
  import { provideToolContentFetcher, type ToolContentFetcher } from '$lib/components/session/tool-content-context';
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import SessionTurnDiffPanel from '$lib/components/session/SessionTurnDiffPanel.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { getForkTarget } from '$lib/domain/session-fork';
  import { canUndoToMessage, isTurnReverted } from '$lib/domain/session-undo';
  import {
    SESSION_TURN_GAP,
    getConversationViewport,
    windowSessionTurns,
    type SessionTurnHeightMap,
    type SessionTurnWindowViewport
  } from '$lib/domain/session-turn-window';
  import type { PromptFailure } from '$lib/domain/prompt-errors';
  import type { ActiveSessionViewModel, DesktopSessionSummary, SessionImageBlock, SessionImageGalleryItem } from '$lib/domain/types';

  let {
    session,
    agentId = '',
    sessions = [],
    undoSupported = false,
    forkSupported = false,
    forkPending = false,
    promptFailure = null,
    promptRetryPending = false,
    onRetryPrompt,
    onDismissPromptFailure,
    olderHistory = null,
    onLoadOlder,
    loadFailure = null,
    onRetryLoad = null,
    onFetchToolContent = null,
    onUndo,
    onRedo,
    onFork,
    onDisclosureChange
  }: {
    session: ActiveSessionViewModel;
    agentId?: string;
    sessions?: DesktopSessionSummary[];
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    promptFailure?: PromptFailure | null;
    promptRetryPending?: boolean;
    onRetryPrompt?: (() => void | Promise<void>) | null;
    onDismissPromptFailure?: (() => void) | null;
    /** Older-history state; `available` is false once the transcript reaches the session start. */
    olderHistory?: { available: boolean; loading: boolean; error: string | null; stale: boolean } | null;
    onLoadOlder?: (() => void | Promise<void>) | null;
    /** A load error worth surfacing with Retry (e.g. `remote_transfer_failed`). */
    loadFailure?: { message: string; retryable: boolean } | null;
    onRetryLoad?: (() => void | Promise<void>) | null;
    /** Loads full tool content for "Show full output" and truncated-argument diffs. */
    onFetchToolContent?: ToolContentFetcher | null;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
    onFork?: (messageId: string) => void;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
  } = $props();

  provideToolContentFetcher(() => onFetchToolContent);

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
  let viewport = $state<SessionTurnWindowViewport>({ top: 0, height: 0 });
  let heightSessionId: string | null = null;
  const diffPanelId = $props.id();
  let diffSelection = $state<{ sessionId: string | null; turnId: string } | null>(null);
  let diffPreview = $state<{ sessionId: string | null; turnId: string } | null>(null);
  let diffTrigger: HTMLButtonElement | null = null;

  function closeTurnDiff() {
    diffSelection = null;
    if (diffTrigger?.isConnected) diffTrigger.focus({ preventScroll: true });
    diffTrigger = null;
  }

  function preloadTurnDiff(turnId: string) {
    // Keep at most one warm panel, and never replace a panel the user is reading.
    if (diffSelection || (diffPreview?.sessionId === session.sessionId && diffPreview.turnId === turnId)) return;
    diffPreview = { sessionId: session.sessionId, turnId };
  }

  function toggleTurnDiff(turnId: string, event: MouseEvent) {
    if (diffSelection?.sessionId === session.sessionId && diffSelection.turnId === turnId) {
      closeTurnDiff();
      return;
    }
    diffTrigger = event.currentTarget as HTMLButtonElement;
    diffSelection = { sessionId: session.sessionId, turnId };
    diffPreview = diffSelection;
  }

  function handleImageFailure(key: string) {
    if (failedImageKeys.has(key)) return;
    failedImageKeys = new Set([...failedImageKeys, key]);
  }

  const turns = $derived(buildSessionConversation(session));
  const diffTurn = $derived(
    diffSelection?.sessionId === session.sessionId ? turns.find((turn) => turn.id === diffSelection?.turnId) : undefined
  );
  const previewSelection = $derived(diffSelection ?? diffPreview);
  const previewTurn = $derived(
    previewSelection?.sessionId === session.sessionId ? turns.find((turn) => turn.id === previewSelection?.turnId) : undefined
  );
  $effect(() => {
    if (diffPreview && !previewTurn) diffPreview = null;
    if (diffSelection && !diffTurn) {
      diffSelection = null;
      diffTrigger = null;
    }
  });
  const windowedTurns = $derived(windowSessionTurns(turns, viewport, turnHeights, { gap: SESSION_TURN_GAP }));
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
    viewport = { top: 0, height: 0 };
  });

  function resolveScrollViewport(): { element: HTMLElement; eventTarget: HTMLElement | Window } {
    const customShell = conversationRoot?.closest<HTMLElement>('.app-shell-custom-titlebar');
    if (customShell) return { element: customShell, eventTarget: customShell };
    const element = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
    return { element, eventTarget: window };
  }

  function syncViewport() {
    if (!conversationRoot) return;
    const { element } = resolveScrollViewport();
    viewport = getConversationViewport(
      conversationRoot.getBoundingClientRect().top + element.scrollTop,
      element.scrollTop,
      element.clientHeight
    );
  }

  const OLDER_HISTORY_TOP_THRESHOLD = 24;
  let lastScrollTop = 0;
  let loadingOlderAnchor = false;

  /** Requests older turns, then restores the scroll offset so the visible content does not move. */
  async function loadOlder() {
    if (!onLoadOlder || !olderHistory?.available || olderHistory.loading || loadingOlderAnchor) return;
    loadingOlderAnchor = true;
    const { element } = resolveScrollViewport();
    const previousHeight = element.scrollHeight;
    const previousTop = element.scrollTop;
    try {
      await onLoadOlder();
      await tick();
      const grown = element.scrollHeight - previousHeight;
      if (grown > 0) element.scrollTop = previousTop + grown;
      syncViewport();
    } finally {
      loadingOlderAnchor = false;
    }
  }

  // Only a user scroll that moves up and reaches the transcript top asks for
  // older history; opening a session never does.
  function maybeLoadOlderOnScroll() {
    const { element } = resolveScrollViewport();
    const scrollingUp = element.scrollTop < lastScrollTop;
    lastScrollTop = element.scrollTop;
    if (scrollingUp && viewport.top <= OLDER_HISTORY_TOP_THRESHOLD) void loadOlder();
  }

  function measureVisibleTurns() {
    if (!conversationRoot) return;
    const next = { ...turnHeights };
    let changed = false;
    for (const node of conversationRoot.querySelectorAll<HTMLElement>('[data-turn-id]')) {
      const id = node.dataset.turnId;
      if (!id) continue;
      const height = Math.round(node.getBoundingClientRect().height);
      if (height > 0 && next[id] !== height) {
        next[id] = height;
        changed = true;
      }
    }
    if (changed) turnHeights = next;
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
    const onUserScroll = () => {
      onScroll();
      maybeLoadOlderOnScroll();
    };
    syncViewport();
    measureVisibleTurns();
    lastScrollTop = resolveScrollViewport().element.scrollTop;
    eventTarget.addEventListener('scroll', onUserScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(onScroll) : null;
    observer?.observe(root);
    const frame = requestAnimationFrame(onScroll);
    return () => {
      cancelAnimationFrame(frame);
      eventTarget.removeEventListener('scroll', onUserScroll);
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

<div class="session-detail-shell" class:session-detail-diff-open={Boolean(diffTurn)}>
  <section class="session-conversation-column">
    <Conversation
      class="session-conversation"
      empty={turns.length === 0}
      emptyTitle="No conversation yet"
      emptyDescription="Send a prompt below to start streaming messages, reasoning, and activities into this view."
    >
      <div bind:this={conversationRoot} class="session-conversation-window">
        {#if loadFailure}
          <div class="session-history-notice" role="alert" data-testid="load-failure">
            <p>{loadFailure.message}</p>
            {#if loadFailure.retryable && onRetryLoad}
              <button type="button" onclick={() => void onRetryLoad()}>Retry</button>
            {/if}
          </div>
        {/if}
        {#if olderHistory?.stale}
          <p class="session-history-notice" role="status" data-testid="history-stale">
            This history may be out of date: the session's host could not be reached.
          </p>
        {/if}
        {#if olderHistory?.available}
          <div class="session-history-older">
            {#if olderHistory.error}
              <p role="alert" data-testid="older-history-error">{olderHistory.error}</p>
            {/if}
            <button type="button" disabled={olderHistory.loading} onclick={() => void loadOlder()}>
              {olderHistory.loading ? 'Loading earlier messages…' : olderHistory.error ? 'Retry loading earlier messages' : 'Load earlier messages'}
            </button>
          </div>
        {/if}
        {#each windowedTurns as item (item.type === 'turn' ? item.turn.id : item.key)}
          {#if item.type === 'spacer'}
            <div class="session-turn-spacer" style={`height:${item.height}px`} aria-hidden="true"></div>
          {:else}
            {@const turn = item.turn}
            {@const forkTarget = getForkTarget(turn)}
            {@const reverted = turn.user?.messageId ? isTurnReverted(session, turn.user.messageId) : false}
            <SessionTurn
              {turn}
              {agentId}
              sessionId={session.sessionId}
              {sessions}
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
              redoAvailable={Boolean(
                undoSupported && !busy && turnActionsSettled && turn.user?.messageId &&
                  turn.user.messageId === session.undo.stack.at(-1)
              )}
              {onRedo}
              diffOpen={diffTurn?.id === turn.id}
              {diffPanelId}
              onToggleDiff={(event) => toggleTurnDiff(turn.id, event)}
              onPreloadDiff={() => preloadTurnDiff(turn.id)}
              {onDisclosureChange}
            />
          {/if}
        {/each}
      </div>
    </Conversation>
  </section>
  {#if previewTurn}
    <SessionTurnDiffPanel id={diffPanelId} turn={previewTurn} open={Boolean(diffTurn)} onClose={closeTurnDiff} />
  {/if}
</div>