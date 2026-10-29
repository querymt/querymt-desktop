<script lang="ts">
  import { ArrowUpRight, Braces, Check, Copy, Diff, GitFork, LoaderCircle, Redo2, Undo2 } from '@lucide/svelte';
  import SessionPromptError from '$lib/components/session/SessionPromptError.svelte';
  import SessionAttachmentPreview from '$lib/components/session/SessionAttachmentPreview.svelte';
  import SessionWorkGroup from '$lib/components/session/SessionWorkGroup.svelte';
  import SessionMessageMetadata from '$lib/components/session/SessionMessageMetadata.svelte';
  import SessionDelegatesBubble from '$lib/components/session/SessionDelegatesBubble.svelte';
  import { extractMessageFrontMatter } from '$lib/domain/message-frontmatter';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { enhanceCodeBlocks } from '$lib/components/session/code-blocks';
  import { preloadSessionToolPatchDiff } from './session-tool-patch-diff';
  import { buildTurnPresentation, formatTurnDuration, getTurnChangedFileCount, getTurnChangeStats, getTurnDelegates, type SessionConversationTurn } from '$lib/domain/session-conversation';
  import { normalizeMarkdownCodeFences, renderMarkdownToHtml, splitStreamingMarkdown } from '$lib/domain/markdown';
  import type { DesktopSessionSummary, SessionContentBlock, SessionImageGalleryItem } from '$lib/domain/types';
  import type { PromptFailure } from '$lib/domain/prompt-errors';

  let {
    turn,
    agentId = '',
    sessionId = null,
    sessions = [],
    imageGallery,
    failedImageKeys,
    onImageFailure,
    undoAvailable = false,
    redoAvailable = false,
    forkAvailable = false,
    reverted = false,
    undoPending = false,
    forkPending = false,
    promptFailure = null,
    retryPending = false,
    onRetryPrompt,
    onDismissPromptFailure,
    onUndo,
    onRedo,
    onFork,
    diffOpen = false,
    diffPanelId,
    onToggleDiff,
    onPreloadDiff,
    onDisclosureChange
  }: {
    turn: SessionConversationTurn;
    agentId?: string;
    sessionId?: string | null;
    sessions?: DesktopSessionSummary[];
    imageGallery?: SessionImageGalleryItem[];
    failedImageKeys?: ReadonlySet<string>;
    onImageFailure?: ((key: string) => void) | null;
    undoAvailable?: boolean;
    redoAvailable?: boolean;
    forkAvailable?: boolean;
    reverted?: boolean;
    undoPending?: boolean;
    forkPending?: boolean;
    promptFailure?: PromptFailure | null;
    retryPending?: boolean;
    onRetryPrompt?: (() => void | Promise<void>) | null;
    onDismissPromptFailure?: (() => void) | null;
    onUndo?: (messageId: string) => void;
    onRedo?: () => void | Promise<void>;
    onFork?: () => void;
    diffOpen?: boolean;
    diffPanelId?: string;
    onToggleDiff?: (event: MouseEvent) => void;
    onPreloadDiff?: () => void;
    onDisclosureChange?: (anchor: HTMLElement, expanded: boolean) => void;
  } = $props();

  let copiedResponse = $state(false);
  let copiedUserId = $state<string | null>(null);
  let metadataOpenKey = $state<string | null>(null);
  const metadataPanelId = $props.id();
  const userPresentation = $derived.by(() => {
    const segments = contentSegments(turn.user?.blocks, turn.user?.text ?? '');
    const firstTextIndex = segments.findIndex((segment) => segment.type === 'text');
    const first = segments[firstTextIndex];
    if (first?.type !== 'text') return { segments, frontMatter: null };
    const { body, frontMatter } = extractMessageFrontMatter(first.block.text);
    if (frontMatter) {
      if (body.trim()) segments[firstTextIndex] = { type: 'text', block: { type: 'text', text: body } };
      else segments.splice(firstTextIndex, 1);
    }
    return { segments, frontMatter };
  });
  const metadataKey = $derived(userPresentation.frontMatter ? `${turn.user?.id}\u0000${userPresentation.frontMatter.source}` : null);
  const metadataOpen = $derived(chatPreferencesStore.developerMode && metadataKey !== null && metadataOpenKey === metadataKey);

  $effect(() => {
    if (!chatPreferencesStore.developerMode || metadataOpenKey !== metadataKey) metadataOpenKey = null;
  });
  const presentation = $derived(turn.presentation ?? buildTurnPresentation(turn.content, turn.settled ?? true));
  const lastPresentationId = $derived(presentation.at(-1)?.id ?? null);
  const changeStats = $derived(getTurnChangeStats(turn));
  const changedFileCount = $derived(getTurnChangedFileCount(turn));
  const delegateCount = $derived(getTurnDelegates(turn).length);
  // Everything the response copy button should capture: the turn's assistant
  // text as markdown, without reasoning traces or tool activity.
  const turnResponseMarkdown = $derived(
    turn.content
      .filter((item) => item.type === 'assistant')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join('\n\n')
  );

  function preloadTurnDiff() {
    preloadSessionToolPatchDiff();
    onPreloadDiff?.();
  }

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
      await navigator.clipboard.writeText(normalizeMarkdownCodeFences(turnResponseMarkdown));
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
        {#if userPresentation.frontMatter && userPresentation.segments.length === 0}
          <p class="muted">No message body</p>
        {/if}
        {#each userPresentation.segments as segment}
          {#if segment.type === 'text'}
            {@const parts = markdownParts(userPresentation.frontMatter ? undefined : turn.user.html, segment.block.text, false, turn.user.text)}
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
        {#if chatPreferencesStore.developerMode && userPresentation.frontMatter}
          <button
            class="session-message-action-btn"
            type="button"
            aria-label={metadataOpen ? 'Hide metadata' : 'Show metadata'}
            title={metadataOpen ? 'Hide metadata' : 'Show metadata'}
            aria-expanded={metadataOpen}
            aria-controls={metadataPanelId}
            onclick={(event) => {
              const expanded = !metadataOpen;
              metadataOpenKey = expanded ? metadataKey : null;
              onDisclosureChange?.(event.currentTarget, expanded);
            }}
          ><Braces size={15} aria-hidden="true" /></button>
        {/if}
      </div>
      {#if metadataOpen && userPresentation.frontMatter}
        <SessionMessageMetadata frontMatter={userPresentation.frontMatter} id={metadataPanelId} />
      {/if}
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
    {#snippet turnDiffPill()}
      {#if changeStats}
        <button
          class="session-turn-diff-pill"
          type="button"
          aria-label={`Turn changes: ${changeStats.added} ${changeStats.added === 1 ? 'line' : 'lines'} added, ${changeStats.removed} ${changeStats.removed === 1 ? 'line' : 'lines'} deleted${changedFileCount ? `, ${changedFileCount} ${changedFileCount === 1 ? 'file' : 'files'} changed` : ''}`}
          aria-expanded={diffOpen}
          aria-controls={diffOpen ? diffPanelId : undefined}
          onpointerenter={preloadTurnDiff}
          onfocus={preloadTurnDiff}
          onclick={onToggleDiff}
        >
          <Diff size={13} aria-hidden="true" />
          {#if changedFileCount !== null && changedFileCount > 0}
            <span class="session-turn-diff-pill-files" aria-hidden="true">{changedFileCount}</span>
          {/if}
          <span class="session-tool-change-added" aria-hidden="true">+{changeStats.added}</span>
          <span class="session-tool-change-removed" aria-hidden="true">-{changeStats.removed}</span>
          <ArrowUpRight size={12} class="session-turn-diff-pill-arrow" aria-hidden="true" />
        </button>
      {/if}
    {/snippet}

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
        {#if redoAvailable}
          <button
            class="session-message-action-btn"
            type="button"
            aria-label="Redo this turn"
            title="Redo workspace changes for this turn"
            onclick={onRedo}
          >
            <Redo2 size={15} />
          </button>
        {/if}
        {#if turn.durationMs !== undefined || changeStats || delegateCount > 0}
          <div class="session-turn-meta">
            {#if turn.durationMs !== undefined}
              <span class="session-turn-duration">Worked for {formatTurnDuration(turn.durationMs)}</span>
            {/if}
            {#if delegateCount > 0}
              <div class="session-turn-pills">
                {@render turnDiffPill()}
                <SessionDelegatesBubble variant="turn" {turn} {agentId} {sessionId} {sessions} />
              </div>
            {:else}
              {@render turnDiffPill()}
            {/if}
          </div>
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
    {#if presentation.length === 0 && (undoAvailable || redoAvailable)}{@render responseActions()}{/if}
  </div>
</article>
