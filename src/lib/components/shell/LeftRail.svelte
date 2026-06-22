<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { sectionIcons, sectionOrder, type SectionName } from '$lib/design/tokens';
  import { agentsStore } from '$lib/stores/agents.svelte';

  let { current, quiet = false, collapsed = false } = $props<{
    current: SectionName;
    quiet?: boolean;
    collapsed?: boolean;
  }>();

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

  const onlineAgentCount = $derived(agentsStore.connectedAgents.length);

  function getSectionLabel(section: SectionName): string {
    if (section === 'Agents' && onlineAgentCount > 0) {
      return `Agents, ${onlineAgentCount} online`;
    }

    return section;
  }
</script>

<Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
  <nav
    class={`panel left-rail sticky self-start flex max-h-[calc(100vh-2rem)] flex-col gap-3 overflow-visible p-4 transition ${quiet ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : ''} ${collapsed ? 'left-rail-collapsed' : ''}`}
    aria-label="Primary navigation"
  >
    <div class="left-rail-nav-items">
      {#each sectionOrder as section}
        {@const Icon = sectionIcons[section]}
        {#if collapsed}
          <Tooltip.Root>
            <Tooltip.Trigger>
              <a
                class={`left-rail-link ${current === section ? 'left-rail-link-active' : ''}`}
                href={routeMap[section]}
                aria-current={current === section ? 'page' : undefined}
                aria-label={getSectionLabel(section)}
              >
                <span class={`left-rail-link-icon ${current === section ? 'left-rail-link-icon-active' : ''}`}>
                  <Icon size={16} />
                  {#if section === 'Agents' && onlineAgentCount > 0}
                    <span class="left-rail-agent-count" aria-hidden="true">{onlineAgentCount}</span>
                  {/if}
                </span>
              </a>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="left-rail-tooltip" side="right" sideOffset={10}>
                {section}
                <Tooltip.Arrow class="left-rail-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        {:else}
          <a
            class={`left-rail-link ${current === section ? 'left-rail-link-active' : ''}`}
            href={routeMap[section]}
            aria-current={current === section ? 'page' : undefined}
          >
            <span class={`left-rail-link-icon ${current === section ? 'left-rail-link-icon-active' : ''}`}>
              <Icon size={16} />
              {#if section === 'Agents' && onlineAgentCount > 0}
                <span class="left-rail-agent-count" aria-label={`${onlineAgentCount} agents online`}>{onlineAgentCount}</span>
              {/if}
            </span>
            <span class="left-rail-link-label">{section}</span>
          </a>
        {/if}
      {/each}
    </div>
  </nav>
</Tooltip.Provider>
