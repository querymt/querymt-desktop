<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { ChevronLeft, ChevronRight, LoaderCircle, Menu, Pin } from '@lucide/svelte';
  import SidebarAttentionDot from '$lib/components/shell/SidebarAttentionDot.svelte';
  import SessionIdChip from '$lib/components/primitives/SessionIdChip.svelte';
  import SessionActionsMenu from '$lib/components/primitives/SessionActionsMenu.svelte';
  import { autoCollapsePopover } from '$lib/design/details-popover';
  import { formatAriaShortcut, formatShortcut } from '$lib/design/platform';
  import { sectionIcons, type SectionName } from '$lib/design/tokens';
  import {
    compareSessionsByPin,
    formatSessionTimestamp,
    getRecentSessionRailItems,
    getSessionWorkspaceName,
    isRootSession,
    sessionMatchesLifecycle,
    type SessionRailItem
  } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { inboxStore } from '$lib/stores/inbox.svelte';
  import Identicon from '$lib/components/primitives/Identicon.svelte';
  import type { DesktopSessionSummary, SessionLifecyclePatch, SessionStatus } from '$lib/domain/types';

  const MAX_SESSION_ICONS = 10;
  const SESSION_PAGE_SIZE = 20;
  const SESSION_ICON_REM = 2.4;
  const SESSION_ICON_GAP_REM = 0.52;
  const SESSION_LIST_OFFSET_REM = 0.6;

  let {
    current,
    sessions,
    showPinnedSessions = false,
    pinnedSessions = [], pinLoadError = null, onRetryPins = null,
    canPinSession = null, onSetPinned = null, pinPending = {}, pinErrors = {},
    attentionSessionKeys = [],
    currentAgentId = null,
    currentSessionId = null,
    collapsed = false,
    collapseLocked = false,
    mobileHidden = false,
    onToggleCollapsed = null,
    onOpenSession = null,
    onVisibleSessionItemsChange = null,
    canManageLifecycle = null,
    lifecyclePending = {},
    lifecycleErrors = {},
    onSetLifecycle = null,
    hasMoreSessions = false,
    loadingMoreSessions = false,
    sessionsLoadError = null,
    onLoadMoreSessions = null
  }: {
    current: SectionName;
    sessions: DesktopSessionSummary[];
    showPinnedSessions?: boolean;
    pinnedSessions?: DesktopSessionSummary[];
    pinLoadError?: string | null;
    onRetryPins?: (() => void | Promise<void>) | null;
    canPinSession?: ((session: DesktopSessionSummary) => boolean) | null;
    onSetPinned?: ((session: DesktopSessionSummary, pinned: boolean) => Promise<unknown>) | null;
    pinPending?: Record<string, boolean>;
    pinErrors?: Record<string, string | null>;
    attentionSessionKeys?: string[];
    currentAgentId?: string | null;
    currentSessionId?: string | null;
    collapsed?: boolean;
    collapseLocked?: boolean;
    mobileHidden?: boolean;
    onToggleCollapsed?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
    onVisibleSessionItemsChange?: ((items: SessionRailItem[]) => void) | null;
    canManageLifecycle?: ((session: DesktopSessionSummary) => boolean) | null;
    lifecyclePending?: Record<string, boolean>;
    lifecycleErrors?: Record<string, string | null>;
    onSetLifecycle?: ((session: DesktopSessionSummary, patch: SessionLifecyclePatch) => Promise<unknown>) | null;
    hasMoreSessions?: boolean;
    loadingMoreSessions?: boolean;
    sessionsLoadError?: string | null;
    onLoadMoreSessions?: (() => Promise<void>) | null;
  } = $props();

  const routeMap: Record<SectionName, string> = {
    Start: '/',
    Inbox: '/inbox',
    Agents: '/agents',
    Sessions: '/sessions',
    Workspaces: '/workspaces',
    Automations: '/automations',
    Mesh: '/mesh',
    Settings: '/settings'
  };
  // Bits UI 2.19 attaches aria-describedby itself, but its popper layer never applies the
  // content id, so the trigger ends up with an empty, invalid aria-describedby while open.
  // Point at a persistent visually hidden description instead; it must not collide with the
  // expanded and collapsed rails because only one renders at a time.
  const AGENTS_STATUS_DESCRIPTION_ID = 'app-sidebar-agents-status-description';
  const MESH_STATUS_DESCRIPTION_ID = 'app-sidebar-mesh-status-description';
  const workSections: SectionName[] = ['Inbox', 'Sessions', 'Workspaces'];
  const manageSections: SectionName[] = ['Agents', 'Automations', 'Mesh'];
  const mobilePrimarySections: SectionName[] = ['Start', 'Inbox', 'Sessions', 'Agents'];
  const mobileMoreSections: SectionName[] = ['Workspaces', 'Automations', 'Mesh', 'Settings'];
  const SettingsIcon = sectionIcons.Settings;

  let sessionListElement = $state<HTMLElement | null>(null);
  let mobileNavigation = $state(false);
  let menuSessionKey = $state<string | null>(null);
  let expandedSessionLimit = $state(SESSION_PAGE_SIZE);
  let pinnedLimit = $state(5);
  let requestingMore = $state(false);
  let loadError = $state<string | null>(null);

  function openSessionMenu(event: MouseEvent | KeyboardEvent, key: string) {
    if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    menuSessionKey = key;
  }
  let sessionIconLimit = $state(MAX_SESSION_ICONS);
  const compact = $derived(collapsed);
  const onlineAgentCount = $derived(agentsStore.connectedAgents.length);
  const configuredAgentCount = $derived(agentsStore.configs.length);
  const agentAttentionCount = $derived(agentsStore.agentsNeedingAttention.length);
  const inboxActionCount = $derived(inboxStore.actionableItems.length);
  const meshNodeCount = $derived(agentsStore.meshNodeCount);
  const actionRequiredSessionKeys = $derived(
    inboxStore.actionableItems.flatMap((item) =>
      item.agentId && item.sessionId ? [`${item.agentId}:${item.sessionId}`] : []
    )
  );
  const pinnedRoots = $derived(showPinnedSessions ? pinnedSessions.filter((session) => isRootSession(session) && session.pin?.pinned &&
    sessionMatchesLifecycle(session.lifecycle, { resolution: 'any', archive: 'excluded' })).slice().sort(compareSessionsByPin) : []);
  const pinnedKeys = $derived(new Set(pinnedRoots.map((session) => `${session.agentId}:${session.sessionId}`)));
  const pinnedRailItems = $derived.by(() => {
    const items = getRecentSessionRailItems(pinnedRoots, { attentionSessionKeys, actionRequiredSessionKeys, limit: pinnedRoots.length });
    const byKey = new Map(items.map((item) => [item.key, item]));
    return pinnedRoots.map((session) => byKey.get(`${session.agentId}:${session.sessionId}`)!);
  });
  const visibleSessions = $derived.by(() =>
    sessions
      .filter(isRootSession)
      .filter((session) => !pinnedKeys.has(`${session.agentId}:${session.sessionId}`))
      .filter((session) => sessionMatchesLifecycle(session.lifecycle, { resolution: 'open', archive: 'excluded' }))
      .filter((session) => !(session.agentId === currentAgentId && session.sessionId === currentSessionId))
  );
  const openRailItems = $derived(
    getRecentSessionRailItems(visibleSessions, {
      attentionSessionKeys,
      actionRequiredSessionKeys,
      limit: compact ? sessionIconLimit : expandedSessionLimit
    })
  );

  const visiblePinnedItems = $derived.by(() => {
    const limit = compact ? sessionIconLimit : pinnedLimit;
    const visible = pinnedRailItems.slice(0, limit);
    const current = pinnedRailItems.find((item) => item.session.agentId === currentAgentId && item.session.sessionId === currentSessionId);
    // Reserve the last visible slot for the current pin without changing pin-time order.
    if (limit > 0 && current && !visible.includes(current)) return [...visible.slice(0, limit - 1), current];
    return visible;
  });
  const railItems = $derived(compact ? [...visiblePinnedItems, ...openRailItems].slice(0, sessionIconLimit) : [...visiblePinnedItems, ...openRailItems]);

  $effect(() => {
    onVisibleSessionItemsChange?.(railItems.slice(0, MAX_SESSION_ICONS));
  });

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const updateMobileNavigation = () => (mobileNavigation = mediaQuery.matches);
    updateMobileNavigation();
    mediaQuery.addEventListener('change', updateMobileNavigation);
    return () => mediaQuery.removeEventListener('change', updateMobileNavigation);
  });

  $effect(() => {
    const element = sessionListElement;
    const isCompact = compact;
    if (!element) return;
    const updateSessionIconLimit = () => {
      if (!isCompact) {
        void loadNearBottom();
        return;
      }
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const iconHeight = SESSION_ICON_REM * rootFontSize;
      const iconGap = SESSION_ICON_GAP_REM * rootFontSize;
      const availableHeight = Math.max(0, element.clientHeight - SESSION_LIST_OFFSET_REM * rootFontSize);
      sessionIconLimit = Math.max(0, Math.min(MAX_SESSION_ICONS, Math.floor((availableHeight + iconGap) / (iconHeight + iconGap))));
    };

    untrack(updateSessionIconLimit);
    const resizeObserver = new ResizeObserver(updateSessionIconLimit);
    resizeObserver.observe(element);
    window.addEventListener('resize', updateSessionIconLimit);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSessionIconLimit);
    };
  });

  $effect(() => {
    void railItems.length;
    void hasMoreSessions;
    void loadingMoreSessions;
    void sessionsLoadError;
    void compact;
    void mobileNavigation;
    const frame = requestAnimationFrame(() => { void loadNearBottom(); });
    return () => cancelAnimationFrame(frame);
  });

  async function loadNearBottom(retry = false) {
    const element = sessionListElement;
    if (compact || mobileNavigation || !element || requestingMore || loadingMoreSessions) return;
    if (!retry && (element.clientHeight <= 0 || element.scrollHeight <= 0 ||
      element.scrollHeight - element.scrollTop - element.clientHeight > 120)) return;
    if (railItems.length < visibleSessions.length) {
      expandedSessionLimit += SESSION_PAGE_SIZE;
      return;
    }
    if (!onLoadMoreSessions || !hasMoreSessions || (!retry && (sessionsLoadError || loadError))) return;
    requestingMore = true;
    loadError = null;
    try {
      await onLoadMoreSessions();
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Could not load more sessions.';
    } finally {
      requestingMore = false;
    }
  }

  function getSessionHref(session: DesktopSessionSummary): string {
    return `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`;
  }

  function getAgentsAccessibleName(): string {
    return agentAttentionCount > 0 ? `Agents, ${agentAttentionCount} need attention` : 'Agents';
  }

  function getAgentsStatus(): string {
    const active = `${onlineAgentCount} ${onlineAgentCount === 1 ? 'agent' : 'agents'} active`;
    const available = `${configuredAgentCount} ${configuredAgentCount === 1 ? 'agent' : 'agents'} available`;
    return `${active}, ${available}`;
  }

  function getMeshStatus(): string {
    return `${meshNodeCount} ${meshNodeCount === 1 ? 'node' : 'nodes'} available`;
  }

  function getSectionLabel(section: SectionName): string {
    if (section === 'Inbox' && inboxActionCount > 0) {
      return `Inbox, ${inboxActionCount} ${inboxActionCount === 1 ? 'action' : 'actions'} required`;
    }
    if (section === 'Mesh' && meshNodeCount > 0) {
      return `Mesh, ${meshNodeCount} ${meshNodeCount === 1 ? 'node' : 'nodes'}`;
    }
    if (section !== 'Agents') return section;
    return getAgentsAccessibleName();
  }

  function getSectionTooltip(section: SectionName): string {
    if (section === 'Agents' && configuredAgentCount > 0) return `Agents, ${getAgentsStatus()}`;
    if (section === 'Mesh' && meshNodeCount > 0) return `Mesh, ${getMeshStatus()}`;
    return getSectionLabel(section);
  }

  function getSessionShortcutLabel(index: number): string {
    if (index >= MAX_SESSION_ICONS) return '';
    return formatShortcut(index === 9 ? '0' : String(index + 1));
  }

  function getSessionAriaShortcut(index: number): string | undefined {
    if (index >= MAX_SESSION_ICONS) return undefined;
    return formatAriaShortcut(index === 9 ? '0' : String(index + 1));
  }

  function getStatusLabel(status: SessionStatus, item: SessionRailItem): string {
    const activity = status === 'thinking' ? 'Active' : status === 'waiting' ? 'Waiting' : status === 'cancelling' ? 'Cancelling' : item.requiresAttention ? null : 'Recent';
    if (item.requiresAttention) return activity ? `${activity}, action required` : 'Action required';
    return activity ?? 'Recent';
  }

  function openSession(session: DesktopSessionSummary) {
    onOpenSession?.(session);
  }
</script>

{#snippet sessionMenu(session: DesktopSessionSummary, key: string)}
  <SessionActionsMenu
    {session}
    bind:open={() => menuSessionKey === key, (value) => (menuSessionKey = value ? key : null)}
    canManage={canManageLifecycle?.(session) ?? false}
    canPin={canPinSession?.(session) ?? false}
    onSetPinned={onSetPinned ? (pinned) => onSetPinned!(session, pinned) : null}
    pending={pinPending[key] || lifecyclePending[key]}
    error={pinErrors[key] || lifecycleErrors[key]}
    onSetLifecycle={onSetLifecycle ? (patch) => onSetLifecycle!(session, patch) : null}
  />
{/snippet}

{#snippet navIndicator(section: SectionName)}
  {#if section === 'Agents' && compact && onlineAgentCount > 0}
    <span class="app-icon-agent-count" aria-hidden="true">{onlineAgentCount}</span>
  {/if}
  {#if section === 'Mesh' && compact && meshNodeCount > 0}
    <span class="app-icon-agent-count" aria-hidden="true">{meshNodeCount}</span>
  {/if}
  {#if section === 'Agents' && agentAttentionCount > 0}<SidebarAttentionDot />{/if}
  {#if section === 'Inbox' && inboxActionCount > 0}<SidebarAttentionDot />{/if}
{/snippet}

{#snippet expandedSection(sections: SectionName[], label: string)}
  <div class="app-sidebar-group">
    <div class="app-sidebar-group-label">{label}</div>
    {#each sections as section}
      {@const Icon = sectionIcons[section]}
      {#if (section === 'Agents' && configuredAgentCount > 0) || (section === 'Mesh' && meshNodeCount > 0)}
        {@const status = section === 'Agents' ? getAgentsStatus() : getMeshStatus()}
        {@const descriptionId = section === 'Agents' ? AGENTS_STATUS_DESCRIPTION_ID : MESH_STATUS_DESCRIPTION_ID}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class={`app-sidebar-link ${current === section ? 'app-sidebar-link-current' : ''}`}
                href={routeMap[section]}
                aria-current={current === section ? 'page' : undefined}
                aria-label={getSectionLabel(section)}
                aria-describedby={descriptionId}
              >
                <span class="app-sidebar-link-icon"><Icon size={16} />{@render navIndicator(section)}</span>
                <span>{section}</span>
                {#if section === 'Agents'}
                  <small
                    class={`app-sidebar-agents-count ${onlineAgentCount > 0 ? 'app-sidebar-agents-count-active' : ''}`}
                    aria-hidden="true"
                  >
                    <span class="app-sidebar-agents-count-n">{onlineAgentCount}</span> / {configuredAgentCount}
                  </small>
                {:else}
                  <small aria-hidden="true">{meshNodeCount}</small>
                {/if}
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>
              {status}
              <Tooltip.Arrow class="app-icon-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span class="sr-only" id={descriptionId}>{status}</span>
      {:else}
        <a
          class={`app-sidebar-link ${current === section ? 'app-sidebar-link-current' : ''}`}
          href={routeMap[section]}
          aria-current={current === section ? 'page' : undefined}
          aria-label={getSectionLabel(section)}
        >
          <span class="app-sidebar-link-icon"><Icon size={16} />{@render navIndicator(section)}</span>
          <span>{section}</span>
          {#if section === 'Inbox' && inboxActionCount > 0}<small>{inboxActionCount}</small>{/if}
        </a>
      {/if}
    {/each}
  </div>
{/snippet}

<Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
  <nav
    class={`app-sidebar ${compact ? 'app-sidebar-collapsed' : 'app-sidebar-expanded'}`}
    aria-label="App navigation and recent sessions"
    aria-hidden={mobileNavigation ? 'true' : undefined}
    inert={mobileNavigation}
  >
    {#if compact}
      <div class="app-icon-rail-top">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a {...props} class={`app-icon-link app-icon-home ${current === 'Start' ? 'app-icon-link-current' : ''}`} href="/" aria-current={current === 'Start' ? 'page' : undefined} aria-label="Start">
                <span class="app-icon-activity-pill" aria-hidden="true"></span><span>Q</span>
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>Start<Tooltip.Arrow class="app-icon-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>

        <div class="app-icon-nav-list">
          {#each [...workSections, ...manageSections] as section}
            {@const Icon = sectionIcons[section]}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <a
                    {...props}
                    class={`app-icon-link app-nav-icon-link ${current === section ? 'app-icon-link-current' : ''}`}
                    href={routeMap[section]}
                    aria-current={current === section ? 'page' : undefined}
                    aria-label={getSectionLabel(section)}
                    aria-describedby={section === 'Agents' && configuredAgentCount > 0 ? AGENTS_STATUS_DESCRIPTION_ID :
                      section === 'Mesh' && meshNodeCount > 0 ? MESH_STATUS_DESCRIPTION_ID : undefined}
                  >
                    <span class="app-icon-activity-pill" aria-hidden="true"></span>
                    <span class="app-nav-icon-surface" aria-hidden="true"><Icon size={16} />{@render navIndicator(section)}</span>
                  </a>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Portal><Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>{getSectionTooltip(section)}<Tooltip.Arrow class="app-icon-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
            </Tooltip.Root>
            {#if section === 'Agents' && configuredAgentCount > 0}
              <span class="sr-only" id={AGENTS_STATUS_DESCRIPTION_ID}>{getAgentsStatus()}</span>
            {:else if section === 'Mesh' && meshNodeCount > 0}
              <span class="sr-only" id={MESH_STATUS_DESCRIPTION_ID}>{getMeshStatus()}</span>
            {/if}
          {/each}
        </div>
        <div class="app-icon-divider" role="separator" aria-label="Recent sessions"></div>
      </div>

      <div class="app-icon-rail-sessions" bind:this={sessionListElement}>
        <div class="session-icon-rail-list">
          {#each railItems as item, index (item.key)}
            {@const session = item.session}
            {#if index === visiblePinnedItems.length && index > 0}<div class="app-icon-divider" role="separator" aria-label="Open sessions"></div>{/if}

            <div class="session-rail-entry session-rail-entry-compact" class:session-rail-entry-menu-open={menuSessionKey === item.key} role="group" aria-label={`Session ${session.title}`}>
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <a {...props} class="session-icon-link" href={getSessionHref(session)} aria-current={pinnedKeys.has(item.key) && session.agentId === currentAgentId && session.sessionId === currentSessionId ? 'page' : undefined} aria-label={`${session.title}, ${getStatusLabel(session.status, item)}${index < MAX_SESSION_ICONS ? `, ${getSessionShortcutLabel(index)}` : ''}`} aria-keyshortcuts={getSessionAriaShortcut(index)} oncontextmenu={(event) => openSessionMenu(event, item.key)} onkeydown={(event) => openSessionMenu(event, item.key)} onclick={() => openSession(session)}>
                    <span class="session-icon-surface" aria-hidden="true">
                      <span class="session-icon-avatar">
                        <Identicon seed={session.sessionId} />
                      </span>
                      {#if item.isActive}<span class="session-icon-status session-icon-status-active"><LoaderCircle size={10} class="animate-spin" /></span>{/if}
                      {#if item.requiresAttention}<SidebarAttentionDot />{/if}
                    </span>
                  </a>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content class="session-icon-tooltip" side="right" sideOffset={10}>
                  <div class="session-icon-tooltip-title">{session.title}</div>
                  {#if pinnedKeys.has(item.key)}<div class="session-icon-tooltip-meta">Pinned</div>{/if}
                  {#if !session.lifecycle}<div class="session-icon-tooltip-meta">Lifecycle unavailable</div>{/if}
                  <div class="session-icon-tooltip-meta">{getStatusLabel(session.status, item)}{#if onlineAgentCount > 1} / {session.agentName}{/if} / {getSessionWorkspaceName(session.cwd)}</div>
                  <div class="session-icon-tooltip-meta">{formatSessionTimestamp(session.updatedAt)} / <SessionIdChip sessionId={session.sessionId} /> / {getSessionShortcutLabel(index)}</div>
                  <Tooltip.Arrow class="session-icon-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            {@render sessionMenu(session, item.key)}
            </div>
          {/each}
        </div>
      </div>

      <div class="app-icon-rail-bottom">
        {#if !collapseLocked}<button class="app-icon-link app-sidebar-toggle-compact" type="button" aria-label="Expand sidebar" title="Expand sidebar" onclick={onToggleCollapsed}><ChevronRight size={16} /></button>{/if}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a {...props} class={`app-icon-link app-nav-icon-link ${current === 'Settings' ? 'app-icon-link-current' : ''}`} href="/settings" aria-current={current === 'Settings' ? 'page' : undefined} aria-label="Settings">
                <span class="app-icon-activity-pill" aria-hidden="true"></span><span class="app-nav-icon-surface" aria-hidden="true"><SettingsIcon size={16} /></span>
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>Settings<Tooltip.Arrow class="app-icon-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>
      </div>
    {:else}
      <div class="app-sidebar-header">
        <a class="app-sidebar-brand" href="/" aria-label="Start">
          <span>Q</span>
          <span class="app-sidebar-brand-copy"><strong>QueryMT</strong><small>Agents command and control</small></span>
        </a>
        <button class="icon-btn app-sidebar-collapse" type="button" aria-label="Collapse sidebar" title="Collapse sidebar" onclick={onToggleCollapsed}><ChevronLeft size={16} /></button>
      </div>

      <div class="app-sidebar-navigation">
        {@render expandedSection(workSections, 'Work')}
        {@render expandedSection(manageSections, 'Manage')}
      </div>

      <div class="app-sidebar-recent">
        <div class="app-sidebar-session-list" bind:this={sessionListElement} onscroll={() => { void loadNearBottom(); }} aria-label={pinnedRoots.length ? 'Pinned and open sessions' : 'Open sessions'} aria-busy={loadingMoreSessions || requestingMore}>
          {#if showPinnedSessions && pinLoadError}<div class="app-sidebar-session-load-error"><span>{pinLoadError}</span><button type="button" onclick={() => onRetryPins?.()}>Retry pins</button></div>{/if}
          {#if !railItems.length}<div class="app-sidebar-section-heading"><span>Open sessions</span></div>{/if}
          {#if railItems.length === 0 && !hasMoreSessions && !loadingMoreSessions}
            <div class="app-sidebar-empty">No open sessions</div>
          {:else}
            {#each railItems as item, index (item.key)}
              {@const session = item.session}
              {#if index === 0 && visiblePinnedItems.length}<div class="app-sidebar-section-heading app-sidebar-pinned-heading"><Pin size={12} /><span>Pinned</span></div>{/if}
              {#if index === visiblePinnedItems.length}<div class="app-sidebar-section-heading"><span>Open sessions</span></div>{/if}
              <div class="session-rail-entry" class:session-rail-entry-menu-open={menuSessionKey === item.key} role="group" aria-label={`Session ${session.title}`}>
              <a class="app-sidebar-session" href={getSessionHref(session)} aria-current={pinnedKeys.has(item.key) && session.agentId === currentAgentId && session.sessionId === currentSessionId ? 'page' : undefined} aria-label={`${session.title}, ${getStatusLabel(session.status, item)}${index < MAX_SESSION_ICONS ? `, ${getSessionShortcutLabel(index)}` : ''}`} aria-keyshortcuts={getSessionAriaShortcut(index)} oncontextmenu={(event) => openSessionMenu(event, item.key)} onkeydown={(event) => openSessionMenu(event, item.key)} onclick={() => openSession(session)}>
                <span class="app-sidebar-session-avatar" aria-hidden="true">
                  <Identicon seed={session.sessionId} />
                  {#if item.isActive}<span class="app-sidebar-session-spinner"><LoaderCircle size={9} class="animate-spin" /></span>{/if}
                  {#if item.requiresAttention}<SidebarAttentionDot />{/if}
                </span>
                <span class="app-sidebar-session-copy"><strong>{session.title}</strong><small>{getSessionWorkspaceName(session.cwd)} · {getStatusLabel(session.status, item)}{#if !session.lifecycle} · Lifecycle unavailable{/if}</small></span>
              </a>
              {@render sessionMenu(session, item.key)}
              </div>
              {#if index === visiblePinnedItems.length - 1 && pinnedRailItems.length > pinnedLimit}
                <button class="app-sidebar-show-more" type="button" onclick={() => pinnedLimit += 5}>Show more pinned</button>
              {/if}
            {/each}
            {#if visiblePinnedItems.length && openRailItems.length === 0}<div class="app-sidebar-section-heading"><span>Open sessions</span></div><div class="app-sidebar-empty">No open sessions</div>{/if}
          {/if}
          {#if sessionsLoadError || loadError}
            <div class="app-sidebar-session-load-error"><span>{sessionsLoadError || loadError}</span><button type="button" onclick={() => { void loadNearBottom(true); }}>Retry</button></div>
          {:else if loadingMoreSessions || requestingMore}
            <div class="app-sidebar-session-loading" role="status"><LoaderCircle size={13} class="animate-spin" /><span class="sr-only">Loading more open sessions</span></div>
          {/if}
        </div>
      </div>

      <div class="app-sidebar-footer">
        <a class={`app-sidebar-link ${current === 'Settings' ? 'app-sidebar-link-current' : ''}`} href="/settings" aria-current={current === 'Settings' ? 'page' : undefined}>
          <span class="app-sidebar-link-icon"><SettingsIcon size={16} /></span><span>Settings</span>
        </a>
      </div>
    {/if}
  </nav>

  {#if mobileNavigation && !mobileHidden}
    <nav class="app-mobile-nav" aria-label="App navigation">
      {#each mobilePrimarySections as section}
        {@const Icon = sectionIcons[section]}
        <a
          class={`app-mobile-nav-link ${current === section ? 'app-mobile-nav-link-current' : ''}`}
          href={routeMap[section]}
          aria-current={current === section ? 'page' : undefined}
          aria-label={getSectionLabel(section)}
        >
          <span class="app-mobile-nav-icon"><Icon size={19} />{@render navIndicator(section)}</span>
          <span>{section}</span>
        </a>
      {/each}

      <details class="app-mobile-more" use:autoCollapsePopover>
        <summary
          class={`app-mobile-nav-link ${mobileMoreSections.includes(current) ? 'app-mobile-nav-link-current' : ''}`}
          aria-label="More sections"
        >
          <span class="app-mobile-nav-icon"><Menu size={19} /></span>
          <span>More</span>
        </summary>
        <div class="app-mobile-more-panel">
          <div class="app-mobile-more-heading">More</div>
          <div class="app-mobile-more-grid">
            {#each mobileMoreSections as section}
              {@const Icon = sectionIcons[section]}
              <a
                class={`app-mobile-more-link ${current === section ? 'app-mobile-more-link-current' : ''}`}
                href={routeMap[section]}
                aria-current={current === section ? 'page' : undefined}
                aria-label={getSectionLabel(section)}
                onclick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}
              >
                <span class="app-mobile-more-icon"><Icon size={18} />{@render navIndicator(section)}</span>
                <span>{section}</span>
              </a>
            {/each}
          </div>
        </div>
      </details>
    </nav>
  {/if}
</Tooltip.Provider>
