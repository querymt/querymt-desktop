<script lang="ts">
  import SessionActivities from '$lib/components/session/SessionActivities.svelte';
  import SessionReasoningBlock from '$lib/components/session/SessionReasoningBlock.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import type { SessionConversationTurn } from '$lib/domain/session-conversation';

  let {
    turn,
    activeToolCallId = null,
    openReasoning = false
  }: {
    turn: SessionConversationTurn;
    activeToolCallId?: string | null;
    openReasoning?: boolean;
  } = $props();
</script>

<article class="session-turn">
  {#if turn.user}
    <section class="session-message session-message-user">
      <div class="session-message-body markdown-body" use:enhanceCodeBlocks>{@html turn.user.html}</div>
    </section>
  {/if}

  <SessionReasoningBlock reasoning={turn.reasoning} open={openReasoning} />

  {#if turn.assistant}
    <section class="session-agent-block">
      <div class="session-agent-body markdown-body" use:enhanceCodeBlocks>{@html turn.assistant.html}</div>

      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {:else if turn.activities.length > 0}
    <section class="session-agent-block session-agent-block-activities">
      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {/if}
</article>
