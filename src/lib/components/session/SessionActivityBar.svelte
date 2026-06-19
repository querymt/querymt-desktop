<script lang="ts">
  import { LoaderCircle, XCircle } from '@lucide/svelte';
  import Shimmer from '$lib/components/ai-elements/shimmer.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    onCancel
  }: {
    session: ActiveSessionViewModel;
    onCancel?: () => void | Promise<void>;
  } = $props();

  const isBusy = $derived(
    session.runState === 'submitting' ||
      session.runState === 'thinking' ||
      session.runState === 'streaming' ||
      session.runState === 'tool-running'
  );

  const primaryStatus = $derived.by(() => {
    if (session.runState === 'failed') {
      return session.lastError ? `Failed: ${session.lastError}` : 'Failed';
    }
    if (session.runState === 'tool-running') {
      return session.activityLabel ?? 'Running tool…';
    }
    if (session.runState === 'streaming') {
      return 'Agent is replying…';
    }
    if (session.runState === 'thinking') {
      return session.activityLabel ?? 'Agent is thinking…';
    }
    if (session.runState === 'submitting') {
      return 'Sending prompt…';
    }
    if (session.runState === 'completed') {
      return 'Completed';
    }
    return 'Ready';
  });
</script>

<section class={`session-activity-bar ${isBusy ? 'session-activity-bar-busy' : ''}`}>
  <div class="session-activity-main">
    <div class="session-activity-indicator" aria-hidden="true">
      {#if isBusy}
        <LoaderCircle size={16} class="animate-spin" />
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <div class="session-activity-title">{primaryStatus}</div>
      <div class="session-activity-meta">
        {#if session.lastStopReason && session.runState === 'completed'}
          <span>stop: {session.lastStopReason}</span>
        {:else if session.activeToolCallId}
          <span>Active tool in progress · double Esc to cancel</span>
        {:else if isBusy}
          <span>Agent busy · double Esc to cancel</span>
        {:else}
          <span>Session {session.sessionId ?? 'unselected'}</span>
        {/if}
      </div>
    </div>
    {#if isBusy && onCancel}
      <button class="icon-btn" type="button" aria-label="Cancel active session" onclick={onCancel}>
        <XCircle size={16} />
      </button>
    {/if}
  </div>

  {#if isBusy}
    <div class="session-activity-shimmer">
      <Shimmer text={primaryStatus} class="text-xs" />
    </div>
  {/if}
</section>
