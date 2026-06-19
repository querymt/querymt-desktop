<script lang="ts">
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import { appMeta, sectionIcons, sectionOrder, type SectionName } from '$lib/design/tokens';

  export let current: SectionName;
  export let quiet = false;
  export let collapsed = false;
  export let onToggle: (() => void) | undefined = undefined;

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
</script>

<Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
  <nav
    class={`panel left-rail sticky top-6 self-start flex max-h-[calc(100vh-3rem)] flex-col gap-3 overflow-visible p-4 transition ${quiet ? 'opacity-55 hover:opacity-100 focus-within:opacity-100' : ''} ${collapsed ? 'left-rail-collapsed' : ''}`}
    aria-label="Primary navigation"
  >
    <div class="left-rail-header">
      <div class="left-rail-brand">
        <div class="left-rail-brand-mark" aria-hidden="true">Q</div>
        {#if !collapsed}
          <div class="left-rail-brand-copy">
            <div class="text-sm font-medium text-[var(--accent)]">{appMeta.title}</div>
            <div class="muted text-xs">{appMeta.subtitle}</div>
          </div>
        {:else}
          <span class="left-rail-active-label">{current}</span>
        {/if}
      </div>

      {#if onToggle}
        <button
          class="left-rail-header-toggle"
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          onclick={onToggle}
        >
          {#if collapsed}
            <ChevronRight size={14} strokeWidth={1.8} />
          {:else}
            <ChevronLeft size={14} strokeWidth={1.8} />
          {/if}
        </button>
      {/if}
    </div>

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
                aria-label={section}
              >
                <span class={`left-rail-link-icon ${current === section ? 'left-rail-link-icon-active' : ''}`}>
                  <Icon size={16} />
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
            </span>
            <span class="left-rail-link-label">{section}</span>
          </a>
        {/if}
      {/each}
    </div>
  </nav>
</Tooltip.Provider>
