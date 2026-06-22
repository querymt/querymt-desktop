<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext } from 'svelte';
  import { Maximize, Minimize, X } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import LeftRail from '$lib/components/shell/LeftRail.svelte';
  import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
  import Inspector from '$lib/components/shell/Inspector.svelte';
  import SessionContextRail from '$lib/components/session/SessionContextRail.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { appearanceStore } from '$lib/stores/appearance.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';
  import type { SectionName } from '$lib/design/tokens';
  import type { SessionRunState } from '$lib/domain/types';
  import type { Snippet } from 'svelte';

  const LEFT_RAIL_HIDDEN_KEY = 'querymt.left-rail.hidden';
  const ESC_CANCEL_WINDOW_MS = 700;
  const CANCELLABLE_RUN_STATES = new Set<SessionRunState>(['submitting', 'thinking', 'streaming', 'tool-running']);

  const { children } = $props<{ children?: Snippet }>();

  let windowMaximized = $state(false);
  let isMacPlatform = $state(false);
  let overlayPortalTarget = $state<HTMLElement | null>(null);

  setContext('app-overlay-target', () => overlayPortalTarget);

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

  let leftRailHidden = $state(false);
  let lastEscapeAt = 0;

  const pathname = $derived(page.url.pathname);
  const isActiveSessionRoute = $derived(pathname.startsWith('/sessions/'));
  const leftRailQuiet = $derived(pathname === '/' || isActiveSessionRoute);
  const isSessionCancellable = $derived(
    isActiveSessionRoute && CANCELLABLE_RUN_STATES.has(agentsStore.activeSession.runState)
  );
  const layoutClass = $derived.by(() => {
    if (leftRailHidden) {
      return 'grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[56px_minmax(0,1fr)] 2xl:grid-cols-[56px_minmax(0,1fr)_280px]';
    }

    return 'grid min-h-[calc(100vh-2rem)] grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_280px]';
  });

  const section = $derived.by(() => {
    if (pathname.startsWith('/sessions/')) {
      return 'Sessions';
    }

    return routeToSection[pathname] ?? 'Today';
  });

  function setLeftRailCollapsed(value: boolean) {
    leftRailHidden = value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LEFT_RAIL_HIDDEN_KEY, value ? '1' : '0');
    }
  }

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

    if (typeof localStorage !== 'undefined') {
      leftRailHidden = localStorage.getItem(LEFT_RAIL_HIDDEN_KEY) === '1';
    }

    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isSessionCancellable) {
        const now = Date.now();
        if (now - lastEscapeAt <= ESC_CANCEL_WINDOW_MS) {
          event.preventDefault();
          lastEscapeAt = 0;
          await agentsStore.cancelActiveSession();
          return;
        }
        lastEscapeAt = now;
      }

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
        if (commandPaletteStore.open) {
          commandPaletteStore.close();
        } else if (!document.querySelector('[data-blocking-overlay="true"]')) {
          // Avoid stacking the command palette over dialogs that already own user focus.
          commandPaletteStore.openCommands();
        }
        return;
      }

      if (key === 'b') {
        event.preventDefault();
        setLeftRailCollapsed(!leftRailHidden);
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

<Tooltip.Provider>
  <div class={`app-shell min-h-screen p-4 lg:p-6 ${windowDecorationsStore.usesCustomTitlebar ? `app-shell-custom-titlebar ${windowMaximized ? 'app-shell-maximized' : ''}` : ''}`}>
    <div class={`app-grid grid ${layoutClass}`}>
      <LeftRail
        current={section}
        quiet={leftRailQuiet}
        collapsed={leftRailHidden}
      />

      <div class="flex min-w-0 flex-col gap-4">
        <main class="min-h-0 flex-1">
          {@render children?.()}
        </main>
        <CommandPalette portalTarget={overlayPortalTarget} />
      </div>

      <div class="app-inspector-column hidden min-h-0 2xl:grid">
        <Inspector />
        {#if isActiveSessionRoute && agentsStore.activeSessionId}
          <aside class="session-side-rail session-side-rail-inspector">
            <SessionContextRail
              session={agentsStore.activeSession}
              sessionConfigPending={agentsStore.sessionConfigPending}
              onConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
            />
          </aside>
        {/if}
      </div>
    </div>
    <div bind:this={overlayPortalTarget} class="app-overlay-root"></div>
  </div>
</Tooltip.Provider>
