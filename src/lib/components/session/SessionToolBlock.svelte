<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    AlertTriangle,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronsLeftRightEllipsis,
    ChevronsRightLeft,
    CircleEllipsis,
    ClipboardCheck,
    Copy,
    Eye,
    FilePenLine,
    Globe,
    ListTodo,
    LoaderCircle,
    MessageCircleQuestion,
    Network,
    Search,
    Sparkles,
    TerminalSquare,
    Trash2,
    Wrench
  } from '@lucide/svelte';
  import { buildSessionToolDiffs } from '$lib/domain/session-tool-diff';
  import { formatChangeStats, getDelegateTargetAgentId, getSessionToolPresentation } from '$lib/domain/session-tool-presentation';
  import type { SessionToolCallItem } from '$lib/domain/types';
  import { loadSessionToolPatchDiff } from './session-tool-patch-diff';

  let { tool }: { tool: SessionToolCallItem } = $props();

  let open = $state(false);
  let sourceOpenForId = $state<string | null>(null);
  let copiedPart = $state<'arguments' | 'result' | null>(null);
  const presentation = $derived(getSessionToolPresentation(tool));
  const diffs = $derived(buildSessionToolDiffs(presentation.name, tool.status, tool.arguments, tool.result));
  const expandable = $derived(presentation.expandable || diffs.length > 0);
  const changeStatsLabel = $derived(formatChangeStats(presentation.changeStats));
  const summaryLabel = $derived(
    `${presentation.label}${presentation.preview ? ` - ${presentation.preview}` : ''}${changeStatsLabel ? ` ${changeStatsLabel}` : ''}`
  );
  const delegateTarget = $derived(presentation.icon === 'delegate' ? getDelegateTargetAgentId(tool) : null);
  const childSessionHref = $derived.by(() => {
    const agentId = page.params.agentId;
    const childSessionId = tool.childSessionId?.trim();
    if (!agentId || !childSessionId) return null;
    return `/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(childSessionId)}`;
  });
  const sourceOpen = $derived(Boolean(open && sourceOpenForId === tool.id));

  $effect(() => {
    if (!open) sourceOpenForId = null;
  });

  function handleDetailsToggle(event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    if (!details.open) sourceOpenForId = null;
  }

  function openChildSession(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!childSessionHref) return;
    void goto(childSessionHref);
  }

  function handleChildSessionKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    openChildSession(event);
  }

  function toggleSourceData() {
    sourceOpenForId = sourceOpenForId === tool.id ? null : tool.id;
  }

  async function copyDetail(part: 'arguments' | 'result', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copiedPart = part;
      window.setTimeout(() => {
        if (copiedPart === part) copiedPart = null;
      }, 1200);
    } catch (error) {
      console.error(`Failed to copy tool ${part}`, error);
    }
  }
</script>

<details
  bind:open
  class={`details-reset session-tool-block session-tool-block-${tool.status}`}
  aria-label={summaryLabel}
  ontoggle={handleDetailsToggle}
>
  <summary class="session-tool-summary" aria-label={`${summaryLabel}, ${presentation.statusLabel}`}>
    <span class="session-tool-icon" aria-hidden="true">
      {#if presentation.icon === 'terminal'}
        <TerminalSquare size={14} />
      {:else if presentation.icon === 'read'}
        <Eye size={14} />
      {:else if presentation.icon === 'edit'}
        <FilePenLine size={14} />
      {:else if presentation.icon === 'delete'}
        <Trash2 size={14} />
      {:else if presentation.icon === 'search'}
        <Search size={14} />
      {:else if presentation.icon === 'web'}
        <Globe size={14} />
      {:else if presentation.icon === 'question'}
        <MessageCircleQuestion size={14} />
      {:else if presentation.icon === 'delegate'}
        <Network size={14} />
      {:else if presentation.icon === 'task'}
        <ListTodo size={14} />
      {:else if presentation.icon === 'skill'}
        <Sparkles size={14} />
      {:else}
        <Wrench size={14} />
      {/if}
    </span>

    <span class="session-tool-summary-main">
      <span class="session-tool-title">{presentation.label}</span>
      {#if presentation.preview}<span class="session-tool-preview">{presentation.preview}</span>{/if}
    </span>

    <span class="session-tool-summary-state">
      {#if presentation.changeStats}
        <span class="session-tool-change-stats" aria-hidden="true">
          {#if presentation.changeStats.added > 0}
            <span class="session-tool-change-added">+{presentation.changeStats.added}</span>
          {/if}
          {#if presentation.changeStats.removed > 0}
            <span class="session-tool-change-removed">-{presentation.changeStats.removed}</span>
          {/if}
        </span>
      {/if}
      {#if childSessionHref}
        <span
          class="session-tool-session-pill"
          role="button"
          tabindex="0"
          aria-label={delegateTarget ? `Open ${delegateTarget} session` : 'Open delegated session'}
          title={delegateTarget ? `Open ${delegateTarget}` : 'Open delegated session'}
          onclick={openChildSession}
          onkeydown={handleChildSessionKeydown}
        >
          <ArrowUpRight size={12} aria-hidden="true" />
          <span class="session-tool-session-pill-label">{delegateTarget ?? 'Open session'}</span>
        </span>
      {/if}
      {#if expandable}
        <span class="session-tool-disclosure" aria-hidden="true"><ChevronDown size={13} /></span>
      {/if}
      <span class={`session-tool-status session-tool-status-${tool.status}`} title={presentation.statusLabel}>
        {#if tool.status === 'failed'}
          <AlertTriangle size={13} aria-hidden="true" />
        {:else if tool.status === 'in_progress'}
          <LoaderCircle size={13} class="animate-spin" aria-hidden="true" />
        {:else if tool.status === 'completed'}
          <Check size={13} aria-hidden="true" />
        {:else}
          <CircleEllipsis size={13} aria-hidden="true" />
        {/if}
        <span class="sr-only">{presentation.statusLabel}</span>
      </span>
    </span>
  </summary>

  {#if open && expandable}
    <div class="session-tool-content">
      {#if diffs.length > 0}
        <section class="session-tool-detail" aria-label="File diff">
          {#await loadSessionToolPatchDiff() then { default: SessionToolPatchDiff }}
            {#each diffs as file (file.path)}
              <SessionToolPatchDiff patch={file.patch} />
            {/each}
          {:catch}
            <p class="session-tool-diff-error">Unable to load diff preview.</p>
          {/await}
        </section>
        {#if presentation.argumentsText || presentation.resultText}
          <div class="session-tool-source-toggle">
            <button
              class="session-tool-copy"
              type="button"
              aria-label={sourceOpen ? 'Hide source data' : 'Show source data'}
              title={sourceOpen ? 'Hide source data' : 'Show source data'}
              aria-expanded={sourceOpen}
              onclick={toggleSourceData}
            >
              {#if sourceOpen}
                <ChevronsRightLeft size={13} aria-hidden="true" />
              {:else}
                <ChevronsLeftRightEllipsis size={13} aria-hidden="true" />
              {/if}
            </button>
          </div>
        {/if}
      {/if}
      {#if diffs.length === 0 || sourceOpen}
        {#if presentation.argumentsText}
          <section class="session-tool-detail" aria-label="Tool parameters">
            <header class="session-tool-detail-header">
              <span>Parameters</span>
              <button
                class="session-tool-copy"
                type="button"
                aria-label={copiedPart === 'arguments' ? 'Parameters copied' : 'Copy parameters'}
                title={copiedPart === 'arguments' ? 'Copied' : 'Copy parameters'}
                onclick={() => copyDetail('arguments', presentation.argumentsText!)}
              >
                {#if copiedPart === 'arguments'}<ClipboardCheck size={13} />{:else}<Copy size={13} />{/if}
              </button>
            </header>
            <pre>{presentation.argumentsText}</pre>
          </section>
        {/if}
        {#if presentation.resultText}
          <section class="session-tool-detail" class:session-tool-detail-failed={tool.status === 'failed'} aria-label="Tool result">
            <header class="session-tool-detail-header">
              <span>{tool.status === 'failed' ? 'Error' : 'Result'}</span>
              <button
                class="session-tool-copy"
                type="button"
                aria-label={copiedPart === 'result' ? 'Result copied' : 'Copy result'}
                title={copiedPart === 'result' ? 'Copied' : 'Copy result'}
                onclick={() => copyDetail('result', presentation.resultText!)}
              >
                {#if copiedPart === 'result'}<ClipboardCheck size={13} />{:else}<Copy size={13} />{/if}
              </button>
            </header>
            <pre>{presentation.resultText}</pre>
          </section>
        {/if}
      {/if}
    </div>
  {/if}
</details>
