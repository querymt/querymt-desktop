<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { Popover } from 'bits-ui';
  import { Info } from '@lucide/svelte';
  import { openExternalUrl } from '$native';

  // A small info button that opens a click-to-dismiss explanation. Unlike a hover tooltip it
  // can hold links and stays readable on touch screens.
  let {
    label,
    links = [],
    children
  }: {
    /** Accessible name of the trigger, e.g. "About max runs". */
    label: string;
    links?: Array<{ label: string; url: string }>;
    children: Snippet;
  } = $props();

  const getOverlayTarget = getContext<(() => HTMLElement | null) | undefined>('app-overlay-target');
  const portalTarget = $derived(getOverlayTarget?.() ?? undefined);
  let open = $state(false);
  let linkError = $state<string | null>(null);

  async function openLink(event: MouseEvent, url: string) {
    event.preventDefault();
    linkError = null;
    try {
      await openExternalUrl(url);
    } catch (error) {
      linkError = error instanceof Error ? error.message : 'Could not open the link.';
    }
  }
</script>

<Popover.Root bind:open onOpenChange={(next) => { if (!next) linkError = null; }}>
  <Popover.Trigger class="schedule-help-trigger" type="button" aria-label={label}>
    <Info size={14} aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Portal to={portalTarget}>
    <Popover.Content class="app-tooltip-content schedule-help-content" sideOffset={6} collisionPadding={12} align="start">
      <div class="schedule-help-body">{@render children()}</div>
      {#if links.length > 0}
        <div class="schedule-help-links">
          {#each links as link (link.url)}
            <a href={link.url} target="_blank" rel="noopener noreferrer" onclick={(event) => openLink(event, link.url)}>{link.label}</a>
          {/each}
        </div>
      {/if}
      {#if linkError}<p class="schedule-help-error" role="alert">{linkError}</p>{/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
