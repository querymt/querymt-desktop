<script lang="ts">
  import { onMount } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { LoaderCircle } from '@lucide/svelte';
  import { sectionIcons, sectionOrder, type SectionName } from '$lib/design/tokens';
  import {
    formatSessionTimestamp,
    getRecentSessionRailItems,
    getSessionWorkspaceName,
    type SessionRailItem,
    type SessionRailTone
  } from '$lib/domain/sessions';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';
  import type { DesktopSessionSummary, SessionStatus } from '$lib/domain/types';

  const MAX_SESSION_ICONS = 10;
  const SESSION_ICON_REM = 2.4;
  const SESSION_ICON_GAP_REM = 0.52;

  let {
    current,
    sessions,
    attentionSessionKeys = [],
    currentAgentId = null,
    currentSessionId = null,
    onOpenSession = null,
    onVisibleSessionItemsChange = null
  }: {
    current: SectionName;
    sessions: DesktopSessionSummary[];
    attentionSessionKeys?: string[];
    currentAgentId?: string | null;
    currentSessionId?: string | null;
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

  const primarySections = sectionOrder.filter(
    (section): section is Exclude<SectionName, 'Today' | 'Settings'> => section !== 'Today' && section !== 'Settings'
  );
  const SettingsIcon = sectionIcons.Settings;
  let sessionListElement = $state<HTMLElement | null>(null);
  let sessionIconLimit = $state(MAX_SESSION_ICONS);
  const onlineAgentCount = $derived(agentsStore.connectedAgents.length);
  const visibleSessions = $derived.by(() =>
    sessions.filter((session) => !(session.agentId === currentAgentId && session.sessionId === currentSessionId))
  );
  const railItems = $derived(
    getRecentSessionRailItems(visibleSessions, {
      attentionSessionKeys,
      limit: sessionIconLimit
    })
  );

  $effect(() => {
    onVisibleSessionItemsChange?.(railItems);
  });

  onMount(() => {
    const updateSessionIconLimit = () => {
      if (!sessionListElement) {
        return;
      }

      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const iconHeight = SESSION_ICON_REM * rootFontSize;
      const iconGap = SESSION_ICON_GAP_REM * rootFontSize;
      const availableHeight = sessionListElement.clientHeight;
      const nextLimit = Math.max(0, Math.min(MAX_SESSION_ICONS, Math.floor((availableHeight + iconGap) / (iconHeight + iconGap))));
      sessionIconLimit = nextLimit;
    };

    updateSessionIconLimit();

    const resizeObserver = new ResizeObserver(updateSessionIconLimit);
    if (sessionListElement) {
      resizeObserver.observe(sessionListElement);
    }
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
    if (section === 'Agents' && onlineAgentCount > 0) {
      return `Agents, ${onlineAgentCount} online`;
    }

    return section;
  }

  function getSessionShortcutLabel(index: number): string {
    return index === 9 ? 'Ctrl/Cmd+0' : `Ctrl/Cmd+${index + 1}`;
  }

  function getSessionAriaShortcut(index: number): string {
    return index === 9 ? 'Control+0 Meta+0' : `Control+${index + 1} Meta+${index + 1}`;
  }

  function getStatusLabel(status: SessionStatus, tone: SessionRailTone): string {
    if (tone === 'attention') {
      return 'Needs review';
    }

    switch (status) {
      case 'thinking':
        return 'Active';
      case 'waiting':
        return 'Waiting';
      case 'cancelling':
        return 'Cancelling';
      case 'completed':
      case 'idle':
      default:
        return 'Recent';
    }
  }
</script>

<Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
  <nav class="app-icon-rail" aria-label="App navigation and recent sessions">
    <div class="app-icon-rail-top">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <a
              {...props}
              class={`app-icon-link app-icon-home ${current === 'Today' ? 'app-icon-link-current' : ''}`}
              href="/"
              aria-current={current === 'Today' ? 'page' : undefined}
              aria-label="Today"
            >
              <span class="app-icon-activity-pill" aria-hidden="true"></span>
              <span>Q</span>
            </a>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>
            Today
            <Tooltip.Arrow class="app-icon-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <div class="app-icon-nav-list">
        {#each primarySections as section}
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
                >
                  <span class="app-icon-activity-pill" aria-hidden="true"></span>
                  <span class="app-nav-icon-surface" aria-hidden="true">
                    <Icon size={16} />
                    {#if section === 'Agents' && onlineAgentCount > 0}
                      <span class="app-icon-agent-count" aria-hidden="true">{onlineAgentCount}</span>
                    {/if}
                  </span>
                </a>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>
                {getSectionLabel(section)}
                <Tooltip.Arrow class="app-icon-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        {/each}
      </div>

      <div class="app-icon-divider" role="separator" aria-label="Recent sessions"></div>
    </div>

    <div class="app-icon-rail-sessions" bind:this={sessionListElement}>
      {#if sessionIconLimit > 0}
        <div class="session-icon-rail-list">
          {#if railItems.length === 0}
            <span class="session-icon-rail-empty" aria-label="No recent active sessions"></span>
          {:else}
            {#each railItems as item, index (item.key)}
              {@const session = item.session}
              {@const identicon = createRoundIdenticon(session.sessionId)}
              <Tooltip.Root>
                <Tooltip.Trigger>
                  {#snippet child({ props })}
                    <a
                      {...props}
                      class={`session-icon-link session-icon-link-${item.tone}`}
                      href={getSessionHref(session)}
                      aria-label={`${session.title}, ${getStatusLabel(session.status, item.tone)}, ${getSessionShortcutLabel(index)}`}
                      aria-keyshortcuts={getSessionAriaShortcut(index)}
                      onclick={() => onOpenSession?.(session)}
                    >
                      <span class="app-icon-activity-pill" aria-hidden="true"></span>
                      <span class="session-icon-avatar" aria-hidden="true">
                        <svg width={identicon.width} height={identicon.width} viewBox={`0 0 ${identicon.width} ${identicon.width}`} preserveAspectRatio="xMinYMin">
                          <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill={identicon.color} />
                          <g fill="none" stroke={identicon.color} stroke-linecap="round" stroke-linejoin="round">
                            {#each identicon.arcs as arc}
                              <path d={arc.d} stroke-width={arc.strokeWidth} />
                            {/each}
                          </g>
                        </svg>
                      </span>
                      {#if item.tone === 'active'}
                        <span class="session-icon-status session-icon-status-active" aria-hidden="true">
                          <LoaderCircle size={10} class="animate-spin" />
                        </span>
                      {:else if item.tone === 'attention'}
                        <span class="session-icon-status session-icon-status-attention" aria-hidden="true"></span>
                      {/if}
                    </a>
                  {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content class="session-icon-tooltip" side="right" sideOffset={10}>
                    <div class="session-icon-tooltip-title">{session.title}</div>
                    <div class="session-icon-tooltip-meta">
                      {getStatusLabel(session.status, item.tone)} / {session.agentName} / {getSessionWorkspaceName(session.cwd)}
                    </div>
                    <div class="session-icon-tooltip-meta">{formatSessionTimestamp(session.updatedAt)} / {getSessionShortcutLabel(index)}</div>
                    <Tooltip.Arrow class="session-icon-tooltip-arrow" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <div class="app-icon-rail-bottom">
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <a
              {...props}
              class={`app-icon-link app-nav-icon-link app-icon-settings ${current === 'Settings' ? 'app-icon-link-current' : ''}`}
              href="/settings"
              aria-current={current === 'Settings' ? 'page' : undefined}
              aria-label="Settings"
            >
              <span class="app-icon-activity-pill" aria-hidden="true"></span>
              <span class="app-nav-icon-surface" aria-hidden="true">
                <SettingsIcon size={16} />
              </span>
            </a>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content class="app-icon-tooltip" side="right" sideOffset={10}>
            Settings
            <Tooltip.Arrow class="app-icon-tooltip-arrow" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  </nav>
</Tooltip.Provider>
