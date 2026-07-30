<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    pendingLabel = undefined,
    cancelLabel = 'Cancel',
    pending = false,
    tone = 'danger',
    portalTarget = undefined,
    children = undefined,
    onConfirm,
    onDismiss = undefined,
    onCloseAutoFocus = undefined
  }: {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    pendingLabel?: string;
    cancelLabel?: string;
    pending?: boolean;
    tone?: 'danger' | 'primary' | 'neutral';
    portalTarget?: Element;
    children?: Snippet;
    onConfirm: () => void;
    onDismiss?: () => void;
    onCloseAutoFocus?: (event: Event) => void;
  } = $props();

  let contentElement: HTMLDivElement | null = $state(null);
  let cancelButton: HTMLButtonElement | null = $state(null);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    open = nextOpen;
    if (!nextOpen) onDismiss?.();
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    if (pending) contentElement?.focus();
    else cancelButton?.focus();
  }

  function cancel() {
    handleOpenChange(false);
  }
</script>

<AlertDialog.Root {open} onOpenChange={handleOpenChange}>
  <AlertDialog.Portal to={portalTarget}>
    <AlertDialog.Overlay class="app-dialog-backdrop" />
    <AlertDialog.Content
      bind:ref={contentElement}
      class="app-dialog app-dialog-compact app-confirm-dialog"
      data-blocking-overlay="true"
      onOpenAutoFocus={handleOpenAutoFocus}
      {onCloseAutoFocus}
      onEscapeKeydown={(event) => pending && event.preventDefault()}
    >
      <header class="app-dialog-header app-confirm-dialog-header">
        <div class="app-dialog-heading">
          <AlertDialog.Title class="app-dialog-title">{title}</AlertDialog.Title>
          <AlertDialog.Description class="app-dialog-description">{description}</AlertDialog.Description>
        </div>
      </header>

      {#if children}
        <div class="app-confirm-dialog-detail">
          {@render children()}
        </div>
      {/if}

      <footer class="app-dialog-footer app-confirm-dialog-footer">
        <button bind:this={cancelButton} class="action-btn" type="button" disabled={pending} onclick={cancel}>{cancelLabel}</button>
        <button
          class={`action-btn ${tone === 'danger' ? 'action-btn-danger' : tone === 'primary' ? 'action-btn-accent' : ''}`}
          type="button"
          disabled={pending}
          onclick={onConfirm}
        >
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </button>
      </footer>
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
