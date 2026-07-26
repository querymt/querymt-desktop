<script lang="ts">
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { getForkTarget, getLatestForkTarget } from '$lib/domain/session-fork';
  import { canUndoToMessage, getCurrentUndoTarget, isTurnReverted } from '$lib/domain/session-undo';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    undoSupported = false,
    forkSupported = false,
    forkPending = false,
    onCancel,
    onUndo,
    onRedo,
    onFork
  }: {
    session: ActiveSessionViewModel;
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    onCancel?: () => void | Promise<void>;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
    onFork?: (messageId: string) => void;
  } = $props();

  const turns = $derived(buildSessionConversation(session));
  const currentUndoTarget = $derived(getCurrentUndoTarget(session));
  const revertedMessageIds = $derived(
    new Set(
      turns
        .filter((turn) => turn.user?.messageId && isTurnReverted(session, turn.user.messageId))
        .map((turn) => turn.user!.messageId!)
    )
  );
  const latestForkTarget = $derived(getLatestForkTarget(turns, revertedMessageIds));
  const busy = $derived(
    ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState) ||
      session.undo.pendingOperation !== null ||
      forkPending
  );
</script>

<div class="session-detail-shell">
  <SessionActivityBar
    {session}
    {undoSupported}
    {forkSupported}
    {forkPending}
    {onCancel}
    {onRedo}
    canFork={forkSupported && latestForkTarget !== null && !busy}
    canUndo={undoSupported && currentUndoTarget !== null && !busy}
    canRedo={undoSupported && session.undo.stack.length > 0 && !busy}
    onUndo={() => currentUndoTarget && onUndo?.(currentUndoTarget.messageId)}
    onFork={() => latestForkTarget && onFork?.(latestForkTarget.messageId)}
  />

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
          {reverted}
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
        />
      {/each}
    </Conversation>
  </section>
</div>