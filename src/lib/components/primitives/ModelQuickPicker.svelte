<script lang="ts">
  import { Bot, Gauge, Network, RefreshCw, Search, X } from '@lucide/svelte';
  import { getContext, tick } from 'svelte';
  import { Dialog, Tooltip } from 'bits-ui';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import { displayedInputModalities, formatContextSize, knownInputModalities, modalityIcon, modalityLabel, showFamily } from '$lib/domain/model-capabilities';
  import { scoreModelSearch } from '$lib/domain/model-search';
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
    emptyLabel = 'Select model',
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
    emptyLabel?: string;
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
      null
  );

  const recentIds = $derived(new Set(recentModels.map(getModelSelectionKey)));

  const filteredGroups = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const groups: ModelGroup[] = [];

    const recentItems = recentModels
      .map((model) => ({ model, score: scoreModelSearch(model, normalizedQuery, [model.family, ...knownInputModalities(model, modelInfo)]) }))
      .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score)
      .map(({ model }) => model);

    groups.push({ label: 'Recent', items: recentItems });

    const providerMap = new Map<string, Array<{ model: ModelEntry; score: number }>>();
    for (const model of modelOptions) {
      if (recentIds.has(getModelSelectionKey(model))) continue;
      const score = scoreModelSearch(model, normalizedQuery, [model.family, ...knownInputModalities(model, modelInfo)]);
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
        {#if selectedModel.node_label}
          <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
            <Tooltip.Root disableHoverableContent>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  {@const { type: _type, tabindex: _tabindex, class: triggerClass = '', ...triggerProps } = props}
                  <!-- tabindex from the spread is stripped and overridden to -1 below -->
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <span
                    {...triggerProps}
                    class={`${triggerClass} muted composer-model-pill-node`}
                    tabindex={-1}
                    aria-label={`Using ${selectedModel.provider} from ${selectedModel.node_label}`}
                  >
                    · {selectedModel.provider}
                    <Network size={12} aria-hidden="true" />
                  </span>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
                  Using <b>{selectedModel.provider}</b> from <b>{selectedModel.node_label}</b>
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        {:else}
          <span class="muted">· {selectedModel.provider}</span>
        {/if}
        {#if agentLabel}
          <span class="muted">· {agentLabel}</span>
        {/if}
      {:else if selectedModelId}
        {selectedModelId}{loading ? '' : ' (unavailable)'}
      {:else}
        {loading ? 'Loading model...' : emptyLabel}
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
                      {@const knownModalities = knownInputModalities(model, modelInfo)}
                      <button
                        class="app-picker-row"
                        class:app-picker-row-highlighted={highlightedIndex === index}
                        type="button"
                        aria-pressed={selectedModelId === selectionKey}
                        onclick={() => handleSelect(selectionKey)}
                        onmousemove={() => (highlightedIndex = index)}
                      >
                        <div class="min-w-0 flex-1">
                          <div class="app-picker-row-title" class:app-picker-row-title-selected={selectedModelId === selectionKey}>
                            {model.label ?? model.model}
                          </div>
                          <div class="app-picker-row-description">
                            <span>{model.provider}</span>
                            {#if agentLabel}<span>{agentLabel}</span>{/if}
                            {#if model.node_label}
                              <span class="app-picker-row-meta" aria-label={`Mesh node ${model.node_label}`} title={`Mesh node ${model.node_label}`}>
                                <Network size={12} aria-hidden="true" />
                                <span>{model.node_label}</span>
                              </span>
                            {/if}
                            {#if showFamily(model)}<span>{model.family}</span>{/if}
                          </div>
                        </div>
                        <div class="app-picker-row-detail">
                          <span
                            class="app-picker-row-context"
                            aria-label={info?.limits?.context ? `${info.limits.context.toLocaleString('en-US')} token context window` : 'Context size unknown'}
                            title={info?.limits?.context ? `${info.limits.context.toLocaleString('en-US')} token context window` : 'Context size unknown'}
                          >
                            <Gauge size={12} aria-hidden="true" />
                            <span>{info?.limits?.context ? formatContextSize(info.limits.context) : 'UNK'}</span>
                          </span>
                          <span
                            class="app-picker-model-modalities"
                            aria-label={knownModalities.length > 0 ? `Input modalities: ${knownModalities.join(', ')}` : 'Input modalities unknown'}
                          >
                            {#each displayedInputModalities(model, modelInfo) as modality}
                              {@const ModalityIcon = modalityIcon(modality)}
                              <span
                                class="app-picker-model-modality"
                                aria-label={modalityLabel(modality, knownModalities.length > 0)}
                                title={modalityLabel(modality, knownModalities.length > 0)}
                              >
                                <ModalityIcon size={13} strokeWidth={1.9} aria-hidden="true" />
                              </span>
                            {/each}
                          </span>
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
