<script lang="ts">
  import { Bot, Check, RefreshCw, Search, X } from '@lucide/svelte';
  import { getContext, tick } from 'svelte';
  import { Dialog } from 'bits-ui';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ModelEntry, ModelInfo } from '$lib/domain/types';
  import { getModelSelectionKey } from '$lib/querymt/config-options';

  type ModelGroup = {
    label: string;
    items: ModelEntry[];
  };

  let {
    modelOptions = [],
    recentModels = [],
    selectedModelId = '',
    modelInfo = {},
    loading = false,
    disabled = false,
    agentLabel = null,
    class: className = '',
    onSelect,
    onRefresh = null
  }: {
    modelOptions?: ModelEntry[];
    recentModels?: ModelEntry[];
    selectedModelId?: string;
    modelInfo?: Record<string, ModelInfo | null>;
    loading?: boolean;
    disabled?: boolean;
    agentLabel?: string | null;
    class?: string;
    onSelect: (modelId: string) => void | Promise<void>;
    onRefresh?: (() => void | Promise<void>) | null;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let highlightedIndex = $state(0);
  let searchElement = $state<HTMLInputElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const selectedModel = $derived(
    modelOptions.find((entry) => getModelSelectionKey(entry) === selectedModelId) ??
      modelOptions.find((entry) => entry.id === selectedModelId && !entry.node_id) ??
      recentModels[0] ??
      modelOptions[0] ??
      null
  );

  const recentIds = $derived(new Set(recentModels.map(getModelSelectionKey)));

  const filteredGroups = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const groups: ModelGroup[] = [];

    const recentItems = recentModels
      .map((model) => ({ model, score: scoreModel(model, normalizedQuery) }))
      .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score)
      .map(({ model }) => model);

    groups.push({ label: 'Recent', items: recentItems });

    const providerMap = new Map<string, Array<{ model: ModelEntry; score: number }>>();
    for (const model of modelOptions) {
      if (recentIds.has(getModelSelectionKey(model))) continue;
      const score = scoreModel(model, normalizedQuery);
      if (score === Number.NEGATIVE_INFINITY) continue;
      const key = model.provider;
      providerMap.set(key, [...(providerMap.get(key) ?? []), { model, score }]);
    }

    const providerGroups = Array.from(providerMap.entries())
      .map(([label, entries]) => ({
        label,
        items: entries.sort((a, b) => b.score - a.score).map(({ model }) => model)
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [...groups, ...providerGroups];
  });

  const flatResults = $derived(filteredGroups.flatMap((group) => group.items));

  $effect(() => {
    if (!open) {
      query = '';
      highlightedIndex = 0;
      return;
    }

    highlightedIndex = clamp(highlightedIndex, 0, Math.max(flatResults.length - 1, 0));
  });

  export async function openPicker() {
    if (disabled) return;
    open = true;
    await tick();
    searchElement?.focus();
    searchElement?.select();
  }

  export function closePicker() {
    open = false;
  }

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
  }

  function focusSearch(event: Event) {
    event.preventDefault();
    searchElement?.focus();
    searchElement?.select();
  }

  function restoreTriggerFocus(event: Event) {
    event.preventDefault();
    triggerElement?.focus();
  }

  async function handleSelect(modelId: string) {
    await onSelect(modelId);
    closePicker();
  }

  async function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightedIndex = clamp(highlightedIndex + 1, 0, Math.max(flatResults.length - 1, 0));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightedIndex = clamp(highlightedIndex - 1, 0, Math.max(flatResults.length - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const target = flatResults[highlightedIndex];
      if (target) {
        await handleSelect(getModelSelectionKey(target));
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closePicker();
    }
  }

  function scoreModel(model: ModelEntry, normalizedQuery: string): number {
    if (!normalizedQuery) return 1;

    const fields = [model.label, model.model, model.provider, model.node_label, model.family]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());

    let best = Number.NEGATIVE_INFINITY;
    for (const field of fields) {
      const substring = field.indexOf(normalizedQuery);
      if (substring !== -1) {
        best = Math.max(best, 1000 - substring);
      }

      const words = field.split(/[^a-z0-9]+/g).filter(Boolean);
      if (words.some((word) => word.startsWith(normalizedQuery))) {
        best = Math.max(best, 800);
      }

      if (isOrderedSubsequence(field, normalizedQuery)) {
        best = Math.max(best, 400 - Math.max(field.length - normalizedQuery.length, 0));
      }
    }

    return best;
  }

  function isOrderedSubsequence(value: string, normalizedQuery: string): boolean {
    let q = 0;
    for (let i = 0; i < value.length && q < normalizedQuery.length; i += 1) {
      if (value[i] === normalizedQuery[q]) {
        q += 1;
      }
    }
    return q === normalizedQuery.length;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
</script>

<div class="inline-flex">
  <button
    bind:this={triggerElement}
    class={`composer-model-pill ${className}`}
    disabled={disabled}
    type="button"
    onclick={openPicker}
  >
    <span class="composer-split-pill-icon" aria-hidden="true">
      {#if loading}
        <RefreshCw size={14} strokeWidth={2} class="animate-spin" />
      {:else}
        <Bot size={14} strokeWidth={2} />
      {/if}
    </span>
    <span class="composer-split-pill-divider" aria-hidden="true"></span>
    <span class="composer-model-pill-label">
      {#if selectedModel}
        {selectedModel.label ?? selectedModel.model}
        <span class="muted">· {selectedModel.provider}</span>
        {#if agentLabel}
          <span class="muted">· {agentLabel}</span>
        {/if}
      {:else}
        Select model
      {/if}
    </span>
  </button>

  <Dialog.Root {open} onOpenChange={handleOpenChange}>
    <Dialog.Portal to={overlayPortalTarget}>
      <Dialog.Overlay class="app-picker-backdrop" />
      <Dialog.Content
        class="app-picker app-picker-model"
        data-blocking-overlay="true"
        onOpenAutoFocus={focusSearch}
        onCloseAutoFocus={restoreTriggerFocus}
      >
        <header class="app-picker-header">
          <div class="app-picker-heading">
            <Dialog.Title class="app-picker-title">Switch model</Dialog.Title>
            <Dialog.Description class="app-picker-description">Search by model, provider, or mesh node.</Dialog.Description>
          </div>
          {#if onRefresh}
            <IconTooltipButton label="Refresh models" icon={RefreshCw} controlSize="compact" iconClass={loading ? 'animate-spin' : ''} disabled={loading} onclick={onRefresh} />
          {/if}
          <button class="app-picker-header-action" type="button" aria-label="Close model picker" onclick={closePicker}>
            <X size={16} />
          </button>
        </header>

        <div class="app-picker-body">
        <div class="app-picker-search-shell">
          <Search size={15} />
          <input
            bind:this={searchElement}
            class="app-picker-search-input"
            placeholder="Search models, providers, nodes…"
            value={query}
            oninput={(event) => {
              query = (event.currentTarget as HTMLInputElement).value;
              highlightedIndex = 0;
            }}
            onkeydown={handleSearchKeydown}
          />
        </div>

        <div class="app-picker-scroll-frame mt-3">
          <div class="app-picker-scroll-area">
            {#each filteredGroups as group}
              <section class="app-picker-group">
                <div class="app-picker-group-heading">{group.label}</div>
                {#if group.items.length === 0 && group.label === 'Recent'}
                  <div class="app-picker-empty">No recent models yet.</div>
                {:else if group.items.length > 0}
                  <div class="app-picker-list">
                    {#each group.items as model}
                      {@const selectionKey = getModelSelectionKey(model)}
                      {@const index = flatResults.findIndex((entry) => getModelSelectionKey(entry) === selectionKey)}
                      {@const info = modelInfo[selectionKey]}
                      <button
                        class="app-picker-row"
                        class:app-picker-row-highlighted={highlightedIndex === index}
                        type="button"
                        onclick={() => handleSelect(selectionKey)}
                        onmousemove={() => (highlightedIndex = index)}
                      >
                        <div class="min-w-0 flex-1">
                          <div class="app-picker-row-title">{model.label ?? model.model}</div>
                          <div class="app-picker-row-description">
                            {model.provider} · {model.model}
                            {#if agentLabel}
                              · {agentLabel}
                            {/if}
                            {#if model.node_label}
                              · {model.node_label}
                            {/if}
                            {#if model.family}
                              · {model.family}
                            {/if}
                          </div>
                        </div>
                        <div class="app-picker-row-detail">
                          {#if model.node_id}<span>mesh</span>{/if}
                          {#if info?.limits?.context}<span>{info.limits.context.toLocaleString()} ctx</span>{/if}
                          {#if selectedModelId === selectionKey}
                            <span class="app-picker-row-check"><Check size={14} /></span>
                          {/if}
                        </div>
                      </button>
                    {/each}
                  </div>
                {/if}
              </section>
            {/each}

            {#if flatResults.length === 0 && modelOptions.length > 0}
              <div class="app-picker-empty">No models match "{query}".</div>
            {/if}

            {#if modelOptions.length === 0}
              <div class="app-picker-empty">
                {#if loading}
                  Loading models...
                {:else}
                  No models available from this agent.
                {/if}
              </div>
            {/if}
          </div>
        </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</div>
