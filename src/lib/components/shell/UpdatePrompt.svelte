<script lang="ts">
  import { openExternalUrl } from '$native';
  import { updatesStore } from '$lib/stores/updates.svelte';

  const prompt = $derived(updatesStore.prompt);
  const progress = $derived(updatesStore.progress);
  const percent = $derived(
    progress && progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null
  );

  /** Installs the update and restarts if the install finished. */
  async function installAndRestart() {
    await updatesStore.install();
    if (updatesStore.state.kind === 'installed') await updatesStore.restart();
  }

  /** Opens the release page, reporting a failure to open it. */
  async function openRelease(url: string) {
    try {
      await openExternalUrl(url);
    } catch (error) {
      updatesStore.actionError = error instanceof Error ? error.message : 'Could not open the release page.';
    }
  }
</script>

{#if prompt}
  <aside class="update-prompt" role="region" aria-label="Update available">
    {#if prompt.kind === 'available'}
      <strong>QueryMT {prompt.version} is available</strong>
      {#if prompt.qmtcodeVersion}
        <p>Includes qmtcode {prompt.qmtcodeVersion}.</p>
      {/if}
      {#if !prompt.canInstall}
        <p>This install cannot update itself. Download the new version from the release page.</p>
      {/if}
      {#if updatesStore.actionError}
        <p class="update-prompt-error" role="alert">{updatesStore.actionError}</p>
      {/if}
      <div class="update-prompt-actions">
        {#if prompt.canInstall}
          <button class="action-btn action-btn-primary" type="button" onclick={() => void installAndRestart()}>
            Install &amp; restart
          </button>
        {:else}
          <button class="action-btn action-btn-primary" type="button" onclick={() => void openRelease(prompt.releaseUrl)}>
            View release
          </button>
        {/if}
        <button class="action-btn" type="button" onclick={() => updatesStore.later(prompt.version)}>Later</button>
        <button class="action-btn" type="button" onclick={() => void updatesStore.skip(prompt.version)}>
          Skip this version
        </button>
      </div>
    {:else if prompt.kind === 'error'}
      <strong>The update could not be installed</strong>
      <p class="update-prompt-error" role="alert">{updatesStore.actionError ?? updatesStore.installError ?? prompt.message}</p>
      <div class="update-prompt-actions">
        <button class="action-btn action-btn-primary" type="button" onclick={() => void updatesStore.checkNow()}>
          Check again
        </button>
        <button class="action-btn" type="button" onclick={() => updatesStore.dismissInstallError()}>Dismiss</button>
      </div>
    {:else if prompt.kind === 'installing'}
      <strong>Installing QueryMT {prompt.version}…</strong>
      {#if percent !== null}
        <progress max="100" value={percent} aria-label="Download progress"></progress>
        <p>{percent}%</p>
      {:else}
        <progress aria-label="Download progress"></progress>
      {/if}
    {:else if prompt.kind === 'installed'}
      <strong>QueryMT {prompt.version} is installed</strong>
      <p>Restart to start using it.</p>
      {#if updatesStore.actionError}
        <p class="update-prompt-error" role="alert">{updatesStore.actionError}</p>
      {/if}
      <div class="update-prompt-actions">
        <button class="action-btn action-btn-primary" type="button" onclick={() => void updatesStore.restart()}>
          Restart now
        </button>
        <button class="action-btn" type="button" onclick={() => updatesStore.later(prompt.version)}>Later</button>
      </div>
    {/if}
  </aside>
{/if}
