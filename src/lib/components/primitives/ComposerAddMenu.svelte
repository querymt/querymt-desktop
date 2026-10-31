<script lang="ts">
  import { getContext } from 'svelte';
  import { DropdownMenu, Tooltip } from 'bits-ui';
  import { Plus } from '@lucide/svelte';
  import type { Component } from 'svelte';

  export type ComposerAddMenuAction = {
    id: string;
    label: string;
    icon: Component<{ size?: number; strokeWidth?: number; class?: string }>;
    disabled?: boolean;
    onSelect: () => void;
  };

  let {
    actions,
    label = 'Add',
    disabled = false,
    class: className = ''
  }: {
    actions: ComposerAddMenuAction[];
    label?: string;
    disabled?: boolean;
    class?: string;
  } = $props();

  const getOverlayTarget = getContext<(() => HTMLElement | null) | undefined>('app-overlay-target');
  const portalTarget = $derived(getOverlayTarget?.() ?? undefined);
  let open = $state(false);
</script>

<DropdownMenu.Root bind:open>
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent disabled={disabled || open}>
      <Tooltip.Trigger>
        {#snippet child({ props: tooltipProps })}
          <DropdownMenu.Trigger
            {...tooltipProps}
            class={`composer-add-trigger ${open ? 'composer-add-trigger-open' : ''} ${className}`}
            aria-label={label}
            {disabled}
          >
            <Plus class="composer-add-icon" size={16} strokeWidth={2} />
          </DropdownMenu.Trigger>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
  <DropdownMenu.Portal to={portalTarget}>
    <DropdownMenu.Content class="app-select-content composer-add-content" side="top" align="start" sideOffset={6} loop>
      <div class="app-select-viewport">
        {#each actions as action (action.id)}
          {@const Icon = action.icon}
          <DropdownMenu.Item class="app-select-item composer-add-item" disabled={action.disabled} onSelect={action.onSelect}>
            <span class="composer-add-item-label">
              <Icon size={15} strokeWidth={2} />
              {action.label}
            </span>
          </DropdownMenu.Item>
        {/each}
      </div>
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
