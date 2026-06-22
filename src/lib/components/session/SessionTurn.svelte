<script lang="ts">
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

  function copyCodeBlocks(node: HTMLElement) {
    async function handleClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('[data-code-copy]');
      if (!button) return;

      const code = button.closest('.code-block-shell')?.querySelector('code')?.textContent;
      if (!code) return;

      await navigator.clipboard.writeText(code);
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1200);
    }

    node.addEventListener('click', handleClick);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
      }
    };
  }
</script>

<article class="session-turn">
  {#if turn.user}
    <section class="session-message session-message-user">
      <div class="session-message-body markdown-body" use:copyCodeBlocks>{@html turn.user.html}</div>
    </section>
  {/if}

  <SessionReasoningBlock reasoning={turn.reasoning} open={openReasoning} />

  {#if turn.assistant}
    <section class="session-agent-block">
      <div class="session-agent-body markdown-body" use:copyCodeBlocks>{@html turn.assistant.html}</div>

      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {:else if turn.activities.length > 0}
    <section class="session-agent-block session-agent-block-activities">
      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {/if}
</article>
