<script lang="ts">
  import { ArrowLeft, Bug, GitFork, Info, LoaderCircle, Redo2, RefreshCw, Undo2 } from '@lucide/svelte';
  import SessionUsageBar from '$lib/components/session/SessionUsageBar.svelte';
  import { formatShortcut } from '$lib/design/platform';
  import type { ActiveSessionViewModel, SessionStatus } from '$lib/domain/types';

  let {
    session,
    title,
    workspace,
    agentName,
    updatedAt,
    summaryStatus = 'idle',
    debugLabel = 'Debug events',
    canUndo = false,
    canRedo = false,
    canFork = false,
    undoSupported = false,
    forkSupported = false,
    forkPending = false,
    onBack,
    onRefresh,
    onDebug,
    onUndo,
    onRedo,
    onFork
  }: {
    session: ActiveSessionViewModel;
    title: string;
    workspace: string;
    agentName: string;
    updatedAt: string;
    summaryStatus?: SessionStatus;
    debugLabel?: string;
    canUndo?: boolean;
    canRedo?: boolean;
    canFork?: boolean;
    undoSupported?: boolean;
    forkSupported?: boolean;
    forkPending?: boolean;
    onBack?: () => void;
    onRefresh?: () => void | Promise<void>;
    onDebug?: () => void;
    onUndo?: () => void;
    onRedo?: () => void | Promise<void>;
    onFork?: () => void;
  } = $props();

  const busy = $derived(
    forkPending ||
      session.undo.pendingOperation !== null ||
      ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState)
  );

  const status = $derived.by((): { label: string; tone: string; busy: boolean } => {
    if (forkPending) return { label: 'Creating fork', tone: 'running', busy: true };
    if (session.undo.pendingOperation === 'undo') return { label: 'Undoing', tone: 'running', busy: true };
    if (session.undo.pendingOperation === 'redo') return { label: 'Restoring', tone: 'running', busy: true };
    if (session.runState === 'failed') return { label: 'Failed', tone: 'danger', busy: false };
    if (session.runState === 'waiting-input' || summaryStatus === 'waiting') {
      return { label: 'Input needed', tone: 'warning', busy: false };
    }
    if (
      ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState) ||
      ['thinking', 'cancelling'].includes(summaryStatus)
    ) {
      return { label: summaryStatus === 'cancelling' ? 'Cancelling' : 'Working', tone: 'running', busy: true };
    }
    if (session.runState === 'completed' || summaryStatus === 'completed') {
      return { label: 'Completed', tone: 'success', busy: false };
    }
    return { label: 'Ready', tone: 'muted', busy: false };
  });
</script>

<header class="session-header">
  <button class="icon-btn session-header-back" type="button" aria-label="Back to sessions" title="Back to sessions" onclick={onBack}>
    <ArrowLeft size={17} />
  </button>

  <div class="session-header-identity">
    <h1>{title}</h1>
    <div class="session-header-meta">
      <span>{workspace}</span>
      <span aria-hidden="true">·</span>
      <span>{agentName}</span>
      <span aria-hidden="true">·</span>
      <span>{updatedAt}</span>
    </div>
  </div>

  <div class="session-header-controls">
    <span class={`session-header-status session-header-status-${status.tone}`}>
      {#if status.busy}<LoaderCircle size={13} class="animate-spin" />{:else}<i aria-hidden="true"></i>{/if}
      <span>{status.label}</span>
    </span>

    <div class="session-header-action-group" aria-label="Session history actions">
      {#if forkSupported}
        <button
          class="icon-btn"
          type="button"
          aria-label="Fork latest turn"
          title="Fork latest turn"
          disabled={!canFork || busy}
          onclick={onFork}
        >
          {#if forkPending}<LoaderCircle size={16} class="animate-spin" />{:else}<GitFork size={16} />{/if}
        </button>
      {/if}
      {#if undoSupported}
        <button
          class="icon-btn"
          type="button"
          aria-label="Undo latest turn"
          title={`Undo latest turn (${formatShortcut('Z')})`}
          disabled={!canUndo || busy}
          onclick={onUndo}
        >
          {#if session.undo.pendingOperation === 'undo'}<LoaderCircle size={16} class="animate-spin" />{:else}<Undo2 size={16} />{/if}
        </button>
        <button
          class="icon-btn"
          type="button"
          aria-label="Redo last undone turn"
          title={`Redo last undone turn (${formatShortcut('Shift+Z')})`}
          disabled={!canRedo || busy}
          onclick={onRedo}
        >
          {#if session.undo.pendingOperation === 'redo'}<LoaderCircle size={16} class="animate-spin" />{:else}<Redo2 size={16} />{/if}
        </button>
      {/if}
    </div>

    <div class="session-header-action-group" aria-label="Session actions">
      <details class="session-header-details">
        <summary class="icon-btn" aria-label="Session details" title="Session details"><Info size={16} /></summary>
        <div class="session-header-details-panel">
          <div class="session-header-details-heading">
            <strong>Session details</strong>
            <span>{session.sessionId ?? 'Not loaded'}</span>
          </div>
          <dl class="session-header-details-list">
            <div><dt>State</dt><dd>{session.runState.replace('-', ' ')}</dd></div>
            {#if session.lastStopReason}<div><dt>Stopped</dt><dd>{session.lastStopReason}</dd></div>{/if}
            {#if session.lastError}<div><dt>Error</dt><dd>{session.lastError}</dd></div>{/if}
          </dl>
          <SessionUsageBar usage={session.usage} />
        </div>
      </details>
      <button class="icon-btn" type="button" aria-label={debugLabel} title={debugLabel} onclick={onDebug}>
        <Bug size={16} />
      </button>
      <button class="icon-btn" type="button" aria-label="Refresh session" title="Refresh session" onclick={onRefresh}>
        <RefreshCw size={16} />
      </button>
    </div>
  </div>
</header>
