<script lang="ts">
  import { Bot, Brain, Check, Gauge, History, LoaderCircle, Network, RefreshCw, Search } from '@lucide/svelte';
  import { tick } from 'svelte';
  import providerSprite from '$lib/assets/providers.svg?raw';
  import { ensureProviderSprite, providerIconHref, providerIconId } from '$lib/domain/provider-icons';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import {
    displayedInputModalities,
    formatContextSize,
    knownInputModalities,
    modalityIcon,
    modalityLabel,
    type ModelInfoMap
  } from '$lib/domain/model-capabilities';
  import { scoreModelSearch } from '$lib/domain/model-search';
  import type { ModelEntry } from '$lib/domain/types';
  import { getModelSelectionKey, modelNodeLabel, type ModelLocationContext } from '$lib/querymt/config-options';

  export type ModelPickerReasoningControl = {
    title: string;
    description: string;
    value: string;
    options: { value: string; label: string }[];
    ariaLabel: string;
    disabled?: boolean;
    pending?: boolean;
    onChange: (value: string) => void | Promise<void>;
  };

  let {
    models = [],
    recentModels = [],
    modelInfo = {},
    modelLocation = undefined,
    selectedModelId = '',
    query = $bindable(''),
    placeholder = 'Search models, providers, nodes…',
    searchLabel = undefined,
    loading = false,
    disabled = false,
    emptyVariant = 'picker',
    onSelect,
    onRefresh = null,
    refreshDisabled = false,
    reasoning = null,
    onEscape = null
  }: {
    models?: ModelEntry[];
    recentModels?: ModelEntry[];
    modelInfo?: ModelInfoMap;
    modelLocation?: ModelLocationContext;
    selectedModelId?: string;
    query?: string;
    placeholder?: string;
    searchLabel?: string;
    loading?: boolean;
    disabled?: boolean;
    emptyVariant?: 'picker' | 'delegate';
    onSelect: (model: ModelEntry) => void | Promise<void>;
    onRefresh?: (() => void | Promise<void>) | null;
    refreshDisabled?: boolean;
    reasoning?: ModelPickerReasoningControl | null;
    onEscape?: ((event: KeyboardEvent) => void) | null;
  } = $props();

  let searchElement = $state<HTMLInputElement | null>(null);
  let highlightedIndex = $state(0);
  let trackedQuery = '';

  const rankedModels = $derived.by(() => {
    const needle = query.trim();
    return models
      .map((model) => ({
        model,
        score: scoreModelSearch(model, needle, [modelNodeLabel(model, modelLocation), model.family, ...knownInputModalities(model, modelInfo)])
      }))
      .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score);
  });

  const groups = $derived.by(() => {
    const available = new Map(rankedModels.map((entry) => [getModelSelectionKey(entry.model), entry]));
    const recentKeys = new Set<string>();
    const recent = recentModels.flatMap((model) => {
      const key = getModelSelectionKey(model);
      const entry = available.get(key);
      if (!entry || recentKeys.has(key)) return [];
      recentKeys.add(key);
      return [entry];
    }).sort((a, b) => b.score - a.score);

    const sections: Array<{ label: string; iconId: string | null; recent: boolean; models: ModelEntry[] }> = [];
    if (recent.length > 0) {
      sections.push({ label: 'Recent', iconId: null, recent: true, models: recent.map((entry) => entry.model) });
    }

    const grouped = new Map<string, ModelEntry[]>();
    for (const { model } of rankedModels) {
      if (recentKeys.has(getModelSelectionKey(model))) continue;
      const nodeLabel = modelNodeLabel(model, modelLocation);
      const label = nodeLabel ? `${model.provider} · ${nodeLabel}` : model.provider;
      const items = grouped.get(label) ?? [];
      items.push(model);
      grouped.set(label, items);
    }
    for (const [label, items] of grouped) {
      sections.push({ label, iconId: providerIconId(items[0].provider), recent: false, models: items });
    }

    // Keyboard indices follow the rendered sections, including Recent first.
    let index = 0;
    return sections.map(({ models: items, ...section }) => ({
      ...section,
      items: items.map((model) => ({ model, index: index++ }))
    }));
  });

  const filteredModels = $derived(groups.flatMap((group) => group.items.map((item) => item.model)));

  $effect.pre(() => {
    if (groups.some((group) => group.iconId)) ensureProviderSprite(providerSprite);
  });

  $effect(() => {
    if (query === trackedQuery) return;
    trackedQuery = query;
    highlightedIndex = 0;
  });

  $effect(() => {
    const max = Math.max(filteredModels.length - 1, 0);
    if (highlightedIndex > max) highlightedIndex = max;
  });

  function revealHighlighted() {
    const row = searchElement?.closest('.model-picker-panel')?.querySelector(`[data-model-index="${highlightedIndex}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView?.({ block: 'nearest' });
  }

  export function focusSearchNow() {
    searchElement?.focus();
    searchElement?.select();
  }

  export async function focusSearch() {
    await tick();
    focusSearchNow();
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  async function selectHighlighted() {
    const target = filteredModels[highlightedIndex];
    if (!target || disabled) return;
    await onSelect(target);
  }

  async function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightedIndex = clamp(highlightedIndex + 1, 0, Math.max(filteredModels.length - 1, 0));
      revealHighlighted();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightedIndex = clamp(highlightedIndex - 1, 0, Math.max(filteredModels.length - 1, 0));
      revealHighlighted();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      await selectHighlighted();
      return;
    }

    if (event.key === 'Escape' && onEscape) {
      event.preventDefault();
      onEscape(event);
    }
  }
</script>

<div class="model-picker-panel">
  <div class="app-picker-search-shell delegate-model-search">
    <Search size={15} />
    <input
      bind:this={searchElement}
      class="app-picker-search-input"
      {placeholder}
      aria-label={searchLabel}
      value={query}
      oninput={(event) => {
        query = (event.currentTarget as HTMLInputElement).value;
      }}
      onkeydown={handleSearchKeydown}
    />
    {#if onRefresh}
      <IconTooltipButton
        label="Refresh models"
        icon={RefreshCw}
        controlSize="compact"
        iconClass={loading ? 'animate-spin' : ''}
        disabled={refreshDisabled}
        onclick={() => onRefresh?.()}
      />
    {/if}
  </div>

  <div class="delegate-model-picker-list">
    {#if groups.length === 0}
      <div class="delegate-model-empty delegate-model-empty-compact">
        {#if emptyVariant === 'delegate'}
          <strong>{loading ? 'Loading models…' : 'No matching models'}</strong>
          <span>{models.length === 0 ? 'Refresh after the agent finishes discovering providers.' : `Nothing matches “${query}”.`}</span>
        {:else}
          <strong>
            {#if models.length === 0}
              {loading ? 'Loading models...' : 'No models available from this agent.'}
            {:else}
              No models match "{query}".
            {/if}
          </strong>
        {/if}
      </div>
    {:else}
      {#each groups as group}
        <section class="delegate-model-picker-group">
          <div class="delegate-model-picker-group-title" style="display: flex; align-items: center; gap: 0.4rem;">
            {#if group.recent}
              <History size={12} aria-hidden="true" />
            {:else if group.iconId}
              <svg class="model-picker-provider-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <use href={providerIconHref(group.iconId)} width="24" height="24" />
              </svg>
            {:else}
              <Bot size={12} aria-hidden="true" />
            {/if}
            <span>{group.label}</span>
          </div>
          {#each group.items as item (getModelSelectionKey(item.model))}
            {@const model = item.model}
            {@const selectionKey = getModelSelectionKey(model)}
            {@const info = modelInfo[selectionKey]}
            {@const knownModalities = knownInputModalities(model, modelInfo)}
            {@const selected = selectedModelId === selectionKey}
            {@const nodeLabel = modelNodeLabel(model, modelLocation)}
            <button
              class="delegate-model-choice"
              class:delegate-model-choice-highlighted={highlightedIndex === item.index}
              type="button"
              data-model-index={item.index}
              aria-pressed={selected}
              disabled={disabled}
              onclick={() => onSelect(model)}
              onmousemove={() => (highlightedIndex = item.index)}
            >
              <span>
                <span class="delegate-model-choice-name">
                  <strong class:delegate-model-choice-name-selected={selected}>{model.label ?? model.model}</strong>
                  {#if selected}
                    <Check class="delegate-model-choice-check" size={12} strokeWidth={2.4} aria-hidden="true" />
                  {/if}
                </span>
                <small>{model.id}</small>
              </span>
              <span class="delegate-model-choice-meta">
                {#if nodeLabel}
                  <small aria-label={`Mesh node ${nodeLabel}`}>
                    <Network size={11} />{nodeLabel}
                  </small>
                {/if}
              </span>
              <span class="app-picker-row-detail delegate-model-choice-detail">
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
              </span>
            </button>
          {/each}
        </section>
      {/each}
    {/if}
  </div>

  {#if reasoning}
    <div class="delegate-reasoning-control">
      <span>
        <Brain size={15} />
        <span>
          <strong>{reasoning.title}</strong>
          <small>{reasoning.description}</small>
        </span>
      </span>
      {#if reasoning.pending}
        <LoaderCircle size={14} class="animate-spin" aria-hidden="true" />
      {/if}
      <AppSelect
        value={reasoning.value}
        options={reasoning.options}
        ariaLabel={reasoning.ariaLabel}
        disabled={reasoning.disabled || reasoning.pending}
        pill={true}
        onValueChange={reasoning.onChange}
      />
    </div>
  {/if}
</div>
