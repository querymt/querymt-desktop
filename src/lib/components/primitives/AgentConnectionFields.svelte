<script lang="ts">
  import ConnectionTypeSwitch from './ConnectionTypeSwitch.svelte';
  import type { AgentConfig } from '$lib/domain/types';

  // Shared agent form fields: used by the Agents page dialog and the setup wizard.
  let {
    name = $bindable(''),
    transport = $bindable<AgentConfig['transport']>('stdio'),
    commandLine = $bindable(''),
    websocketUrl = $bindable(''),
    disabled = false,
    addressError = null
  }: {
    name?: string;
    transport?: AgentConfig['transport'];
    commandLine?: string;
    websocketUrl?: string;
    disabled?: boolean;
    addressError?: string | null;
  } = $props();

  const uid = $props.id();
  const addressErrorId = `${uid}-address-error`;
</script>

<label class="app-dialog-field">
  <span class="app-dialog-field-label">Agent name</span>
  <input class="input-shell w-full" placeholder="Agent name" bind:value={name} {disabled} />
  <span class="app-dialog-field-help">Shown in sidebars, settings, and session controls.</span>
</label>

<div class="app-dialog-field">
  <span class="app-dialog-field-label">Connection type</span>
  <ConnectionTypeSwitch bind:value={transport} {disabled} />
  <span class="app-dialog-field-help">Local processes are managed by Desktop. WebSocket agents run independently.</span>
</div>

{#if transport === 'stdio'}
  <label class="app-dialog-field">
    <span class="app-dialog-field-label">Command line</span>
    <input class="input-shell w-full" placeholder="/path/to/executable --acp" bind:value={commandLine} {disabled} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} inputmode="text" />
    <span class="app-dialog-field-help">Executable and arguments used to start the ACP agent.</span>
  </label>
{:else}
  <label class="app-dialog-field">
    <span class="app-dialog-field-label">Agent address</span>
    <input
      class="input-shell w-full"
      placeholder="127.0.0.1:3030"
      bind:value={websocketUrl}
      {disabled}
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck={false}
      inputmode="text"
      aria-invalid={addressError ? 'true' : undefined}
      aria-describedby={addressError ? addressErrorId : undefined}
    />
    <span class="app-dialog-field-help">Host and port of a running ACP WebSocket server (qmtcode --acp-ws).</span>
    {#if addressError}<span id={addressErrorId} class="app-dialog-field-error" role="alert">{addressError}</span>{/if}
  </label>
{/if}
