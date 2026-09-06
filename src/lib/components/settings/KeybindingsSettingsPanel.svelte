<script lang="ts">
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import { buildKeybindings, KEYBINDING_SCOPES } from '$lib/domain/keybindings';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { isMacPlatform as detectMacPlatform } from '$lib/design/platform';

  let isMacPlatform = $state(false);
  let initialized = $state(false);

  $effect(() => {
    chatPreferencesStore.initialize();
    initialized = true;
    isMacPlatform = detectMacPlatform();
  });

  const sendShortcutOptions = $derived.by(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: 'enter', label: 'Enter' },
      { value: 'shift-enter', label: 'Shift+Enter' },
      { value: 'ctrl-enter', label: 'Ctrl+Enter' }
    ];
    if (isMacPlatform) options.push({ value: 'cmd-enter', label: 'Cmd+Enter' });
    return options;
  });

  const keybindings = $derived(buildKeybindings(initialized ? chatPreferencesStore.sendShortcut : 'enter'));

  function handleSendShortcutChange(value: string) {
    if (value === 'enter' || value === 'shift-enter' || value === 'ctrl-enter' || value === 'cmd-enter') {
      chatPreferencesStore.setSendShortcut(value);
    }
  }
</script>

<section class="settings-panel" aria-labelledby="keybindings-settings-title">
  <div class="settings-panel-header">
    <h2 id="keybindings-settings-title">Keybindings</h2>
    <p>Review the keyboard shortcuts. The send shortcut is configurable — other bindings are fixed for now.</p>
  </div>

  {#each KEYBINDING_SCOPES as scope (scope.id)}
    <div class="settings-subsection" aria-label={scope.label}>
      <div class="settings-subsection-header">
        <h3>{scope.label}</h3>
        <p>{scope.description}</p>
      </div>
      <div class="settings-simple-list">
        {#each keybindings.filter((binding) => binding.scope === scope.id) as binding (binding.label)}
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
        {#if scope.id === 'composer'}
          <div class="settings-simple-row">
            <div class="settings-simple-main">
              <h3>Send messages with</h3>
              <p>Choose the shortcut that submits a message.</p>
            </div>
            <AppSelect
              value={chatPreferencesStore.sendShortcut}
              options={sendShortcutOptions}
              pill
              ariaLabel="Send messages with"
              onValueChange={handleSendShortcutChange}
            />
          </div>
        {/if}
      </div>
    </div>
  {/each}
</section>
