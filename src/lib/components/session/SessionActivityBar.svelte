<script lang="ts">
  import { AlertTriangle, LoaderCircle, XCircle } from '@lucide/svelte';
  import Shimmer from '$lib/components/ai-elements/shimmer.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    forkPending = false,
    onCancel
  }: {
    session: ActiveSessionViewModel;
    forkPending?: boolean;
    onCancel?: () => void | Promise<void>;
  } = $props();

  const agentBusy = $derived(
    session.runState === 'submitting' ||
      session.runState === 'thinking' ||
      session.runState === 'streaming' ||
      session.runState === 'tool-running'
  );
  const isBusy = $derived(session.undo.pendingOperation !== null || forkPending || agentBusy);
  const isVisible = $derived(isBusy || session.runState === 'failed' || session.runState === 'waiting-input');

  const primaryStatus = $derived.by(() => {
    if (forkPending) return 'Creating fork…';
    if (session.undo.pendingOperation === 'undo') return 'Undoing workspace changes…';
    if (session.undo.pendingOperation === 'redo') return 'Restoring workspace changes…';
    if (session.runState === 'failed') return session.lastError ? `Failed: ${session.lastError}` : 'Session failed';
    if (session.runState === 'waiting-input') return 'Input needed';
    if (session.runState === 'tool-running') return session.activityLabel ?? 'Running tool…';
    if (session.runState === 'streaming') return 'Agent is replying…';
    if (session.runState === 'thinking') return session.activityLabel ?? 'Agent is thinking…';
    if (session.runState === 'submitting') return 'Sending prompt…';
    return '';
  });
</script>

{#if isVisible}
  <section
    class={`session-activity-bar ${isBusy ? 'session-activity-bar-busy' : ''} ${session.runState === 'failed' ? 'session-activity-bar-failed' : ''}`}
    aria-live="polite"
  >
    <div class="session-activity-main">
      <div class="session-activity-indicator" aria-hidden="true">
        {#if isBusy}
          <LoaderCircle size={15} class="animate-spin" />
        {:else}
          <AlertTriangle size={15} />
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <div class="session-activity-title">{primaryStatus}</div>
        <div class="session-activity-meta">
          {#if session.runState === 'failed'}
            <span>Review the error, then update the prompt or refresh the session.</span>
          {:else if session.runState === 'waiting-input'}
            <span>Respond to the request below to continue.</span>
          {:else if session.undo.pendingOperation}
            <span>Updating session history and workspace files</span>
          {:else}
            <span>Double Esc to cancel</span>
          {/if}
        </div>
      </div>
      {#if agentBusy && onCancel}
        <button class="icon-btn" type="button" aria-label="Cancel active session" title="Cancel active session" onclick={onCancel}>
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
{/if}
