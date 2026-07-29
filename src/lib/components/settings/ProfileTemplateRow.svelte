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
      <button class="action-btn" type="button" disabled={pending} onclick={() => onEnable(template)}>
        {#if pending}<LoaderCircle size={14} class="animate-spin" />{/if}
        {pending ? 'Enabling…' : 'Enable'}
      </button>
    {/if}
  </div>

  {#if message}<div class="profile-row-feedback profile-row-feedback-success" role="status">{message}</div>{/if}
  {#if error}<div class="profile-row-feedback profile-row-feedback-error" role="alert">{error}</div>{/if}

  <div class="profile-row-details">
    <button type="button" aria-expanded={detailsOpen} onclick={() => (detailsOpen = !detailsOpen)}>
      <span>Details</span>
      <ChevronDown size={14} class={detailsOpen ? 'settings-advanced-chevron-open' : ''} />
    </button>
    {#if detailsOpen}
      <div class="profile-row-details-content">
        {#if template.tags.length > 0}
          <div><strong>Tags</strong><span>{template.tags.join(', ')}</span></div>
        {/if}
        <div><strong>Profile ID</strong><span>{template.id}</span></div>
        {#if template.userPath}<div><strong>Installed at</strong><span title={template.userPath}>{template.userPath}</span></div>{/if}
      </div>
    {/if}
  </div>
</article>
