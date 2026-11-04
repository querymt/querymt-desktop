<script lang="ts" generics="T extends string">
  import type { Component } from 'svelte';

  // Same look as the composer's "Message delivery" switch (Steer / Queue): a faint
  // container with a lighter fill on the selected option. Disabled options stay visible.
  let {
    options,
    value = $bindable(),
    ariaLabel
  }: {
    options: Array<{ value: T; label: string; icon?: Component<{ size?: number; strokeWidth?: number; class?: string }>; disabled?: boolean }>;
    value: T;
    ariaLabel: string;
  } = $props();
</script>

<div class="composer-delivery-switch schedule-switch" role="group" aria-label={ariaLabel}>
  {#each options as option (option.value)}
    {@const Icon = option.icon}
    <button
      type="button"
      class:active={value === option.value}
      aria-pressed={value === option.value}
      disabled={option.disabled}
      onclick={() => (value = option.value)}
    >
      {#if Icon}<Icon size={13} />{/if}
      {option.label}
    </button>
  {/each}
</div>
