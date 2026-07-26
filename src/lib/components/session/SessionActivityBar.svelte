<script lang="ts">
  import { GitFork, LoaderCircle, Redo2, Undo2, XCircle } from '@lucide/svelte';
  import Shimmer from '$lib/components/ai-elements/shimmer.svelte';
  import SessionUsageBar from '$lib/components/session/SessionUsageBar.svelte';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let {
    session,
    canUndo = false,
    canRedo = false,
    undoSupported = false,
    forkSupported = false,
    forkPending = false,
    canFork = false,
    onCancel,
    onUndo,
    onRedo,
    onFork
  }: {
    session: ActiveSessionViewModel;
    canUndo?: boolean;
    canRedo?: boolean;
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    canFork?: boolean;
    onCancel?: () => void | Promise<void>;
    onUndo?: () => void;
    onRedo?: () => void | Promise<void>;
    onFork?: () => void;
  } = $props();

  const agentBusy = $derived(
    session.runState === 'submitting' ||
      session.runState === 'thinking' ||
      session.runState === 'streaming' ||
      session.runState === 'tool-running'
  );
  const isBusy = $derived(session.undo.pendingOperation !== null || forkPending || agentBusy);

  const primaryStatus = $derived.by(() => {
    if (forkPending) return 'Creating fork…';
    if (session.undo.pendingOperation === 'undo') return 'Undoing workspace changes…';
    if (session.undo.pendingOperation === 'redo') return 'Restoring workspace changes…';
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
      return session.undo.lastMessage ?? 'Completed';
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
        {:else if session.undo.pendingOperation}
          <span>Updating session history and workspace files</span>
        {:else if isBusy}
          <span>Agent busy · double Esc to cancel</span>
        {:else}
          <span>Session {session.sessionId ?? 'unselected'}</span>
        {/if}
      </div>
    </div>
    <div class="session-activity-actions">
      {#if forkSupported}
        <button
          class="icon-btn"
          type="button"
          aria-label="Fork latest turn"
          title="Fork latest turn"
          disabled={!canFork || isBusy}
          onclick={() => onFork?.()}
        >
          {#if forkPending}<LoaderCircle size={16} class="animate-spin" />{:else}<GitFork size={16} />{/if}
        </button>
      {/if}
      {#if undoSupported}
        <button
          class="icon-btn"
          type="button"
          aria-label="Undo latest turn"
          title="Undo latest turn (Ctrl/Cmd+Z)"
          disabled={!canUndo || session.undo.pendingOperation !== null || isBusy}
          onclick={() => onUndo?.()}
        >
          {#if session.undo.pendingOperation === 'undo'}<LoaderCircle size={16} class="animate-spin" />{:else}<Undo2 size={16} />{/if}
        </button>
        <button
          class="icon-btn"
          type="button"
          aria-label="Redo last undone turn"
          title="Redo last undone turn (Ctrl/Cmd+Shift+Z)"
          disabled={!canRedo || session.undo.pendingOperation !== null || isBusy}
          onclick={() => onRedo?.()}
        >
          {#if session.undo.pendingOperation === 'redo'}<LoaderCircle size={16} class="animate-spin" />{:else}<Redo2 size={16} />{/if}
        </button>
      {/if}
      {#if agentBusy && onCancel}
        <button class="icon-btn" type="button" aria-label="Cancel active session" onclick={onCancel}>
          <XCircle size={16} />
        </button>
      {/if}
    </div>
  </div>

  {#if isBusy}
    <div class="session-activity-shimmer">
      <Shimmer text={primaryStatus} class="text-xs" />
    </div>
  {/if}

  <SessionUsageBar usage={session.usage} />
</section>
