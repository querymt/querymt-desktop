<script lang="ts">
  import { Archive, ArrowLeft, Bug, CircleCheckBig, FileCog, Info, Network, RefreshCw } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import CopyTextChip from '$lib/components/primitives/CopyTextChip.svelte';
  import SessionIdChip from '$lib/components/primitives/SessionIdChip.svelte';
  import SessionActionsMenu from '$lib/components/primitives/SessionActionsMenu.svelte';
  import SessionContextDial from '$lib/components/session/SessionContextDial.svelte';
  import SessionUsageBar from '$lib/components/session/SessionUsageBar.svelte';
  import { autoCollapsePopover } from '$lib/design/details-popover';
  import type { ActiveSessionViewModel, DesktopSessionSummary, SessionLifecyclePatch, SessionStatus } from '$lib/domain/types';

  let {
    session,
    summary = null,
    canManageLifecycle = false,
    lifecyclePending = false,
    lifecycleError = null,
    onSetLifecycle = null,
    canPin = false, pinPending = false, pinError = null, onSetPinned = null,
    title,
    workspace,
    workspacePath = null,
    remoteHost = null,
    agentName,
    profileLabel = null,
    updatedAt,
    summaryStatus = 'idle',
    debugLabel = 'Debug events',
    showDebug = false,
    forkPending = false,
    onBack,
    onRefresh,
    onDebug
  }: {
    session: ActiveSessionViewModel;
    summary?: DesktopSessionSummary | null;
    canManageLifecycle?: boolean;
    canPin?: boolean;
    pinPending?: boolean;
    pinError?: string | null;
    onSetPinned?: ((pinned: boolean) => Promise<unknown>) | null;
    lifecyclePending?: boolean;
    lifecycleError?: string | null;
    onSetLifecycle?: ((patch: SessionLifecyclePatch) => Promise<unknown>) | null;
    title: string;
    workspace: string;
    /** Full project path; when present the workspace name becomes click-to-copy. */
    workspacePath?: string | null;
    remoteHost?: string | null;
    agentName?: string;
    /** Display label of the profile this session was started with; null hides the chip. */
    profileLabel?: string | null;
    updatedAt: string;
    summaryStatus?: SessionStatus;
    debugLabel?: string;
    showDebug?: boolean;
    forkPending?: boolean;
    onBack?: () => void;
    onRefresh?: () => void | Promise<void>;
    onDebug?: () => void;
  } = $props();

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
      return { label: 'Turn complete', tone: 'muted', busy: false };
    }
    return { label: 'Ready', tone: 'muted', busy: false };
  });
</script>

{#snippet lifecycleIcons()}
  {#if summary?.lifecycle?.resolved || summary?.lifecycle?.archived}
    <span class="session-header-lifecycle">
      {#if summary.lifecycle.resolved}
        <span class="session-header-lifecycle-icon session-header-lifecycle-icon-resolved" role="img" aria-label="Resolved" title="Resolved"><CircleCheckBig size={13} aria-hidden="true" /></span>
      {/if}
      {#if summary.lifecycle.archived}
        <span class="session-header-lifecycle-icon" role="img" aria-label="Archived" title="Archived"><Archive size={13} aria-hidden="true" /></span>
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet remoteHostIcon()}
  {#if remoteHost}
    <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
      <Tooltip.Root disableHoverableContent>
        <Tooltip.Trigger class="session-header-remote-indicator" type="button" aria-label={`Remote session on ${remoteHost}`}>
          <Network size={12} aria-hidden="true" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content class="app-tooltip-content" sideOffset={6}>Remote session on {remoteHost}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  {/if}
{/snippet}

<header class="session-header">
  <button class="icon-btn session-header-back" type="button" aria-label="Back to sessions" title="Back to sessions" onclick={onBack}>
    <ArrowLeft size={17} />
  </button>

  <div class="session-header-identity">
    <div class="session-header-title-line">
      <span class="session-header-status-wrap">
        <span
          class={`session-header-status-dot session-header-status-dot-${status.tone}`}
          aria-label={`Status: ${status.label}`}
        ></span>
        <span class="session-row-status-tooltip" role="tooltip">{status.label}</span>
      </span>
      <h1>{title}</h1>
    </div>
    <div class="session-header-mobile-meta" aria-label="Session context">
      {@render lifecycleIcons()}
      {@render remoteHostIcon()}
      <span class="session-header-mobile-workspace" title={workspace}>{workspace}</span>
      {#if session.sessionId}
        <span aria-hidden="true">·</span>
        <span class="session-header-mobile-id" title={session.sessionId}>{session.sessionId.slice(0, 13)}</span>
      {/if}
      <SessionContextDial usage={session.usage} />
    </div>
    <div class="session-header-meta">
      {@render lifecycleIcons()}
      {@render remoteHostIcon()}
      <CopyTextChip class="session-header-workspace" value={workspacePath ?? workspace} display={workspace} title="Copy project path" />
      {#if session.sessionId}
        <span class="session-header-session-id"><span aria-hidden="true">·</span><SessionIdChip sessionId={session.sessionId} /></span>
      {/if}
      {#if profileLabel}
        <span class="session-header-meta-desktop">
          <span aria-hidden="true">·</span>
          <span class="session-header-profile" title="Session profile (set at start)"><FileCog size={11} aria-hidden="true" />{profileLabel}</span>
        </span>
      {/if}
      {#if session.usage.contextUsed !== null}
        <span class="session-header-context-slot"><span aria-hidden="true">·</span><SessionContextDial usage={session.usage} /></span>
      {/if}
      <span class="session-header-meta-desktop"><span aria-hidden="true">·</span><span>{updatedAt}</span></span>
      {#if agentName}
        <span class="session-header-meta-desktop"><span aria-hidden="true">·</span><span>{agentName}</span></span>
      {/if}
    </div>
  </div>

  <div class="session-header-controls">
    <div class="session-header-action-group" aria-label="Session actions">
      {#if summary}
        <SessionActionsMenu session={summary} canManage={canManageLifecycle} {canPin} {onSetPinned} pending={pinPending || lifecyclePending} error={pinError || lifecycleError} {onSetLifecycle} triggerClass="icon-btn" />
      {/if}
      <details class="session-header-details" use:autoCollapsePopover>
        <summary class="icon-btn" aria-label="Session details" title="Session details"><Info size={16} /></summary>
        <div class="session-header-details-panel">
          <div class="session-header-details-heading">
            <strong>Session</strong>
            <span class="session-header-details-status">
              <span class={`session-header-status-dot session-header-status-dot-${status.tone}`} aria-hidden="true"></span>
              {status.label}
            </span>
          </div>
          <dl class="session-header-details-list session-header-mobile-details">
            <div><dt>Workspace</dt><dd><CopyTextChip value={workspacePath ?? workspace} display={workspace} title="Copy project path" /></dd></div>
            {#if agentName}
              <div><dt>Agent</dt><dd>{agentName}</dd></div>
            {/if}
            {#if profileLabel}
              <div><dt>Profile</dt><dd>{profileLabel}</dd></div>
            {/if}
            <div><dt>Updated</dt><dd>{updatedAt}</dd></div>
            {#if session.sessionId}
              <div><dt>Session ID</dt><dd><SessionIdChip sessionId={session.sessionId} /></dd></div>
            {/if}
          </dl>
          {#if session.lastError}
            <dl class="session-header-details-list">
              <div><dt>Error</dt><dd>{session.lastError}</dd></div>
            </dl>
          {/if}
          <SessionUsageBar usage={session.usage} />
        </div>
      </details>
      {#if showDebug}
        <button class="icon-btn" type="button" aria-label={debugLabel} title={debugLabel} onclick={onDebug}>
          <Bug size={16} />
        </button>
      {/if}
      <button class="icon-btn" type="button" aria-label="Refresh session" title="Refresh session" onclick={onRefresh}>
        <RefreshCw size={16} />
      </button>
    </div>
  </div>
</header>
