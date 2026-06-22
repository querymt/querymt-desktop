<script lang="ts">
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    onCancel
  }: {
    session: ActiveSessionViewModel;
    onCancel?: () => void | Promise<void>;
  } = $props();

  const turns = $derived(buildSessionConversation(session));
</script>

<div class="session-detail-shell">
  <SessionActivityBar {session} {onCancel} />

  <section class="session-conversation-column">
    <Conversation
      class="session-conversation"
      empty={turns.length === 0}
      emptyTitle="No conversation yet"
      emptyDescription="Send a prompt below to start streaming messages, reasoning, and activities into this view."
    >
      {#each turns as turn, index}
        <SessionTurn
          {turn}
          activeToolCallId={session.activeToolCallId}
          openReasoning={session.runState === 'thinking' && index === turns.length - 1}
        />
      {/each}
    </Conversation>
  </section>
</div>