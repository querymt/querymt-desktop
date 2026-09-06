<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import AppSwitch from '$lib/components/primitives/AppSwitch.svelte';
  import type { ImageSendMode } from '$lib/domain/types';
  import { appearanceStore, type AppearanceThemeMode } from '$lib/stores/appearance.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { windowDecorationsStore } from '$lib/stores/window-decorations.svelte';

  let advancedOpen = $state(false);

  const themeOptions: Array<{ value: AppearanceThemeMode; label: string }> = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  const imageModeOptions: Array<{ value: ImageSendMode; label: string }> = [
    { value: 'image', label: 'Native image' },
    { value: 'resource', label: 'Embedded resource' }
  ];

  $effect(() => {
    appearanceStore.initialize();
    chatPreferencesStore.initialize();
    void windowDecorationsStore.initialize();
  });

  function handleThemeChange(value: string) {
    if (value === 'system' || value === 'light' || value === 'dark') appearanceStore.setThemeMode(value);
  }

  function handleImageModeChange(value: string) {
    if (value === 'image' || value === 'resource') chatPreferencesStore.setImageSendMode(value);
  }
</script>

<section class="settings-panel" aria-labelledby="general-settings-title">
  <div class="settings-panel-header">
    <h2 id="general-settings-title">General</h2>
    <p>Everyday preferences for how QueryMT looks and behaves.</p>
  </div>

  <div class="settings-simple-list">
    <div class="settings-simple-row">
      <div class="settings-simple-main">
        <h3>Theme</h3>
        <p>Choose light, dark, or system appearance.</p>
      </div>
      <AppSelect value={appearanceStore.themeMode} options={themeOptions} pill ariaLabel="Theme" onValueChange={handleThemeChange} />
    </div>
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
</section>
