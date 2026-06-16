<script lang="ts">
  import { Check } from '@lucide/svelte';
  import { Checkbox } from 'bits-ui';

  let {
    checked = $bindable(false),
    disabled = false,
    label = undefined,
    ariaLabel = undefined,
    pill = false,
    class: className = '',
    onCheckedChange = undefined
  }: {
    checked: boolean;
    disabled?: boolean;
    label?: string;
    ariaLabel?: string;
    pill?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  } = $props();

  function handleCheckedChange(nextChecked: boolean) {
    checked = nextChecked;
    onCheckedChange?.(nextChecked);
  }
</script>

<Checkbox.Root
  bind:checked
  {disabled}
  aria-label={ariaLabel ?? label}
  class={`app-checkbox-control ${pill ? 'app-checkbox-pill' : ''} ${className}`}
  onCheckedChange={handleCheckedChange}
>
  {#snippet children({ checked })}
    <span class="app-checkbox-box" aria-hidden="true">
      {#if checked}
        <Check size={12} strokeWidth={3} />
      {/if}
    </span>
    {#if label}
      <span class="app-checkbox-label">{label}</span>
    {/if}
  {/snippet}
</Checkbox.Root>
