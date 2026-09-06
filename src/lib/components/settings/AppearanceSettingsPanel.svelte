<script lang="ts">
  import { ACCENT_PRESETS, appearanceStore } from '$lib/stores/appearance.svelte';

  const themeModes = [
    { id: 'system' as const, label: 'System' },
    { id: 'light' as const, label: 'Light' },
    { id: 'dark' as const, label: 'Dark' }
  ];

  $effect(() => {
    appearanceStore.initialize();
  });
</script>

{#snippet miniPreview()}
  <span class="theme-mini-rail"><i></i><i></i><i></i></span>
  <span class="theme-mini-main">
    <i class="theme-mini-line theme-mini-w60"></i>
    <i class="theme-mini-line theme-mini-w80"></i>
    <i class="theme-mini-line theme-mini-w45"></i>
    <span class="theme-mini-composer"><i class="theme-mini-dot"></i></span>
  </span>
{/snippet}

<section class="settings-panel" aria-labelledby="appearance-settings-title">
  <div class="settings-panel-header">
    <h2 id="appearance-settings-title">Appearance</h2>
    <p>Theme and accent color.</p>
  </div>

  <div class="settings-subsection" aria-label="Application theme">
    <div class="settings-subsection-header">
      <h3>Application theme</h3>
      <p>Follow the system or pick a fixed theme.</p>
    </div>
    <div class="theme-card-row" role="radiogroup" aria-label="Application theme">
      {#each themeModes as mode (mode.id)}
        <button
          type="button"
          role="radio"
          class="theme-card"
          class:theme-card-selected={appearanceStore.themeMode === mode.id}
          aria-checked={appearanceStore.themeMode === mode.id}
          aria-label={`${mode.label} application theme`}
          onclick={() => appearanceStore.setThemeMode(mode.id)}
        >
          <span class="theme-card-preview">
            {#if mode.id === 'system'}
              <span class="theme-mini" data-scheme="light">{@render miniPreview()}</span>
              <span class="theme-mini theme-mini-overlay" data-scheme="dark">{@render miniPreview()}</span>
            {:else}
              <span class="theme-mini" data-scheme={mode.id}>{@render miniPreview()}</span>
            {/if}
          </span>
          <span class="theme-card-label">{mode.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="settings-subsection" aria-label="Accent color">
    <div class="settings-subsection-header">
      <h3>Accent color</h3>
      <p>The accent highlights buttons, prompts, and selections across the app.</p>
    </div>
    <div class="settings-simple-list">
      <div class="settings-simple-row">
        <div class="settings-simple-main">
          <h3>Accent color</h3>
          <p>Applies instantly and is saved automatically.</p>
        </div>
        <div class="accent-swatch-row" role="radiogroup" aria-label="Accent color">
          {#each ACCENT_PRESETS as preset (preset.id)}
            <button
              type="button"
              role="radio"
              class="accent-swatch"
              class:accent-swatch-selected={appearanceStore.accent === preset.id}
              style={`--swatch: ${appearanceStore.resolvedTheme === 'dark' ? preset.dark : preset.light}`}
              aria-checked={appearanceStore.accent === preset.id}
              aria-label={`${preset.label} accent`}
              title={preset.label}
              onclick={() => appearanceStore.setAccentColor(preset.id)}
            ></button>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>
