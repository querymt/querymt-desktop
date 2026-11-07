<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import AppSwitch from '$lib/components/primitives/AppSwitch.svelte';
  import type { ImageSendMode } from '$lib/domain/types';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { sidebarStore } from '$lib/stores/sidebar.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';
  import { getContext } from 'svelte';
  import AppCheckbox from '$lib/components/primitives/AppCheckbox.svelte';
  import AppConfirmDialog from '$lib/components/primitives/AppConfirmDialog.svelte';
  import { clearDesktopLocalStorage } from '$lib/domain/app-reset';
  import { platformCapabilities } from '$lib/platform/runtime';
  import { resetAppData } from '$native';

  let advancedOpen = $state(false);
  let dangerOpen = $state(false);
  let resetOpen = $state(false);
  let resetIncludeProfiles = $state(false);
  let resetPending = $state(false);
  let resetError = $state<string | null>(null);

  const getOverlayPortalTarget = getContext<(() => HTMLElement | null) | undefined>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  function openReset() {
    resetIncludeProfiles = false;
    resetError = null;
    resetOpen = true;
  }

  async function confirmReset() {
    resetPending = true;
    resetError = null;
    try {
      clearDesktopLocalStorage(localStorage);
      // Desktop: schedules folder cleanup and restarts the app. Embedded: reloads the page.
      await resetAppData({ includeProfiles: resetIncludeProfiles });
    } catch (error) {
      resetError = error instanceof Error ? error.message : String(error);
      resetPending = false;
    }
  }

  const imageModeOptions: Array<{ value: ImageSendMode; label: string }> = [
    { value: 'image', label: 'Native image' },
    { value: 'resource', label: 'Embedded resource' }
  ];

  $effect(() => {
    chatPreferencesStore.initialize();
    sidebarStore.initialize();
    void windowDecorationsStore.initialize();
  });

  function handleImageModeChange(value: string) {
    if (value === 'image' || value === 'resource') chatPreferencesStore.setImageSendMode(value);
  }
</script>

<section class="settings-panel" aria-labelledby="general-settings-title">
  <div class="settings-panel-header">
    <h2 id="general-settings-title">General</h2>
    <p>Everyday preferences for how QueryMT looks and behaves.</p>
  </div>

  <div class="settings-simple-row">
    <div class="settings-simple-main">
      <h3>Show pinned sessions in sidebar</h3>
      <p>Keep pinned sessions above Open sessions.</p>
    </div>
    <AppSwitch
      checked={sidebarStore.showPinnedSessions}
      ariaLabel="Show pinned sessions in sidebar"
      onCheckedChange={(checked) => sidebarStore.setShowPinnedSessions(checked)}
    />
  </div>

  <div class="settings-simple-row">
    <div class="settings-simple-main">
      <h3>Show remote sessions</h3>
      <p>Include sessions from peers selected in Mesh.</p>
    </div>
    <AppSwitch
      checked={chatPreferencesStore.showRemoteSessions}
      ariaLabel="Show remote sessions"
      onCheckedChange={(checked) => {
        chatPreferencesStore.setShowRemoteSessions(checked);
        void agentsStore.refreshAllSessions();
      }}
    />
  </div>

  <div class="settings-simple-row">
    <div class="settings-simple-main">
      <h3>Setup</h3>
      <p>Check the agent, connect providers and choose a model.</p>
    </div>
    <a class="action-btn" href="/setup">Run setup again</a>
  </div>

  <div class="settings-advanced">
    <button class="settings-advanced-trigger" type="button" aria-expanded={advancedOpen} onclick={() => (advancedOpen = !advancedOpen)}>
      <span>
        <strong>Advanced</strong>
        <small>Experimental window behavior and developer tools</small>
      </span>
      <ChevronDown size={16} class={advancedOpen ? 'settings-advanced-chevron-open' : ''} />
    </button>

    {#if advancedOpen}
      <div class="settings-advanced-content">
        <div class="settings-simple-row">
          <div class="settings-simple-main">
            <h3>Image attachment encoding</h3>
            <p>Send images as native ACP image blocks or embedded resources.</p>
          </div>
          <AppSelect value={chatPreferencesStore.imageSendMode} options={imageModeOptions} pill ariaLabel="Image attachment encoding" onValueChange={handleImageModeChange} />
        </div>

        <div class="settings-simple-row">
          <div class="settings-simple-main">
            <h3>Developer mode</h3>
            <p>Show developer-only tools.</p>
          </div>
          <AppSwitch
            checked={chatPreferencesStore.developerMode}
            ariaLabel="Developer mode"
            onCheckedChange={(checked) => chatPreferencesStore.setDeveloperMode(checked)}
          />
        </div>

        <div class="settings-simple-row">
          <div class="settings-simple-main">
            <h3>Custom titlebar <span class="badge">Beta</span></h3>
            <p class:settings-preference-error={windowDecorationsStore.error}>
              {#if windowDecorationsStore.error}
                {windowDecorationsStore.error}
              {:else if !windowDecorationsStore.supported}
                Available in Tauri desktop builds.
              {:else}
                Use QueryMT's experimental window frame instead of the operating system frame.
              {/if}
            </p>
          </div>
          <AppSwitch
            checked={windowDecorationsStore.mode === 'custom'}
            disabled={!windowDecorationsStore.supported}
            ariaLabel="Custom titlebar"
            onCheckedChange={(checked) => void windowDecorationsStore.toggleCustomTitlebar(checked)}
          />
        </div>
      </div>
    {/if}
  </div>

  <div class="settings-advanced">
    <button class="settings-advanced-trigger" type="button" aria-expanded={dangerOpen} onclick={() => (dangerOpen = !dangerOpen)}>
      <span>
        <strong>Danger zone</strong>
        <small>Irreversible actions for desktop app data</small>
      </span>
      <ChevronDown size={16} class={dangerOpen ? 'settings-advanced-chevron-open' : ''} />
    </button>

    {#if dangerOpen}
      <div class="settings-advanced-content">
        <div class="settings-simple-row">
          <div class="settings-simple-main">
            <h3>Reset desktop app data</h3>
            <p>Removes agents, recent sessions and workspaces, preferences and caches stored by the desktop app, then restarts it. Agent sessions, provider sign-ins and your project files are not touched.</p>
          </div>
          <button class="action-btn action-btn-danger" type="button" onclick={openReset}>Reset app data</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<AppConfirmDialog
  bind:open={resetOpen}
  title="Reset desktop app data?"
  description="The app will restart and open like a fresh install. This cannot be undone."
  confirmLabel="Reset and restart"
  pendingLabel="Resetting…"
  pending={resetPending}
  portalTarget={overlayPortalTarget}
  onConfirm={confirmReset}
>
  <div class="settings-reset-detail">
    <p><strong>Removed:</strong> configured agents, recent sessions, models and workspaces, pinned sessions, appearance and chat preferences, and webview caches.</p>
    <p><strong>Kept:</strong> qmtcode sessions and config, provider sign-ins and API keys, the qmtcode binary and your project files.</p>
    {#if platformCapabilities.nativeProfileTemplates}
      <AppCheckbox bind:checked={resetIncludeProfiles} label="Also delete desktop profiles" description="Profiles you created or enabled from templates." />
    {/if}
    {#if resetError}<div class="alert-error" role="alert">{resetError}</div>{/if}
  </div>
</AppConfirmDialog>
