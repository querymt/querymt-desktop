<script lang="ts">
  import { AudioLines, Bot, FileText, Gauge, Image, Network, Paperclip, RefreshCw, Search, Type, Video, X } from '@lucide/svelte';
  import { getContext, tick } from 'svelte';
  import { Dialog } from 'bits-ui';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ModelEntry, ModelInfo } from '$lib/domain/types';
  import { getModelSelectionKey } from '$lib/querymt/config-options';

  type ModelGroup = {
    label: string;
    items: ModelEntry[];
  };

  const modalityIcons = {
    text: Type,
    image: Image,
    pdf: FileText,
    audio: AudioLines,
    video: Video
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

  function knownInputModalities(model: ModelEntry): string[] {
    const modalities = modelInfo[getModelSelectionKey(model)]?.capabilities?.modalities?.input;
    if (!modalities?.length) return [];
    return [...new Set(modalities.map((modality) => modality.trim().toLowerCase()).filter(Boolean))];
  }

  function displayedInputModalities(model: ModelEntry): string[] {
    const modalities = knownInputModalities(model);
    return modalities.length > 0 ? modalities : ['text'];
  }

  function modalityIcon(modality: string) {
    return modalityIcons[modality as keyof typeof modalityIcons] ?? Paperclip;
  }

  function modalityLabel(modality: string, known: boolean) {
    return known ? `Supports ${modality} input` : 'Model modalities unknown';
  }

  function formatContextSize(tokens: number) {
    if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
    return tokens.toLocaleString('en-US');
  }

  function showFamily(model: ModelEntry) {
    if (!model.family) return false;
    const family = model.family.toLocaleLowerCase();
    return family !== model.model.toLocaleLowerCase() && family !== model.label?.toLocaleLowerCase();
  }

  function scoreModel(model: ModelEntry, normalizedQuery: string): number {
    if (!normalizedQuery) return 1;

    const fields = [model.label, model.model, model.provider, model.node_label, model.family, ...knownInputModalities(model)]
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
                      {@const knownModalities = knownInputModalities(model)}
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
                          {#if info?.limits?.context}
                            <span
                              class="app-picker-row-context"
                              aria-label={`${info.limits.context.toLocaleString('en-US')} token context window`}
                              title={`${info.limits.context.toLocaleString('en-US')} token context window`}
                            >
                              <Gauge size={12} aria-hidden="true" />
                              <span>{formatContextSize(info.limits.context)}</span>
                            </span>
                          {/if}
                          <span
                            class="app-picker-model-modalities"
                            aria-label={knownModalities.length > 0 ? `Input modalities: ${knownModalities.join(', ')}` : 'Input modalities unknown'}
                          >
                            {#each displayedInputModalities(model) as modality}
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
