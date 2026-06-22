<script lang="ts">
  import { Clipboard, Link, Plus, RefreshCw, Ticket, Trash2, XCircle } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import SectionHeader from '$lib/components/primitives/SectionHeader.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { commandPaletteStore } from '$lib/stores/command-palette.svelte';

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
  let copiedInviteId = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  $effect(() => {
    if (!selectedAgentId && meshAgents.length > 0) {
      selectedAgentId = meshAgents[0].id;
    }
    if (selectedAgentId && !meshAgents.some((agent) => agent.id === selectedAgentId)) {
      selectedAgentId = meshAgents[0]?.id ?? '';
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

  function selectedCapabilitySummary() {
    if (!selectedCapabilities) return loading ? 'Refreshing mesh capabilities' : 'No capabilities reported yet';

    const details = [`API v${selectedCapabilities.querymt_control_version}`];
    if (selectedCapabilities.features.mesh) details.push('Mesh');
    if (selectedCapabilities.features.mesh_invites) details.push('Invites');
    if (selectedCapabilities.features.remote_sessions) details.push('Remote sessions');
    return details.join(' · ');
  }

  function meshStatusSummary() {
    if (!meshStatus) return 'No mesh status loaded yet';
    return meshStatus.enabled ? 'Enabled' : 'Disabled';
  }

  function meshPeerSummary() {
    if (!meshStatus) return 'Refresh mesh data to inspect peer details';
    const details = [];
    if (meshStatus.peer_id) details.push(`Peer ${meshStatus.peer_id}`);
    if (meshStatus.transport) details.push(meshStatus.transport);
    details.push(`${meshStatus.known_peer_count} peers`);
    return details.join(' · ');
  }

  function meshStoreSummary() {
    if (!meshStatus) return 'Refresh mesh data to inspect local stores';
    return `Invite store ${meshStatus.has_invite_store ? 'ready' : 'missing'} · State store ${meshStatus.has_mesh_state_store ? 'ready' : 'missing'}`;
  }

  function remoteSessionsFor(nodeId: string) {
    return selectedAgentId ? agentsStore.remoteSessionsByAgent[selectedAgentId]?.[nodeId]?.sessions ?? [] : [];
  }

  async function copyInviteUrl(inviteId: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copiedInviteId = inviteId;
      window.setTimeout(() => {
        if (copiedInviteId === inviteId) copiedInviteId = null;
      }, 1600);
    } catch {
      actionError = 'Failed to copy invite link.';
    }
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

  function openRemoteCreate(nodeId: string | null = null) {
    commandPaletteStore.openRemoteCreate({
      agentId: selectedAgentId || null,
      nodeId
    });
  }

  function openRemoteAttach(nodeId: string | null = null, sessionId: string | null = null) {
    commandPaletteStore.openRemoteAttach({
      agentId: selectedAgentId || null,
      nodeId,
      sessionId
    });
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

<div class="settings-page">
  <div class="page-toolbar">
    <SectionHeader
      title="Mesh"
      description="Manage mesh status, invites, and remote sessions."
    />
  </div>

  <div class="settings-unified-panel">
    {#if meshAgents.length === 0}
      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2>Mesh</h2>
            <p>No connected agents currently advertise `querymt/mesh/status`.</p>
          </div>
        </div>
      </section>
    {:else}
      <section class="settings-section">
        <div class="settings-section-header settings-section-header-action">
          <div>
            <h2>Agent</h2>
            <p>Choose the active agent and inspect mesh connectivity.</p>
          </div>
          <IconTooltipButton label="Refresh mesh" icon={RefreshCw} size={16} disabled={!selectedAgentId || loading} onclick={() => refreshMesh()} />
        </div>

        <div class="settings-preference-list">
          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Active agent</div>
              <div class="settings-preference-description">{selectedCapabilitySummary()}</div>
            </div>
            <AppSelect bind:value={selectedAgentId} options={meshAgents.map((agent) => ({ value: agent.id, label: agent.name }))} pill ariaLabel="Agent" />
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Status</div>
              <div class="settings-preference-description">{meshStatusSummary()}</div>
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Peer</div>
              <div class="settings-preference-description">{meshPeerSummary()}</div>
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Stores</div>
              <div class="settings-preference-description">{meshStoreSummary()}</div>
            </div>
          </div>
        </div>
      </section>

      {#if actionError}
        <div class="alert-error settings-section-message">
          {actionError}
        </div>
      {/if}

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2>Invites</h2>
            <p>Create and revoke mesh invites from the selected agent.</p>
          </div>
        </div>

        <div class="settings-preference-list">
          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Invite TTL</div>
              <div class="settings-preference-description">How long a generated invite remains valid.</div>
            </div>
            <div class="settings-preference-control">
              <input class="input-shell" bind:value={inviteTtl} placeholder="24h" />
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Max uses</div>
              <div class="settings-preference-description">Limit how many times the invite can be consumed.</div>
            </div>
            <div class="settings-preference-control">
              <input class="input-shell" bind:value={inviteMaxUses} placeholder="1" />
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Create invite</div>
              <div class="settings-preference-description">Generate a new invite with the values above.</div>
            </div>
            <div class="settings-preference-actions-single">
              <button class="action-btn action-btn-primary" type="button" disabled={!canRun('querymt/mesh/createInvite') || loading} onclick={() => createInvite()}>
                <Ticket size={15} />
                Create
              </button>
            </div>
          </div>
        </div>

        {#if lastInvite}
          <div class="mesh-created-invite">
            <div class="mesh-created-invite-main">
              <div class="mesh-created-invite-eyebrow">Invite created</div>
              <div class="mesh-created-invite-id">{lastInvite.invite_id}</div>
              <div class="mesh-created-invite-url" title={lastInvite.url}>{lastInvite.url}</div>
            </div>
            <button class="action-btn" type="button" onclick={() => copyInviteUrl(lastInvite.invite_id, lastInvite.url)}>
              <Clipboard size={15} />
              {copiedInviteId === lastInvite.invite_id ? 'Copied' : 'Copy link'}
            </button>
          </div>
        {/if}
        {#if lastRevoke}
          <div class="settings-inline-note">Last revoke: {lastRevoke.invite_id} ({lastRevoke.success ? 'ok' : 'failed'})</div>
        {/if}

        <div class="settings-subsection">
          <div class="settings-subsection-header">
            <h3>Current invites</h3>
            <p>Invite tokens exposed by the selected agent.</p>
          </div>

          {#if meshInvites.length === 0}
            <div class="empty-state">No invites available yet.</div>
          {:else}
            <div class="mesh-item-list">
              {#each meshInvites as invite}
                <article class="mesh-item-row">
                  <div class="mesh-item-main">
                    <div class="mesh-item-title">{invite.invite_id}</div>
                    <div class="mesh-item-description">{invite.mesh_name ?? 'Default mesh'}</div>
                    <div class="mesh-item-meta">{invite.status} · uses left {invite.uses_remaining} · max uses {invite.max_uses} · expires {new Date(invite.expires_at * 1000).toLocaleString()}</div>
                  </div>
                  <div class="mesh-item-actions">
                    <IconTooltipButton label="Revoke" icon={Trash2} tone="danger" disabled={!canRun('querymt/mesh/revokeInvite') || loading} onclick={() => revokeInvite(invite.invite_id)} />
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2>Remote sessions</h2>
            <p>Create or attach remote sessions before loading their activity below.</p>
          </div>
        </div>

        <div class="settings-preference-list">
          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Create remote session</div>
              <div class="settings-preference-description">Open the remote session dialog with this agent preselected.</div>
            </div>
            <div class="settings-preference-actions-single">
              <button class="action-btn action-btn-primary" type="button" disabled={!canRun('querymt/remote/createSession') || loading} onclick={() => openRemoteCreate()}>
                <Plus size={15} />
                Create
              </button>
            </div>
          </div>

          <div class="settings-preference-row">
            <div class="settings-preference-main">
              <div class="settings-preference-title">Attach remote session</div>
              <div class="settings-preference-description">Open the attach dialog with this agent preselected.</div>
            </div>
            <div class="settings-preference-actions-single">
              <button class="action-btn" type="button" disabled={!canRun('querymt/remote/attachSession') || loading} onclick={() => openRemoteAttach()}>
                <Link size={15} />
                Attach
              </button>
            </div>
          </div>
        </div>

        {#if lastAttach}
          <div class="settings-inline-note">Last remote attach: {lastAttach.session_id} on {lastAttach.node_id} ({lastAttach.attached ? 'attached' : 'not attached'})</div>
        {/if}
      </section>

      <section class="settings-section">
        <div class="settings-section-header">
          <div>
            <h2>Nodes</h2>
            <p>Live remote nodes plus on-demand remote session lookup.</p>
          </div>
        </div>

        {#if meshNodes.length === 0}
          <div class="empty-state">No mesh nodes reported yet.</div>
        {:else}
          <div class="mesh-item-list">
            {#each meshNodes as node}
              <article class="mesh-item-row mesh-item-row-stacked">
                <div class="mesh-item-main">
                  <div class="mesh-item-title">{node.label}</div>
                  <div class="mesh-item-description">{node.id}</div>
                  <div class="mesh-item-meta">{node.transport} · {node.active_sessions} active{node.last_seen_at ? ` · last seen ${node.last_seen_at}` : ''}</div>
                  {#if node.capabilities.length > 0}
                    <div class="mesh-item-meta">{node.capabilities.join(' · ')}</div>
                  {/if}
                </div>
                <div class="mesh-item-actions">
                  <IconTooltipButton label="Create remote session" icon={Plus} disabled={!canRun('querymt/remote/createSession') || loading} onclick={() => openRemoteCreate(node.id)} />
                  <IconTooltipButton label="Attach remote session" icon={Link} disabled={!canRun('querymt/remote/attachSession') || loading} onclick={() => openRemoteAttach(node.id)} />
                  <IconTooltipButton label="Load remote sessions" icon={RefreshCw} disabled={!canRun('querymt/remote/sessions') || loading} onclick={() => loadRemoteSessions(node.id)} />
                </div>

                {#if remoteSessionsFor(node.id).length > 0}
                  <div class="mesh-remote-session-list">
                    {#each remoteSessionsFor(node.id) as session}
                      <div class="mesh-remote-session-row">
                        <div class="mesh-item-main">
                          <div class="mesh-item-title">{session.title ?? session.id}</div>
                          <div class="mesh-item-description">{session.cwd ?? 'No cwd'} · {session.updated_at ?? 'No activity yet'}</div>
                        </div>
                        <div class="mesh-item-actions">
                          <IconTooltipButton label="Attach" icon={Link} disabled={!canRun('querymt/remote/attachSession') || loading} onclick={() => openRemoteAttach(node.id, session.id)} />
                          <IconTooltipButton label="Dismiss" icon={XCircle} disabled={!canRun('querymt/remote/dismissSession') || loading} onclick={() => dismissRemoteSession(node.id, session.id)} />
                        </div>
                      </div>
                    {/each}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}

        {#if lastDismiss}
          <div class="settings-inline-note">Last remote dismiss: {lastDismiss.session_id} ({lastDismiss.success ? 'ok' : 'failed'})</div>
        {/if}
      </section>
    {/if}
  </div>
</div>
