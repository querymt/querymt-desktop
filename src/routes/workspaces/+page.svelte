<script lang="ts">
  import { goto } from '$app/navigation';
  import { FolderPlus, LoaderCircle } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import WorkspaceList from '$lib/components/primitives/WorkspaceList.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { WorkspaceItem } from '$lib/domain/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';

  async function useWorkspace(item: WorkspaceItem) {
    agentsStore.setComposerCwd(item.path);
    await goto('/sessions');
  }
</script>

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Workspaces"
      description="Folders available as context when starting a session."
    />
    <IconTooltipButton
      label={workspacesStore.loading ? 'Opening folder picker' : 'Pick folder'}
      icon={workspacesStore.loading ? LoaderCircle : FolderPlus}
      iconClass={workspacesStore.loading ? 'animate-spin' : ''}
      tone="primary"
      size={16}
      disabled={workspacesStore.loading}
      onclick={() => workspacesStore.addWorkspaceFromDialog()}
    />
  </div>

  <div class="settings-unified-panel">
    <WorkspaceList
      items={workspacesStore.items}
      loading={workspacesStore.loading}
      error={workspacesStore.error}
      onAddWorkspace={() => workspacesStore.addWorkspaceFromDialog()}
      onRetry={() => workspacesStore.addWorkspaceFromDialog()}
      onUseWorkspace={(item) => useWorkspace(item)}
      onRemoveWorkspace={(item) => workspacesStore.removeWorkspace(item.id)}
    />
  </div>
</div>
