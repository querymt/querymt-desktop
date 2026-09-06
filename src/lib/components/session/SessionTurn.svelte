<script lang="ts">
  import { Check, Copy, GitFork, LoaderCircle, Undo2 } from '@lucide/svelte';
  import SessionPromptError from '$lib/components/session/SessionPromptError.svelte';
  import SessionAttachmentPreview from '$lib/components/session/SessionAttachmentPreview.svelte';
  import SessionWorkGroup from '$lib/components/session/SessionWorkGroup.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import { buildTurnPresentation, formatTurnDuration, type SessionConversationTurn } from '$lib/domain/session-conversation';
  import { renderMarkdownToHtml, splitStreamingMarkdown } from '$lib/domain/markdown';
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

  let copiedResponse = $state(false);
  let copiedUserId = $state<string | null>(null);
  const presentation = $derived(turn.presentation ?? buildTurnPresentation(turn.content, turn.settled ?? true));
  const lastPresentationId = $derived(presentation.at(-1)?.id ?? null);
  // Everything the response copy button should capture: the turn's assistant
  // text as markdown, without reasoning traces or tool activity.
  const turnResponseMarkdown = $derived(
    turn.content
      .filter((item) => item.type === 'assistant')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')
  );

  function markdownParts(html: string | undefined, text: string, live: boolean, fullText: string) {
    if (live) return splitStreamingMarkdown(text);
    if (html && text === fullText) return { frozenHtml: html, tailText: '' };
    return { frozenHtml: text ? renderMarkdownToHtml(text) : '', tailText: '' };
  }

  function contentSegments(blocks: SessionContentBlock[] | undefined, text: string) {
    const source = blocks?.length ? blocks : text ? [{ type: 'text' as const, text }] : [];
    const segments: Array<
      | { type: 'text'; block: Extract<SessionContentBlock, { type: 'text' }> }
      | { type: 'attachments'; blocks: Exclude<SessionContentBlock, { type: 'text' }>[] }
    > = [];
    for (const block of source) {
      if (block.type === 'text') {
        const previous = segments.at(-1);
        // Streamed responses arrive as one text block per chunk; coalesce
        // consecutive ones so the markdown renders as a single flow instead
        // of one paragraph per chunk.
        if (previous?.type === 'text') {
          previous.block = { type: 'text', text: previous.block.text + block.text };
          continue;
        }
        segments.push({ type: 'text', block: { type: 'text', text: block.text } });
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

  async function copyTurnResponse() {
    if (!turnResponseMarkdown) return;

    try {
      await navigator.clipboard.writeText(turnResponseMarkdown);
      copiedResponse = true;
      window.setTimeout(() => {
        copiedResponse = false;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy response', error);
    }
  }
</script>

<article class:session-turn-reverted={reverted} class="session-turn" data-turn-id={turn.id}>
  {#if turn.user}
    <section class="session-user-message-shell">
      <div class="session-message session-message-user">
        {#each contentSegments(turn.user.blocks, turn.user.text) as segment}
          {#if segment.type === 'text'}
            {@const parts = markdownParts(turn.user.html, segment.block.text, false, turn.user.text)}
            <div class="session-message-body markdown-body" use:enhanceCodeBlocks>
              {#if parts.frozenHtml}<div class="session-message-body-frozen">{@html parts.frozenHtml}</div>{/if}
              {#if parts.tailText}<div class="session-message-body-tail">{parts.tailText}</div>{/if}
            </div>
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
    {#snippet responseActions()}
      <div class="session-message-actions session-assistant-message-actions" aria-label="Message actions">
        {#if turnResponseMarkdown}<button
          class="session-message-action-btn"
          type="button"
          aria-label={copiedResponse ? 'Response copied' : 'Copy response'}
          title={copiedResponse ? 'Copied' : 'Copy response'}
          onclick={copyTurnResponse}
        >
          {#if copiedResponse}
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
        {#if turn.durationMs !== undefined}
          <span class="session-turn-duration">Worked for {formatTurnDuration(turn.durationMs)}</span>
        {/if}
      </div>
    {/snippet}

    {#each presentation as item (item.id)}
      {#if item.type === 'work-group'}
        <SessionWorkGroup group={item} {onDisclosureChange} />
        {#if item.id === lastPresentationId}{@render responseActions()}{/if}
      {:else}
        <section class="session-agent-block session-assistant-message-shell">
          {#each contentSegments(item.blocks, item.text) as segment}
            {#if segment.type === 'text'}
              {@const parts = markdownParts(item.html, segment.block.text, turn.settled === false, item.text)}
              <div class="session-agent-body markdown-body" use:enhanceCodeBlocks>
                {#if parts.frozenHtml}<div class="session-agent-body-frozen">{@html parts.frozenHtml}</div>{/if}
                {#if parts.tailText}<div class="session-agent-body-tail">{parts.tailText}</div>{/if}
              </div>
            {:else}
              <SessionAttachmentPreview blocks={segment.blocks} gallery={imageGallery} {failedImageKeys} {onImageFailure} />
            {/if}
          {/each}

          {#if item.id === lastPresentationId}{@render responseActions()}{/if}
        </section>
      {/if}
    {/each}
  </div>
</article>
