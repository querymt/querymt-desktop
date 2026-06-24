<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Component } from 'svelte';

  let {
    icon: Icon,
    label,
    disabled = false,
    tone = 'default',
    size = 15,
    iconClass = '',
    onclick
  }: {
    icon: Component<{ size?: number; strokeWidth?: number; class?: string }>;
    label: string;
    disabled?: boolean;
    tone?: 'default' | 'primary' | 'danger';
    size?: number;
    iconClass?: string;
    onclick?: () => void;
  } = $props();
</script>

<Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
  <Tooltip.Root disableHoverableContent disabled={disabled}>
    <Tooltip.Trigger
      class={`icon-btn ${tone === 'primary' ? 'icon-btn-primary' : tone === 'danger' ? 'icon-btn-danger' : ''}`}
      type="button"
      aria-label={label}
      {disabled}
      onclick={() => onclick?.()}
    >
      <Icon {size} strokeWidth={2} class={iconClass} />
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
        {label}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
