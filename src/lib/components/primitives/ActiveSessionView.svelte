<script lang="ts">
  import Conversation from '$lib/components/ai-elements/conversation.svelte';
  import SessionActivityBar from '$lib/components/session/SessionActivityBar.svelte';
  import SessionConfigPanel from '$lib/components/session/SessionConfigPanel.svelte';
  import SessionPlanPanel from '$lib/components/session/SessionPlanPanel.svelte';
  import SessionTechnicalDetails from '$lib/components/session/SessionTechnicalDetails.svelte';
  import SessionTurn from '$lib/components/session/SessionTurn.svelte';
  import { buildSessionConversation } from '$lib/domain/session-conversation';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let { session }: { session: ActiveSessionViewModel } = $props();

  const turns = $derived(buildSessionConversation(session));
</script>

<div class="session-detail-shell">
  <SessionActivityBar {session} />

  <div class="session-detail-grid">
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

    <aside class="session-side-rail">
      <SessionPlanPanel {session} />
      <SessionConfigPanel {session} />
      <SessionTechnicalDetails {session} />
    </aside>
  </div>
</div>
