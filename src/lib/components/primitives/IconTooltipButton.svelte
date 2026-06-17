<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Component } from 'svelte';

  let {
    icon: Icon,
    label,
    disabled = false,
    tone = 'default',
    onclick
  }: {
    icon: Component<{ size?: number; strokeWidth?: number }>;
    label: string;
    disabled?: boolean;
    tone?: 'default' | 'danger';
    onclick?: () => void;
  } = $props();
</script>

<Tooltip.Root delayDuration={250} disableHoverableContent disabled={disabled}>
  <Tooltip.Trigger>
    <button
      class={`icon-btn ${tone === 'danger' ? 'icon-btn-danger' : ''}`}
      type="button"
      aria-label={label}
      {disabled}
      onclick={() => onclick?.()}
    >
      <Icon size={15} strokeWidth={2} />
    </button>
  </Tooltip.Trigger>
  <Tooltip.Portal>
    <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
      {label}
    </Tooltip.Content>
  </Tooltip.Portal>
</Tooltip.Root>
