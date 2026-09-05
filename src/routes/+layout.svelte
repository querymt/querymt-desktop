<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, setContext } from 'svelte';
  import { Maximize, Minimize, X } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import RecentSessionRail from '$lib/components/shell/RecentSessionRail.svelte';
  import CommandPalette from '$lib/components/shell/CommandPalette.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { appearanceStore } from '$lib/stores/appearance.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { isMacPlatform as detectMacPlatform } from '$lib/design/platform';
  import type { SectionName } from '$lib/design/tokens';
  import type { SessionRailItem } from '$lib/domain/sessions';
  import type { SessionRunState } from '$lib/domain/types';
  import type { Snippet } from 'svelte';

  const ESC_CANCEL_WINDOW_MS = 700;
  const CANCELLABLE_RUN_STATES = new Set<SessionRunState>(['submitting', 'thinking', 'streaming', 'tool-running']);

  const { children } = $props<{ children?: Snippet }>();

  let windowMaximized = $state(false);
  let isMacPlatform = $state(false);
  let overlayPortalTarget = $state<HTMLElement | null>(null);
  let visibleRailSessionItems = $state<SessionRailItem[]>([]);

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

  let lastEscapeAt = 0;

  const pathname = $derived(page.url.pathname);
  const isActiveSessionRoute = $derived(pathname.startsWith('/sessions/'));
  const currentRailAgentId = $derived(isActiveSessionRoute ? decodeURIComponent(page.params.agentId ?? '') : null);
  const currentRailSessionId = $derived(isActiveSessionRoute ? decodeURIComponent(page.params.sessionId ?? '') : null);
  const isSessionCancellable = $derived(
    isActiveSessionRoute && CANCELLABLE_RUN_STATES.has(agentsStore.activeSession.runState)
  );
  const layoutClass = $derived(sidebarStore.initialized && sidebarStore.effectiveCollapsed ? 'app-grid-sidebar-collapsed' : 'app-grid-sidebar-expanded');

  const section = $derived.by(() => {
    if (pathname.startsWith('/sessions/')) {
      return 'Sessions';
    }

    return routeToSection[pathname] ?? 'Today';
  });

  function preventNewWindowNavigation(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!target) {
      return;
    }

    const opensNewWindow = target.getAttribute('target') === '_blank'
      || event.button === 1
      || (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey));
    if (opensNewWindow) {
      event.preventDefault();
    }
  }

  function showOnFirstPaint(callback: () => void): () => void {
    if (document.visibilityState === 'hidden') {
      if (document.readyState === 'complete') {
        callback();
        return () => {};
      }

      window.addEventListener('load', callback, { once: true });
      return () => window.removeEventListener('load', callback);
    }

    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
  }

  onMount(() => {
    appearanceStore.initialize();
    chatPreferencesStore.initialize();
    sidebarStore.initialize();
    void agentsStore.initialize();

    isMacPlatform = detectMacPlatform();

    let disposed = false;
    let cancelShow: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    const cleanupDesktopWindow = () => {
      cancelShow?.();
      unlistenResize?.();
      unlistenFocus?.();
      cancelShow = undefined;
      unlistenResize = undefined;
      unlistenFocus = undefined;
    };
    const isDesktopRuntime = '__TAURI_INTERNALS__' in window;
    if (isDesktopRuntime) {
      void (async () => {
        await windowDecorationsStore.initialize();
        const appWindow = await currentWindow();
        const { invoke } = await import('@tauri-apps/api/core');
        const appRuntime = await invoke<string>('app_runtime');
        if (disposed) {
          return;
        }

        const updateMaximized = async () => {
          windowMaximized = await appWindow.isMaximized();
        };
        await updateMaximized();
        if (disposed) {
          return;
        }

        unlistenResize = await appWindow.onResized(updateMaximized);
        if (disposed) {
          cleanupDesktopWindow();
          return;
        }

        unlistenFocus = await appWindow.onFocusChanged(updateMaximized);
        if (disposed) {
          cleanupDesktopWindow();
          return;
        }

        const windowIsVisible = await appWindow.isVisible();
        if (disposed) {
          cleanupDesktopWindow();
          return;
        }

        if (!windowIsVisible) {
          cancelShow = showOnFirstPaint(() => {
            void appWindow.show().then(() => appWindow.setFocus()).catch((error) => {
              console.error('Failed to show the desktop window.', error);
            });
          });
        }

        if (appRuntime === 'cef') {
          window.addEventListener('click', preventNewWindowNavigation, true);
          window.addEventListener('auxclick', preventNewWindowNavigation, true);
        }
      })().catch((error) => {
        cleanupDesktopWindow();
        if (!disposed) {
          console.error('Failed to initialize the desktop window.', error);
        }
      });
    } else {
      void windowDecorationsStore.initialize();
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
      const railShortcutIndex = getRailShortcutIndex(key);
      if (railShortcutIndex !== null) {
        const item = visibleRailSessionItems[railShortcutIndex];
        if (!item || document.querySelector('[data-blocking-overlay="true"]')) {
          return;
        }

        event.preventDefault();
        const { agentId, sessionId } = item.session;
        agentsStore.acknowledgeSession(agentId, sessionId);
        if (currentRailAgentId === agentId && currentRailSessionId === sessionId) {
          return;
        }

        await goto(`/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}`);
        return;
      }

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
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      if (isDesktopRuntime) {
        window.removeEventListener('click', preventNewWindowNavigation, true);
        window.removeEventListener('auxclick', preventNewWindowNavigation, true);
      }
      cleanupDesktopWindow();
    };
  });

  function getRailShortcutIndex(key: string): number | null {
    if (key === '0') {
      return 9;
    }

    if (/^[1-9]$/.test(key)) {
      return Number(key) - 1;
    }

    return null;
  }

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
  <div class={`app-shell min-h-screen p-4 ${windowDecorationsStore.usesCustomTitlebar ? `app-shell-custom-titlebar ${windowMaximized ? 'app-shell-maximized' : ''}` : ''}`}>
    <RecentSessionRail
      current={section}
      sessions={agentsStore.sessions}
      attentionSessionKeys={agentsStore.attentionSessionKeys}
      currentAgentId={currentRailAgentId}
      currentSessionId={currentRailSessionId}
      collapsed={sidebarStore.initialized && sidebarStore.effectiveCollapsed}
      collapseLocked={sidebarStore.viewportConstrained}
      onToggleCollapsed={() => sidebarStore.toggleCollapsed()}
      onOpenSession={(session) => agentsStore.acknowledgeSession(session.agentId, session.sessionId)}
      onVisibleSessionItemsChange={(items) => (visibleRailSessionItems = items)}
    />

    <div class={`app-grid grid ${layoutClass}`}>
      <div class="app-sidebar-spacer" aria-hidden="true"></div>

      <div class="app-main-column flex min-w-0 flex-col gap-4">
        <main class="min-h-0 flex-1">
          {@render children?.()}
        </main>
        <CommandPalette portalTarget={overlayPortalTarget} />
      </div>

    </div>
    <div bind:this={overlayPortalTarget} class="app-overlay-root"></div>
  </div>
</Tooltip.Provider>
