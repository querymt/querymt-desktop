<script lang="ts">
  import { goto } from '$app/navigation';
  import { FolderPlus, LoaderCircle } from '@lucide/svelte';
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
      <!-- Labelled neutral button like "New automation"; stays enabled while the picker is open
           so focus does not jump, and ignores clicks until it closes. -->
      <button
        class="action-btn"
        type="button"
        aria-busy={workspacesStore.loading || undefined}
        onclick={() => { if (!workspacesStore.loading) void workspacesStore.addWorkspaceFromDialog(); }}
      >
        {#if workspacesStore.loading}<LoaderCircle size={15} class="animate-spin" />Opening folder picker…{:else}<FolderPlus size={15} />Add folder{/if}
      </button>
    {/if}
  </div>

  <div class="settings-unified-panel">
    {#if isEmbedded}
      <form class="settings-section workspace-add-form" onsubmit={(event) => { event.preventDefault(); addServerWorkspace(); }}>
        <label class="app-dialog-field-label" for="workspace-server-path">Workspace path on qmtcode server</label>
        <div class="workspace-add-row">
          <input id="workspace-server-path" class="input-shell workspace-add-input" placeholder="/path/on/qmtcode/server" bind:value={workspacePath} autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck={false} />
          <button class="action-btn workspace-add-action" type="submit" disabled={!workspacePath.trim()}>Add server path</button>
        </div>
      </form>
    {/if}
    <WorkspaceList
      items={workspacesStore.items}
      loading={workspacesStore.loading}
      error={workspacesStore.error}
      addLabel="Add folder"
      emptyDescription={isEmbedded ? 'Add an absolute path from the qmtcode server to use it when starting a session.' : 'Add a folder to use it as context when starting a session.'}
      onAddWorkspace={isEmbedded ? null : () => workspacesStore.addWorkspaceFromDialog()}
      onRetry={isEmbedded ? null : () => workspacesStore.addWorkspaceFromDialog()}
      onUseWorkspace={(item) => useWorkspace(item)}
      onRemoveWorkspace={(item) => workspacesStore.removeWorkspace(item.id)}
    />
  </div>
</div>
