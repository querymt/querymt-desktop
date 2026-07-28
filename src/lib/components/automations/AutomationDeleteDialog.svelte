<script lang="ts">
  import { LoaderCircle, X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { scheduleTargetLabel, scheduleTriggerLabel } from '$lib/domain/automations';
  import type { ScheduleInfo } from '$lib/querymt/generated/types';

  let {
    open = $bindable(false),
    schedule = null,
    pending = false,
    error = null,
    onConfirm
  }: {
    open: boolean;
    schedule?: ScheduleInfo | null;
    pending?: boolean;
    error?: string | null;
    onConfirm: (schedule: ScheduleInfo) => void;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="model-picker-backdrop" />
    <Dialog.Content class="model-picker-modal command-palette-modal-form !p-0">
      <div class="dialog-header">
        <div class="dialog-header-title-block">
          <Dialog.Title class="dialog-title">Delete automation</Dialog.Title>
          <Dialog.Description class="dialog-subtitle">{schedule ? `Permanently remove ${scheduleTriggerLabel(schedule)}?` : 'Permanently remove this automation?'}</Dialog.Description>
        </div>
        <div class="dialog-header-actions">
          <button class="dialog-close-button" type="button" aria-label="Close delete automation confirmation" disabled={pending} onclick={() => (open = false)}><X size={16} /></button>
        </div>
      </div>

      <div class="dialog-body">
        <div class="dialog-form">
          {#if schedule}
            <div class="dialog-row-group">
              <div class="dialog-row dialog-row-muted dialog-row-full">
                <div class="dialog-row-main">
                  <div class="dialog-row-title">{scheduleTargetLabel(schedule)}</div>
                  <div class="dialog-row-description">Schedule {schedule.public_id}. This action cannot be undone.</div>
                </div>
              </div>
            </div>
          {/if}
          {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
          <div class="dialog-footer">
            <button class="action-btn" type="button" disabled={pending} onclick={() => (open = false)}>Cancel</button>
            <button class="action-btn action-btn-danger" type="button" disabled={pending || !schedule} onclick={() => schedule && onConfirm(schedule)}>
              {#if pending}<LoaderCircle size={14} class="animate-spin" />{/if}
              {pending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
