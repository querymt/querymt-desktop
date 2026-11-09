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

  let buttons: HTMLButtonElement[] = $state([]);

  // Radio group keyboard pattern: arrows move focus and selection; Tab enters at the selected option.
  function handleKeydown(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1
      : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    value = options[next].value;
    buttons[next]?.focus();
  }
</script>

<!-- Two-way choice shown inline, same look as the composer's Steer/Queue switch. -->
<div class="connection-type-switch" role="radiogroup" aria-label={ariaLabel}>
  {#each options as option, index (option.value)}
    {@const Icon = option.icon}
    <button
      bind:this={buttons[index]}
      type="button"
      role="radio"
      class:active={value === option.value}
      aria-checked={value === option.value}
      tabindex={value === option.value ? 0 : -1}
      {disabled}
      onclick={() => (value = option.value)}
      onkeydown={(event) => handleKeydown(event, index)}
    >
      <Icon size={14} aria-hidden="true" />
      {option.label}
    </button>
  {/each}
</div>
