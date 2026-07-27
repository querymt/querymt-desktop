<script lang="ts">
  import { onMount } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { ChevronLeft, ChevronRight, LoaderCircle, X } from '@lucide/svelte';
  import SidebarAttentionDot from '$lib/components/shell/SidebarAttentionDot.svelte';
  import { formatAriaShortcut, formatShortcut } from '$lib/design/platform';
  import { sectionIcons, type SectionName } from '$lib/design/tokens';
  import {
    formatSessionTimestamp,
    getRecentSessionRailItems,
    getSessionWorkspaceName,
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
    narrowOpen = false,
    onToggleCollapsed = null,
    onCloseNarrow = null,
    onOpenSession = null,
    onVisibleSessionItemsChange = null
  }: {
    current: SectionName;
    sessions: DesktopSessionSummary[];
    attentionSessionKeys?: string[];
    currentAgentId?: string | null;
    currentSessionId?: string | null;
    collapsed?: boolean;
    narrowOpen?: boolean;
    onToggleCollapsed?: (() => void) | null;
    onCloseNarrow?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
    onVisibleSessionItemsChange?: ((items: SessionRailItem[]) => void) | null;
  } = $props();

  const routeMap: Record<SectionName, string> = {
    Today: '/',
    Inbox: '/inbox',
    Agents: '/agents',
    Sessions: '/sessions',
    Workspaces: '/workspaces',
    Automations: '/automations',
    Mesh: '/mesh',
    Settings: '/settings'
  };
  const workSections: SectionName[] = ['Inbox', 'Sessions', 'Workspaces'];
  const manageSections: SectionName[] = ['Agents', 'Automations', 'Mesh'];
  const SettingsIcon = sectionIcons.Settings;

  let sessionListElement = $state<HTMLElement | null>(null);
  let sessionIconLimit = $state(MAX_SESSION_ICONS);
  const compact = $derived(collapsed && !narrowOpen);
  const onlineAgentCount = $derived(agentsStore.connectedAgents.length);
  const agentAttentionCount = $derived(agentsStore.agentsNeedingAttention.length);
  const inboxActionCount = $derived(inboxStore.actionableItems.length);
  const actionRequiredSessionKeys = $derived(
    inboxStore.actionableItems.flatMap((item) =>
      item.agentId && item.sessionId ? [`${item.agentId}:${item.sessionId}`] : []
    )
  );
  const visibleSessions = $derived.by(() =>
    sessions.filter((session) => !(session.agentId === currentAgentId && session.sessionId === currentSessionId))
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

  function getSectionLabel(section: SectionName): string {
    if (section === 'Inbox' && inboxActionCount > 0) {
      return `Inbox, ${inboxActionCount} ${inboxActionCount === 1 ? 'action' : 'actions'} required`;
    }
    if (section !== 'Agents') return section;

    const details: string[] = [];
    if (onlineAgentCount > 0) details.push(`${onlineAgentCount} online`);
    if (agentAttentionCount > 0) details.push(`${agentAttentionCount} need attention`);
    return details.length > 0 ? `Agents, ${details.join(', ')}` : 'Agents';
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

  function closeNarrow() {
    onCloseNarrow?.();
  }

  function openSession(session: DesktopSessionSummary) {
    onOpenSession?.(session);
    closeNarrow();
  }
</script>

{#snippet navIndicator(section: SectionName)}
  {#if section === 'Agents' && onlineAgentCount > 0}
    <span class="app-icon-agent-count" aria-hidden="true">{onlineAgentCount}</span>
  {/if}
  {#if section === 'Agents' && agentAttentionCount > 0}<SidebarAttentionDot />{/if}
  {#if section === 'Inbox' && inboxActionCount > 0}<SidebarAttentionDot />{/if}
{/snippet}

{#snippet expandedSection(sections: SectionName[], label: string)}
  <div class="app-sidebar-group">
    <div class="app-sidebar-group-label">{label}</div>
    {#each sections as section}
      {@const Icon = sectionIcons[section]}
      <a
        class={`app-sidebar-link ${current === section ? 'app-sidebar-link-current' : ''}`}
        href={routeMap[section]}
        aria-current={current === section ? 'page' : undefined}
        aria-label={getSectionLabel(section)}
        onclick={closeNarrow}
      >
        <span class="app-sidebar-link-icon"><Icon size={16} />{@render navIndicator(section)}</span>
        <span>{section}</span>
        {#if section === 'Inbox' && inboxActionCount > 0}<small>{inboxActionCount}</small>{/if}
        {#if section === 'Agents' && onlineAgentCount > 0}<small>{onlineAgentCount}</small>{/if}
      </a>
    {/each}
  </div>
{/snippet}

<Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
  <nav class={`app-sidebar ${compact ? 'app-sidebar-collapsed' : 'app-sidebar-expanded'} ${narrowOpen ? 'app-sidebar-narrow-open' : ''}`} aria-label="App navigation and recent sessions">
    {#if compact}
      <div class="app-icon-rail-top">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a {...props} class={`app-icon-link app-icon-home ${current === 'Today' ? 'app-icon-link-current' : ''}`} href="/" aria-current={current === 'Today' ? 'page' : undefined} aria-label="Today">
                <span class="app-icon-activity-pill" aria-hidden="true"></span><span>Q</span>
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>Today<Tooltip.Arrow class="app-icon-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root>

        <div class="app-icon-nav-list">
          {#each [...workSections, ...manageSections] as section}
            {@const Icon = sectionIcons[section]}
            <Tooltip.Root>
              <Tooltip.Trigger>
                {#snippet child({ props })}
                  <a {...props} class={`app-icon-link app-nav-icon-link ${current === section ? 'app-icon-link-current' : ''}`} href={routeMap[section]} aria-current={current === section ? 'page' : undefined} aria-label={getSectionLabel(section)}>
                    <span class="app-icon-activity-pill" aria-hidden="true"></span>
                    <span class="app-nav-icon-surface" aria-hidden="true"><Icon size={16} />{@render navIndicator(section)}</span>
                  </a>
                {/snippet}
              </Tooltip.Trigger>
              <Tooltip.Portal><Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>{getSectionLabel(section)}<Tooltip.Arrow class="app-icon-tooltip-arrow" /></Tooltip.Content></Tooltip.Portal>
            </Tooltip.Root>
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
                  <div class="session-icon-tooltip-meta">{getStatusLabel(session.status, item)} / {session.agentName} / {getSessionWorkspaceName(session.cwd)}</div>
                  <div class="session-icon-tooltip-meta">{formatSessionTimestamp(session.updatedAt)} / {getSessionShortcutLabel(index)}</div>
                  <Tooltip.Arrow class="session-icon-tooltip-arrow" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          {/each}
        </div>
      </div>

      <div class="app-icon-rail-bottom">
        <button class="app-icon-link app-sidebar-toggle-compact" type="button" aria-label="Expand sidebar" title="Expand sidebar" onclick={onToggleCollapsed}><ChevronRight size={16} /></button>
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
        <a class="app-sidebar-brand" href="/" aria-label="Today" onclick={closeNarrow}><span>Q</span><strong>QueryMT</strong></a>
        <button class="icon-btn app-sidebar-collapse" type="button" aria-label="Collapse sidebar" title="Collapse sidebar" onclick={onToggleCollapsed}><ChevronLeft size={16} /></button>
        <button class="icon-btn app-sidebar-narrow-close" type="button" aria-label="Close navigation" onclick={closeNarrow}><X size={17} /></button>
      </div>

      <div class="app-sidebar-navigation">
        {@render expandedSection(workSections, 'Work')}
        {@render expandedSection(manageSections, 'Manage')}
      </div>

      <div class="app-sidebar-recent" bind:this={sessionListElement}>
        <div class="app-sidebar-section-heading"><span>Recent sessions</span><a href="/sessions" onclick={closeNarrow}>View all</a></div>
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
        <a class={`app-sidebar-link ${current === 'Settings' ? 'app-sidebar-link-current' : ''}`} href="/settings" aria-current={current === 'Settings' ? 'page' : undefined} onclick={closeNarrow}>
          <span class="app-sidebar-link-icon"><SettingsIcon size={16} /></span><span>Settings</span>
        </a>
      </div>
    {/if}
  </nav>
</Tooltip.Provider>
