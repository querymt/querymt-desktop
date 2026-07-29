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
    onDismiss = undefined
  }: {
    open: boolean;
    title: string;
    description?: string;
    size?: 'compact' | 'standard' | 'workflow' | 'wide';
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
  } = $props();

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    open = nextOpen;
    if (!nextOpen) onDismiss?.();
  }

  function close() {
    handleOpenChange(false);
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Portal to={portalTarget}>
    <Dialog.Overlay class="app-dialog-backdrop" />
    <Dialog.Content
      class={`app-dialog app-dialog-${size} ${contentClass}`}
      data-blocking-overlay="true"
      {onOpenAutoFocus}
      {onCloseAutoFocus}
      onEscapeKeydown={(event) => pending && event.preventDefault()}
      onInteractOutside={(event) => pending && event.preventDefault()}
    >
      <header class={`app-dialog-header ${divided ? '' : 'app-dialog-header-undivided'}`}>
        <div class="app-dialog-heading">
          <Dialog.Title class="app-dialog-title">{title}</Dialog.Title>
          {#if description}
            <Dialog.Description class="app-dialog-description">{description}</Dialog.Description>
          {/if}
        </div>
        {#if showClose}
          <button class="app-dialog-close" type="button" aria-label={closeLabel} disabled={pending} onclick={close}>
            <X size={16} />
          </button>
        {/if}
      </header>

      <div class={`app-dialog-body ${bodyClass}`}>
        {@render children()}
      </div>

      {#if footer}
        <footer class="app-dialog-footer">
          {@render footer()}
        </footer>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
