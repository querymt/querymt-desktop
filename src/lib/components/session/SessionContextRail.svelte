<script lang="ts">
  import SessionConfigPanel from '$lib/components/session/SessionConfigPanel.svelte';
  import SessionPlanPanel from '$lib/components/session/SessionPlanPanel.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    sessionConfigPending = {},
    onConfigChange
  }: {
    session: ActiveSessionViewModel;
    sessionConfigPending?: Record<string, boolean>;
    onConfigChange: (configId: string, value: string) => void | Promise<void>;
  } = $props();
</script>

{#if session.plans.length > 0}
  <SessionPlanPanel {session} />
{/if}
<SessionConfigPanel session={session} pending={sessionConfigPending} {onConfigChange} />
