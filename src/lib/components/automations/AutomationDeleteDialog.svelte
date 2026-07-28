<script lang="ts">
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';
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

<AppConfirmDialog
  bind:open
  title={schedule ? `Delete ${scheduleTriggerLabel(schedule)}?` : 'Delete automation?'}
  description={schedule ? `${scheduleTargetLabel(schedule)} will stop running. This action cannot be undone.` : 'This automation will stop running. This action cannot be undone.'}
  confirmLabel="Delete"
  pendingLabel="Deleting..."
  {pending}
  onConfirm={() => schedule && onConfirm(schedule)}
>
  {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
</AppConfirmDialog>
