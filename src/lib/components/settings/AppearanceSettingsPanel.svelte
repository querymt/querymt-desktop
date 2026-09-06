<script lang="ts">
  import { ACCENT_PRESETS, appearanceStore } from '$lib/stores/appearance.svelte';

  $effect(() => {
    appearanceStore.initialize();
  });
</script>

<section class="settings-panel" aria-labelledby="appearance-settings-title">
  <div class="settings-panel-header">
    <h2 id="appearance-settings-title">Appearance</h2>
    <p>Theme and accent color.</p>
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
