<script lang="ts">
  import { X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    description,
    size = 'standard',
    pending = false,
    showClose = true,
    divided = true,
    closeLabel = 'Close dialog',
    portalTarget = undefined,
    contentClass = '',
    bodyClass = '',
    children,
    footer = undefined,
    onOpenAutoFocus = undefined,
    onCloseAutoFocus = undefined,
    onDismiss = undefined,
    onClose = undefined,
    onEscapeKeydown = undefined,
    onInteractOutside = undefined
  }: {
    open: boolean;
    title: string;
    description?: string;
    size?: 'compact' | 'standard' | 'workflow' | 'wide' | 'model-picker';
    pending?: boolean;
    showClose?: boolean;
    divided?: boolean;
    closeLabel?: string;
    portalTarget?: Element;
    contentClass?: string;
    bodyClass?: string;
    children: Snippet;
    footer?: Snippet;
    onOpenAutoFocus?: (event: Event) => void;
    onCloseAutoFocus?: (event: Event) => void;
    onDismiss?: () => void;
    onClose?: (event: MouseEvent) => void;
    onEscapeKeydown?: (event: KeyboardEvent) => void;
    onInteractOutside?: (event: PointerEvent) => void;
  } = $props();

  const modelPicker = $derived(size === 'model-picker');

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    open = nextOpen;
    if (!nextOpen) onDismiss?.();
  }

  function close(event?: MouseEvent) {
    if (pending) return;
    if (event) {
      onClose?.(event);
      if (event.defaultPrevented) return;
    }
    handleOpenChange(false);
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Portal to={portalTarget}>
    <Dialog.Overlay class={modelPicker ? 'app-picker-backdrop' : 'app-dialog-backdrop'} />
    <Dialog.Content
      class={`${modelPicker ? 'app-picker app-picker-model' : `app-dialog app-dialog-${size}`} ${contentClass}`}
      data-blocking-overlay="true"
      {onOpenAutoFocus}
      {onCloseAutoFocus}
      onEscapeKeydown={(event) => {
        if (pending) event.preventDefault();
        onEscapeKeydown?.(event);
      }}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
        onInteractOutside?.(event);
      }}
    >
      <header class={`${modelPicker ? 'app-picker-header' : 'app-dialog-header'} ${divided ? '' : 'app-dialog-header-undivided'}`}>
        <div class={modelPicker ? 'app-picker-heading' : 'app-dialog-heading'}>
          <Dialog.Title class={modelPicker ? 'app-picker-title' : 'app-dialog-title'}>{title}</Dialog.Title>
          {#if description}
            <Dialog.Description class={modelPicker ? 'app-picker-description' : 'app-dialog-description'}>{description}</Dialog.Description>
          {/if}
        </div>
        {#if showClose}
          <button class={modelPicker ? 'app-picker-header-action' : 'app-dialog-close'} type="button" aria-label={closeLabel} disabled={pending} onclick={close}>
            <X size={16} />
          </button>
        {/if}
      </header>

      <div class={`${modelPicker ? 'app-picker-body' : 'app-dialog-body'} ${bodyClass}`}>
        {@render children()}
      </div>

      {#if footer}
        <footer class={modelPicker ? 'app-picker-footer shrink-0 px-5 pb-5' : 'app-dialog-footer'}>
          {@render footer()}
        </footer>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
