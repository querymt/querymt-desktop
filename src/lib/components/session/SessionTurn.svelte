<script lang="ts">
  import { Check, Copy, GitFork, Pencil, RotateCcw, Share2, Undo2, Volume2 } from '@lucide/svelte';
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

  let copiedAssistantId = $state<string | null>(null);
  let copiedUserId = $state<string | null>(null);
  let noopNoticeAssistantId = $state<string | null>(null);
  let userEditNoticeId = $state<string | null>(null);

  function showNotImplemented() {
    if (!turn.assistant) return;

    noopNoticeAssistantId = turn.assistant.id;
    window.setTimeout(() => {
      if (noopNoticeAssistantId === turn.assistant?.id) {
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

  async function copyAssistantMessage() {
    if (!turn.assistant?.text) return;

    try {
      await navigator.clipboard.writeText(turn.assistant.text);
      copiedAssistantId = turn.assistant.id;
      window.setTimeout(() => {
        if (copiedAssistantId === turn.assistant?.id) {
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

  <SessionReasoningBlock reasoning={turn.reasoning} open={openReasoning} />

  {#if turn.assistant}
    <section class="session-agent-block">
      <div class="session-agent-body markdown-body" use:enhanceCodeBlocks>{@html turn.assistant.html}</div>

      <div class="session-message-actions" aria-label="Message actions">
        <button
          class="session-message-action-btn"
          type="button"
          aria-label={copiedAssistantId === turn.assistant.id ? 'Response copied' : 'Copy response'}
          title={copiedAssistantId === turn.assistant.id ? 'Copied' : 'Copy response'}
          onclick={copyAssistantMessage}
        >
          {#if copiedAssistantId === turn.assistant.id}
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
          onclick={showNotImplemented}
        >
          <Share2 size={15} />
        </button>
        <button
          class="session-message-action-btn"
          type="button"
          aria-label="Read aloud"
          title="Read aloud"
          onclick={showNotImplemented}
        >
          <Volume2 size={15} />
        </button>
        <button
          class="session-message-action-btn"
          type="button"
          aria-label="Try again"
          title="Try again..."
          onclick={showNotImplemented}
        >
          <RotateCcw size={15} />
        </button>
        <button
          class="session-message-action-btn"
          type="button"
          aria-label="Fork into new session"
          title="Fork into new session"
          onclick={showNotImplemented}
        >
          <GitFork size={15} />
        </button>
        <button
          class="session-message-action-btn"
          type="button"
          aria-label="Undo"
          title="Undo"
          onclick={showNotImplemented}
        >
          <Undo2 size={15} />
        </button>
        {#if noopNoticeAssistantId === turn.assistant.id}
          <span class="session-message-action-note" aria-live="polite">Not implemented yet</span>
        {/if}
      </div>

      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {:else if turn.activities.length > 0}
    <section class="session-agent-block session-agent-block-activities">
      <SessionActivities activities={turn.activities} {activeToolCallId} />
    </section>
  {/if}
</article>
