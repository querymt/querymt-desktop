<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import LeftRail from '$lib/components/shell/LeftRail.svelte';
  import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
  import Inspector from '$lib/components/shell/Inspector.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';
  import type { SectionName } from '$lib/design/tokens';
  import type { Snippet } from 'svelte';

  const { children } = $props<{ children?: Snippet }>();

  const routeToSection: Record<string, SectionName> = {
    '/': 'Today',
    '/inbox': 'Inbox',
    '/agents': 'Agents',
    '/sessions': 'Sessions',
    '/workspaces': 'Workspaces',
    '/automations': 'Automations',
    '/mesh': 'Mesh',
    '/settings': 'Settings'
  };

  const pathname = $derived(page.url.pathname);

  const section = $derived.by(() => {
    if (pathname.startsWith('/sessions/')) {
      return 'Sessions';
    }

    return routeToSection[pathname] ?? 'Today';
  });

  onMount(() => {
    void agentsStore.initialize();

    const onKeyDown = async (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        await goto('/');
        agentsStore.requestPromptFocus();
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        commandPaletteStore.openCommands();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
</script>

<div class="min-h-screen p-4 lg:p-6">
  <div class="grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_280px]">
     <LeftRail current={section} quiet={pathname === '/'} />
 
      <div class="flex min-w-0 flex-col gap-4">
        <main class="min-h-0 flex-1">
          {@render children?.()}
        </main>
        <CommandPalette />
      </div>



    <div class="hidden min-h-0 2xl:block">
      <Inspector />
    </div>
  </div>
</div>
