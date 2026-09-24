<script lang="ts">
  import { goto } from '$app/navigation';
  import { FolderPlus, LoaderCircle } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import WorkspaceList from '$lib/components/primitives/WorkspaceList.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { WorkspaceItem } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { isEmbedded } from '$lib/platform/runtime';

  let workspacePath = $state('');

  async function useWorkspace(item: WorkspaceItem) {
    agentsStore.setComposerCwd(item.path);
    await goto('/sessions');
  }

  function addServerWorkspace() {
    const path = workspacePath.trim();
    if (!path) return;
    workspacesStore.addWorkspacePath(path);
    workspacePath = '';
  }
</script>

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Workspaces"
      description={isEmbedded ? 'Server paths available as context when starting a session.' : 'Folders available as context when starting a session.'}
    />
    {#if !isEmbedded}
      <IconTooltipButton
        label={workspacesStore.loading ? 'Opening folder picker' : 'Pick folder'}
        icon={workspacesStore.loading ? LoaderCircle : FolderPlus}
        iconClass={workspacesStore.loading ? 'animate-spin' : ''}
        size={16}
        disabled={workspacesStore.loading}
        onclick={() => workspacesStore.addWorkspaceFromDialog()}
      />
    {/if}
  </div>

  <div class="settings-unified-panel">
    {#if isEmbedded}
      <form class="settings-section workspace-add-form" onsubmit={(event) => { event.preventDefault(); addServerWorkspace(); }}>
        <label class="app-dialog-field-label" for="workspace-server-path">Workspace path on qmtcode server</label>
        <div class="workspace-add-row">
          <input id="workspace-server-path" class="input-shell workspace-add-input" placeholder="/path/on/qmtcode/server" bind:value={workspacePath} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} />
          <button class="action-btn action-btn-primary workspace-add-action" type="submit" disabled={!workspacePath.trim()}>Add server path</button>
        </div>
      </form>
    {/if}
    <WorkspaceList
      items={workspacesStore.items}
      loading={workspacesStore.loading}
      error={workspacesStore.error}
      emptyDescription={isEmbedded ? 'Add an absolute path from the qmtcode server to use it when starting a session.' : 'Add a folder to use it as context when starting a session.'}
      onAddWorkspace={isEmbedded ? null : () => workspacesStore.addWorkspaceFromDialog()}
      onRetry={isEmbedded ? null : () => workspacesStore.addWorkspaceFromDialog()}
      onUseWorkspace={(item) => useWorkspace(item)}
      onRemoveWorkspace={(item) => workspacesStore.removeWorkspace(item.id)}
    />
  </div>
</div>
