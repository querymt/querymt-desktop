<script lang="ts">
  import { AlertTriangle, LoaderCircle, MessageCircleQuestion } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import { getSessionShellCommand, getSessionToolName, getSessionToolPresentation } from '$lib/domain/session-tool-presentation';
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

  // `preview`/`extra` are only set for a running tool, so its name can stay
  // prominent while the (often long) command is dimmed and truncates first.
  const status = $derived.by((): { title: string; preview: string | null; extra: string | null } => {
    const plain = (title: string) => ({ title, preview: null, extra: null });
    if (forkPending) return plain('Creating fork…');
    if (session.undo.pendingOperation === 'undo') return plain('Undoing workspace changes…');
    if (session.undo.pendingOperation === 'redo') return plain('Restoring workspace changes…');
    if (session.runState === 'failed') return plain(session.lastError ? `Failed: ${session.lastError}` : 'Session failed');
    if (session.runState === 'waiting-input') return plain('Input needed');
    if (session.runState === 'unknown') return plain(session.activityLabel ?? 'Execution status unavailable');
    if (session.dependencyLabel && !agentBusy) return plain(`Own turn idle - ${session.dependencyLabel}`);
    if (session.activityLabel?.startsWith('Cancelling') || session.activityLabel?.startsWith('Finishing')) return plain(session.activityLabel);
    if (session.runState === 'tool-running' && activeToolPresentation) {
      const count = session.toolCalls.filter((tool) => (tool.status === 'pending' || tool.status === 'in_progress') && (!session.runId || !tool.runId || tool.runId === session.runId)).length;
      return {
        title: activeToolPresentation.label,
        preview: activeToolPresentation.preview || null,
        extra: count > 1 ? ` (+${count - 1} active)` : null
      };
    }
    if (session.runState === 'tool-running') return plain(session.activityLabel ?? 'Running tool…');
    if (session.runState === 'streaming') return plain('Responding…');
    if (session.runState === 'thinking') return plain(`${session.activityLabel ?? 'Thinking...'}${session.dependencyLabel ? ` - ${session.dependencyLabel}` : ''}`);
    if (session.runState === 'submitting') return plain('Sending prompt…');
    return plain('');
  });
  // The bar truncates long commands, and `preview` is itself compacted, so the
  // tooltip carries the untruncated shell command when there is one.
  const tooltipPreview = $derived.by(() => {
    if (!status.preview) return null;
    const toolName = activeTool ? getSessionToolName(activeTool) : '';
    const fullCommand = activeTool && (toolName === 'shell' || toolName === 'execute') ? getSessionShellCommand(activeTool) : null;
    return fullCommand ?? status.preview;
  });
</script>

{#if isVisible}
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent disabled={!canCancel && !tooltipPreview}>
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
            {#if status.preview || status.extra}
              <span class="session-activity-title session-activity-title-tool">
                <span class="session-activity-label">{status.title}</span>
                {#if status.preview}<span class="session-activity-preview">{` · ${status.preview}`}</span>{/if}
                {#if status.extra}<span class="session-activity-extra">{status.extra}</span>{/if}
              </span>
            {:else}
              <span class="session-activity-title">{status.title}</span>
            {/if}
            {#if session.runState === 'failed'}
              <span class="session-activity-meta">Review the error, update the prompt, or refresh.</span>
            {:else if session.runState === 'waiting-input'}
              <span class="session-activity-meta">Respond below to continue.</span>
            {/if}
          </section>
        {/snippet}
      </Tooltip.Trigger>
      {#if canCancel || tooltipPreview}
        <Tooltip.Portal>
          <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
            {#if tooltipPreview}
              <span class="session-activity-tooltip-preview">{tooltipPreview}</span>
              {#if canCancel}<span class="session-activity-tooltip-hint">Double Esc to cancel</span>{/if}
            {:else}
              Double Esc to cancel
            {/if}
          </Tooltip.Content>
        </Tooltip.Portal>
      {/if}
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
