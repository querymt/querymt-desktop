<script lang="ts">
  import { sectionIcons, sectionOrder, type SectionName } from '$lib/design/tokens';

  export let current: SectionName;
  export let quiet = false;

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

<nav class={`panel sticky top-6 self-start flex max-h-[calc(100vh-3rem)] flex-col gap-4 overflow-y-auto p-4 transition ${quiet ? 'opacity-80 hover:opacity-100' : ''}`}>
  <div class="space-y-1">
    {#each sectionOrder as section}
      {@const Icon = sectionIcons[section]}
      <a
        class={`flex items-center gap-3 rounded-full px-2.5 py-2 text-sm transition ${current === section ? 'bg-[var(--accent-dim)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]'}`}
        href={routeMap[section]}
        aria-current={current === section ? 'page' : undefined}
      >
        <span class={`flex h-9 w-9 items-center justify-center rounded-full border ${current === section ? 'border-[var(--rail)] bg-[var(--bg-card)] text-[var(--accent)]' : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--muted)]'}`}>
          <Icon size={16} />
        </span>
        <span class="flex-1">{section}</span>
      </a>
    {/each}
  </div>
</nav>
