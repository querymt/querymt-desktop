<script lang="ts">
  import { Check, ChevronDown, LoaderCircle } from '@lucide/svelte';
  import type { ProfileTemplateInfo } from '$lib/querymt/profile-templates';

  let {
    template,
    pending = false,
    message = null,
    error = null,
    onEnable
  }: {
    template: ProfileTemplateInfo;
    pending?: boolean;
    message?: string | null;
    error?: string | null;
    onEnable: (template: ProfileTemplateInfo) => void;
  } = $props();

  let detailsOpen = $state(false);
</script>

<article class="profile-row">
  <div class="profile-row-main">
    <h3>{template.name}</h3>
    <p>{template.description}</p>
  </div>

  <div class="profile-row-action">
    {#if template.enabled}
      <span class="profile-row-enabled"><Check size={14} />Enabled</span>
    {:else}
      <button class="action-btn action-btn-compact profile-row-enable-action" type="button" disabled={pending} onclick={() => onEnable(template)}>
        {#if pending}<LoaderCircle size={14} class="animate-spin" />{/if}
        {pending ? 'Enabling…' : 'Enable'}
      </button>
    {/if}
    <button
      class="action-btn action-btn-compact profile-row-details-action"
      type="button"
      aria-expanded={detailsOpen}
      onclick={() => (detailsOpen = !detailsOpen)}
    >
      Details
      <ChevronDown size={13} aria-hidden="true" class={detailsOpen ? 'settings-advanced-chevron-open' : ''} />
    </button>
  </div>

  {#if message}<div class="profile-row-feedback profile-row-feedback-success" role="status">{message}</div>{/if}
  {#if error}<div class="profile-row-feedback profile-row-feedback-error" role="alert">{error}</div>{/if}

  {#if detailsOpen}
    <div class="profile-row-details-content">
      {#if template.tags.length > 0}
        <div><strong>Tags</strong><span>{template.tags.join(', ')}</span></div>
      {/if}
      <div><strong>Profile ID</strong><span>{template.id}</span></div>
      {#if template.userPath}<div><strong>Installed at</strong><span title={template.userPath}>{template.userPath}</span></div>{/if}
    </div>
  {/if}
</article>
