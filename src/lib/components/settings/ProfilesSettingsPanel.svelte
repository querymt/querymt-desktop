<script lang="ts">
  import { Info, RefreshCw, WandSparkles } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import ProfileTemplateRow from './ProfileTemplateRow.svelte';
  import { enableProfileTemplate, listProfileTemplates, type ProfileTemplateInfo } from '$lib/querymt/profile-templates';
  import { agentsStore } from '$lib/stores/agents.svelte';

  let templates = $state<ProfileTemplateInfo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let pendingId = $state<string | null>(null);
  let rowMessages = $state<Record<string, string | undefined>>({});
  let rowErrors = $state<Record<string, string | undefined>>({});
  let howItWorksOpen = $state(false);

  $effect(() => {
    void refresh();
  });

  async function refresh() {
    loading = true;
    error = null;
    try {
      templates = await listProfileTemplates();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Failed to load profile templates.';
    } finally {
      loading = false;
    }
  }

  async function enable(template: ProfileTemplateInfo) {
    pendingId = template.id;
    rowMessages = { ...rowMessages, [template.id]: undefined };
    rowErrors = { ...rowErrors, [template.id]: undefined };
    try {
      const updated = await enableProfileTemplate(template.id);
      templates = templates.map((entry) => (entry.id === updated.id ? updated : entry));
      await agentsStore.refreshManagedProfiles();
      rowMessages = { ...rowMessages, [template.id]: `${updated.name} is ready to use.` };
    } catch (caught) {
      rowErrors = { ...rowErrors, [template.id]: caught instanceof Error ? caught.message : `Failed to enable ${template.name}.` };
    } finally {
      pendingId = null;
    }
  }
</script>

<section class="settings-panel" aria-labelledby="profiles-settings-title">
  <div class="settings-panel-header settings-panel-header-action">
    <div>
      <h2 id="profiles-settings-title">Profiles</h2>
      <p>Ready-made agent configurations for common workflows.</p>
    </div>
    <IconTooltipButton label={loading ? 'Refreshing profiles' : 'Refresh profiles'} icon={RefreshCw} iconClass={loading ? 'animate-spin' : ''} size={16} disabled={loading} onclick={refresh} />
  </div>

  {#if loading && templates.length === 0}
    <div class="state-skeleton-list" aria-label="Loading profiles" aria-busy="true">
      {#each Array(3) as _}
        <div class="state-skeleton-row"><span class="state-skeleton-copy"><i></i><i></i></span><span class="state-skeleton-actions"></span></div>
      {/each}
    </div>
  {:else if error && templates.length === 0}
    <div class="state-panel state-panel-error" role="alert">
      <span class="state-panel-icon"><WandSparkles size={17} /></span>
      <div class="state-panel-copy"><strong>Profiles could not be loaded</strong><p>{error}</p></div>
      <button class="action-btn" type="button" onclick={refresh}>Try again</button>
    </div>
  {:else if templates.length === 0}
    <div class="state-panel">
      <span class="state-panel-icon"><WandSparkles size={17} /></span>
      <div class="state-panel-copy"><strong>No curated profiles available</strong><p>Refresh to check for ready-made configurations.</p></div>
      <button class="action-btn" type="button" onclick={refresh}>Refresh</button>
    </div>
  {:else}
    {#if error}<div class="state-inline-error" role="alert"><span>{error}</span><button class="action-btn" type="button" onclick={refresh}>Retry</button></div>{/if}
    <div class="profile-list" aria-label="Curated profiles">
      {#each templates as template (template.id)}
        <ProfileTemplateRow
          {template}
          pending={pendingId === template.id}
          message={rowMessages[template.id]}
          error={rowErrors[template.id]}
          onEnable={enable}
        />
      {/each}
    </div>
  {/if}

  <section class="profiles-how-it-works">
    <button class="settings-advanced-trigger" type="button" aria-expanded={howItWorksOpen} onclick={() => (howItWorksOpen = !howItWorksOpen)}>
      <span><strong>How profiles work</strong><small>Storage, updates, and existing copies</small></span>
      <Info size={15} />
    </button>
    {#if howItWorksOpen}
      <div class="profiles-how-it-works-content">
        <p>Profiles are stored as TOML configuration files. Enabling a curated profile never overwrites an existing copy, and running agents pick up profile changes automatically.</p>
      </div>
    {/if}
  </section>
</section>
