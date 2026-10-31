<script lang="ts">
  import { Check } from '@lucide/svelte';
  import { Checkbox } from 'bits-ui';

  let {
    checked = $bindable(false),
    disabled = false,
    label = undefined,
    description = undefined,
    ariaLabel = undefined,
    pill = false,
    class: className = '',
    onCheckedChange = undefined
  }: {
    checked: boolean;
    disabled?: boolean;
    label?: string;
    description?: string;
    ariaLabel?: string;
    pill?: boolean;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  } = $props();

  const instanceId = $props.id();
  const descriptionId = $derived(description ? `${instanceId}-desc` : undefined);

  function handleCheckedChange(nextChecked: boolean) {
    checked = nextChecked;
    onCheckedChange?.(nextChecked);
  }
</script>

<Checkbox.Root
  bind:checked
  {disabled}
  aria-label={ariaLabel ?? label}
  aria-describedby={descriptionId}
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
      <span class="app-checkbox-copy">
        <span class="app-checkbox-label">{label}</span>
        {#if description}
          <span id={descriptionId} class="app-checkbox-description">{description}</span>
        {/if}
      </span>
    {/if}
  {/snippet}
</Checkbox.Root>
