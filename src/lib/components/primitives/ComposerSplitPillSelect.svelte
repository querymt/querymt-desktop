<script lang="ts">
  import { Check, LoaderCircle } from '@lucide/svelte';
  import { Select } from 'bits-ui';
  import type { Component } from 'svelte';

  export type ComposerSplitPillOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  let {
    value = $bindable(''),
    options,
    icon: Icon,
    placeholder = 'Select...',
    disabled = false,
    pending = false,
    ariaLabel = undefined,
    showLabelTitle = true,
    class: className = '',
    onValueChange = undefined
  }: {
    value: string;
    options: ComposerSplitPillOption[];
    icon: Component<{ size?: number; strokeWidth?: number; class?: string }>;
    placeholder?: string;
    disabled?: boolean;
    pending?: boolean;
    ariaLabel?: string;
    showLabelTitle?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
  } = $props();

  const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? placeholder);

  function handleValueChange(nextValue: string) {
    value = nextValue;
    onValueChange?.(nextValue);
  }
</script>

<Select.Root type="single" value={value} items={options} disabled={disabled || pending} onValueChange={handleValueChange}>
  <Select.Trigger class={`composer-split-pill ${className}`} aria-label={ariaLabel}>
    <span class="composer-split-pill-icon" aria-hidden="true">
      {#if pending}
        <LoaderCircle size={14} strokeWidth={2} class="animate-spin" />
      {:else}
        <Icon size={14} strokeWidth={2} />
      {/if}
    </span>
    <span class="composer-split-pill-divider" aria-hidden="true"></span>
    <span class="composer-split-pill-label" title={showLabelTitle ? selectedLabel : undefined}>{selectedLabel}</span>
  </Select.Trigger>

  <Select.Portal>
    <Select.Content class="app-select-content" sideOffset={6}>
      <Select.Viewport class="app-select-viewport">
        {#each options as option}
          <Select.Item class="app-select-item" value={option.value} disabled={option.disabled} label={option.label}>
            <span class="app-select-item-label">{option.label}</span>
            <span class="app-select-item-indicator">
              <Check size={14} strokeWidth={2.2} />
            </span>
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>