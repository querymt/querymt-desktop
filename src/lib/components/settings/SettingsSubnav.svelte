<script lang="ts">
  import { Bot, SlidersHorizontal, WandSparkles } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';

  export type SettingsSectionId = 'general' | 'profiles' | 'providers';

  let {
    selected,
    onSelect
  }: {
    selected: SettingsSectionId;
    onSelect: (section: SettingsSectionId) => void;
  } = $props();

  const sections = [
    { id: 'general', label: 'General', description: 'Appearance and chat behavior', icon: SlidersHorizontal },
    { id: 'profiles', label: 'Profiles', description: 'Ready-made agent configurations', icon: WandSparkles },
    { id: 'providers', label: 'Providers', description: 'Authentication and maintenance', icon: Bot }
  ] satisfies Array<{ id: SettingsSectionId; label: string; description: string; icon: typeof SlidersHorizontal }>;
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
