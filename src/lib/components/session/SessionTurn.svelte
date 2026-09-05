<script lang="ts">
  import { Check, Copy, GitFork, LoaderCircle, Undo2 } from '@lucide/svelte';
  import SessionPromptError from '$lib/components/session/SessionPromptError.svelte';
  import SessionAttachmentPreview from '$lib/components/session/SessionAttachmentPreview.svelte';
  import SessionWorkGroup from '$lib/components/session/SessionWorkGroup.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import { buildTurnPresentation, type SessionAssistantContent, type SessionConversationTurn } from '$lib/domain/session-conversation';
  import { renderMarkdownToHtml } from '$lib/domain/markdown';
  import type { SessionContentBlock, SessionImageGalleryItem } from '$lib/domain/types';
  import type { PromptFailure } from '$lib/domain/prompt-errors';

  let {
    turn,
    imageGallery,
    failedImageKeys,
    onImageFailure,
    undoAvailable = false,
    forkAvailable = false,
    reverted = false,
    undoPending = false,
    forkPending = false,
    promptFailure = null,
    retryPending = false,
    onRetryPrompt,
    onDismissPromptFailure,
    onUndo,
    onFork,
    onDisclosureChange
  }: {
    turn: SessionConversationTurn;
    imageGallery?: SessionImageGalleryItem[];
    failedImageKeys?: ReadonlySet<string>;
    onImageFailure?: ((key: string) => void) | null;
    undoAvailable?: boolean;
    forkAvailable?: boolean;
    reverted?: boolean;
    undoPending?: boolean;
    forkPending?: boolean;
    promptFailure?: PromptFailure | null;
    retryPending?: boolean;
    onRetryPrompt?: (() => void | Promise<void>) | null;
    onDismissPromptFailure?: (() => void) | null;
    onUndo?: (messageId: string) => void;
    onFork?: () => void;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
  } = $props();

  let copiedAssistantId = $state<string | null>(null);
  let copiedUserId = $state<string | null>(null);
  const presentation = $derived(turn.presentation ?? buildTurnPresentation(turn.content, turn.settled ?? true));

  function contentSegments(blocks: SessionContentBlock[] | undefined, text: string) {
    const source = blocks?.length ? blocks : text ? [{ type: 'text' as const, text }] : [];
    const segments: Array<
      | { type: 'text'; block: Extract<SessionContentBlock, { type: 'text' }> }
      | { type: 'attachments'; blocks: Exclude<SessionContentBlock, { type: 'text' }>[] }
    > = [];
    for (const block of source) {
      if (block.type === 'text') {
        segments.push({ type: 'text', block });
        continue;
      }
      const previous = segments.at(-1);
      if (previous?.type === 'attachments') previous.blocks.push(block);
      else segments.push({ type: 'attachments', blocks: [block] });
    }
    return segments;
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

<article class:session-turn-reverted={reverted} class="session-turn">
  {#if turn.user}
    <section class="session-user-message-shell">
      <div class="session-message session-message-user">
        {#each contentSegments(turn.user.blocks, turn.user.text) as segment}
          {#if segment.type === 'text'}
            <div class="session-message-body markdown-body" use:enhanceCodeBlocks>{@html renderMarkdownToHtml(segment.block.text)}</div>
          {:else}
            <SessionAttachmentPreview blocks={segment.blocks} gallery={imageGallery} {failedImageKeys} {onImageFailure} />
          {/if}
        {/each}
      </div>

      <div class="session-message-actions session-user-message-actions" aria-label="User message actions">
        {#if turn.user.text}<button
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
        </button>{/if}
      </div>
    </section>
  {/if}

  <div class="session-turn-content">
    {#if promptFailure && onDismissPromptFailure}
      <SessionPromptError
        failure={promptFailure}
        {retryPending}
        onRetry={onRetryPrompt}
        onDismiss={onDismissPromptFailure}
      />
    {/if}
    {#each presentation as item (item.id)}
      {#if item.type === 'work-group'}
        <SessionWorkGroup group={item} {onDisclosureChange} />
      {:else}
        <section class="session-agent-block session-assistant-message-shell">
          {#each contentSegments(item.blocks, item.text) as segment}
            {#if segment.type === 'text'}
              <div class="session-agent-body markdown-body" use:enhanceCodeBlocks>{@html renderMarkdownToHtml(segment.block.text)}</div>
            {:else}
              <SessionAttachmentPreview blocks={segment.blocks} gallery={imageGallery} {failedImageKeys} {onImageFailure} />
            {/if}
          {/each}

          <div class="session-message-actions session-assistant-message-actions" aria-label="Message actions">
            {#if item.text}<button
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
            </button>{/if}
            {#if forkAvailable}
              <button
                class="session-message-action-btn"
                type="button"
                aria-label="Fork into new session"
                title="Fork into a new session from this response"
                disabled={forkPending}
                onclick={() => onFork?.()}
              >
                {#if forkPending}<LoaderCircle size={15} class="animate-spin" />{:else}<GitFork size={15} />{/if}
              </button>
            {/if}
            {#if undoAvailable && turn.user?.messageId}
              <button
                class="session-message-action-btn"
                type="button"
                aria-label="Undo to this prompt"
                title="Undo workspace to this prompt"
                disabled={undoPending}
                onclick={() => turn.user?.messageId && onUndo?.(turn.user.messageId)}
              >
                <Undo2 size={15} />
              </button>
            {/if}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</article>
