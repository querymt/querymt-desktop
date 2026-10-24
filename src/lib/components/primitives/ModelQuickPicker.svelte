<script lang="ts">
  import { Bot, Network, RefreshCw, X } from '@lucide/svelte';
  import { getContext, tick } from 'svelte';
  import { Dialog, Tooltip } from 'bits-ui';
  import providerSprite from '$lib/assets/providers.svg?raw';
  import ModelPickerPanel, { type ModelPickerReasoningControl } from '$lib/components/primitives/ModelPickerPanel.svelte';
  import { ensureProviderSprite, modelSelectionTooltip, providerIconHref, providerIconId } from '$lib/domain/provider-icons';
  import type { ModelEntry, ModelInfo } from '$lib/domain/types';
  import { getModelSelectionKey, modelNodeLabel, type ModelLocationContext } from '$lib/querymt/config-options';

  let {
    modelOptions = [],
    recentModels = [],
    selectedModelId = '',
    emptyLabel = 'Select model',
    modelInfo = {},
    modelLocation = undefined,
    loading = false,
    disabled = false,
    agentLabel = null,
    class: className = '',
    reasoning = null,
    onSelect,
    onRefresh = null,
    /** Returns whether programmatic prompt focus was taken; falsy keeps dialog default focus. */
    onRequestPromptFocus = null
  }: {
    modelOptions?: ModelEntry[];
    recentModels?: ModelEntry[];
    selectedModelId?: string;
    emptyLabel?: string;
    modelInfo?: Record<string, ModelInfo | null>;
    modelLocation?: ModelLocationContext;
    loading?: boolean;
    disabled?: boolean;
    agentLabel?: string | null;
    class?: string;
    reasoning?: ModelPickerReasoningControl | null;
    onSelect: (modelId: string) => void | Promise<void>;
    onRefresh?: (() => void | Promise<void>) | null;
    onRequestPromptFocus?: (() => boolean) | null;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let pickerPanel = $state<{ focusSearch: () => Promise<void>; focusSearchNow: () => void } | null>(null);
  // Where the picker was opened from and whether a selection completed; both
  // decide where focus returns on close (prompt vs. the dialog's trigger).
  let openOrigin: 'prompt' | 'trigger' = 'trigger';
  let selectionCompleted = false;

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const selectedModel = $derived(
    modelOptions.find((entry) => getModelSelectionKey(entry) === selectedModelId) ??
      modelOptions.find((entry) => entry.id === selectedModelId && !entry.node_id) ??
      null
  );
  const selectedIconId = $derived(selectedModel ? providerIconId(selectedModel.provider) : null);
  const selectedNodeLabel = $derived(selectedModel ? modelNodeLabel(selectedModel, modelLocation) : null);
  const selectedUnavailable = $derived(selectedModel?.availability === 'unavailable');
  const selectionTooltip = $derived.by(() => {
    if (selectedUnavailable && selectedModel) return `${selectedModel.label ?? selectedModel.model}. Provider temporarily unavailable. Refresh or check the provider.`;
    if (selectedModel) return modelSelectionTooltip({ ...selectedModel, node_label: selectedNodeLabel }, agentLabel);
    if (selectedModelId) return `${selectedModelId}${loading ? '' : ' (unavailable)'}`;
    return null;
  });

  const showFallbackTooltip = $derived(!!selectionTooltip && (selectedUnavailable || !selectedIconId) && !loading);
  const reasoningBadge = $derived(
    selectedModel ? reasoning?.options.find((option) => option.value === reasoning.value && option.label.trim()) ?? null : null
  );
  const triggerLabel = $derived(
    reasoningBadge ? `${selectionTooltip}; reasoning effort: ${reasoningBadge.label}` : selectionTooltip
  );

  $effect.pre(() => {
    if (selectedIconId) ensureProviderSprite(providerSprite);
  });

  $effect(() => {
    if (!open) query = '';
  });

  /** Opens the picker from the prompt keyboard shortcut (Cmd+M / Ctrl+M). */
  export async function openPicker() {
    if (disabled) return;
    await openFromPrompt();
  }

  async function openFromPrompt() {
    openOrigin = 'prompt';
    selectionCompleted = false;
    open = true;
    await focusSearchInput();
  }

  async function openFromTrigger() {
    openOrigin = 'trigger';
    selectionCompleted = false;
    open = true;
    await focusSearchInput();
  }

  async function focusSearchInput() {
    await tick();
    await pickerPanel?.focusSearch();
  }

  export function closePicker() {
    stopSearchReclaim();
    open = false;
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) stopSearchReclaim();
    open = nextOpen;
  }

  /**
   * Returns whether focus should return to the prompt: any close of a
   * keyboard-opened picker, and any close after a successful selection from
   * either origin. The composer callback keeps the small-screen/coarse-pointer
   * guard; when it declines, the dialog falls back to its default (trigger).
   */
  function shouldRestorePromptFocus(): boolean {
    return openOrigin === 'prompt' || selectionCompleted;
  }

  function handleCloseAutoFocus(event: Event) {
    if (shouldRestorePromptFocus() && onRequestPromptFocus?.()) {
      event.preventDefault();
      return;
    }
    // Keep the conventional dialog behavior: restore focus to the trigger
    // (also the safe default when prompt focus is declined by the guard).
    event.preventDefault();
    triggerElement?.focus();
  }

  let removeSearchReclaim: (() => void) | null = null;

  function stopSearchReclaim() {
    removeSearchReclaim?.();
  }

  /**
   * bits-ui's focus trap can park focus on the dialog shell (tabindex=-1)
   * when a pending prompt focus races the open. Pull that back to search in
   * the same turn so the field is focused when the open call returns.
   */
  function ensureSearchReclaim() {
    if (removeSearchReclaim) return;
    const reclaim = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('app-picker-model')) return;
      const input = target.querySelector('input.app-picker-search-input');
      if (!(input instanceof HTMLInputElement) || document.activeElement === input) return;
      input.focus();
      input.select();
    };
    document.addEventListener('focusin', reclaim, true);
    removeSearchReclaim = () => {
      document.removeEventListener('focusin', reclaim, true);
      removeSearchReclaim = null;
    };
  }

  function focusOpenSearch() {
    const input = document.querySelector('.app-picker.app-picker-model input.app-picker-search-input');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
      return true;
    }
    pickerPanel?.focusSearchNow();
    return false;
  }

  function focusSearch(event: Event) {
    event.preventDefault();
    ensureSearchReclaim();
    if (!focusOpenSearch()) void focusSearchInput();
  }

  async function handleSelect(modelId: string) {
    await onSelect(modelId);
    selectionCompleted = true;
    closePicker();
  }

  function handlePickerEscape(event: KeyboardEvent) {
    event.preventDefault();
    closePicker();
  }
</script>

<div class="inline-flex">
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent disabled={!showFallbackTooltip}>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          {@const { type: _type, class: triggerClass = '', onclick: onTooltipClick, disabled: _tooltipDisabled, ...triggerProps } = props}
          <button
            {...triggerProps}
            bind:this={triggerElement}
            class={`composer-model-pill ${className} ${triggerClass}`}
            class:composer-model-pill-with-reasoning={!!reasoningBadge}
            disabled={disabled}
            type="button"
            aria-label={triggerLabel}
            onclick={(event) => {
              if (typeof onTooltipClick === 'function') onTooltipClick(event);
              return openFromTrigger();
            }}
          >
            <span class="composer-split-pill-icon" aria-hidden="true">
              {#if loading}
                <RefreshCw size={14} strokeWidth={2} class="animate-spin" />
              {:else if selectedIconId}
                <svg class="composer-provider-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <use href={providerIconHref(selectedIconId)} width="24" height="24" />
                </svg>
              {:else}
                <Bot size={14} strokeWidth={2} />
              {/if}
            </span>
            <span class="composer-split-pill-divider" aria-hidden="true"></span>
            <span class="composer-model-pill-label">
              {#if selectedModel}
                {selectedModel.label ?? selectedModel.model}
                {#if selectedNodeLabel}
                  <span class="muted composer-model-pill-node" aria-hidden="true">
                    <Network class={selectedUnavailable ? 'model-availability-warning' : undefined} size={12} />
                  </span>
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
            {#if reasoningBadge}
              <span class="composer-reasoning-badge" data-level={reasoning?.value.trim().toLowerCase()} aria-hidden="true">
                {reasoningBadge.label}
              </span>
            {/if}
          </button>
        {/snippet}
      </Tooltip.Trigger>
      {#if showFallbackTooltip}
        <Tooltip.Portal>
          <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
            {selectionTooltip}
          </Tooltip.Content>
        </Tooltip.Portal>
      {/if}
    </Tooltip.Root>
  </Tooltip.Provider>

  <Dialog.Root {open} onOpenChange={handleOpenChange}>
    <Dialog.Portal to={overlayPortalTarget}>
      <Dialog.Overlay class="app-picker-backdrop" />
      <Dialog.Content
        class="app-picker app-picker-model"
        data-blocking-overlay="true"
        onOpenAutoFocus={focusSearch}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <header class="app-picker-header">
          <div class="app-picker-heading">
            <Dialog.Title class="app-picker-title">Switch model</Dialog.Title>
            <Dialog.Description class="app-picker-description">Search by model, provider, or mesh node.</Dialog.Description>
          </div>
          <button class="app-picker-header-action" type="button" aria-label="Close model picker" onclick={closePicker}>
            <X size={16} />
          </button>
        </header>

        <div class="app-picker-body">
          <ModelPickerPanel
            bind:this={pickerPanel}
            bind:query
            models={modelOptions}
            {recentModels}
            {modelInfo}
            {modelLocation}
            {selectedModelId}
            {loading}
            {reasoning}
            {onRefresh}
            refreshDisabled={loading}
            placeholder="Search models, providers, nodes…"
            onSelect={(model) => handleSelect(getModelSelectionKey(model))}
            onEscape={handlePickerEscape}
          />
        </div>
        <footer class="app-picker-footer shrink-0 px-5 pb-5">
          <!-- TODO: Add "Use profile default" for the root planner; needs backend default-model and reset support. -->
          <button class="action-btn" type="button" onclick={closePicker}>Done</button>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</div>

<style>
  /* Keep the attached badge's layout and theme-aware palette together. */
  .composer-model-pill-with-reasoning {
    position: relative;
    overflow: visible;
  }

  .composer-reasoning-badge {
    --reasoning-light: #475569;
    --reasoning-dark: #cbd5e1;
    --reasoning-color: var(--reasoning-light);
    position: absolute;
    top: -7px;
    right: 5px;
    display: block;
    text-align: center;
    box-sizing: border-box;
    height: 14px;
    max-width: calc(100% - 10px);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--reasoning-color) 45%, var(--bg-card));
    border-radius: calc(var(--radius-control) / 2);
    background: color-mix(in srgb, var(--reasoning-color) 14%, var(--bg-card));
    padding: 0 4px;
    color: var(--reasoning-color);
    font-size: 8.25px;
    font-weight: 600;
    line-height: 12px;
    text-transform: lowercase;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .composer-reasoning-badge[data-level='low'] {
    --reasoning-light: #0f766e;
    --reasoning-dark: #5eead4;
  }

  .composer-reasoning-badge[data-level='medium'] {
    --reasoning-light: #1d4ed8;
    --reasoning-dark: #93c5fd;
  }

  .composer-reasoning-badge[data-level='high'] {
    --reasoning-light: #92400e;
    --reasoning-dark: #fcd34d;
  }

  .composer-reasoning-badge[data-level='max'] {
    --reasoning-light: #7e22ce;
    --reasoning-dark: #d8b4fe;
  }

  :global(:root[data-theme='dark']) .composer-reasoning-badge {
    --reasoning-color: var(--reasoning-dark);
  }
</style>
