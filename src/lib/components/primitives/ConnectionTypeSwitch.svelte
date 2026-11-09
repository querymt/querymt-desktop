<script lang="ts">
  import { Globe, Terminal } from '@lucide/svelte';
  import type { AgentConfig } from '$lib/domain/types';

  type Transport = AgentConfig['transport'];

  let {
    value = $bindable<Transport>('stdio'),
    disabled = false,
    ariaLabel = 'Agent connection type'
  }: { value?: Transport; disabled?: boolean; ariaLabel?: string } = $props();

  const options: Array<{ value: Transport; label: string; icon: typeof Terminal }> = [
    { value: 'stdio', label: 'Local process', icon: Terminal },
    { value: 'websocket', label: 'WebSocket server', icon: Globe }
  ];
</script>

<!-- Two-way choice shown inline, same look as the composer's Steer/Queue switch. -->
<div class="connection-type-switch" role="radiogroup" aria-label={ariaLabel}>
  {#each options as option (option.value)}
    {@const Icon = option.icon}
    <button
      type="button"
      role="radio"
      class:active={value === option.value}
      aria-checked={value === option.value}
      {disabled}
      onclick={() => (value = option.value)}
    >
      <Icon size={14} aria-hidden="true" />
      {option.label}
    </button>
  {/each}
</div>
