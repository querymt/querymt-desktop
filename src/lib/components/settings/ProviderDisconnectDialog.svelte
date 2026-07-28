<script lang="ts">
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';
  import { restoreProviderDialogFocus, type ProviderDialogFocusTarget } from './provider-dialog-focus';
  import type { AuthProviderEntry } from '$lib/querymt/generated/types';

  let {
    open,
    provider = null,
    focusTarget = null,
    portalTarget = null,
    pending = false,
    onClose,
    onConfirm
  }: {
    open: boolean;
    provider?: AuthProviderEntry | null;
    focusTarget?: ProviderDialogFocusTarget | null;
    portalTarget?: HTMLElement | null;
    pending?: boolean;
    onClose: () => void;
    onConfirm: () => void;
  } = $props();

  function restoreFocus(event: Event) {
    restoreProviderDialogFocus(event, focusTarget);
  }
</script>

<AppConfirmDialog
  {open}
  title={`Disconnect ${provider?.display_name ?? 'provider'}?`}
  description="OAuth access will be removed. You can sign in again at any time."
  confirmLabel="Disconnect"
  pendingLabel="Disconnecting..."
  {pending}
  portalTarget={portalTarget ?? undefined}
  {onConfirm}
  onDismiss={onClose}
  onCloseAutoFocus={restoreFocus}
/>
