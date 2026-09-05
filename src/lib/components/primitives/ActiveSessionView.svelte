<script lang="ts">
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { getForkTarget } from '$lib/domain/session-fork';
  import { canUndoToMessage, isTurnReverted } from '$lib/domain/session-undo';
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
    onCancel,
    onUndo,
    onRedo,
    onFork,
    onDisclosureChange
  }: {
    session: ActiveSessionViewModel;
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    promptFailure?: PromptFailure | null;
    promptRetryPending?: boolean;
    onRetryPrompt?: (() => void | Promise<void>) | null;
    onDismissPromptFailure?: (() => void) | null;
    onCancel?: () => void | Promise<void>;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
    onFork?: (messageId: string) => void;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
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

  function handleImageFailure(key: string) {
    if (failedImageKeys.has(key)) return;
    failedImageKeys = new Set([...failedImageKeys, key]);
  }

  const turns = $derived(buildSessionConversation(session));
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

  const busy = $derived(
    ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState) ||
      session.undo.pendingOperation !== null ||
      forkPending
  );
</script>

<div class="session-detail-shell">
  <SessionActivityBar {session} {forkPending} {onCancel} />

  <section class="session-conversation-column">
    <Conversation
      class="session-conversation"
      empty={turns.length === 0}
      emptyTitle="No conversation yet"
      emptyDescription="Send a prompt below to start streaming messages, reasoning, and activities into this view."
    >
      {#each turns as turn}
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
          forkAvailable={Boolean(forkSupported && !busy && !reverted && forkTarget)}
          {forkPending}
          onFork={() => forkTarget && onFork?.(forkTarget.messageId)}
          undoAvailable={Boolean(
            undoSupported &&
              !busy &&
              !session.undo.pendingOperation &&
              turn.user?.messageId &&
              canUndoToMessage(session, turn.user.messageId)
          )}
          undoPending={session.undo.pendingOperation === 'undo'}
          {onUndo}
          {onDisclosureChange}
        />
      {/each}
    </Conversation>
  </section>
</div>