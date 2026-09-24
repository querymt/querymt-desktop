<script lang="ts">
  import { onMount } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { ChevronLeft, ChevronRight, LoaderCircle, Menu } from '@lucide/svelte';
  import SidebarAttentionDot from '$lib/components/shell/SidebarAttentionDot.svelte';
  import SessionIdChip from '$lib/components/primitives/SessionIdChip.svelte';
  import { autoCollapsePopover } from '$lib/design/details-popover';
  import { formatAriaShortcut, formatShortcut } from '$lib/design/platform';
  import { sectionIcons, type SectionName } from '$lib/design/tokens';
  import {
    formatSessionTimestamp,
    getRecentSessionRailItems,
    getSessionWorkspaceName,
    isRootSession,
    type SessionRailItem
  } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { inboxStore } from '$lib/stores/inbox.svelte';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';
  import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

  const MAX_SESSION_ICONS = 10;
  const SESSION_ICON_REM = 2.4;
  const SESSION_ICON_GAP_REM = 0.52;
  const SESSION_LIST_OFFSET_REM = 0.6;

  let {
    current,
    sessions,
    attentionSessionKeys = [],
    currentAgentId = null,
    currentSessionId = null,
    collapsed = false,
    collapseLocked = false,
    mobileHidden = false,
    onToggleCollapsed = null,
    onOpenSession = null,
    onVisibleSessionItemsChange = null
  }: {
    current: SectionName;
    sessions: DesktopSessionSummary[];
    attentionSessionKeys?: string[];
    currentAgentId?: string | null;
    currentSessionId?: string | null;
    collapsed?: boolean;
    collapseLocked?: boolean;
    mobileHidden?: boolean;
    onToggleCollapsed?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
    onVisibleSessionItemsChange?: ((items: SessionRailItem[]) => void) | null;
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
  const workSections: SectionName[] = ['Inbox', 'Sessions', 'Workspaces'];
  const manageSections: SectionName[] = ['Agents', 'Automations', 'Mesh'];
  const mobilePrimarySections: SectionName[] = ['Start', 'Inbox', 'Sessions', 'Agents'];
  const mobileMoreSections: SectionName[] = ['Workspaces', 'Automations', 'Mesh', 'Settings'];
  const SettingsIcon = sectionIcons.Settings;

  let sessionListElement = $state<HTMLElement | null>(null);
  let mobileNavigation = $state(false);
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
  const visibleSessions = $derived.by(() =>
    sessions
      .filter(isRootSession)
      .filter((session) => !(session.agentId === currentAgentId && session.sessionId === currentSessionId))
  );
  const railItems = $derived(
    getRecentSessionRailItems(visibleSessions, {
      attentionSessionKeys,
      actionRequiredSessionKeys,
      limit: compact ? sessionIconLimit : MAX_SESSION_ICONS
    })
  );

  $effect(() => {
    onVisibleSessionItemsChange?.(railItems);
  });

  onMount(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const updateMobileNavigation = () => (mobileNavigation = mediaQuery.matches);
    updateMobileNavigation();
    mediaQuery.addEventListener('change', updateMobileNavigation);
    return () => mediaQuery.removeEventListener('change', updateMobileNavigation);
  });

  onMount(() => {
    const updateSessionIconLimit = () => {
      if (!sessionListElement || !compact) return;
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const iconHeight = SESSION_ICON_REM * rootFontSize;
      const iconGap = SESSION_ICON_GAP_REM * rootFontSize;
      const availableHeight = Math.max(0, sessionListElement.clientHeight - SESSION_LIST_OFFSET_REM * rootFontSize);
      sessionIconLimit = Math.max(0, Math.min(MAX_SESSION_ICONS, Math.floor((availableHeight + iconGap) / (iconHeight + iconGap))));
    };

    updateSessionIconLimit();
    const resizeObserver = new ResizeObserver(updateSessionIconLimit);
    if (sessionListElement) resizeObserver.observe(sessionListElement);
    window.addEventListener('resize', updateSessionIconLimit);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSessionIconLimit);
    };
  });

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
    return getSectionLabel(section);
  }

  function getSessionShortcutLabel(index: number): string {
    return formatShortcut(index === 9 ? '0' : String(index + 1));
  }

  function getSessionAriaShortcut(index: number): string {
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
      {#if section === 'Agents' && configuredAgentCount > 0}
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class={`app-sidebar-link ${current === 'Agents' ? 'app-sidebar-link-current' : ''}`}
                href={routeMap.Agents}
                aria-current={current === 'Agents' ? 'page' : undefined}
                aria-label={getSectionLabel('Agents')}
                aria-describedby={AGENTS_STATUS_DESCRIPTION_ID}
              >
                <span class="app-sidebar-link-icon"><Icon size={16} />{@render navIndicator('Agents')}</span>
                <span>Agents</span>
                <small
                  class={`app-sidebar-agents-count ${onlineAgentCount > 0 ? 'app-sidebar-agents-count-active' : ''}`}
                  aria-hidden="true"
                >
                  <span class="app-sidebar-agents-count-n">{onlineAgentCount}</span> / {configuredAgentCount}
                </small>
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>
              {getAgentsStatus()}
              <Tooltip.Arrow class="app-icon-tooltip-arrow" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <span class="sr-only" id={AGENTS_STATUS_DESCRIPTION_ID}>{getAgentsStatus()}</span>
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
          {#if section === 'Mesh' && meshNodeCount > 0}<small>{meshNodeCount}</small>{/if}
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
                    aria-describedby={section === 'Agents' && configuredAgentCount > 0 ? AGENTS_STATUS_DESCRIPTION_ID : undefined}
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
            {/if}
          {/each}
        </div>
        <div class="app-icon-divider" role="separator" aria-label="Recent sessions"></div>
      </div>

      <div class="app-icon-rail-sessions" bind:this={sessionListElement}>
        <div class="session-icon-rail-list">
          {#each railItems as item, index (item.key)}
            {@const session = item.session}
            {@const identicon = createRoundIdenticon(session.sessionId)}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <a {...props} class={`session-icon-link ${item.isActive ? 'session-icon-link-active' : ''}`} href={getSessionHref(session)} aria-label={`${session.title}, ${getStatusLabel(session.status, item)}, ${getSessionShortcutLabel(index)}`} aria-keyshortcuts={getSessionAriaShortcut(index)} onclick={() => openSession(session)}>
                    <span class="app-icon-activity-pill" aria-hidden="true"></span>
                    <span class="session-icon-surface" aria-hidden="true">
                      <span class="session-icon-avatar">
                        <svg class="session-identicon-svg" style={`--identicon-color: ${identicon.color}`} width={identicon.width} height={identicon.width} viewBox={`0 0 ${identicon.width} ${identicon.width}`} preserveAspectRatio="xMinYMin">
                          <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill="currentColor" />
                          <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{#each identicon.arcs as arc}<path d={arc.d} stroke-width={arc.strokeWidth} />{/each}</g>
                        </svg>
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
                  <div class="session-icon-tooltip-meta">{getStatusLabel(session.status, item)}{#if onlineAgentCount > 1} / {session.agentName}{/if} / {getSessionWorkspaceName(session.cwd)}</div>
                  <div class="session-icon-tooltip-meta">{formatSessionTimestamp(session.updatedAt)} / <SessionIdChip sessionId={session.sessionId} /> / {getSessionShortcutLabel(index)}</div>
                  <Tooltip.Arrow class="session-icon-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
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

      <div class="app-sidebar-recent" bind:this={sessionListElement}>
        <div class="app-sidebar-section-heading"><span>Recent sessions</span><a href="/sessions">View all</a></div>
        <div class="app-sidebar-session-list">
          {#if railItems.length === 0}
            <div class="app-sidebar-empty">No recent sessions</div>
          {:else}
            {#each railItems as item, index (item.key)}
              {@const session = item.session}
              {@const identicon = createRoundIdenticon(session.sessionId)}
              <a class={`app-sidebar-session ${item.isActive ? 'app-sidebar-session-active' : ''}`} href={getSessionHref(session)} aria-label={`${session.title}, ${getStatusLabel(session.status, item)}, ${getSessionShortcutLabel(index)}`} aria-keyshortcuts={getSessionAriaShortcut(index)} onclick={() => openSession(session)}>
                <span class="app-sidebar-session-avatar" aria-hidden="true">
                  <svg class="session-identicon-svg" style={`--identicon-color: ${identicon.color}`} width={identicon.width} height={identicon.width} viewBox={`0 0 ${identicon.width} ${identicon.width}`} preserveAspectRatio="xMinYMin">
                    <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill="currentColor" />
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">{#each identicon.arcs as arc}<path d={arc.d} stroke-width={arc.strokeWidth} />{/each}</g>
                  </svg>
                  {#if item.isActive}<span class="app-sidebar-session-spinner"><LoaderCircle size={9} class="animate-spin" /></span>{/if}
                  {#if item.requiresAttention}<SidebarAttentionDot />{/if}
                </span>
                <span class="app-sidebar-session-copy"><strong>{session.title}</strong><small>{getSessionWorkspaceName(session.cwd)} · {getStatusLabel(session.status, item)}</small></span>
                <kbd>{index === 9 ? '0' : index + 1}</kbd>
              </a>
            {/each}
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
