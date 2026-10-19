<script lang="ts">
  import { FolderSearch } from '@lucide/svelte';
  import { onDestroy } from 'svelte';
  import { suggestWorkspacePaths } from '$native';
  import type { WorkspaceSuggestion } from '$lib/domain/types';
  import { isEmbedded, platformCapabilities } from '$lib/platform/runtime';

  const RECENT_PREFIX = '__recent__:';

  let {
    value = '',
    disabled = false,
    recentPaths = [],
    onInput
  }: {
    value?: string;
    disabled?: boolean;
    recentPaths?: string[];
    onInput: (value: string) => void;
  } = $props();

  let suggestions = $state<WorkspaceSuggestion[]>([]);
  let open = $state(false);
  let highlightedIndex = $state(0);
  let loading = $state(false);
  let requestToken = 0;
  let containerElement: HTMLDivElement | null = null;
  let inputElement: HTMLInputElement | null = null;
  let selectingSuggestion = false;
  let restoringInputFocus = false;

  onDestroy(() => { requestToken += 1; });

  function closeSuggestions() {
    selectingSuggestion = false;
    requestToken += 1;
    open = false;
    suggestions = [];
    highlightedIndex = 0;
    loading = false;
  }

  function handleFocusOut(event: FocusEvent) {
    if (selectingSuggestion || (event.relatedTarget instanceof Node && containerElement?.contains(event.relatedTarget))) return;
    closeSuggestions();
  }

  function handleOutsidePointerDown(event: PointerEvent) {
    if (!(event.target instanceof Node) || !containerElement?.contains(event.target)) closeSuggestions();
  }

  function beginSuggestionPointer(event: PointerEvent) {
    if (event.button > 0) return;
    // A webview may blur the input before click. Keep the pressed row mounted
    // and stable until selection completes, without committing on pointerdown.
    selectingSuggestion = true;
    requestToken += 1;
    loading = false;
  }

  function finishSuggestionPointer(event: PointerEvent) {
    selectingSuggestion = false;
    if (!(event.target instanceof Node) || !containerElement?.contains(event.target)) closeSuggestions();
  }

  function cancelSuggestionPointer() {
    selectingSuggestion = false;
    if (!containerElement?.contains(document.activeElement)) closeSuggestions();
  }

  async function updateSuggestions(query: string) {
    const trimmed = query.trim();
    const currentToken = ++requestToken;

    if (!trimmed) {
      suggestions = recentPaths.map((path) => ({ path, name: `${RECENT_PREFIX}${path}` }));
      open = suggestions.length > 0;
      highlightedIndex = 0;
      loading = false;
      return;
    }

    if (!platformCapabilities.workspacePathSuggestions) {
      suggestions = [];
      open = false;
      loading = false;
      return;
    }

    loading = true;
    try {
      const next = await suggestWorkspacePaths(trimmed, 10);
      if (currentToken !== requestToken) return;
      suggestions = next;
      open = next.length > 0;
      highlightedIndex = 0;
    } catch {
      if (currentToken !== requestToken) return;
      suggestions = [];
      open = false;
    } finally {
      if (currentToken === requestToken) {
        loading = false;
      }
    }
  }

  function handleInput(event: Event) {
    const next = (event.currentTarget as HTMLInputElement).value;
    onInput(next);
    void updateSuggestions(next);
  }

  function applySuggestion(path: string) {
    closeSuggestions();
    onInput(path);
    restoringInputFocus = true;
    inputElement?.focus({ preventScroll: true });
    restoringInputFocus = false;
  }

  function formatSuggestionName(suggestion: WorkspaceSuggestion): string {
    return suggestion.name.startsWith(RECENT_PREFIX)
      ? suggestion.path.split('/').filter(Boolean).pop() ?? suggestion.path
      : suggestion.name;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (open || loading) event.preventDefault();
      closeSuggestions();
      return;
    }
    if (!open || suggestions.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, suggestions.length - 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      return;
    }

    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      const match = suggestions[highlightedIndex];
      if (match) {
        applySuggestion(match.path);
      }
      return;
    }
  }
</script>

<svelte:window onpointerdown={handleOutsidePointerDown} onpointerup={finishSuggestionPointer} onpointercancel={cancelSuggestionPointer} />

<div class="relative" bind:this={containerElement} onfocusout={handleFocusOut}>
  <div class="workspace-input-shell">
    <FolderSearch size={15} />
    <input
      bind:this={inputElement}
      class="workspace-input"
      placeholder={isEmbedded ? '/path/on/qmtcode/server' : '/absolute/path/to/workspace'}
      value={value}
      disabled={disabled}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={() => { if (!restoringInputFocus) void updateSuggestions(value); }}
    />
    {#if loading}
      <span class="muted workspace-input-loading text-xs">...</span>
    {/if}

  </div>
  {#if isEmbedded}
    <p class="muted mt-1 px-1 text-xs">Use an absolute path on the qmtcode server.</p>
  {/if}

  {#if open && suggestions.length > 0}
    <div class="workspace-suggestion-popover">
      {#each suggestions as suggestion, index}
        <button
          class="workspace-suggestion-row"
          class:model-picker-row-selected={highlightedIndex === index}
          type="button"
          onpointerdown={beginSuggestionPointer}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => applySuggestion(suggestion.path)}
          onmousemove={() => (highlightedIndex = index)}
        >
          <div class="truncate text-sm font-medium">{formatSuggestionName(suggestion)}</div>
          <div class="muted truncate text-xs">{suggestion.path}</div>
        </button>
      {/each}
    </div>
  {/if}
</div>
