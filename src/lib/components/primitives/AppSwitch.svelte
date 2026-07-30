<script lang="ts">
  import { Switch } from 'bits-ui';

  let {
    checked = $bindable(false),
    disabled = false,
    ariaLabel,
    class: className = '',
    onCheckedChange = undefined
  }: {
    checked: boolean;
    disabled?: boolean;
    ariaLabel: string;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  } = $props();

  function handleCheckedChange(nextChecked: boolean) {
    checked = nextChecked;
    onCheckedChange?.(nextChecked);
  }
</script>

<Switch.Root
  bind:checked
  {disabled}
  aria-label={ariaLabel}
  class={`app-switch-control ${className}`}
  onCheckedChange={handleCheckedChange}
>
  <Switch.Thumb class="app-switch-thumb" />
</Switch.Root>
