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
  import { toolFilePath, parseObject } from '$lib/domain/session-tool-args';
  import { buildSessionToolDiffs } from '$lib/domain/session-tool-diff';
  import { parseReadFileOutput } from '$lib/domain/session-tool-read-output';
  import { parseShellToolOutput } from '$lib/domain/session-tool-shell-output';
  import {
    formatChangeStats,
    getDelegateTargetAgentId,
    getSessionShellCommand,
    getSessionToolName,
    getSessionToolPresentation
  } from '$lib/domain/session-tool-presentation';
  import type { SessionToolCallItem } from '$lib/domain/types';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { loadSessionToolPatchDiff } from './session-tool-patch-diff';
  import { loadSessionToolReadOutput } from './session-tool-read-output';
  import { loadSessionToolTerminalOutput } from './session-tool-terminal-output';

  let { tool }: { tool: SessionToolCallItem } = $props();

  let open = $state(false);
  let sourceOpenForId = $state<string | null>(null);
  let copiedPart = $state<'arguments' | 'result' | null>(null);
  const presentation = $derived(getSessionToolPresentation(tool));
  const diffs = $derived(buildSessionToolDiffs(presentation.name, tool.status, tool.arguments, tool.result));
  const READ_FILE_TOOLS = new Set(['read_tool', 'get_function', 'get_symbol', 'read']);
  const toolName = $derived(getSessionToolName(tool));
  const isRead = $derived(READ_FILE_TOOLS.has(toolName));
  const isShell = $derived(toolName === 'shell' || toolName === 'execute');
  const readOutputView = $derived.by(() => {
    if (!isRead) return null;
    const args = parseObject(tool.arguments);
    const paths = args?.paths;
    const path = args ? toolFilePath(args) || (Array.isArray(paths) && typeof paths[0] === 'string' ? paths[0] : '') : '';
    return parseReadFileOutput(tool.result, path);
  });
  const terminalOutput = $derived.by(() => {
    if (!isShell) return null;
    const raw = tool.result?.trim() ?? '';
    if (!raw) return { stdout: '', stderr: '', exitCode: null };
    const parsed = parseShellToolOutput(raw);
    if (parsed) return parsed;
    return {
      stdout: resultError(raw) ?? (raw.startsWith('{') || /^\[\s*[{\"]/.test(raw) ? 'Unable to decode shell output.' : raw),
      stderr: '',
      exitCode: null
    };
  });
  const readFallback = $derived.by(() => {
    const raw = tool.result?.trim();
    if (!raw) return tool.status === 'in_progress' ? 'Waiting for read output...' : 'No read output available.';
    return resultError(raw) ?? (/^[\[{]/.test(raw) ? 'Unable to display read output.' : raw);
  });
  const hasCustomResult = $derived(isRead || isShell || readOutputView !== null || terminalOutput !== null);
  const shellCommand = $derived(terminalOutput ? getSessionShellCommand(tool) : null);
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
  const sourceOpen = $derived(Boolean(open && chatPreferencesStore.developerMode && sourceOpenForId === tool.id));

  $effect(() => {
    if (!open || !chatPreferencesStore.developerMode) sourceOpenForId = null;
  });

  function resultError(raw: string): string | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const record = parsed as Record<string, unknown>;
      const error = record.error ?? record.message;
      return typeof error === 'string' ? error : null;
    } catch {
      return null;
    }
  }

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
  class:session-tool-block-diff={diffs.length > 0}
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

  {#snippet parametersSection()}
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
  {/snippet}

  {#snippet rawResultSection()}
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
  {/snippet}

  {#if open && expandable}
    <div class="session-tool-content">
      {#if diffs.length > 0}
        <section class="session-tool-detail" aria-label="File diff">
          {#await loadSessionToolPatchDiff() then { default: SessionToolPatchDiff }}
            {#each diffs as file (file.path)}
              <SessionToolPatchDiff patch={file.patch} hideFileHeader={diffs.length === 1} />
            {/each}
          {:catch}
            <p class="session-tool-diff-error">Unable to load diff preview.</p>
          {/await}
        </section>
      {/if}
      {#if readOutputView}
        {#await loadSessionToolReadOutput() then { default: SessionToolReadOutput }}
          <SessionToolReadOutput view={readOutputView} />
        {:catch}
          <p>Unable to load read output.</p>
        {/await}
      {:else if isRead}
        <section class="session-tool-detail" aria-label="Read output"><pre>{readFallback}</pre></section>
      {:else if terminalOutput}
        {#await loadSessionToolTerminalOutput() then { default: SessionToolTerminalOutput }}
          <SessionToolTerminalOutput
            command={shellCommand}
            stdout={terminalOutput.stdout}
            stderr={terminalOutput.stderr}
            exitCode={terminalOutput.exitCode}
          />
        {:catch}
          <p>Unable to load console output.</p>
        {/await}
      {/if}
      {#if diffs.length === 0 && !hasCustomResult}
        {@render parametersSection()}
        {@render rawResultSection()}
      {/if}
      {#if chatPreferencesStore.developerMode && (diffs.length > 0 || hasCustomResult) && (presentation.argumentsText || presentation.resultText)}
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
      {#if sourceOpen}
        {@render parametersSection()}
        {@render rawResultSection()}
      {/if}
    </div>
  {/if}
</details>
