<script lang="ts">
  import { Bot, UserRound } from '@lucide/svelte';
  import SessionActivities from '$lib/components/session/SessionActivities.svelte';
  import SessionReasoningBlock from '$lib/components/session/SessionReasoningBlock.svelte';
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
      <div class="session-message-header">
        <div class="session-message-meta">
          <span class="session-message-avatar"><UserRound size={14} /></span>
          <div>
            <div class="session-message-role">You</div>
            <div class="session-message-role-subtle">Prompt</div>
          </div>
        </div>
      </div>
      <div class="session-message-body markdown-body">{@html turn.user.html}</div>
    </section>
  {/if}

  <SessionReasoningBlock reasoning={turn.reasoning} open={openReasoning} />

  {#if turn.assistant}
    <section class="session-message session-message-assistant">
      <div class="session-message-header">
        <div class="session-message-meta">
          <span class="session-message-avatar"><Bot size={14} /></span>
          <div>
            <div class="session-message-role">Agent</div>
            <div class="session-message-role-subtle">Response</div>
          </div>
        </div>
      </div>

      <div class="session-message-body markdown-body">{@html turn.assistant.html}</div>

      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {:else if turn.activities.length > 0}
    <section class="session-message session-message-assistant">
      <div class="session-message-header">
        <div class="session-message-meta">
          <span class="session-message-avatar"><Bot size={14} /></span>
          <div>
            <div class="session-message-role">Agent</div>
            <div class="session-message-role-subtle">Activities</div>
          </div>
        </div>
      </div>
      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {/if}
</article>
