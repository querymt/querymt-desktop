<script lang="ts">
  import { LoaderCircle, Network, RefreshCw, Ticket } from '@lucide/svelte';
  import MeshInviteDialog from '$lib/components/mesh/MeshInviteDialog.svelte';
  import MeshInviteList from '$lib/components/mesh/MeshInviteList.svelte';
  import MeshNodeList from '$lib/components/mesh/MeshNodeList.svelte';
  import MeshSummary from '$lib/components/mesh/MeshSummary.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import type { CreateMeshInviteRequest, MeshInviteCreatedInfo, MeshInviteInfo } from '$lib/querymt/generated/types';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';

  $effect(() => chatPreferencesStore.initialize());

  const meshAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.mesh && caps.methods.includes('querymt/mesh/status'));
    })
  );

  let selectedAgentId = $state('');
  let refreshingMesh = $state(false);
  let creatingInvite = $state(false);
  let inviteDialogOpen = $state(false);
  let inviteDialogError = $state<string | null>(null);
  let inviteResult = $state<MeshInviteCreatedInfo | null>(null);
  let revokingInviteId = $state<string | null>(null);
  let copiedInviteId = $state<string | null>(null);
  let copiedCreatedInvite = $state(false);
  let actionError = $state<string | null>(null);

  $effect(() => {
    if (!selectedAgentId && meshAgents.length > 0) selectedAgentId = meshAgents[0].id;
    if (selectedAgentId && !meshAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = meshAgents[0]?.id ?? '';
    }
  });

  const selectedCapabilities = $derived.by(() =>
    selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] ?? null : null
  );
  const meshStatus = $derived.by(() => selectedAgentId ? agentsStore.meshStatusByAgent[selectedAgentId] ?? null : null);
  const meshNodes = $derived.by(() => selectedAgentId ? agentsStore.meshNodesByAgent[selectedAgentId]?.nodes ?? [] : []);
  const meshInvites = $derived.by(() => selectedAgentId ? agentsStore.meshInvitesByAgent[selectedAgentId]?.invites ?? [] : []);
  const activeSessionCount = $derived(meshNodes.reduce((total, node) => total + node.active_sessions, 0));
  const activeInviteCount = $derived(meshInvites.filter((invite) => invite.status.toLowerCase() === 'active' && invite.expires_at * 1000 > Date.now()).length);

  function canRun(method: string) {
    return selectedCapabilities?.methods.includes(method) ?? false;
  }

  async function refreshMesh() {
    if (!selectedAgentId) return;
    refreshingMesh = true;
    actionError = null;
    try {
      await agentsStore.refreshMeshForAgent(selectedAgentId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to load mesh data.';
    } finally {
      refreshingMesh = false;
    }
  }

  function includeRemoteSessions(nodeId: string, enabled: boolean) {
    if (!chatPreferencesStore.showRemoteSessions) return;
    chatPreferencesStore.setRemoteSessionPeer(nodeId, enabled);
    void agentsStore.refreshAllSessions();
  }

  function openInviteDialog() {
    inviteDialogError = null;
    inviteResult = null;
    copiedCreatedInvite = false;
    inviteDialogOpen = true;
  }

  async function createInvite(request: CreateMeshInviteRequest) {
    if (!selectedAgentId) return;
    creatingInvite = true;
    inviteDialogError = null;
    try {
      inviteResult = await agentsStore.createMeshInvite(selectedAgentId, request);
    } catch (error) {
      inviteDialogError = error instanceof Error ? error.message : 'Failed to create invite.';
    } finally {
      creatingInvite = false;
    }
  }

  async function revokeInvite(invite: MeshInviteInfo) {
    if (!selectedAgentId || !window.confirm(`Revoke invite ${invite.invite_id}? It can no longer be used to join the mesh.`)) return;
    revokingInviteId = invite.invite_id;
    actionError = null;
    try {
      await agentsStore.revokeMeshInvite(selectedAgentId, invite.invite_id);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to revoke invite.';
    } finally {
      revokingInviteId = null;
    }
  }

  async function copyText(id: string, value: string, created = false) {
    try {
      await navigator.clipboard.writeText(value);
      if (created) copiedCreatedInvite = true;
      else copiedInviteId = id;
      window.setTimeout(() => {
        if (created) copiedCreatedInvite = false;
        else if (copiedInviteId === id) copiedInviteId = null;
      }, 1600);
    } catch {
      if (created) inviteDialogError = 'Failed to copy invite link.';
      else actionError = 'Failed to copy invite ID.';
    }
  }
</script>

<div class="settings-page mesh-page">
  <div class="page-toolbar mesh-page-toolbar">
    <SectionHeader title="Mesh" description="Manage remote nodes and invites." />
    <div class="mesh-page-actions">
      {#if meshAgents.length > 1}
        <AppSelect bind:value={selectedAgentId} options={meshAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Mesh agent" />
      {/if}
      <IconTooltipButton
        label={refreshingMesh ? 'Refreshing mesh' : 'Refresh mesh'}
        icon={refreshingMesh ? LoaderCircle : RefreshCw}
        iconClass={refreshingMesh ? 'animate-spin' : ''}
        size={16}
        disabled={!selectedAgentId || refreshingMesh}
        onclick={refreshMesh}
      />
    </div>
  </div>

  <div class="settings-unified-panel">
    {#if meshAgents.length === 0}
      <section class="settings-section" aria-label="Mesh availability">
        <div class="state-panel">
          <span class="state-panel-icon"><Network size={17} /></span>
          <div class="state-panel-copy">
            <strong>Mesh is not available</strong>
            <p>Connect an agent that supports mesh status to manage nodes and invites.</p>
          </div>
        </div>
      </section>
    {:else}
      <MeshSummary status={meshStatus} nodeCount={meshNodes.length} {activeSessionCount} {activeInviteCount} />

      {#if actionError}<div class="alert-error settings-section-message" role="alert">{actionError}</div>{/if}

      <section class="settings-section" aria-labelledby="mesh-nodes-title">
        <div class="settings-section-header mesh-section-header">
          <div>
            <h2 id="mesh-nodes-title">Nodes</h2>
            <p>Remote peers available through the selected agent.</p>
          </div>
        </div>
        <MeshNodeList nodes={meshNodes} onIncludeSessions={includeRemoteSessions} />
      </section>

      {#if selectedCapabilities?.features.mesh_invites || meshInvites.length > 0}
        <section class="settings-section" aria-labelledby="mesh-invites-title">
          <div class="settings-section-header settings-section-header-action mesh-section-header">
            <div>
              <h2 id="mesh-invites-title">Invites</h2>
              <p>Access links for peers joining this mesh.</p>
            </div>
            <IconTooltipButton label="Create mesh invite" icon={Ticket} disabled={!canRun('querymt/mesh/createInvite')} onclick={openInviteDialog} />
          </div>
          <MeshInviteList
            invites={meshInvites}
            {copiedInviteId}
            {revokingInviteId}
            canRevoke={canRun('querymt/mesh/revokeInvite')}
            onCopy={(invite) => copyText(invite.invite_id, JSON.stringify(invite))}
            onRevoke={revokeInvite}
          />
        </section>
      {/if}
    {/if}
  </div>
</div>

<MeshInviteDialog
  bind:open={inviteDialogOpen}
  pending={creatingInvite}
  error={inviteDialogError}
  result={inviteResult}
  copied={copiedCreatedInvite}
  onCreate={createInvite}
  onCopy={(invite) => copyText(invite.invite_id, invite.url, true)}
/>
