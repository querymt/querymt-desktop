<script lang="ts">
  import { Archive, ArrowLeft, CircleCheckBig, FileCog, GitBranch, Info, Network, Pin, RefreshCw } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import CopyTextChip from '$lib/components/primitives/CopyTextChip.svelte';
  import Hint from '$lib/components/primitives/Hint.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SessionIdChip from '$lib/components/primitives/SessionIdChip.svelte';
  import SessionActionsMenu from '$lib/components/primitives/SessionActionsMenu.svelte';
  import SessionContextDial from '$lib/components/session/SessionContextDial.svelte';
  import SessionUsageBar from '$lib/components/session/SessionUsageBar.svelte';
  import { autoCollapsePopover } from '$lib/design/details-popover';
  import { isWorkspaceUsable, worktreeTooltip } from '$lib/domain/session-workspace';
  import { describeContext } from '$lib/domain/session-usage';
  import { getSessionStatusTone } from '$lib/domain/sessions';
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
    updatedAtFull = null,
    summaryStatus = 'idle',
    debugLabel = 'Debug events',
    showDebug = false,
    forkPending = false,
    onCreateWorktree = null,
    onHandoffWorktree = null,
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
    /** Compact label for the metadata row ("5m"). */
    updatedAt: string;
    /** Absolute date for the row's tooltip and the details panel; falls back to `updatedAt`. */
    updatedAtFull?: string | null;
    summaryStatus?: SessionStatus;
    debugLabel?: string;
    showDebug?: boolean;
    forkPending?: boolean;
    onCreateWorktree?: (() => void) | null;
    onHandoffWorktree?: (() => void) | null;
    onBack?: () => void;
    onRefresh?: () => void | Promise<void>;
    onDebug?: () => void;
  } = $props();

  const contextDetail = $derived(describeContext(session.usage));
  const hasContext = $derived(session.usage.contextUsed !== null);

  // Debug events live in the More menu. Without a loaded summary the menu still
  // opens (for debug only) using a minimal stand-in session.
  const menuSession = $derived.by(() => {
    if (summary) return summary;
    if (!showDebug) return null;
    return { sessionId: session.sessionId ?? '', title, lifecycle: null, pin: undefined } as Pick<DesktopSessionSummary, 'sessionId' | 'title' | 'lifecycle' | 'pin'>;
  });

  const status = $derived.by((): { label: string; tone: string; busy: boolean } => {
    if (forkPending) return { label: 'Creating fork', tone: 'running', busy: true };
    if (session.undo.pendingOperation === 'undo') return { label: 'Undoing', tone: 'running', busy: true };
    if (session.undo.pendingOperation === 'redo') return { label: 'Restoring', tone: 'running', busy: true };
    if (session.runState === 'unknown' || (summaryStatus === 'unknown' && (!session.sessionId || ['idle', 'completed'].includes(session.runState)))) return { label: 'Status unavailable', tone: 'warning', busy: false };
    if (session.runState === 'failed') return { label: 'Failed', tone: 'danger', busy: false };
    if (session.dependencyLabel && !['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState)) {
      return { label: `Own turn idle - ${session.dependencyLabel}`, tone: 'running', busy: true };
    }
    if (session.runState === 'waiting-input' || (!session.sessionId && summaryStatus === 'waiting')) {
      return { label: 'Input needed', tone: 'warning', busy: false };
    }
    if (
      ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState) ||
      (!session.sessionId && ['thinking', 'cancelling'].includes(summaryStatus))
    ) {
      return { label: session.activityLabel?.startsWith('Compacting') ? 'Compacting' : session.activityLabel?.startsWith('Cancelling') ? 'Cancelling' : session.activityLabel?.startsWith('Finishing') ? 'Finishing' : session.activityLabel?.startsWith('Waiting for delegates') ? 'Waiting for delegates' : 'Working', tone: 'running', busy: true };
    }
    if (session.runState === 'completed' || (!session.sessionId && summaryStatus === 'completed')) {
      // Same tone the session list gives a completed turn.
      return { label: 'Turn complete', tone: getSessionStatusTone('completed'), busy: false };
    }
    return { label: 'Ready', tone: 'muted', busy: false };
  });
</script>

{#snippet lifecycleIcons()}
  {#if summary?.pin?.pinned || summary?.lifecycle?.resolved || summary?.lifecycle?.archived}
    <span class="session-header-lifecycle">
      {#if summary.pin?.pinned}
        <Hint text="Pinned" class="session-header-lifecycle-icon" role="img" aria-label="Pinned"><Pin size={13} aria-hidden="true" /></Hint>
      {/if}
      {#if summary.lifecycle?.resolved}
        <Hint text="Resolved" class="session-header-lifecycle-icon session-header-lifecycle-icon-resolved" role="img" aria-label="Resolved"><CircleCheckBig size={13} aria-hidden="true" /></Hint>
      {/if}
      {#if summary.lifecycle?.archived}
        <Hint text="Archived" class="session-header-lifecycle-icon" role="img" aria-label="Archived"><Archive size={13} aria-hidden="true" /></Hint>
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
  <IconTooltipButton label="Back to sessions" icon={ArrowLeft} controlSize="compact" size={16} class="session-header-btn session-header-back" onclick={() => onBack?.()} />

  <div class="session-header-identity">
    <div class="session-header-title-line">
      <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
        <Tooltip.Root disableHoverableContent>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <span {...props} class="session-header-status-wrap">
                <span
                  class={`session-header-status-dot session-header-status-dot-${status.tone}`}
                  aria-label={`Status: ${status.label}`}
                ></span>
              </span>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="app-tooltip-content" side="bottom" align="start" sideOffset={6}>{status.label}</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
      <h1>{title}</h1>
    </div>
    <div class="session-header-mobile-meta" aria-label="Session context">
      {@render lifecycleIcons()}
      {@render remoteHostIcon()}
      <Hint text={workspace} class="session-header-mobile-workspace">{workspace}</Hint>
      {#if session.sessionId}
        <Hint text={session.sessionId} class="session-header-mobile-id">{session.sessionId.slice(0, 8)}</Hint>
      {/if}
    </div>
    <div class="session-header-meta">
      {@render lifecycleIcons()}
      {@render remoteHostIcon()}
      <CopyTextChip class="session-header-workspace" value={workspacePath ?? workspace} display={workspace} title="Copy project path" tooltip />
      {#if summary?.workspace}
        {@const usable = isWorkspaceUsable(summary.workspace)}
        <Hint text={worktreeTooltip(summary.workspace)} class={`session-header-worktree ${usable ? '' : 'session-header-worktree-warning'}`} data-testid="header-worktree-chip">
          <GitBranch size={11} aria-hidden="true" />{summary.workspace.branch ?? 'worktree'}{#if !usable} · {summary.workspace.lifecycle}{/if}
        </Hint>
      {/if}
      {#if session.sessionId}
        <span class="session-header-session-id"><SessionIdChip sessionId={session.sessionId} length={8} tooltip /></span>
      {/if}
      {#if profileLabel}
        <span class="session-header-meta-desktop">
          <Hint text="Session profile (set at start)" class="session-header-profile"><FileCog size={11} aria-hidden="true" />{profileLabel}</Hint>
        </span>
      {/if}
      <span class="session-header-meta-desktop"><Hint text={updatedAtFull ?? updatedAt} class="session-header-updated">{updatedAt}</Hint></span>
      {#if agentName}
        <span class="session-header-meta-desktop"><span>{agentName}</span></span>
      {/if}
    </div>
  </div>

  <div class="session-header-controls">
    <div class="session-header-action-group" aria-label="Session actions">
      <!-- First action: session details, merged with the context ring. The ring is the
           only context readout now; clicking it opens the same details panel. -->
      <details class="session-header-details" use:autoCollapsePopover>
        <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
          <Tooltip.Root disableHoverableContent>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <summary
                  {...props}
                  class={`icon-btn icon-btn-compact session-header-btn session-header-details-trigger ${hasContext ? 'session-header-details-trigger-context' : ''}`}
                  aria-label="Session details"
                >
                  {#if hasContext}<SessionContextDial usage={session.usage} inline />{:else}<Info size={15} />{/if}
                </summary>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class={`app-tooltip-content ${contextDetail ? 'app-tooltip-multiline' : ''}`} sideOffset={6}>
                Session details
                {#if contextDetail}<span class="app-tooltip-detail">{contextDetail}</span>{/if}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
        <div class="session-header-details-panel">
          <div class="session-header-details-heading">
            <strong>Session</strong>
            <span class="session-header-details-status">
              <span class={`session-header-status-dot session-header-status-dot-${status.tone}`} aria-hidden="true"></span>
              {status.label}
            </span>
          </div>
          <dl class="session-header-details-list session-header-mobile-details">
            <div><dt>Workspace</dt><dd><CopyTextChip value={workspacePath ?? workspace} display={workspace} title="Copy project path" tooltip /></dd></div>
            {#if agentName}
              <div><dt>Agent</dt><dd>{agentName}</dd></div>
            {/if}
            {#if profileLabel}
              <div><dt>Profile</dt><dd>{profileLabel}</dd></div>
            {/if}
            {#if summary?.workspace}
              {@const wt = summary.workspace}
              <div><dt>Worktree branch</dt><dd>{wt.branch ?? 'Unknown'}</dd></div>
              {#if wt.checkoutPath}<div><dt>Checkout</dt><dd><CopyTextChip value={wt.checkoutPath} display={wt.checkoutPath} title="Copy checkout path" tooltip /></dd></div>{/if}
              {#if wt.baselineMode}<div><dt>Baseline</dt><dd>{wt.baselineMode.replace(/_/g, ' ')}</dd></div>{/if}
              {#if wt.lifecycle}<div><dt>Worktree state</dt><dd>{wt.lifecycle}</dd></div>{/if}
              {#if wt.handedOffTo}<div><dt>Handed off</dt><dd>Yes</dd></div>{/if}
            {/if}
            <div><dt>Updated</dt><dd>{updatedAtFull ?? updatedAt}</dd></div>
            {#if session.sessionId}
              <div><dt>Session ID</dt><dd><SessionIdChip sessionId={session.sessionId} tooltip /></dd></div>
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
      {#if menuSession}
        <SessionActionsMenu
          session={menuSession}
          canManage={canManageLifecycle}
          {canPin}
          {onSetPinned}
          pending={pinPending || lifecyclePending}
          error={pinError || lifecycleError}
          {onSetLifecycle}
          {onCreateWorktree}
          {onHandoffWorktree}
          onDebug={showDebug ? onDebug ?? null : null}
          {debugLabel}
          tooltip
          triggerClass="icon-btn icon-btn-compact session-header-btn"
        />
      {/if}
      <IconTooltipButton label="Refresh session" icon={RefreshCw} controlSize="compact" size={15} class="session-header-btn" onclick={() => void onRefresh?.()} />
    </div>
  </div>
</header>
