<script lang="ts">
  import { Bot, Keyboard, Palette, Plug, SlidersHorizontal, WandSparkles } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';

  export type SettingsSectionId = 'appearance' | 'general' | 'keybindings' | 'profiles' | 'providers' | 'connectors';

  let {
    selected,
    showProfiles = true,
    showConnectors = false,
    onSelect
  }: {
    selected: SettingsSectionId;
    showProfiles?: boolean;
    /** The agent has OAuth connectors (MCP servers) to sign in to. */
    showConnectors?: boolean;
    onSelect: (section: SettingsSectionId) => void;
  } = $props();

  const allSections = [
    { id: 'general', label: 'General', description: 'Appearance and chat behavior', icon: SlidersHorizontal },
    { id: 'appearance', label: 'Appearance', description: 'Theme and accent color', icon: Palette },
    { id: 'keybindings', label: 'Keybindings', description: 'Keyboard shortcuts', icon: Keyboard },
    { id: 'profiles', label: 'Profiles', description: 'Ready-made agent configurations', icon: WandSparkles },
    { id: 'providers', label: 'Providers', description: 'Authentication and maintenance', icon: Bot },
    { id: 'connectors', label: 'Connectors', description: 'Sign-in for connected tools', icon: Plug }
  ] satisfies Array<{ id: SettingsSectionId; label: string; description: string; icon: typeof SlidersHorizontal }>;
  const sections = $derived(allSections.filter(
      (section) => (showProfiles || section.id !== 'profiles') && (showConnectors || section.id !== 'connectors')
    ));
</script>

<nav class="settings-subnav" aria-label="Settings sections">
  {#each sections as section}
    <button
      class:settings-subnav-item-current={selected === section.id}
      class="settings-subnav-item"
      type="button"
      aria-current={selected === section.id ? 'page' : undefined}
      onclick={() => onSelect(section.id)}
    >
      <section.icon size={16} />
      <span>
        <strong>{section.label}</strong>
        <small>{section.description}</small>
      </span>
    </button>
  {/each}
</nav>

<div class="settings-subnav-select">
  <AppSelect
    value={selected}
    options={sections.map((section) => ({ value: section.id, label: section.label }))}
    ariaLabel="Settings section"
    onValueChange={(value) => onSelect(value as SettingsSectionId)}
  />
</div>
