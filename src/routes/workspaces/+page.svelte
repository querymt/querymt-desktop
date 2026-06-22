<script lang="ts">
  import { goto } from '$app/navigation';
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

<div class="space-y-4 page-width-wide">
  <SectionHeader
    eyebrow="Desktop context"
    title="Workspaces"
    description="Desktop contexts and folder shortcuts for starting work with any configured agent."
  />

  <WorkspaceList
    items={workspacesStore.items}
    loading={workspacesStore.loading}
    error={workspacesStore.error}
    onAddWorkspace={() => workspacesStore.addWorkspaceFromDialog()}
    onUseWorkspace={(item) => useWorkspace(item)}
  />
</div>
