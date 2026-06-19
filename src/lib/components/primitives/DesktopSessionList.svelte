<script lang="ts">
  import { Accordion } from 'bits-ui';
  import { ChevronDown, ChevronRight, Clock3, FolderKanban, RefreshCw, Search } from '@lucide/svelte';
  import { formatSessionTimestamp, groupSessionsByWorkspace } from '$lib/domain/sessions';
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
    <div class="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
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
              <div class="session-workspace-agents">
                {#each group.agents as agent}
                  <span class="session-agent-chip">{agent}</span>
                {/each}
              </div>
              <div class="session-workspace-session-list">
                {#each group.sessions as session}
                  <button class="session-row" type="button" onclick={() => onOpenSession?.(session)}>
                    <span class="session-row-main">
                      <span class="session-row-title">{session.title}</span>
                      <span class="session-row-meta">
                        <span class="badge">{getStatusLabel(session.status)}</span>
                        <span>{session.agentName}</span>
                        <span>{formatSessionTimestamp(session.updatedAt)}</span>
                      </span>
                    </span>
                    <span class="session-row-open" aria-hidden="true">
                      <ChevronRight size={16} />
                    </span>
                  </button>
                {/each}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    {/if}
  </div>
</div>
