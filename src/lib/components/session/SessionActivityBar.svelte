<script lang="ts">
  import { AlertTriangle, LoaderCircle, MessageCircleQuestion } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import { getSessionToolPresentation } from '$lib/domain/session-tool-presentation';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    forkPending = false
  }: {
    session: ActiveSessionViewModel;
    forkPending?: boolean;
  } = $props();

  const agentBusy = $derived(
    session.runState === 'submitting' ||
      session.runState === 'thinking' ||
      session.runState === 'streaming' ||
      session.runState === 'tool-running'
  );
  const canCancel = $derived(agentBusy && !session.undo.pendingOperation && !forkPending);
  const isBusy = $derived(session.undo.pendingOperation !== null || forkPending || agentBusy || !!session.dependencyLabel);
  const isVisible = $derived(isBusy || session.runState === 'failed' || session.runState === 'waiting-input' || session.runState === 'unknown');
  const activeTool = $derived(session.toolCalls.find((tool) => tool.id === session.activeToolCallId) ?? null);
  const activeToolPresentation = $derived(activeTool ? getSessionToolPresentation(activeTool) : null);

  const primaryStatus = $derived.by(() => {
    if (forkPending) return 'Creating fork…';
    if (session.undo.pendingOperation === 'undo') return 'Undoing workspace changes…';
    if (session.undo.pendingOperation === 'redo') return 'Restoring workspace changes…';
    if (session.runState === 'failed') return session.lastError ? `Failed: ${session.lastError}` : 'Session failed';
    if (session.runState === 'waiting-input') return 'Input needed';
    if (session.runState === 'unknown') return session.activityLabel ?? 'Execution status unavailable';
    if (session.dependencyLabel && !agentBusy) return `Own turn idle - ${session.dependencyLabel}`;
    if (session.activityLabel?.startsWith('Cancelling') || session.activityLabel?.startsWith('Finishing')) return session.activityLabel;
    if (session.runState === 'tool-running' && activeToolPresentation) {
      const count = session.toolCalls.filter((tool) => (tool.status === 'pending' || tool.status === 'in_progress') && (!session.runId || !tool.runId || tool.runId === session.runId)).length;
      return `${activeToolPresentation.label}${activeToolPresentation.preview ? ` · ${activeToolPresentation.preview}` : ''}${count > 1 ? ` (+${count - 1} active)` : ''}`;
    }
    if (session.runState === 'tool-running') return session.activityLabel ?? 'Running tool…';
    if (session.runState === 'streaming') return 'Responding…';
    if (session.runState === 'thinking') return `${session.activityLabel ?? 'Thinking...'}${session.dependencyLabel ? ` - ${session.dependencyLabel}` : ''}`;
    if (session.runState === 'submitting') return 'Sending prompt…';
    return '';
  });
</script>

{#if isVisible}
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent disabled={!canCancel}>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (Focus exposes the informational tooltip without making the live region a button.) -->
          <section
            {...props}
            class={`session-activity-bar ${isBusy ? 'session-activity-bar-busy' : ''} ${session.runState === 'failed' ? 'session-activity-bar-failed' : ''} ${session.runState === 'waiting-input' ? 'session-activity-bar-attention' : ''}`}
            role={session.runState === 'failed' ? 'alert' : 'status'}
            aria-live={session.runState === 'failed' ? 'assertive' : 'polite'}
            tabindex={canCancel ? 0 : undefined}
          >
            <span class="session-activity-indicator" aria-hidden="true">
              {#if isBusy}
                <LoaderCircle size={14} class="animate-spin" />
              {:else if session.runState === 'waiting-input'}
                <MessageCircleQuestion size={14} />
              {:else}
                <AlertTriangle size={14} />
              {/if}
            </span>
            <span class="session-activity-title">{primaryStatus}</span>
            {#if session.runState === 'failed'}
              <span class="session-activity-meta">Review the error, update the prompt, or refresh.</span>
            {:else if session.runState === 'waiting-input'}
              <span class="session-activity-meta">Respond below to continue.</span>
            {/if}
          </section>
        {/snippet}
      </Tooltip.Trigger>
      {#if canCancel}
        <Tooltip.Portal>
          <Tooltip.Content class="app-tooltip-content" sideOffset={6}>Double Esc to cancel</Tooltip.Content>
        </Tooltip.Portal>
      {/if}
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
