<script lang="ts">
  import { KEYBINDINGS, KEYBINDING_SCOPES } from '$lib/domain/keybindings';
</script>

<section class="settings-panel" aria-labelledby="keybindings-settings-title">
  <div class="settings-panel-header">
    <h2 id="keybindings-settings-title">Keybindings</h2>
    <p>Keyboard shortcuts. Editing bindings is not supported yet.</p>
  </div>

  {#each KEYBINDING_SCOPES as scope (scope.id)}
    <div class="settings-subsection" aria-label={scope.label}>
      <div class="settings-subsection-header">
        <h3>{scope.label}</h3>
        <p>{scope.description}</p>
      </div>
      <div class="settings-simple-list">
        {#each KEYBINDINGS.filter((binding) => binding.scope === scope.id) as binding (binding.label)}
          <div class="settings-simple-row">
            <div class="settings-simple-main">
              <h3>{binding.label}</h3>
            </div>
            <span class="keybinding-keys">
              {#each binding.keys as key, index (index)}
                {#if index > 0}<span class="keybinding-plus" aria-hidden="true">+</span>{/if}
                <kbd>{key}</kbd>
              {/each}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <p class="keybinding-note">
    The send key follows the <strong>Send shortcut</strong> setting in General.
  </p>
</section>
