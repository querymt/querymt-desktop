<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { Select } from 'bits-ui';

  export type AppSelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  let {
    value = $bindable(''),
    options,
    placeholder = 'Select...',
    disabled = false,
    ariaLabel = undefined,
    pill = false,
    class: className = '',
    onValueChange = undefined
  }: {
    value: string;
    options: AppSelectOption[];
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
    pill?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
  } = $props();

  const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? placeholder);

  function handleValueChange(nextValue: string) {
    value = nextValue;
    onValueChange?.(nextValue);
  }
</script>

<Select.Root type="single" value={value} items={options} {disabled} onValueChange={handleValueChange}>
  <Select.Trigger class={`app-select-trigger ${pill ? 'app-select-trigger-pill' : ''} ${className}`} aria-label={ariaLabel}>
    <span class="app-select-value">{selectedLabel}</span>
    <ChevronDown size={14} strokeWidth={2} class="app-select-chevron" />
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
