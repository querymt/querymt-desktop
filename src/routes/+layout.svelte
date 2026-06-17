<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Maximize, Minimize, X } from '@lucide/svelte';
  import LeftRail from '$lib/components/shell/LeftRail.svelte';
  import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
  import Inspector from '$lib/components/shell/Inspector.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { appearanceStore } from '$lib/stores/appearance.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';
  import type { SectionName } from '$lib/design/tokens';
  import type { Snippet } from 'svelte';

  const { children } = $props<{ children?: Snippet }>();

  let windowMaximized = $state(false);
  let isMacPlatform = $state(false);

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
    appearanceStore.initialize();
    void agentsStore.initialize();
    void windowDecorationsStore.initialize();

    isMacPlatform = navigator.platform.toLowerCase().includes('mac');

    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    if ('__TAURI_INTERNALS__' in window) {
      void currentWindow().then(async (appWindow) => {
        const updateMaximized = async () => {
          windowMaximized = await appWindow.isMaximized();
        };
        await updateMaximized();
        unlistenResize = await appWindow.onResized(updateMaximized);
        unlistenFocus = await appWindow.onFocusChanged(updateMaximized);
      });
    }

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
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unlistenResize?.();
      unlistenFocus?.();
    };
  });

  async function currentWindow() {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  }

  async function minimizeWindow() {
    await (await currentWindow()).minimize();
  }

  async function toggleMaximizeWindow() {
    const appWindow = await currentWindow();
    await appWindow.toggleMaximize();
    windowMaximized = await appWindow.isMaximized();
  }

  async function closeWindow() {
    await (await currentWindow()).close();
  }

  async function startResizeDrag(direction: Parameters<Awaited<ReturnType<typeof currentWindow>>['startResizeDragging']>[0], event: PointerEvent) {
    if (event.button !== 0 || windowMaximized) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    await (await currentWindow()).startResizeDragging(direction);
  }
</script>

{#if windowDecorationsStore.usesCustomTitlebar}
  <div
    class={`custom-titlebar ${windowMaximized ? 'custom-titlebar-maximized' : ''}`}
    role="toolbar"
    tabindex="-1"
    aria-label="Window controls"
  >
    {#if isMacPlatform}
      <div class="custom-titlebar-controls custom-titlebar-controls-mac">
        <button class="custom-titlebar-close" type="button" aria-label="Close window" onclick={(event) => { event.stopPropagation(); void closeWindow(); }}>
          <X size={10} strokeWidth={3} />
        </button>
        <button class="custom-titlebar-minimize" type="button" aria-label="Minimize window" onclick={(event) => { event.stopPropagation(); void minimizeWindow(); }}>
          <Minimize size={10} strokeWidth={3} />
        </button>
        <button class="custom-titlebar-maximize" type="button" aria-label="Maximize window" onclick={(event) => { event.stopPropagation(); void toggleMaximizeWindow(); }}>
          <Maximize size={9} strokeWidth={3} />
        </button>
      </div>
    {/if}
    <div class={`custom-titlebar-brand ${isMacPlatform ? 'custom-titlebar-brand-mac' : ''}`} data-tauri-drag-region>
      <span class="custom-titlebar-dot" aria-hidden="true"></span>
      <span data-tauri-drag-region>QueryMT</span>
    </div>
    {#if !isMacPlatform}
      <div class="custom-titlebar-controls">
        <button type="button" aria-label="Minimize window" onclick={(event) => { event.stopPropagation(); void minimizeWindow(); }}>
          <Minimize size={14} strokeWidth={2} />
        </button>
        <button type="button" aria-label="Maximize window" onclick={(event) => { event.stopPropagation(); void toggleMaximizeWindow(); }}>
          <Maximize size={14} strokeWidth={2} />
        </button>
        <button class="custom-titlebar-close" type="button" aria-label="Close window" onclick={(event) => { event.stopPropagation(); void closeWindow(); }}>
          <X size={15} strokeWidth={2} />
        </button>
      </div>
    {/if}
  </div>
{/if}

{#if windowDecorationsStore.usesCustomTitlebar && !windowMaximized}
  <button class="window-resize-handle window-resize-handle-n" type="button" aria-label="Resize north" onpointerdown={(event) => void startResizeDrag('North', event)}></button>
  <button class="window-resize-handle window-resize-handle-e" type="button" aria-label="Resize east" onpointerdown={(event) => void startResizeDrag('East', event)}></button>
  <button class="window-resize-handle window-resize-handle-s" type="button" aria-label="Resize south" onpointerdown={(event) => void startResizeDrag('South', event)}></button>
  <button class="window-resize-handle window-resize-handle-w" type="button" aria-label="Resize west" onpointerdown={(event) => void startResizeDrag('West', event)}></button>
  <button class="window-resize-handle window-resize-handle-ne" type="button" aria-label="Resize northeast" onpointerdown={(event) => void startResizeDrag('NorthEast', event)}></button>
  <button class="window-resize-handle window-resize-handle-nw" type="button" aria-label="Resize northwest" onpointerdown={(event) => void startResizeDrag('NorthWest', event)}></button>
  <button class="window-resize-handle window-resize-handle-se" type="button" aria-label="Resize southeast" onpointerdown={(event) => void startResizeDrag('SouthEast', event)}></button>
  <button class="window-resize-handle window-resize-handle-sw" type="button" aria-label="Resize southwest" onpointerdown={(event) => void startResizeDrag('SouthWest', event)}></button>
{/if}

<div class={`app-shell min-h-screen p-4 lg:p-6 ${windowDecorationsStore.usesCustomTitlebar ? `app-shell-custom-titlebar ${windowMaximized ? 'app-shell-maximized' : ''}` : ''}`}>
  <div class="app-grid grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_280px]">
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
