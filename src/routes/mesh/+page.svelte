<script lang="ts">
  import { Link, Plus, RefreshCw, Ticket, Trash2, XCircle } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';

  const meshAgents = $derived.by(() =>
    agentsStore.configs.filter((config) => {
      const caps = agentsStore.controlCapabilitiesByAgent[config.id];
      return Boolean(caps?.features.mesh && caps.methods.includes('querymt/mesh/status'));
    })
  );

  let selectedAgentId = $state<string>('');
  let loading = $state(false);
  let inviteTtl = $state('24h');
  let inviteMaxUses = $state('1');
  let remoteNodeId = $state('');
  let remoteCwd = $state('');
  let attachSessionId = $state('');
  let attachNodeId = $state('');
  let actionError = $state<string | null>(null);

  $effect(() => {
    if (!selectedAgentId && meshAgents.length > 0) {
      selectedAgentId = meshAgents[0].id;
    }
    if (selectedAgentId && !meshAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = meshAgents[0]?.id ?? '';
    }
    if (!remoteNodeId && meshNodes.length > 0) {
      remoteNodeId = meshNodes[0].id;
    }
    if (!attachNodeId && meshNodes.length > 0) {
      attachNodeId = meshNodes[0].id;
    }
  });

  const selectedCapabilities = $derived.by(
    () => (selectedAgentId ? agentsStore.controlCapabilitiesByAgent[selectedAgentId] ?? null : null)
  );
  const meshStatus = $derived.by(
    () => (selectedAgentId ? agentsStore.meshStatusByAgent[selectedAgentId] ?? null : null)
  );
  const meshNodes = $derived.by(
    () => (selectedAgentId ? agentsStore.meshNodesByAgent[selectedAgentId]?.nodes ?? [] : [])
  );
  const meshInvites = $derived.by(
    () => (selectedAgentId ? agentsStore.meshInvitesByAgent[selectedAgentId]?.invites ?? [] : [])
  );
  const lastInvite = $derived.by(
    () => (selectedAgentId ? agentsStore.lastMeshInviteByAgent[selectedAgentId] ?? null : null)
  );
  const lastRevoke = $derived.by(
    () => (selectedAgentId ? agentsStore.lastMeshRevokeByAgent[selectedAgentId] ?? null : null)
  );
  const lastAttach = $derived.by(
    () => (selectedAgentId ? agentsStore.lastRemoteAttachByAgent[selectedAgentId] ?? null : null)
  );
  const lastDismiss = $derived.by(
    () => (selectedAgentId ? agentsStore.lastRemoteDismissByAgent[selectedAgentId] ?? null : null)
  );

  function canRun(method: string) {
    return selectedCapabilities?.methods.includes(method) ?? false;
  }

  function remoteSessionsFor(nodeId: string) {
    return selectedAgentId ? agentsStore.remoteSessionsByAgent[selectedAgentId]?.[nodeId]?.sessions ?? [] : [];
  }

  async function refreshMesh() {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.refreshMeshForAgent(selectedAgentId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to load mesh data.';
    } finally {
      loading = false;
    }
  }

  async function loadRemoteSessions(nodeId: string) {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.refreshRemoteSessionsForAgent(selectedAgentId, nodeId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to load remote sessions.';
    } finally {
      loading = false;
    }
  }

  async function createInvite() {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.createMeshInvite(selectedAgentId, {
        ttl: inviteTtl || undefined,
        max_uses: inviteMaxUses ? Number(inviteMaxUses) : undefined
      });
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to create invite.';
    } finally {
      loading = false;
    }
  }

  async function createRemoteSession() {
    if (!selectedAgentId || !remoteNodeId.trim()) {
      actionError = 'Node id is required to create a remote session.';
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.createRemoteSession(selectedAgentId, remoteNodeId.trim(), remoteCwd.trim() || undefined);
      remoteCwd = '';
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to create remote session.';
    } finally {
      loading = false;
    }
  }

  async function attachRemoteSession() {
    if (!selectedAgentId || !attachNodeId.trim() || !attachSessionId.trim()) {
      actionError = 'Node id and session id are required to attach a remote session.';
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.attachRemoteSession(selectedAgentId, attachNodeId.trim(), attachSessionId.trim());
      attachSessionId = '';
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to attach remote session.';
    } finally {
      loading = false;
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.revokeMeshInvite(selectedAgentId, inviteId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to revoke invite.';
    } finally {
      loading = false;
    }
  }

  async function dismissRemoteSession(nodeId: string, sessionId: string) {
    if (!selectedAgentId) {
      return;
    }
    loading = true;
    actionError = null;
    try {
      await agentsStore.dismissRemoteSession(selectedAgentId, nodeId, sessionId);
    } catch (error) {
      actionError = error instanceof Error ? error.message : 'Failed to dismiss remote session.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="space-y-4 page-width-wide">
  <div class="page-toolbar">
    <SectionHeader
      eyebrow="Remote control"
      title="Mesh"
      description="Live mesh topology, invite management, and remote session visibility for agents that expose QueryMT mesh controls."
    />

    <div class="compact-toolbar">
      <button class="icon-btn" type="button" aria-label="Refresh mesh" disabled={!selectedAgentId || loading} onclick={() => refreshMesh()}>
        <RefreshCw size={16} />
      </button>
    </div>
  </div>

  {#if meshAgents.length === 0}
    <div class="panel empty-state p-6 text-sm text-[var(--muted)]">
      No connected agents currently advertise `querymt/mesh/status`.
    </div>
  {:else}
    <section class="panel p-4 space-y-4">
      <div class="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-end">
        <label class="space-y-2">
          <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Agent</span>
          <AppSelect bind:value={selectedAgentId} options={meshAgents.map((agent) => ({ value: agent.id, label: agent.name }))} ariaLabel="Agent" />
        </label>

        <div class="flex flex-wrap gap-2 text-xs">
          {#if selectedCapabilities}
            <span class="badge">api v{selectedCapabilities.querymt_control_version}</span>
            {#if selectedCapabilities.features.mesh}<span class="badge">mesh</span>{/if}
            {#if selectedCapabilities.features.mesh_invites}<span class="badge">invites</span>{/if}
            {#if selectedCapabilities.features.remote_sessions}<span class="badge">remote sessions</span>{/if}
          {/if}
        </div>
      </div>

      {#if actionError}
        <div class="alert-error">
          {actionError}
        </div>
      {/if}

      {#if meshStatus}
        <article class="surface-muted p-4 space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge">{meshStatus.enabled ? 'enabled' : 'disabled'}</span>
            {#if meshStatus.peer_id}<span class="badge">peer {meshStatus.peer_id}</span>{/if}
            {#if meshStatus.transport}<span class="badge">{meshStatus.transport}</span>{/if}
            <span class="badge">{meshStatus.known_peer_count} peers</span>
          </div>
          <div class="text-xs text-[var(--muted)]">
            invite store {meshStatus.has_invite_store ? 'ready' : 'missing'} • state store {meshStatus.has_mesh_state_store ? 'ready' : 'missing'}
          </div>
        </article>
      {/if}

      <div class="grid gap-4 xl:grid-cols-2">
        <article class="surface-muted p-4 space-y-3">
          <div>
            <h2 class="panel-title">Invite controls</h2>
            <p class="panel-copy mt-1">Create and revoke mesh invites from the selected agent.</p>
          </div>

          <div class="flex flex-wrap items-end gap-3">
            <label class="space-y-2">
              <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Invite TTL</span>
              <input class="input-shell" bind:value={inviteTtl} placeholder="24h" />
            </label>
            <label class="space-y-2">
              <span class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Max Uses</span>
              <input class="input-shell" bind:value={inviteMaxUses} placeholder="1" />
            </label>
            <button class="action-btn action-btn-primary" type="button" disabled={!canRun('querymt/mesh/createInvite') || loading} onclick={() => createInvite()}>
              <Ticket size={15} />
              Create Invite
            </button>
          </div>

          {#if lastInvite}
            <div class="alert-success">
              Created invite {lastInvite.invite_id}: {lastInvite.url}
            </div>
          {/if}
          {#if lastRevoke}
            <div class="text-xs text-[var(--muted)]">Last revoke: {lastRevoke.invite_id} ({lastRevoke.success ? 'ok' : 'failed'})</div>
          {/if}
        </article>

        <article class="surface-muted p-4 space-y-4">
          <div>
            <h2 class="panel-title">Remote session controls</h2>
            <p class="panel-copy mt-1">Create or attach remote sessions before loading their activity below.</p>
          </div>

          <div class="grid gap-3 lg:grid-cols-2">
            <input class="input-shell" bind:value={remoteNodeId} placeholder="Node id" />
            <input class="input-shell" bind:value={remoteCwd} placeholder="Working directory (optional)" />
          </div>
          <button class="action-btn action-btn-primary" type="button" disabled={!canRun('querymt/remote/createSession') || loading} onclick={() => createRemoteSession()}>
            <Plus size={15} />
            Create Remote Session
          </button>

          <div class="grid gap-3 lg:grid-cols-2">
            <input class="input-shell" bind:value={attachNodeId} placeholder="Node id" />
            <input class="input-shell" bind:value={attachSessionId} placeholder="Existing session id" />
          </div>
          <button class="action-btn" type="button" disabled={!canRun('querymt/remote/attachSession') || loading} onclick={() => attachRemoteSession()}>
            <Link size={15} />
            Attach Remote Session
          </button>

          {#if lastAttach}
            <div class="text-xs text-[var(--muted)]">Last remote attach: {lastAttach.session_id} on {lastAttach.node_id} ({lastAttach.attached ? 'attached' : 'not attached'})</div>
          {/if}
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section class="space-y-3">
          <div>
            <h2 class="panel-title">Nodes</h2>
            <p class="panel-copy mt-1">Live remote nodes plus on-demand remote session lookup.</p>
          </div>

          {#if meshNodes.length === 0}
            <div class="empty-state">No mesh nodes reported yet.</div>
          {:else}
            {#each meshNodes as node}
              <article class="surface-muted p-4 space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-medium">{node.label}</div>
                    <div class="mt-1 text-xs text-[var(--muted)]">{node.id}</div>
                  </div>
                  <div class="compact-toolbar">
                    <span class="badge">{node.transport}</span>
                    <span class="badge">{node.active_sessions} active</span>
                    <button class="icon-btn" type="button" aria-label={`Load remote sessions for ${node.label}`} disabled={!canRun('querymt/remote/sessions') || loading} onclick={() => loadRemoteSessions(node.id)}>
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </div>

                <div class="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                  {#each node.capabilities as capability}
                    <span class="badge">{capability}</span>
                  {/each}
                  {#if node.last_seen_at}<span>last seen {node.last_seen_at}</span>{/if}
                </div>

                {#if remoteSessionsFor(node.id).length > 0}
                  <details class="details-reset surface-muted px-4 py-3" open>
                    <summary class="flex items-center justify-between gap-3 text-sm font-medium">
                      <span>Remote sessions</span>
                      <span class="panel-copy">{remoteSessionsFor(node.id).length}</span>
                    </summary>
                    <div class="mt-3 space-y-2">
                      {#each remoteSessionsFor(node.id) as session}
                        <div class="surface-muted flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-sm">
                          <div>
                            <div class="font-medium">{session.title ?? session.id}</div>
                            <div class="mt-1 text-xs text-[var(--muted)]">{session.cwd ?? 'No cwd'} • {session.updated_at ?? 'No activity yet'}</div>
                          </div>
                          <button class="icon-btn" type="button" aria-label={`Dismiss ${session.id}`} disabled={!canRun('querymt/remote/dismissSession') || loading} onclick={() => dismissRemoteSession(node.id, session.id)}>
                            <XCircle size={15} />
                          </button>
                        </div>
                      {/each}
                    </div>
                  </details>
                {/if}
              </article>
            {/each}
          {/if}
        </section>

        <section class="space-y-3">
          <div>
            <h2 class="panel-title">Invites</h2>
            <p class="panel-copy mt-1">Current invite tokens exposed by the selected agent.</p>
          </div>

          {#if meshInvites.length === 0}
            <div class="empty-state">No invites available yet.</div>
          {:else}
            {#each meshInvites as invite}
              <article class="surface-muted p-4 space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="text-sm font-medium">{invite.invite_id}</div>
                    <div class="mt-1 text-xs text-[var(--muted)]">{invite.mesh_name ?? 'Default mesh'}</div>
                  </div>
                  <div class="compact-toolbar">
                    <span class="badge">{invite.status}</span>
                    <button class="icon-btn" type="button" aria-label={`Revoke ${invite.invite_id}`} disabled={!canRun('querymt/mesh/revokeInvite') || loading} onclick={() => revokeInvite(invite.invite_id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                  <span>uses left {invite.uses_remaining}</span>
                  <span>• max uses {invite.max_uses}</span>
                  <span>• expires {new Date(invite.expires_at * 1000).toLocaleString()}</span>
                </div>
              </article>
            {/each}
          {/if}
        </section>
      </div>

      {#if lastDismiss}
        <div class="text-xs text-[var(--muted)]">Last remote dismiss: {lastDismiss.session_id} ({lastDismiss.success ? 'ok' : 'failed'})</div>
      {/if}
    </section>
  {/if}
</div>
