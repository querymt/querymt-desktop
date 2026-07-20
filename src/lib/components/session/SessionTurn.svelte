<script lang="ts">
  import { Check, Copy, GitFork, Pencil, RotateCcw, Share2, Undo2, Volume2 } from '@lucide/svelte';
  import SessionReasoningBlock from '$lib/components/session/SessionReasoningBlock.svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import type { SessionAssistantContent, SessionConversationTurn } from '$lib/domain/session-conversation';

  let { turn }: { turn: SessionConversationTurn } = $props();

  let copiedAssistantId = $state<string | null>(null);
  let copiedUserId = $state<string | null>(null);
  let noopNoticeAssistantId = $state<string | null>(null);
  let userEditNoticeId = $state<string | null>(null);

  function showNotImplemented(assistantId: string) {
    noopNoticeAssistantId = assistantId;
    window.setTimeout(() => {
      if (noopNoticeAssistantId === assistantId) {
        noopNoticeAssistantId = null;
      }
    }, 1600);
  }

  function showUserEditNotImplemented() {
    if (!turn.user) return;

    userEditNoticeId = turn.user.id;
    window.setTimeout(() => {
      if (userEditNoticeId === turn.user?.id) {
        userEditNoticeId = null;
      }
    }, 1600);
  }

  async function copyUserMessage() {
    if (!turn.user?.text) return;

    try {
      await navigator.clipboard.writeText(turn.user.text);
      copiedUserId = turn.user.id;
      window.setTimeout(() => {
        if (copiedUserId === turn.user?.id) {
          copiedUserId = null;
        }
      }, 1200);
    } catch (error) {
      console.error('Failed to copy user message', error);
    }
  }

  async function copyAssistantMessage(assistant: SessionAssistantContent) {
    if (!assistant.text) return;

    try {
      await navigator.clipboard.writeText(assistant.text);
      copiedAssistantId = assistant.id;
      window.setTimeout(() => {
        if (copiedAssistantId === assistant.id) {
          copiedAssistantId = null;
        }
      }, 1200);
    } catch (error) {
      console.error('Failed to copy assistant message', error);
    }
  }
</script>

<article class="session-turn">
  {#if turn.user}
    <section class="session-user-message-shell">
      <div class="session-message session-message-user">
        <div class="session-message-body markdown-body" use:enhanceCodeBlocks>{@html turn.user.html}</div>
      </div>

      <div class="session-message-actions session-user-message-actions" aria-label="User message actions">
        <button
          class="session-message-action-btn"
          type="button"
          aria-label={copiedUserId === turn.user.id ? 'Prompt copied' : 'Copy prompt'}
          title={copiedUserId === turn.user.id ? 'Copied' : 'Copy prompt'}
          onclick={copyUserMessage}
        >
          {#if copiedUserId === turn.user.id}
            <Check size={15} />
          {:else}
            <Copy size={15} />
          {/if}
        </button>
        <button
          class="session-message-action-btn"
          type="button"
          aria-label="Edit prompt"
          title="Edit prompt"
          onclick={showUserEditNotImplemented}
        >
          <Pencil size={15} />
        </button>
        {#if userEditNoticeId === turn.user.id}
          <span class="session-message-action-note" aria-live="polite">Not implemented yet</span>
        {/if}
      </div>
    </section>
  {/if}

  <div class="session-turn-content">
    {#each turn.content as item (item.id)}
      {#if item.type === 'reasoning'}
        <SessionReasoningBlock reasoning={[item]} />
      {:else if item.type === 'tool'}
        <div class="session-turn-tool">
          <SessionToolBlock tool={item.tool} />
        </div>
      {:else}
        <section class="session-agent-block">
          <div class="session-agent-body markdown-body" use:enhanceCodeBlocks>{@html item.html}</div>

          <div class="session-message-actions" aria-label="Message actions">
            <button
              class="session-message-action-btn"
              type="button"
              aria-label={copiedAssistantId === item.id ? 'Response copied' : 'Copy response'}
              title={copiedAssistantId === item.id ? 'Copied' : 'Copy response'}
              onclick={() => copyAssistantMessage(item)}
            >
              {#if copiedAssistantId === item.id}
                <Check size={15} />
              {:else}
                <Copy size={15} />
              {/if}
            </button>
            <button
              class="session-message-action-btn"
              type="button"
              aria-label="Share response"
              title="Share response"
              onclick={() => showNotImplemented(item.id)}
            >
              <Share2 size={15} />
            </button>
            <button
              class="session-message-action-btn"
              type="button"
              aria-label="Read aloud"
              title="Read aloud"
              onclick={() => showNotImplemented(item.id)}
            >
              <Volume2 size={15} />
            </button>
            <button
              class="session-message-action-btn"
              type="button"
              aria-label="Try again"
              title="Try again..."
              onclick={() => showNotImplemented(item.id)}
            >
              <RotateCcw size={15} />
            </button>
            <button
              class="session-message-action-btn"
              type="button"
              aria-label="Fork into new session"
              title="Fork into new session"
              onclick={() => showNotImplemented(item.id)}
            >
              <GitFork size={15} />
            </button>
            <button
              class="session-message-action-btn"
              type="button"
              aria-label="Undo"
              title="Undo"
              onclick={() => showNotImplemented(item.id)}
            >
              <Undo2 size={15} />
            </button>
            {#if noopNoticeAssistantId === item.id}
              <span class="session-message-action-note" aria-live="polite">Not implemented yet</span>
            {/if}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</article>
