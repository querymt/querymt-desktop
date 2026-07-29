<script lang="ts">
  import { AlertTriangle, LoaderCircle, MessageCircleQuestion, X } from '@lucide/svelte';
  import { getSessionToolPresentation } from '$lib/domain/session-tool-presentation';
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
  const activeTool = $derived(session.toolCalls.find((tool) => tool.id === session.activeToolCallId) ?? null);
  const activeToolPresentation = $derived(activeTool ? getSessionToolPresentation(activeTool) : null);

  const primaryStatus = $derived.by(() => {
    if (forkPending) return 'Creating fork…';
    if (session.undo.pendingOperation === 'undo') return 'Undoing workspace changes…';
    if (session.undo.pendingOperation === 'redo') return 'Restoring workspace changes…';
    if (session.runState === 'failed') return session.lastError ? `Failed: ${session.lastError}` : 'Session failed';
    if (session.runState === 'waiting-input') return 'Input needed';
    if (session.runState === 'tool-running' && activeToolPresentation) {
      return `${activeToolPresentation.label}${activeToolPresentation.preview ? ` · ${activeToolPresentation.preview}` : ''}`;
    }
    if (session.runState === 'tool-running') return session.activityLabel ?? 'Running tool…';
    if (session.runState === 'streaming') return 'Responding…';
    if (session.runState === 'thinking') return session.activityLabel ?? 'Thinking…';
    if (session.runState === 'submitting') return 'Sending prompt…';
    return '';
  });
</script>

{#if isVisible}
  <section
    class={`session-activity-bar ${isBusy ? 'session-activity-bar-busy' : ''} ${session.runState === 'failed' ? 'session-activity-bar-failed' : ''} ${session.runState === 'waiting-input' ? 'session-activity-bar-attention' : ''}`}
    role={session.runState === 'failed' ? 'alert' : 'status'}
    aria-live={session.runState === 'failed' ? 'assertive' : 'polite'}
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
    {:else if !session.undo.pendingOperation && !forkPending}
      <span class="session-activity-meta">Double Esc to cancel</span>
    {/if}
    {#if agentBusy && onCancel}
      <button class="session-activity-cancel" type="button" aria-label="Cancel active session" title="Cancel active session" onclick={onCancel}>
        <X size={14} />
      </button>
    {/if}
  </section>
{/if}
