<script lang="ts">
  import { Accordion } from 'bits-ui';
  import { Check, ChevronDown, ChevronRight, Clock3, Copy, FolderKanban, RefreshCw, Search } from '@lucide/svelte';
  import { formatSessionTimestamp, groupSessionsByWorkspace } from '$lib/domain/sessions';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';
  import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

  let {
    sessions,
    loading = false,
    error = null,
    emptyMessage = 'No sessions returned yet.',
    onRefresh = null,
    onOpenSession = null
  }: {
    sessions: DesktopSessionSummary[];
    loading?: boolean;
    error?: string | null;
    emptyMessage?: string;
    onRefresh?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
  } = $props();

  let query = $state('');
  let statusFilter = $state<'all' | SessionStatus>('all');
  let openGroups = $state<string[]>([]);
  let lastWorkspaceKeySignature = $state('');
  let copiedSessionId = $state<string | null>(null);

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
</div>
