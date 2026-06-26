<script lang="ts">
  import { Bot, Check, RefreshCw, Search } from '@lucide/svelte';
  import { getContext, tick } from 'svelte';
  import { Portal } from 'bits-ui';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { ModelEntry, ModelInfo } from '$lib/domain/types';

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

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const selectedModel = $derived(
    modelOptions.find((entry) => entry.id === selectedModelId) ?? recentModels[0] ?? modelOptions[0] ?? null
  );

  const recentIds = $derived(new Set(recentModels.map((entry) => entry.id)));

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
      if (recentIds.has(model.id)) continue;
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
        await handleSelect(target.id);
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

  {#if open}
    <Portal to={overlayPortalTarget}>
      <button class="model-picker-backdrop" type="button" aria-label="Close model picker" onclick={closePicker}></button>
      <div class="model-picker-modal !p-0" data-blocking-overlay="true">
      <div class="border-b border-[var(--border)] px-4 py-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-medium">Switch model</div>
            <div class="muted text-xs">Search, press Enter, and continue typing.</div>
          </div>
          {#if onRefresh}
            <IconTooltipButton label="Refresh models" icon={RefreshCw} size={14} iconClass={loading ? 'animate-spin' : ''} disabled={loading} onclick={onRefresh} />
          {/if}
        </div>
      </div>

      <div class="p-4">
        <div class="model-search-shell">
          <Search size={15} />
          <input
            bind:this={searchElement}
            class="model-search-input"
            placeholder="Search models, providers, nodes…"
            value={query}
            oninput={(event) => {
              query = (event.currentTarget as HTMLInputElement).value;
              highlightedIndex = 0;
            }}
            onkeydown={handleSearchKeydown}
          />
        </div>

        <div class="picker-scroll-frame mt-3">
          <div class="picker-scroll-area max-h-[24rem] space-y-3">
            {#each filteredGroups as group}
              <section class="space-y-2">
                <div class="px-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted)]">{group.label}</div>
                {#if group.items.length === 0 && group.label === 'Recent'}
                  <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">
                    No recent models yet.
                  </div>
                {:else if group.items.length > 0}
                  <div class="model-picker-list">
                    {#each group.items as model}
                      {@const index = flatResults.findIndex((entry) => entry.id === model.id)}
                      {@const info = modelInfo[model.id]}
                      <button
                        class="model-picker-row"
                        class:model-picker-row-selected={selectedModelId === model.id || highlightedIndex === index}
                        type="button"
                        onclick={() => handleSelect(model.id)}
                        onmousemove={() => (highlightedIndex = index)}
                      >
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm font-medium">{model.label ?? model.model}</div>
                          <div class="muted truncate text-xs">
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
                        <div class="flex flex-wrap items-center justify-end gap-2">
                          {#if agentLabel}
                            <span class="badge">{agentLabel}</span>
                          {/if}
                          {#if model.node_id}
                            <span class="badge">mesh</span>
                          {/if}
                          {#if model.node_label}
                            <span class="badge">{model.node_label}</span>
                          {/if}
                          {#if info?.limits?.context}
                            <span class="badge">{info.limits.context.toLocaleString()} ctx</span>
                          {/if}
                          {#if info?.capabilities?.reasoning}
                            <span class="badge">reasoning</span>
                          {/if}
                          {#if info?.capabilities?.tool_call}
                            <span class="badge">tools</span>
                          {/if}
                          {#if selectedModelId === model.id}
                            <Check size={14} />
                          {/if}
                        </div>
                      </button>
                    {/each}
                  </div>
                {/if}
              </section>
            {/each}

            {#if flatResults.length === 0 && modelOptions.length > 0}
              <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">
                No models match "{query}".
              </div>
            {/if}

            {#if modelOptions.length === 0}
              <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">
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
      </div>
    </Portal>
  {/if}
</div>
