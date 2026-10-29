<script lang="ts">
  import { getContext, onDestroy, untrack } from 'svelte';
  import { SessionSearchClient } from '$lib/domain/session-search-client';
  import type { SessionSearchMatch } from '$lib/domain/session-search';
  import { Accordion, Popover, RadioGroup } from 'bits-ui';
  import { AlertTriangle, Archive, Bot, Check, ChevronDown, ChevronRight, Clock3, Folder, FolderOpen, FolderSync, GitBranch, GitFork, Info, LoaderCircle, MessageSquarePlus, Network, PlugZap, Pin, Plus, RefreshCw, Search, SearchX, SlidersHorizontal, X } from '@lucide/svelte';
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';
  import CopyTextChip from '$lib/components/primitives/CopyTextChip.svelte';
  import SessionIdChip from '$lib/components/primitives/SessionIdChip.svelte';
  import SessionActionsMenu from '$lib/components/primitives/SessionActionsMenu.svelte';
  import SessionLifecycleBadges from '$lib/components/primitives/SessionLifecycleBadges.svelte';
  import { createSessionBrowserState, SESSION_LIFECYCLE_VIEWS, RECENT_SESSION_GROUP_KEY, PINNED_SESSION_GROUP_KEY, compareSessionsByPin, getSessionKey, getSessionWorkspaceName, isRootSession, sessionMatchesLifecycle, compactRemoteNodeId, formatSessionTimestamp, formatSessionTimestampAbsolute, getWorkspaceLocation, getWorkspaceRemoteMachines, groupSessionsByWorkspace, type WorkspaceSessionGroup } from '$lib/domain/sessions';
  import Identicon from '$lib/components/primitives/Identicon.svelte';
  import { isWorkspaceArchivedAccess, isWorkspaceUsable, worktreeTooltip } from '$lib/domain/session-workspace';
  import type { DesktopSessionSummary, ExcludedSessionAgent, SessionBrowserState, SessionLifecyclePatch, SessionLifecycleView, SessionStatus } from '$lib/domain/types';

  let {
    sessions = [],
    recentSessionKeys = [],
    pinnedSessions = [],
    canPinSession = null, onSetPinned = null, pinPending = {}, pinErrors = {},
    browserState = $bindable(createSessionBrowserState()),
    catalogComplete = false,
    hasAnySessions = null,
    canManageLifecycle = null,
    lifecyclePending = {},
    lifecycleErrors = {},
    onSetLifecycle = null,
    workspaceGroups = null,
    loading = false,
    loadedSessionCount = 0,
    error = null,
    excludedAgents = [],
    supportedAgentCount = null,
    emptyMessage = 'No sessions returned yet.',
    disconnected = false,
    showAgentNames = true,
    showRemoteSessions = false,
    showToolbarRefresh = true,
    onRefresh = null,
    onCreateSession = null,
    onOpenAgents = null,
    onOpenWorkspace = null,
    onCreateWorkspaceSession = null,
    onLoadMoreWorkspace = null,
    onOpenSession = null,
    canDeleteSession = null,
    onDeleteSession = null,
    loadChildren = null
  }: {
    sessions?: DesktopSessionSummary[];
    recentSessionKeys?: string[];
    pinnedSessions?: DesktopSessionSummary[];
    canPinSession?: ((session: DesktopSessionSummary) => boolean) | null;
    onSetPinned?: ((session: DesktopSessionSummary, pinned: boolean) => Promise<unknown>) | null;
    pinPending?: Record<string, boolean>;
    pinErrors?: Record<string, string | null>;
    browserState?: SessionBrowserState;
    catalogComplete?: boolean;
    hasAnySessions?: boolean | null;
    canManageLifecycle?: ((session: DesktopSessionSummary) => boolean) | null;
    lifecyclePending?: Record<string, boolean>;
    lifecycleErrors?: Record<string, string | null>;
    onSetLifecycle?: ((session: DesktopSessionSummary, patch: SessionLifecyclePatch) => Promise<unknown>) | null;
    workspaceGroups?: WorkspaceSessionGroup[] | null;
    loading?: boolean;
    loadedSessionCount?: number;
    error?: string | null;
    excludedAgents?: ExcludedSessionAgent[];
    supportedAgentCount?: number | null;
    emptyMessage?: string;
    disconnected?: boolean;
    showAgentNames?: boolean;
    showRemoteSessions?: boolean;
    showToolbarRefresh?: boolean;
    onRefresh?: (() => void | Promise<void>) | null;
    onCreateSession?: (() => void | Promise<void>) | null;
    onOpenAgents?: (() => void | Promise<void>) | null;
    onOpenWorkspace?: ((cwd: string) => void | Promise<void>) | null;
    onCreateWorkspaceSession?: ((group: WorkspaceSessionGroup, nodeId?: string) => void | Promise<void>) | null;
    onLoadMoreWorkspace?: ((cwd: string) => void | Promise<void>) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
    canDeleteSession?: ((session: DesktopSessionSummary) => boolean) | null;
    onDeleteSession?: ((session: DesktopSessionSummary) => Promise<void>) | null;
    /** Loads direct children (forks and worktree children) of a session; enables the expand control. */
    loadChildren?: ((session: DesktopSessionSummary) => Promise<DesktopSessionSummary[]>) | null;
  } = $props();

  let expandedRows = $state<Record<string, boolean>>({});
  let childrenByRow = $state<Record<string, DesktopSessionSummary[]>>({});
  let childrenLoading = $state<Record<string, boolean>>({});
  let childrenError = $state<Record<string, string | null>>({});

  function hasExpandableChildren(session: DesktopSessionSummary): boolean {
    return !!loadChildren && ((session.forkCount ?? 0) > 0 || session.hasChildren === true);
  }

  async function toggleChildren(session: DesktopSessionSummary) {
    const key = getSessionKey(session);
    if (expandedRows[key]) {
      // Drop the local copy so the next expansion re-reads the store (which owns invalidation).
      const { [key]: _dropped, ...rest } = childrenByRow;
      childrenByRow = rest;
      expandedRows = { ...expandedRows, [key]: false };
      return;
    }
    expandedRows = { ...expandedRows, [key]: true };
    if (!loadChildren || childrenLoading[key]) return;
    childrenLoading = { ...childrenLoading, [key]: true };
    childrenError = { ...childrenError, [key]: null };
    try {
      childrenByRow = { ...childrenByRow, [key]: await loadChildren(session) };
    } catch (cause) {
      childrenError = { ...childrenError, [key]: cause instanceof Error ? cause.message : 'Could not load child sessions.' };
    } finally {
      childrenLoading = { ...childrenLoading, [key]: false };
    }
  }

  type RuntimeFilter = SessionBrowserState['runtime'];

  let filtersOpen = $state(false);
  let coverageOpen = $state(false);
  let loadingVisible = $state(false);
  let searchOpenGroups = $state<string[]>([]);
  let requestedWorkspaceLoads = $state<Record<string, number>>({});
  let copiedSessionId = $state<string | null>(null);
  let pendingDeleteSession = $state<DesktopSessionSummary | null>(null);
  let deletingSessionKey = $state<string | null>(null);
  let deleteError = $state<string | null>(null);
  let draftQuery = $state(browserState.query);
  let appliedQuery = $state('');
  let composing = $state(false);
  let searchPending = $state(false);
  let searchMatches = $state.raw<SessionSearchMatch[] | null>(null);
  let searchVisibleLimits = $state<Record<string, number>>({});
  let indexRevision = $state(0);
  let lastRequestedQuery = '';
  const searchClient = new SessionSearchClient();
  onDestroy(() => searchClient.dispose());

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  const sourceWorkspaceGroups = $derived.by(() => {
    const rows = new Map([...pinnedSessions, ...sessions].map((session) => [getSessionKey(session), session]));
    const groups = workspaceGroups ?? groupSessionsByWorkspace([...rows.values()]);
    const pinned = pinnedSessions.filter((session) => session.pin?.pinned && isRootSession(session)).slice().sort(compareSessionsByPin);
    const pinnedKeys = new Set(pinned.map(getSessionKey));
    const byKey = new Map(groups.flatMap((group) => group.sessions).map((session) => [getSessionKey(session), session]));
    const recent = [...new Set(recentSessionKeys)].flatMap((key) => {
      const session = byKey.get(key);
      return session && isRootSession(session) && !session.pin?.pinned && !pinnedKeys.has(key) ? [session] : [];
    });
    const specialGroups: WorkspaceSessionGroup[] = [];
    if (pinned.length) specialGroups.push({
      kind: 'pinned', key: PINNED_SESSION_GROUP_KEY, cwd: '', name: 'Pinned sessions', path: '',
      sessions: pinned, latestActivity: null, initialized: true, loading: false, hasMore: false, error: null, catalogGeneration: 0
    });
    if (recent.length) specialGroups.push({
      kind: 'recent', key: RECENT_SESSION_GROUP_KEY, cwd: '', name: 'Recent sessions', path: '',
      sessions: recent, latestActivity: null, initialized: true, loading: false, hasMore: false, error: null, catalogGeneration: 0
    });
    return [...specialGroups, ...groups];
  });

  function machineName(machine: { id: string; label: string | null }) {
    return machine.label ?? compactRemoteNodeId(machine.id);
  }

  function workspaceMachineText(group: WorkspaceSessionGroup) {
    const machines = group.remoteMachines ?? [];
    if (machines.length === 0) return group.location === 'remote' ? 'Remote' : group.location === 'mixed' ? 'local + remote' : null;
    if (machines.length > 1) return group.location === 'mixed' ? `local + ${machines.length} machines` : `${machines.length} machines`;
    const name = machineName(machines[0]);
    return group.location === 'mixed' ? `local + ${name}` : name;
  }

  function workspaceMachineTitle(group: WorkspaceSessionGroup) {
    const names = (group.remoteMachines ?? []).map(machineName).join(', ');
    if (!names) return group.location === 'remote' ? 'Remote workspace' : group.location === 'mixed' ? 'Local and remote workspace' : undefined;
    return group.location === 'mixed' ? `Local workspace and remote workspace on ${names}` : `Remote workspace on ${names}`;
  }
  const initialLoading = $derived(loading && sourceWorkspaceGroups.length === 0);
  const refreshing = $derived(loading && sourceWorkspaceGroups.length > 0);
  const normalizedQuery = $derived(draftQuery.trim().toLowerCase());
  const searching = $derived(normalizedQuery.length > 0);
  const showingSearch = $derived(appliedQuery.length > 0);
  const loadingStatus = $derived(`${searching ? 'Searching remaining history…' : initialLoading ? 'Loading sessions…' : catalogComplete ? 'Loading remaining sessions…' : 'Refreshing sessions…'}${loadedSessionCount > 0 ? ` ${loadedSessionCount} loaded` : ''}`);
  const searchPlaceholder = $derived(loading && loadingVisible && !error ? loadingStatus : 'Search sessions, workspaces, agents…');
  const hasActiveFilters = $derived(searching || browserState.runtime !== 'all' || browserState.location !== 'all');
  const selectedView = $derived(SESSION_LIFECYCLE_VIEWS.find((view) => view.filter.resolution === browserState.resolution && view.filter.archive === browserState.archive));
  const coverageExclusions = $derived(browserState.resolution !== 'any' || browserState.archive !== 'any' ? excludedAgents : []);
  const allAgentsExcluded = $derived(coverageExclusions.length > 0 && supportedAgentCount === 0);
  const coverageLabel = $derived(`${coverageExclusions.length} ${coverageExclusions.length === 1 ? 'agent' : 'agents'} excluded`);
  const emptyCatalog = $derived(!coverageExclusions.length && (hasAnySessions === false || (sourceWorkspaceGroups.length === 0 && (!catalogComplete || selectedView?.value === 'all'))));
  const emptyCategoryTitle = $derived(`${selectedView ? `No ${selectedView.label.toLowerCase()} sessions` : 'No matching sessions'}${coverageExclusions.length ? ' from supported agents' : ''}`);
  const emptyCategoryDescription = $derived(selectedView?.value === 'resolved' ? 'Sessions you mark as resolved appear here.'
    : selectedView?.value === 'archived' ? 'Sessions you archive appear here.' : 'Browse All to find resolved and archived sessions.');
  const refinementLabels = $derived([
    ...(browserState.runtime === 'all' ? [] : [browserState.runtime === 'running' ? 'Running' : 'Needs input']),
    ...(browserState.location === 'all' ? [] : [browserState.location === 'remote' ? 'Remote' : 'Local']),
    ...(selectedView ? [] : [
      browserState.resolution === 'any' ? 'Any resolution' : browserState.resolution === 'open' ? 'Open' : 'Resolved',
      browserState.archive === 'only' ? 'Archived only' : browserState.archive === 'excluded' ? 'Not archived' : 'Including archived'
    ])
  ]);

  $effect(() => {
    if (!showRemoteSessions && browserState.location === 'remote') browserState.location = 'all';
  });

  const loadingKey = $derived(loading ? `${browserState.resolution}:${browserState.archive}` : null);
  $effect(() => {
    loadingVisible = false;
    if (!loadingKey) return;
    const timer = setTimeout(() => { loadingVisible = true; }, 200);
    return () => clearTimeout(timer);
  });

  // Eligibility changes with catalog/filter data, never with individual keystrokes.
  const eligibleWorkspaceGroups = $derived(sourceWorkspaceGroups.map((group) => ({
    ...group,
    sessions: group.sessions.filter((session) => sessionMatchesFilter(session, browserState.runtime) &&
      sessionMatchesLifecycle(session.lifecycle, browserState) &&
      (browserState.location === 'all' || (browserState.location === 'remote' ? session.location === 'remote' : session.location !== 'remote')))
  })));
  const eligibleByKey = $derived(new Map(eligibleWorkspaceGroups.map((group) => [group.key, group])));
  const sessionsByKey = $derived(new Map(eligibleWorkspaceGroups.flatMap((group) => group.sessions.map((session) => [getSessionKey(session), session] as const))));
  const browseGroups = $derived(eligibleWorkspaceGroups.filter((group) => group.sessions.length ||
    (!catalogComplete && browserState.runtime === 'all' && browserState.location === 'all')));
  const matchingGroups = $derived(searchMatches ?? browseGroups);
  const filteredWorkspaceGroups = $derived.by(() => {
    return matchingGroups.flatMap((match) => {
      const group = eligibleByKey.get(match.key);
      if (!group) return [];
      const members = new Set(group.sessions.map(getSessionKey));
      const filteredSessions = 'sessionKeys' in match
        ? match.sessionKeys.flatMap((key) => { const session = sessionsByKey.get(key); return session && members.has(key) ? [session] : []; }) : group.sessions;
      const limit = (showingSearch ? searchVisibleLimits : browserState.visibleLimits)[group.key] ?? 10;
      return [{
        ...group, sessions: catalogComplete || group.kind ? filteredSessions.slice(0, limit) : filteredSessions,
        totalMatching: filteredSessions.length,
        hasMore: catalogComplete || !!group.kind ? filteredSessions.length > limit : group.hasMore,
        location: filteredSessions.length ? getWorkspaceLocation(filteredSessions) : group.location,
        remoteMachines: filteredSessions.length ? getWorkspaceRemoteMachines(filteredSessions) : group.remoteMachines
      }];
    });
  });

  $effect(() => {
    const query = browserState.query;
    untrack(() => { if (draftQuery !== query) draftQuery = query; });
  });
  $effect(() => {
    const groups = eligibleWorkspaceGroups;
    if (untrack(() => searchClient.update(groups))) untrack(() => indexRevision++);
  });
  $effect(() => {
    const query = normalizedQuery;
    void indexRevision;
    searchClient.cancel();
    if (composing) return;
    let cancelled = false;
    const delay = query && query !== lastRequestedQuery ? 80 : 0;
    lastRequestedQuery = query;
    searchPending = true;
    const timer = setTimeout(async () => {
      const matches = query ? await searchClient.search(query) : null;
      if (cancelled || (query && matches === null)) return;
      untrack(() => {
        if (query !== appliedQuery) {
          searchVisibleLimits = {};
        }
      });
      searchMatches = matches;
      appliedQuery = query;
      searchPending = false;
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); searchClient.cancel(); };
  });

  function updateQuery(event: Event) {
    draftQuery = (event.currentTarget as HTMLInputElement).value;
    browserState.query = draftQuery;
  }

  $effect(() => {
    if (showingSearch) {
      searchOpenGroups = filteredWorkspaceGroups.map((group) => group.key);
    } else {
      if (!browserState.groupsInitialized && filteredWorkspaceGroups.length) {
        browserState.openGroups = filteredWorkspaceGroups.slice(0, 1).map((group) => group.key);
        browserState.groupsInitialized = true;
      }
      if (!browserState.pinnedGroupInitialized && filteredWorkspaceGroups.some((group) => group.kind === 'pinned')) {
        browserState.openGroups = [...new Set([PINNED_SESSION_GROUP_KEY, ...browserState.openGroups])];
        browserState.pinnedGroupInitialized = true;
      }
      if (!browserState.recentGroupInitialized && filteredWorkspaceGroups.some((group) => group.kind === 'recent')) {
        browserState.openGroups = [...new Set([RECENT_SESSION_GROUP_KEY, ...browserState.openGroups])];
        browserState.recentGroupInitialized = true;
      }
    }
  });

  function getOpenGroups(): string[] {
    return showingSearch ? searchOpenGroups : browserState.openGroups;
  }

  function setOpenGroups(groups: string[]) {
    if (showingSearch) searchOpenGroups = groups;
    else browserState.openGroups = groups;
  }

  $effect(() => {
    for (const group of filteredWorkspaceGroups) {
      if (
        getOpenGroups().includes(group.key) &&
        !group.initialized &&
        !group.loading &&
        !group.error &&
        requestedWorkspaceLoads[group.key] !== group.catalogGeneration
      ) {
        requestedWorkspaceLoads = { ...requestedWorkspaceLoads, [group.key]: group.catalogGeneration };
        void onOpenWorkspace?.(group.cwd);
      }
    }
  });

  const runtimeFilters: Array<{ value: RuntimeFilter; label: string }> = [
    { value: 'all', label: 'Any' },
    { value: 'running', label: 'Running' },
    { value: 'needs-input', label: 'Needs input' }
  ];

  const locationFilters = [{ value: 'all', label: 'Any' }, { value: 'local', label: 'Local' }, { value: 'remote', label: 'Remote' }];
  const resolutionFilters = [{ value: 'any', label: 'Any' }, { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }];
  const archiveFilters = [{ value: 'excluded', label: 'Hide' }, { value: 'only', label: 'Only' }, { value: 'any', label: 'Include' }];

  function resetRefinements() {
    browserState.runtime = 'all';
    browserState.location = 'all';
    if (!selectedView) setView('open');
  }

  function sessionMatchesFilter(session: DesktopSessionSummary, filter: RuntimeFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'running') return session.status === 'thinking' || session.status === 'cancelling';
    return session.status === 'waiting';
  }

  function countWorkspaceSessions(group: WorkspaceSessionGroup, filter: RuntimeFilter): number {
    return group.sessions.filter((session) => sessionMatchesFilter(session, filter)).length;
  }

  function clearFilters() {
    draftQuery = '';
    browserState.query = '';
    browserState.runtime = 'all';
    browserState.location = 'all';
  }

  function setView(value: SessionLifecycleView) {
    coverageOpen = false;
    const view = SESSION_LIFECYCLE_VIEWS.find((candidate) => candidate.value === value)!;
    browserState.resolution = view.filter.resolution;
    browserState.archive = view.filter.archive;
  }

  function loadMore(group: WorkspaceSessionGroup) {
    if (catalogComplete || !!group.kind) {
      const limits = showingSearch ? searchVisibleLimits : browserState.visibleLimits;
      const limit = (limits[group.key] ?? 10) + 10;
      if (showingSearch) searchVisibleLimits[group.key] = limit;
      else browserState = { ...browserState, visibleLimits: { ...limits, [group.key]: limit } };
    } else void onLoadMoreWorkspace?.(group.cwd);
  }

  function getStatusLabel(status: SessionStatus): string {
    switch (status) {
      case 'thinking':
        return 'Thinking';
      case 'waiting':
        return 'Waiting';
      case 'cancelling':
        return 'Cancelling';
      case 'completed':
        return 'Turn complete';
      case 'idle':
      default:
        return 'Idle';
    }
  }

  function getStatusTone(status: SessionStatus): string {
    switch (status) {
      case 'thinking':
      case 'cancelling':
        return 'running';
      case 'waiting':
        return 'warning';
      case 'completed':
        return 'success';
      default:
        return 'muted';
    }
  }

  async function copySessionId(sessionId: string) {

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

  function requestDeleteSession(session: DesktopSessionSummary) {
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

{#snippet filterRow(label: string, value: string, options: Array<{ value: string; label: string }>, onChange: (value: string) => void)}
  <div class="session-filter-row">
    <span class="session-filter-row-label">{label}</span>
    <RadioGroup.Root class="session-filter-choices" aria-label={label} {value} onValueChange={onChange} orientation="horizontal">
      {#each options as option}
        <RadioGroup.Item class="session-filter-choice" value={option.value}>
          {#snippet children({ checked })}
            <Check size={11} class={checked ? 'session-filter-check' : 'session-filter-check session-filter-check-hidden'} aria-hidden="true" />
            {option.label}
          {/snippet}
        </RadioGroup.Item>
      {/each}
    </RadioGroup.Root>
  </div>
{/snippet}

{#snippet sessionRow(session: DesktopSessionSummary, group: WorkspaceSessionGroup, depth: number)}
                   {@const sessionKey = `${session.agentId}:${session.sessionId}`}
                   {@const canDelete = canDeleteSession?.(session) ?? false}
                   {@const expandable = hasExpandableChildren(session)}
                   {@const expanded = !!expandedRows[sessionKey]}
                   {@const archivedReadOnly = isWorkspaceArchivedAccess(session.access)}
                   {@const handedOff = !archivedReadOnly && (!!session.workspace?.handedOffTo || session.access?.mode === 'read_only')}
                   <div class="model-picker-row session-row" class:session-row-nested={depth > 0} style={depth > 0 ? `margin-left: ${depth * 1.1}rem` : undefined} data-depth={depth}>
                    <button
                      class="session-row-navigation"
                      type="button"
                      aria-label={`Open session ${session.title}`}
                      onclick={() => onOpenSession?.(session)}
                    ></button>
                     {#if expandable}
                       <button class="session-row-expand" type="button" aria-expanded={expanded}
                         aria-label={`${expanded ? 'Collapse' : 'Expand'} child sessions of ${session.title}`}
                         onclick={() => toggleChildren(session)}>
                         {#if childrenLoading[sessionKey]}<LoaderCircle size={13} class="animate-spin" />{:else}<ChevronRight size={13} class={expanded ? 'session-row-expand-open' : ''} />{/if}
                       </button>
                     {/if}
                    <span class="session-row-identicon" aria-hidden="true">
                      <Identicon seed={session.sessionId} />
                    </span>
                    <span class="session-row-main">
                       <span class="session-row-title-line">
                            <span class="session-row-title">{session.title}</span>
                            {#if session.pin?.pinned && group.kind !== 'pinned'}<Pin size={12} class="session-pin-indicator" aria-label="Pinned" />{/if}
                           <SessionLifecycleBadges lifecycle={session.lifecycle} showUnavailable={browserState.resolution === 'any' && browserState.archive === 'any'} />
                           {#if session.location === 'remote' && session.remoteConnectionState === 'disconnected'}
                             <span class="session-relationship-badge session-relationship-badge-remote">Remote · disconnected</span>
                           {:else if group.location === 'mixed' && session.location === 'remote'}
                             <span class="session-relationship-badge session-relationship-badge-remote">Remote</span>
                           {/if}
                          {#if session.parentSessionId}
                           {#if session.forkOrigin === 'user'}
                             <span class="session-relationship-badge session-relationship-badge-fork"><GitFork size={11} />Fork</span>
                           {:else if session.forkOrigin === 'worktree'}
                             <span class="session-relationship-badge session-relationship-badge-worktree"><GitBranch size={11} />Worktree</span>
                          {:else if session.forkOrigin === 'delegation'}
                            <span class="session-relationship-badge session-relationship-badge-delegate"><Bot size={11} />Delegate</span>
                          {:else}
                            <span class="session-relationship-badge session-relationship-badge-child"><GitFork size={11} />Child</span>
                          {/if}
                        {/if}
                        {#if session.workspace}
                          {@const usable = isWorkspaceUsable(session.workspace)}
                          <span class="session-relationship-badge session-relationship-badge-branch" class:session-relationship-badge-warning={!usable}
                            title={worktreeTooltip(session.workspace)} data-testid="worktree-branch-badge">
                            {#if usable}<GitBranch size={11} />{:else}<AlertTriangle size={11} />{/if}{session.workspace.branch ?? 'worktree'}{#if !usable} · {session.workspace.lifecycle}{/if}
                          </span>
                        {/if}
                        {#if archivedReadOnly}
                          <span class="session-relationship-badge session-relationship-badge-handoff" title="This worktree was archived; the session is read-only" data-testid="worktree-archived-badge">Archived</span>
                        {:else if handedOff}
                          <span class="session-relationship-badge session-relationship-badge-handoff" title="This worktree was handed off to another session">Handed off</span>
                        {/if}
                        {#if (session.forkCount ?? 0) > 0}
                          <span class="session-relationship-badge session-relationship-badge-count">
                            <GitFork size={11} />{session.forkCount} {session.forkCount === 1 ? 'fork' : 'forks'}
                          </span>
                        {/if}
                      </span>
                      <span class="session-row-meta">
                        {#if !!group.kind}
                          <span class="session-row-workspace" title={session.cwd}>
                            {getSessionWorkspaceName(session.cwd)}{#if session.location === 'remote'} · {session.remoteNodeLabel || compactRemoteNodeId(session.remoteNodeId ?? '')}{/if}
                          </span>
                        {/if}
                        {#if showAgentNames}<span>{session.agentName}</span>{/if}
                        <span class="session-row-status-line">
                          <span
                            class={`session-header-status-dot session-header-status-dot-${getStatusTone(session.status)}`}
                            aria-label={`Status: ${getStatusLabel(session.status)}`}
                            title={`Status: ${getStatusLabel(session.status)}`}
                          ></span>
                          <SessionIdChip sessionId={session.sessionId} />
                          <span aria-hidden="true">·</span>
                          <button
                            class="session-row-timestamp"
                            type="button"
                            title={formatSessionTimestampAbsolute(session.updatedAt)}
                            onclick={() => onOpenSession?.(session)}
                          >{formatSessionTimestamp(session.updatedAt)}</button>
                        </span>
                      </span>
                    </span>
                     <span class="session-row-side">
                       <SessionActionsMenu
                         {session}
                          canManage={canManageLifecycle?.(session) ?? false}
                          canPin={canPinSession?.(session) ?? false}
                          onSetPinned={onSetPinned ? (pinned) => onSetPinned!(session, pinned) : null}
                         pending={pinPending[sessionKey] || lifecyclePending[sessionKey] || deletingSessionKey === sessionKey}
                         error={pinErrors[sessionKey] || lifecycleErrors[sessionKey]}
                         onSetLifecycle={onSetLifecycle ? (patch) => onSetLifecycle!(session, patch) : null}
                         onCopy={() => copySessionId(session.sessionId)}
                         copied={copiedSessionId === session.sessionId}
                         onDelete={onDeleteSession && canDelete && !deletingSessionKey ? () => requestDeleteSession(session) : null}
                       />
                     </span>
                  </div>
                  {#if expandable && expanded}
                    <div class="session-row-children" role="group" aria-label={`Child sessions of ${session.title}`}>
                      {#if childrenLoading[sessionKey] && !childrenByRow[sessionKey]}
                        <div class="session-workspace-loading" style={`margin-left: ${(depth + 1) * 1.1}rem`}><LoaderCircle size={13} class="animate-spin" /> Loading child sessions...</div>
                      {:else if childrenError[sessionKey]}
                        <div class="session-workspace-pagination" style={`margin-left: ${(depth + 1) * 1.1}rem`}>
                          <span class="alert-error" role="alert">{childrenError[sessionKey]}</span>
                          <button class="action-btn" type="button" onclick={() => { expandedRows = { ...expandedRows, [sessionKey]: false }; void toggleChildren(session); }}>Retry</button>
                        </div>
                      {:else}
                        {#each (childrenByRow[sessionKey] ?? []).filter((child) => child.parentSessionId === session.sessionId) as child (getSessionKey(child))}
                          {@render sessionRow(child, group, depth + 1)}
                        {:else}
                          <div class="session-workspace-loading" style={`margin-left: ${(depth + 1) * 1.1}rem`}>No child sessions.</div>
                        {/each}
                      {/if}
                    </div>
                  {/if}
{/snippet}

<div class="session-browser">
  <div class="session-browser-toolbar">
    <label class="session-browser-search">
      {#if loading && loadingVisible && !error}
        <LoaderCircle size={15} class="animate-spin" />
        <span class="sr-only" role="status">{loadingStatus}</span>
      {:else}
        <Search size={15} />
      {/if}
      <input value={draftQuery} oninput={updateQuery} oncompositionstart={() => composing = true}
        oncompositionend={(event) => { composing = false; updateQuery(event); }}
        aria-label="Search sessions" placeholder={searchPlaceholder} />
    </label>
    <div class="session-browser-actions">
      <Popover.Root bind:open={filtersOpen}>
        <Popover.Trigger class="session-filter-trigger" aria-label={refinementLabels.length ? `Filters, ${refinementLabels.length} active` : 'Filters'}>
          <SlidersHorizontal size={15} />
          <span>Filters</span>
          {#if refinementLabels.length}<span class="session-filter-count">{refinementLabels.length}</span>{/if}
        </Popover.Trigger>
        <Popover.Portal to={overlayPortalTarget ?? undefined}>
          <Popover.Content class="session-filter-popover" role="dialog" aria-label="Session filters" sideOffset={8} collisionPadding={12} align="end" trapFocus>
            <div class="session-filter-popover-heading">
              <strong>Filters</strong>
              <Popover.Close class="session-filter-close" aria-label="Close filters"><X size={15} /></Popover.Close>
            </div>
            <div class="session-filter-section">
              {@render filterRow('Runtime', browserState.runtime, runtimeFilters, (value) => browserState.runtime = value as RuntimeFilter)}
              {#if showRemoteSessions}{@render filterRow('Location', browserState.location, locationFilters, (value) => browserState.location = value as SessionBrowserState['location'])}{/if}
            </div>
            <div class="session-filter-section">
              {@render filterRow('Resolution', browserState.resolution, resolutionFilters, (value) => browserState.resolution = value as SessionBrowserState['resolution'])}
              {@render filterRow('Archived', browserState.archive, archiveFilters, (value) => browserState.archive = value as SessionBrowserState['archive'])}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {#if showToolbarRefresh && onRefresh}
        <button class="icon-btn" type="button" aria-label={refreshing ? 'Refreshing sessions' : 'Refresh sessions'} disabled={loading} onclick={onRefresh}>
          {#if refreshing}<LoaderCircle size={16} class="animate-spin" />{:else}<RefreshCw size={16} />{/if}
        </button>
      {/if}
    </div>
  </div>
  <div class="session-browser-viewbar">
    <div class="session-browser-filters" role="group" aria-label="Session lifecycle views">
      {#each SESSION_LIFECYCLE_VIEWS as view}
        <button class={`session-browser-filter ${selectedView?.value === view.value ? 'session-browser-filter-active' : ''}`} type="button" aria-pressed={selectedView?.value === view.value} onclick={() => setView(view.value)}>{view.label}</button>
      {/each}
    </div>
    <div class="session-browser-view-details">
      {#if refinementLabels.length}
        <div class="session-filter-summary">
          <span>{refinementLabels.join(' · ')}</span>
          <button type="button" aria-label="Clear additional filters" onclick={resetRefinements}>Clear</button>
        </div>
      {/if}
      {#if coverageExclusions.length}
        <Popover.Root bind:open={coverageOpen}>
          <Popover.Trigger class="session-coverage-trigger" aria-label={`${coverageLabel} from this view. Show details`}>
            <span>{coverageLabel}</span><Info size={13} aria-hidden="true" />
          </Popover.Trigger>
          <Popover.Portal to={overlayPortalTarget ?? undefined}>
            <Popover.Content class="app-tooltip-content session-coverage-content" role="dialog" aria-label="Excluded agents" sideOffset={6} align="end" collisionPadding={12} trapFocus>
              <p>
                {#each coverageExclusions as agent, index}{#if index > 0}{', '}{/if}<a href="/agents" onclick={() => coverageOpen = false}>{agent.name}</a>{/each}
                {coverageExclusions.length === 1 ? 'does' : 'do'} not support lifecycle filters. {coverageExclusions.length === 1 ? 'Its' : 'Their'} sessions are <button type="button" onclick={() => setView('all')}>available in All</button>.
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      {/if}
    </div>
  </div>

  <div class="session-browser-body" aria-busy={loading || searchPending}>
    {#if searchPending && (searching || showingSearch)}<span class="sr-only" role="status">Updating search results</span>{/if}
    {#if error && (sourceWorkspaceGroups.length > 0 || loading)}
      <div class="state-inline-error" role="alert">
        <AlertTriangle size={15} />
        <span class="min-w-0 flex-1"><strong>{catalogComplete ? 'Session results may be incomplete.' : 'Sessions could not be refreshed.'}</strong> {error}</span>
        {#if onRefresh}<button class="action-btn action-btn-compact" type="button" onclick={onRefresh}>Retry</button>{/if}
      </div>
    {/if}
    {#if initialLoading}
      <div class="session-browser-pending">
        {#if loadingVisible}
          <div class="state-skeleton-list" aria-label="Loading sessions">
            {#each Array(4) as _}
              <div class="state-skeleton-row">
                <span class="state-skeleton-avatar"></span>
                <span class="state-skeleton-copy"><i></i><i></i></span>
                <span class="state-skeleton-actions"></span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else if error && sourceWorkspaceGroups.length === 0}
      <div class="state-panel state-panel-error session-empty-state" role="alert">
        <span class="state-panel-icon"><AlertTriangle size={17} /></span>
        <div class="state-panel-copy"><strong>Sessions could not be loaded</strong><p>{error}</p></div>
        {#if onRefresh}<div class="session-empty-actions"><button class="action-btn" type="button" onclick={onRefresh}>Try again</button></div>{/if}
      </div>
    {:else if disconnected && sourceWorkspaceGroups.length === 0}
      <div class="state-panel session-empty-state">
        <span class="state-panel-icon"><PlugZap size={17} /></span>
        <div class="state-panel-copy"><strong>No agents connected</strong><p>Connect an agent before browsing or creating sessions.</p></div>
        {#if onOpenAgents}<div class="session-empty-actions"><button class="action-btn action-btn-primary" type="button" onclick={onOpenAgents}>Open agents</button></div>{/if}
      </div>
    {:else if allAgentsExcluded}
      <div class="state-panel session-empty-state">
        <span class="state-panel-icon"><Info size={17} /></span>
        <div class="state-panel-copy"><strong>{selectedView ? `${selectedView.label} view unavailable for connected agents` : 'Lifecycle filters unavailable for connected agents'}</strong><p>View all sessions to browse these agents.</p></div>
        <div class="session-empty-actions"><button class="action-btn" type="button" onclick={() => setView('all')}>View all sessions</button></div>
      </div>
    {:else if filteredWorkspaceGroups.length === 0}
      {#if searchPending && (searching || showingSearch)}
        <div class="session-browser-pending" aria-label="Updating search results"></div>
      {:else if catalogComplete && (loading || error)}
        <div class="state-panel session-empty-state">
          <span class="state-panel-icon"><SearchX size={17} /></span>
          <div class="state-panel-copy"><strong>No matches in loaded sessions</strong><p>{loading ? 'More sessions are still loading.' : 'Retry to search the remaining history.'}</p></div>
          {#if hasActiveFilters}<div class="session-empty-actions"><button class="action-btn" type="button" onclick={clearFilters}>Clear filters</button></div>{/if}
        </div>
      {:else if emptyCatalog}
        <div class="state-panel session-empty-state">
          <span class="state-panel-icon"><MessageSquarePlus size={17} /></span>
          <div class="state-panel-copy"><strong>No sessions yet</strong><p>{emptyMessage}</p></div>
          {#if onCreateSession}<div class="session-empty-actions"><button class="action-btn action-btn-primary" type="button" onclick={onCreateSession}>New session</button></div>{/if}
        </div>
      {:else if hasActiveFilters || !selectedView}
        <div class="state-panel session-empty-state">
          <span class="state-panel-icon"><SearchX size={17} /></span>
          <div class="state-panel-copy"><strong>No matching sessions{coverageExclusions.length ? ' from supported agents' : ''}</strong><p>Try another search or clear your filters.</p></div>
          <div class="session-empty-actions"><button class="action-btn" type="button" onclick={() => { clearFilters(); resetRefinements(); }}>Clear filters</button></div>
        </div>
      {:else}
        <div class="state-panel session-empty-state">
          <span class="state-panel-icon">{#if selectedView.value === 'archived'}<Archive size={17} />{:else if selectedView.value === 'resolved'}<Check size={17} />{:else}<MessageSquarePlus size={17} />{/if}</span>
          <div class="state-panel-copy"><strong>{emptyCategoryTitle}</strong><p>{hasAnySessions === null && selectedView.value === 'open' ? 'No open sessions were returned.' : emptyCategoryDescription}</p></div>
          <div class="session-empty-actions">
            <button class="action-btn" type="button" onclick={() => setView(selectedView?.value === 'resolved' ? 'open' : 'all')}>{selectedView.value === 'resolved' ? 'View open sessions' : 'View all sessions'}</button>
          </div>
        </div>
      {/if}
    {:else}
      <Accordion.Root type="multiple" bind:value={getOpenGroups, setOpenGroups} class="session-workspace-accordion">
        {#each filteredWorkspaceGroups as group (group.key)}
          <Accordion.Item value={group.key} class="session-workspace-item">
             <div class="session-workspace-heading">
               <Accordion.Header level={3} class="session-workspace-header">
                 <Accordion.Trigger class="session-workspace-trigger">
                   <span class="session-workspace-trigger-main">
                      <span class="session-workspace-icon" aria-hidden="true">
                        {#if group.kind === 'pinned'}
                          <Pin size={22} strokeWidth={1.5} />
                        {:else if group.kind === 'recent'}
                          <Clock3 size={22} strokeWidth={1.5} />
                        {:else if getOpenGroups().includes(group.key)}
                          <FolderOpen size={22} strokeWidth={1.5} />
                        {:else if group.location === 'remote' || group.location === 'mixed'}
                          <FolderSync size={22} strokeWidth={1.5} />
                        {:else}
                          <Folder size={22} strokeWidth={1.5} />
                        {/if}
                      </span>
                      <span class="session-workspace-copy">
                        <span class="session-workspace-name">{group.name}</span>
                         <span class="session-workspace-path">
                           {#if !!group.kind}
                             <span>{group.kind === 'pinned' ? 'Saved on your agents' : 'Recently opened'}</span>
                           {:else}
                             <CopyTextChip value={group.path} title="Copy project path" />
                           {/if}
                           {#if !group.kind && workspaceMachineText(group)}
                             <span class="session-workspace-machine" title={workspaceMachineTitle(group)}><Network size={12} aria-hidden="true" />{workspaceMachineText(group)}</span>
                           {/if}
                         </span>
                      </span>
                   </span>
                   <span class="session-workspace-meta">
                     {#if group.loading && !group.initialized}
                       <span class="badge session-workspace-count-loading" aria-label="Loading sessions" title="Loading sessions"><LoaderCircle size={12} class="animate-spin" aria-hidden="true" /></span>
                     {:else if group.initialized}
                       {@const activeCount = countWorkspaceSessions(group, 'running')}
                       {@const waitingCount = countWorkspaceSessions(group, 'needs-input')}
                       {#if activeCount > 0}<span class="session-workspace-signal session-workspace-signal-active">{activeCount} running</span>{/if}
                       {#if waitingCount > 0}<span class="session-workspace-signal session-workspace-signal-waiting">{waitingCount} waiting</span>{/if}
                        {@const hasUncountedSessions = !catalogComplete && !group.kind && group.hasMore}
                        <span class="session-workspace-count" aria-label={`${group.totalMatching} loaded session${group.totalMatching === 1 ? '' : 's'}${hasUncountedSessions ? ', more available' : ''}`}>{group.totalMatching}{hasUncountedSessions ? '+' : ''}</span>
                     {:else}
                       <span class="session-workspace-count session-workspace-count-pending" aria-label="Sessions not loaded" title="Sessions load when opened">—</span>
                     {/if}
                      {#if !group.kind}<span class="session-workspace-updated" title={formatSessionTimestampAbsolute(group.latestActivity)}><Clock3 size={12} /> {formatSessionTimestamp(group.latestActivity)}</span>{/if}
                     <ChevronDown size={15} class="session-workspace-chevron" />
                   </span>
                 </Accordion.Trigger>
               </Accordion.Header>
                {#if onCreateWorkspaceSession && !group.kind}
                  {#if group.location === 'mixed' || (group.remoteMachines?.length ?? 0) > 1}
                    <details class="session-workspace-target-picker">
                      <summary class="session-workspace-new" aria-label={`New session in ${group.name}`} title={`Choose target for ${group.name}`}><Plus size={15} /></summary>
                      <div class="session-workspace-target-options">
                        {#if group.location === 'mixed'}
                          <button type="button" onclick={() => onCreateWorkspaceSession?.(group, 'local')}>Local</button>
                        {/if}
                        {#each group.remoteMachines ?? [] as machine (machine.id)}
                          <button type="button" title={machine.id} onclick={() => onCreateWorkspaceSession?.(group, machine.id)}>{machine.label || compactRemoteNodeId(machine.id)}</button>
                        {/each}
                      </div>
                    </details>
                  {:else}
                    <button class="session-workspace-new" type="button" aria-label={`New session in ${group.name}`} title={`New session in ${group.name}`} onclick={() => onCreateWorkspaceSession?.(group)}><Plus size={15} /></button>
                  {/if}
                {/if}
             </div>
            <Accordion.Content class="session-workspace-content">
              {#if getOpenGroups().includes(group.key)}
              {#if group.loading && group.sessions.length === 0}
                <div class="session-workspace-loading"><LoaderCircle size={15} class="animate-spin" /> Loading workspace sessions...</div>
              {:else}
                <div class="model-picker-list session-workspace-session-list">
                  {#each group.sessions as session (getSessionKey(session))}
                    {@render sessionRow(session, group, 0)}
                  {/each}
                </div>
                {#if group.error}
                  <div class="session-workspace-pagination">
                    <span class="alert-error" role="alert">{group.error}</span>
                    <button class="action-btn" type="button" onclick={() => onOpenWorkspace?.(group.cwd)}>Retry</button>
                  </div>
                {:else if group.hasMore && (catalogComplete || !!group.kind || onLoadMoreWorkspace)}
                  <div class="session-workspace-pagination">
                    <button
                      class="session-workspace-load-more"
                      type="button"
                      disabled={group.loading}
                      onclick={() => loadMore(group)}
                    >
                      {#if group.loading}
                        <LoaderCircle size={14} class="animate-spin" />
                      {:else}
                        <ChevronDown size={14} aria-hidden="true" />
                      {/if}
                      {group.loading ? 'Loading...' : 'Load 10 more'}
                    </button>
                  </div>
                {/if}
              {/if}
              {/if}
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
    {/if}
  </div>

  {#if pendingDeleteSession}
    <AppConfirmDialog
      open={true}
      title={`Delete ${pendingDeleteSession.title}?`}
      description={`The session and its history will be permanently removed from ${pendingDeleteSession.agentName}. This cannot be undone.`}
      confirmLabel="Delete"
      pendingLabel="Deleting..."
      pending={deletingSessionKey !== null}
      portalTarget={overlayPortalTarget}
      onConfirm={confirmDeleteSession}
      onDismiss={closeDeleteDialog}
    >
      {#if deleteError}<div class="alert-error" role="alert">{deleteError}</div>{/if}
    </AppConfirmDialog>
  {/if}
</div>
