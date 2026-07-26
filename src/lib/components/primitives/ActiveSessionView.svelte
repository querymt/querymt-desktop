<script lang="ts">
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import { canUndoToMessage, getCurrentUndoTarget, isTurnReverted } from '$lib/domain/session-undo';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    undoSupported = false,
    onCancel,
    onUndo,
    onRedo
  }: {
    session: ActiveSessionViewModel;
    undoSupported?: boolean;
    onCancel?: () => void | Promise<void>;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
  } = $props();

  const turns = $derived(buildSessionConversation(session));
  const currentUndoTarget = $derived(getCurrentUndoTarget(session));
  const busy = $derived(['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState));
</script>

<div class="session-detail-shell">
  <SessionActivityBar
    {session}
    {undoSupported}
    {onCancel}
    {onRedo}
    canUndo={undoSupported && currentUndoTarget !== null && !busy}
    canRedo={undoSupported && session.undo.stack.length > 0 && !busy}
    onUndo={() => currentUndoTarget && onUndo?.(currentUndoTarget.messageId)}
  />

  <section class="session-conversation-column">
    <Conversation
      class="session-conversation"
      empty={turns.length === 0}
      emptyTitle="No conversation yet"
      emptyDescription="Send a prompt below to start streaming messages, reasoning, and activities into this view."
    >
      {#each turns as turn}
        <SessionTurn
          {turn}
          reverted={turn.user?.messageId ? isTurnReverted(session, turn.user.messageId) : false}
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