<script lang="ts">
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import AppSwitch from '$lib/components/primitives/AppSwitch.svelte';
  import { updatesStore } from '$lib/stores/updates.svelte';

  const channelOptions = [
    { value: 'stable', label: 'Stable' },
    { value: 'nightly', label: 'Nightly' }
  ];

  $effect(() => {
    void updatesStore.initialize();
  });

  const status = $derived(updatesStore.status);
  const state = $derived(updatesStore.state);
  const promptHidden = $derived(state.kind === 'available' && updatesStore.prompt === null);

  const statusText = $derived.by(() => {
    if (updatesStore.checking || state.kind === 'checking') return 'Checking for updates…';
    switch (state.kind) {
      case 'upToDate':
        return 'QueryMT is up to date.';
      case 'waiting':
        return `Waiting for a ${status?.channel ?? 'stable'} release newer than ${state.running}.`;
      case 'available':
        return `Version ${state.version} is available.`;
      case 'refused':
        return `Version ${state.version} is not offered: ${state.message}`;
      case 'installing':
        return `Installing ${state.version}…`;
      case 'installed':
        return `Version ${state.version} is installed. Restart QueryMT to use it.`;
      case 'error':
        return state.message;
      default:
        return status?.lastCheck ? 'No update found at the last check.' : 'Not checked yet.';
    }
  });

  const lastChecked = $derived(status?.lastCheck ? new Date(status.lastCheck * 1000).toLocaleString() : null);
  const busy = $derived(updatesStore.checking || state.kind === 'checking' || state.kind === 'installing');
</script>

<section class="settings-panel" aria-labelledby="updates-settings-title">
  <div class="settings-panel-header">
    <h2 id="updates-settings-title">Updates</h2>
    <p>Keep QueryMT Desktop and its bundled qmtcode current.</p>
  </div>

  {#if !status}
    <div class="surface-muted p-4 text-sm text-[var(--muted)]">
      {updatesStore.actionError ?? 'Update information is not available yet.'}
    </div>
  {:else}
    <div class="settings-simple-row">
      <div class="settings-simple-main">
        <h3>Current version</h3>
        <p>
          QueryMT Desktop <strong>{status.currentVersion}</strong>
          {#if status.qmtcodeVersion}
            with qmtcode <strong>{status.qmtcodeVersion}</strong>
          {/if}
        </p>
      </div>
    </div>

    <div class="settings-simple-row">
      <div class="settings-simple-main">
        <h3>Release channel</h3>
        <p>Nightly builds are newer but less tested. Switching never downgrades the app.</p>
      </div>
      <AppSelect
        value={status.channel}
        options={channelOptions}
        pill
        ariaLabel="Release channel"
        onValueChange={(value) => {
          if (value === 'stable' || value === 'nightly') void updatesStore.setChannel(value);
        }}
      />
    </div>

    <div class="settings-simple-row">
      <div class="settings-simple-main">
        <h3>Check automatically</h3>
        <p>Look for updates in the background. Nothing is downloaded until you choose to install.</p>
      </div>
      <AppSwitch
        checked={status.autoCheck}
        ariaLabel="Check for updates automatically"
        onCheckedChange={(checked) => void updatesStore.setAutoCheck(checked)}
      />
    </div>

    <div class="settings-simple-row">
      <div class="settings-simple-main">
        <h3>Update status</h3>
        <p
          role="status"
          class:settings-preference-error={state.kind === 'error' || state.kind === 'refused'}
        >
          {statusText}
        </p>
        {#if lastChecked}
          <p>Last checked {lastChecked}.</p>
        {/if}
        {#if updatesStore.actionError && updatesStore.actionError !== statusText}
          <p class="settings-preference-error" role="alert">{updatesStore.actionError}</p>
        {/if}
      </div>
      <div class="settings-update-actions">
        {#if promptHidden}
          <button class="action-btn" type="button" onclick={() => updatesStore.reopen()}>Review update</button>
        {/if}
        {#if state.kind === 'installed'}
          <button class="action-btn action-btn-primary" type="button" onclick={() => void updatesStore.restart()}>
            Restart now
          </button>
        {/if}
        <button class="action-btn" type="button" disabled={busy} onclick={() => void updatesStore.checkNow()}>
          {updatesStore.checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
    </div>
  {/if}
</section>
