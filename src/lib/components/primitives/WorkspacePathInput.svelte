<script lang="ts">
  import { FolderSearch, Monitor } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import ComposerSplitPillSelect from '$lib/components/primitives/ComposerSplitPillSelect.svelte';
  import { suggestWorkspacePaths } from '$lib/querymt/sidecar';
  import type { ComposerOption, WorkspaceSuggestion } from '$lib/domain/types';

  const RECENT_PREFIX = '__recent__:';

  let {
    value = '',
    disabled = false,
    recentPaths = [],
    targetOptions = [],
    selectedTargetId = 'local',
    onInput,
    onTargetChange = null
  }: {
    value?: string;
    disabled?: boolean;
    recentPaths?: string[];
    targetOptions?: ComposerOption[];
    selectedTargetId?: string;
    onInput: (value: string) => void;
    onTargetChange?: ((targetId: string) => void) | null;
  } = $props();

  let suggestions = $state<WorkspaceSuggestion[]>([]);
  let open = $state(false);
  let highlightedIndex = $state(0);
  let loading = $state(false);
  let requestToken = 0;

  const hasTargetSelector = $derived(targetOptions.length > 1);

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
    onInput(path);
    open = false;
    suggestions = [];
    highlightedIndex = 0;
  }

  function formatSuggestionName(suggestion: WorkspaceSuggestion): string {
    return suggestion.name.startsWith(RECENT_PREFIX)
      ? suggestion.path.split('/').filter(Boolean).pop() ?? suggestion.path
      : suggestion.name;
  }

  function handleKeydown(event: KeyboardEvent) {
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

    if (event.key === 'Escape') {
      open = false;
    }
  }
</script>

<div class="relative">
  <div class="workspace-input-shell">
    <FolderSearch size={15} />
    <input
      class="workspace-input"
      placeholder="/absolute/path/to/workspace"
      value={value}
      disabled={disabled}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onblur={() => setTimeout(() => (open = false), 120)}
      onfocus={() => void updateSuggestions(value)}
    />
    {#if loading}
      <span class="muted workspace-input-loading text-xs">...</span>
    {/if}
    {#if hasTargetSelector}
      <div class="workspace-target-select-wrap">
        <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
          <Tooltip.Root disableHoverableContent>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <div {...props} class="workspace-target-tooltip-trigger">
                  <ComposerSplitPillSelect
                    value={selectedTargetId}
                    options={targetOptions.map((target) => ({ value: target.id, label: target.label }))}
                    icon={Monitor}
                    ariaLabel="Session target"
                    showLabelTitle={false}
                    class="composer-control-pill workspace-target-pill"
                    onValueChange={(nextTargetId) => onTargetChange?.(nextTargetId)}
                  />
                </div>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="app-tooltip-content" sideOffset={6}>Session target</Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
    {/if}
  </div>

  {#if open && suggestions.length > 0}
    <div class="workspace-suggestion-popover">
      {#each suggestions as suggestion, index}
        <button
          class="workspace-suggestion-row"
          class:model-picker-row-selected={highlightedIndex === index}
          type="button"
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
