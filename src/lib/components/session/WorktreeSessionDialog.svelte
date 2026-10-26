<script lang="ts">
  import { getContext } from 'svelte';
  import { LoaderCircle } from '@lucide/svelte';
  import AppDialog from '$lib/components/primitives/AppDialog.svelte';
  import { validateWorktreeCreateOptions, type WorktreeCreateOptions, type WorktreeHandoffOptions } from '$lib/domain/session-workspace';

  let {
    open = $bindable(false),
    mode,
    sourceTitle,
    pending = false,
    error = null,
    summarySupported = false,
    onCreate,
    onHandoff
  }: {
    open?: boolean;
    mode: 'create' | 'handoff';
    sourceTitle: string;
    pending?: boolean;
    error?: string | null;
    /** Agent advertises handoff summaries. */
    summarySupported?: boolean;
    onCreate?: (options: WorktreeCreateOptions) => void | Promise<void>;
    onHandoff?: (options: WorktreeHandoffOptions) => void | Promise<void>;
  } = $props();

  const getOverlayPortalTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const overlayPortalTarget = $derived(getOverlayPortalTarget?.() ?? undefined);

  let name = $state('');
  let baseRef = $state('');
  let includeLocalChanges = $state(false);
  let summary = $state(false);

  // Each opening starts from clean defaults (summary off by default).
  $effect(() => {
    if (open) {
      name = '';
      baseRef = '';
      includeLocalChanges = false;
      summary = false;
    }
  });

  const createOptions = $derived<WorktreeCreateOptions>({ name, baseRef, includeLocalChanges });
  const conflict = $derived(mode === 'create' && includeLocalChanges && baseRef.trim() ? validateWorktreeCreateOptions(createOptions) : null);
  const validation = $derived(mode === 'create' ? validateWorktreeCreateOptions(createOptions) : null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending || validation) return;
    if (mode === 'create') {
      await onCreate?.({
        name: name.trim() || undefined,
        baseRef: includeLocalChanges ? undefined : baseRef.trim() || undefined,
        includeLocalChanges
      });
    } else {
      await onHandoff?.({ name: name.trim() || undefined, summary: summarySupported && summary ? true : undefined });
    }
  }
</script>

{#if open}
  <AppDialog
    bind:open
    title={mode === 'create' ? 'New worktree session' : 'Hand off worktree'}
    description={mode === 'create'
      ? `Start an isolated session in a new Git worktree. ${sourceTitle || 'The source session'} stays unchanged.`
      : `Start a fresh conversation in the same checkout. ${sourceTitle || 'This session'} stays readable but can no longer run.`}
    size="standard"
    {pending}
    closeLabel="Close worktree dialog"
    portalTarget={overlayPortalTarget}
  >
    <form id="worktree-session-form" class="app-dialog-form" onsubmit={submit}>
      <label class="app-dialog-field">
        <span class="app-dialog-field-label">Name (optional)</span>
        <input class="input-shell w-full" bind:value={name} placeholder="feature-x" aria-label="Worktree name" disabled={pending} />
      </label>

      {#if mode === 'create'}
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">Base ref (optional)</span>
          <input class="input-shell w-full" bind:value={baseRef} placeholder="main" aria-label="Base ref" disabled={pending} />
          <span class="app-dialog-field-help">Branch, tag or commit to start from.</span>
        </label>
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">
            <input type="checkbox" bind:checked={includeLocalChanges} disabled={pending} aria-label="Include local changes" />
            Include local changes
          </span>
          <span class="app-dialog-field-help">Copy uncommitted work into the worktree. Exclusive with a base ref.</span>
        </label>
        {#if conflict}<div class="alert-error" role="alert">{conflict}</div>{/if}
      {:else if summarySupported}
        <label class="app-dialog-field">
          <span class="app-dialog-field-label">
            <input type="checkbox" bind:checked={summary} disabled={pending} aria-label="Start with a summary" />
            Start with a summary
          </span>
          <span class="app-dialog-field-help">Seeds the new conversation with a summary of this one. This can take a few seconds.</span>
        </label>
      {/if}

      {#if validation && !conflict}<div class="alert-error" role="alert">{validation}</div>{/if}
      {#if error}<div class="alert-error" role="alert">{error}</div>{/if}
    </form>

    {#snippet footer()}
      <button class="action-btn" type="button" disabled={pending} onclick={() => (open = false)}>Cancel</button>
      <button class="action-btn action-btn-accent" form="worktree-session-form" type="submit" disabled={pending || !!validation}>
        {#if pending}<LoaderCircle size={15} class="animate-spin" />{/if}
        {#if mode === 'create'}{pending ? 'Creating...' : 'Create and open'}{:else}{pending ? 'Handing off...' : 'Hand off and open'}{/if}
      </button>
    {/snippet}
  </AppDialog>
{/if}
