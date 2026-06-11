<script lang="ts">
  import { appMeta, sectionIcons, sectionOrder, type SectionName } from '$lib/design/tokens';

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

<nav class={`panel sticky top-6 self-start flex max-h-[calc(100vh-3rem)] flex-col gap-3 overflow-y-auto p-4 transition ${quiet ? 'opacity-55 hover:opacity-100' : ''}`}>
  <div class="mb-3 px-2">
    <div class="text-sm font-medium text-[var(--accent)]">{appMeta.title}</div>
    <div class="muted text-xs">{appMeta.subtitle}</div>
  </div>

  <div class="space-y-1">
    {#each sectionOrder as section}
      {@const Icon = sectionIcons[section]}
      <a
        class={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${current === section ? 'bg-[var(--accent-dim)] text-[var(--text)]' : 'text-slate-300 hover:bg-white/5'}`}
        href={routeMap[section]}
        aria-current={current === section ? 'page' : undefined}
      >
        <span class={`flex h-9 w-9 items-center justify-center rounded-2xl border ${current === section ? 'border-[var(--border-strong)] bg-black/20 text-[var(--accent)]' : 'border-white/8 bg-black/10 text-slate-400'}`}>
          <Icon size={16} />
        </span>
        <span class="flex-1">{section}</span>
      </a>
    {/each}
  </div>
</nav>
