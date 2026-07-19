<script lang="ts">
  import { getContext } from 'svelte';
  import { Accordion, Portal } from 'bits-ui';
  import { Check, ChevronDown, ChevronRight, Clock3, Copy, FolderKanban, LoaderCircle, RefreshCw, Search, Trash2, X } from '@lucide/svelte';
  import { formatSessionTimestamp, groupSessionsByWorkspace } from '$lib/domain/sessions';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';
  import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

  let {
    sessions,
    loading = false,
    error = null,
    emptyMessage = 'No sessions returned yet.',
    onRefresh = null,
    onOpenSession = null,
    canDeleteSession = null,
    onDeleteSession = null
  }: {
    sessions: DesktopSessionSummary[];
    loading?: boolean;
    error?: string | null;
    emptyMessage?: string;
    onRefresh?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
    canDeleteSession?: ((session: DesktopSessionSummary) => boolean) | null;
    onDeleteSession?: ((session: DesktopSessionSummary) => Promise<void>) | null;
  } = $props();

  let query = $state('');
  let statusFilter = $state<'all' | SessionStatus>('all');
  let openGroups = $state<string[]>([]);
  let lastWorkspaceKeySignature = $state('');
  let copiedSessionId = $state<string | null>(null);
  let pendingDeleteSession = $state<DesktopSessionSummary | null>(null);
  let deletingSessionKey = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const filteredSessions = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesStatus = statusFilter === 'all' || session.status === statusFilter;
      const matchesQuery =
        !normalizedQuery ||
        session.title.toLowerCase().includes(normalizedQuery) ||
        session.cwd.toLowerCase().includes(normalizedQuery) ||
        session.agentName.toLowerCase().includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    });
  });

  const workspaceGroups = $derived(groupSessionsByWorkspace(filteredSessions));

  $effect(() => {
    const nextSignature = workspaceGroups.map((group) => group.key).join('|');
    if (nextSignature !== lastWorkspaceKeySignature) {
      lastWorkspaceKeySignature = nextSignature;
      const visibleKeys = new Set(workspaceGroups.map((group) => group.key));
      const preservedOpenGroups = openGroups.filter((key) => visibleKeys.has(key));
      openGroups = preservedOpenGroups.length > 0 ? preservedOpenGroups : workspaceGroups.slice(0, 3).map((group) => group.key);
    }
  });

  const statusFilters: Array<{ value: 'all' | SessionStatus; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'idle', label: 'Idle' },
    { value: 'thinking', label: 'Thinking' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'cancelling', label: 'Cancelling' },
    { value: 'completed', label: 'Completed' }
  ];

  function getStatusLabel(status: SessionStatus): string {
    switch (status) {
      case 'thinking':
        return 'Thinking';
      case 'waiting':
        return 'Waiting';
      case 'cancelling':
        return 'Cancelling';
      case 'completed':
        return 'Completed';
      case 'idle':
      default:
        return 'Idle';
    }
  }

  async function copySessionId(event: MouseEvent, sessionId: string) {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(sessionId);
      copiedSessionId = sessionId;
      window.setTimeout(() => {
        if (copiedSessionId === sessionId) copiedSessionId = null;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy session ID', error);
    }
  }

  function requestDeleteSession(event: MouseEvent, session: DesktopSessionSummary) {
    event.stopPropagation();
    deleteError = null;
    pendingDeleteSession = session;
  }

  function closeDeleteDialog() {
    if (deletingSessionKey) return;
    pendingDeleteSession = null;
    deleteError = null;
  }

  async function confirmDeleteSession() {
    const session = pendingDeleteSession;
    if (!session || !onDeleteSession) return;

    const sessionKey = `${session.agentId}:${session.sessionId}`;
    deletingSessionKey = sessionKey;
    deleteError = null;
    try {
      await onDeleteSession(session);
      pendingDeleteSession = null;
    } catch (error) {
      deleteError = error instanceof Error ? error.message : `Failed to delete ${session.title}.`;
    } finally {
      if (deletingSessionKey === sessionKey) deletingSessionKey = null;
    }
  }
</script>

<div class="session-browser">
  <div class="session-browser-toolbar">
    <label class="session-browser-search">
      <Search size={15} />
      <input bind:value={query} placeholder="Search sessions, workspaces, agents…" />
    </label>
    <div class="session-browser-actions">
      <div class="session-browser-filters" aria-label="Session status filter">
        {#each statusFilters as filter}
          <button
            class={`session-browser-filter ${statusFilter === filter.value ? 'session-browser-filter-active' : ''}`}
            type="button"
            aria-pressed={statusFilter === filter.value}
            onclick={() => (statusFilter = filter.value)}
          >
            {filter.label}
          </button>
        {/each}
      </div>
      {#if onRefresh}
        <button class="icon-btn" type="button" aria-label="Refresh sessions" onclick={onRefresh}>
          <RefreshCw size={16} />
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="alert-error">{error}</div>
  {/if}

  <div class="session-browser-body">
    {#if loading}
      <div class="muted px-4 py-4 text-sm">Loading sessions…</div>
    {:else if sessions.length === 0}
      <div class="muted px-4 py-4 text-sm">{emptyMessage}</div>
    {:else if workspaceGroups.length === 0}
      <div class="muted px-4 py-4 text-sm">No sessions match the current filters.</div>
    {:else}
      <Accordion.Root type="multiple" bind:value={openGroups} class="session-workspace-accordion">
        {#each workspaceGroups as group}
          <Accordion.Item value={group.key} class="session-workspace-item">
            <Accordion.Header level={3} class="session-workspace-header">
              <Accordion.Trigger class="session-workspace-trigger">
                <span class="session-workspace-trigger-main">
                  <span class="session-workspace-icon"><FolderKanban size={16} /></span>
                  <span class="session-workspace-copy">
                    <span class="session-workspace-name">{group.name}</span>
                    <span class="session-workspace-path">{group.path}</span>
                  </span>
                </span>
                <span class="session-workspace-meta">
                  <span class="badge">{group.sessions.length}</span>
                  <span class="session-workspace-updated"><Clock3 size={12} /> {formatSessionTimestamp(group.latestActivity)}</span>
                  <ChevronDown size={15} class="session-workspace-chevron" />
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content class="session-workspace-content">
              <div class="model-picker-list session-workspace-session-list">
                {#each group.sessions as session}
                  {@const identicon = createRoundIdenticon(session.sessionId)}
                  <div class="model-picker-row session-row">
                    <button
                      class="session-row-navigation"
                      type="button"
                      aria-label={`Open session ${session.title}`}
                      onclick={() => onOpenSession?.(session)}
                    ></button>
                    <span class="session-row-identicon" aria-hidden="true">
                      <svg
                        class="session-identicon-svg"
                        style={`--identicon-color: ${identicon.color}`}
                        width={identicon.width}
                        height={identicon.width}
                        viewBox={`0 0 ${identicon.width} ${identicon.width}`}
                        preserveAspectRatio="xMinYMin"
                      >
                        <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill="currentColor" />
                        <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                          {#each identicon.arcs as arc}
                            <path d={arc.d} stroke-width={arc.strokeWidth} />
                          {/each}
                        </g>
                      </svg>
                    </span>
                    <span class="session-row-main">
                      <span class="session-row-title">{session.title}</span>
                      <span class="session-row-meta">
                        <span>{session.agentName}</span>
                        <span>{formatSessionTimestamp(session.updatedAt)}</span>
                        <span class="session-row-id">
                          <code>{session.sessionId.slice(0, 8)}</code>
                          <button
                            class="session-row-copy-id"
                            type="button"
                            aria-label={copiedSessionId === session.sessionId ? 'Session ID copied' : 'Copy session ID'}
                            title={copiedSessionId === session.sessionId ? 'Copied' : 'Copy full session ID'}
                            onclick={(event) => copySessionId(event, session.sessionId)}
                          >
                            {#if copiedSessionId === session.sessionId}
                              <Check size={12} />
                            {:else}
                              <Copy size={12} />
                            {/if}
                          </button>
                        </span>
                      </span>
                    </span>
                    <span class="session-row-side">
                      <span class="badge">{getStatusLabel(session.status)}</span>
                      {#if onDeleteSession}
                        {@const sessionKey = `${session.agentId}:${session.sessionId}`}
                        {@const canDelete = canDeleteSession?.(session) ?? false}
                        <span class="session-row-delete-slot">
                          {#if canDelete}
                            <button
                              class="session-row-delete"
                              type="button"
                              aria-label={deletingSessionKey === sessionKey ? `Deleting session ${session.title}` : `Delete session ${session.title}`}
                              title="Delete session"
                              disabled={deletingSessionKey !== null}
                              onclick={(event) => requestDeleteSession(event, session)}
                            >
                              {#if deletingSessionKey === sessionKey}
                                <LoaderCircle size={13} class="session-row-delete-spinner" />
                              {:else}
                                <Trash2 size={13} />
                              {/if}
                            </button>
                          {/if}
                        </span>
                      {/if}
                      <span class="session-row-open" aria-hidden="true">
                        <ChevronRight size={15} />
                      </span>
                    </span>
                  </div>
                {/each}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    {/if}
  </div>

  {#if pendingDeleteSession}
    <Portal to={overlayPortalTarget}>
      <div class="app-backdrop fixed inset-0 z-50 flex items-center justify-center px-4">
        <button
          class="absolute inset-0 h-full w-full cursor-default"
          type="button"
          aria-label="Close delete session confirmation"
          onclick={() => closeDeleteDialog()}
          disabled={deletingSessionKey !== null}
        ></button>
        <div class="dialog-modal-panel dialog-modal-panel-small relative z-10" role="dialog" aria-modal="true" aria-labelledby="delete-session-dialog-title" tabindex="-1" data-blocking-overlay="true">
          <div class="dialog-header">
            <div class="dialog-header-title-block">
              <div class="dialog-title" id="delete-session-dialog-title">Delete Session</div>
              <div class="dialog-subtitle">Permanently remove "{pendingDeleteSession.title}" from {pendingDeleteSession.agentName}?</div>
            </div>
            <div class="dialog-header-actions">
              <button
                class="dialog-close-button"
                type="button"
                aria-label="Close delete session confirmation"
                onclick={() => closeDeleteDialog()}
                disabled={deletingSessionKey !== null}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div class="dialog-body">
            <div class="dialog-form">
              <div class="dialog-row-group">
                <div class="dialog-row dialog-row-muted dialog-row-full">
                  <div class="dialog-row-main">
                    <div class="dialog-row-title">This cannot be undone</div>
                    <div class="dialog-row-description">The session and its history will be permanently removed from the agent.</div>
                  </div>
                </div>
              </div>

              {#if deleteError}
                <div class="alert-error" role="alert">{deleteError}</div>
              {/if}

              <div class="dialog-footer">
                <button class="action-btn" type="button" onclick={() => closeDeleteDialog()} disabled={deletingSessionKey !== null}>Cancel</button>
                <button class="action-btn action-btn-danger" type="button" onclick={() => confirmDeleteSession()} disabled={deletingSessionKey !== null}>
                  {#if deletingSessionKey}
                    <LoaderCircle size={14} class="animate-spin" />
                    Deleting...
                  {:else}
                    Delete
                  {/if}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  {/if}
</div>
