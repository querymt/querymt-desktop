<script lang="ts">
  import type { MeshStatusInfo } from '$lib/querymt/generated/types';

  let {
    status,
    nodeCount,
    activeSessionCount,
    activeInviteCount
  }: {
    status: MeshStatusInfo | null;
    nodeCount: number;
    activeSessionCount: number;
    activeInviteCount: number;
  } = $props();

  const storeWarning = $derived.by(() => {
    if (!status?.enabled) return null;
    const missing = [];
    if (!status.has_mesh_state_store) missing.push('mesh state');
    if (!status.has_invite_store) missing.push('invite');
    return missing.length > 0 ? `${missing.join(' and ')} storage unavailable` : null;
  });
</script>

<section class="mesh-overview" aria-label="Mesh overview">
  <div class="mesh-overview-stats">
    <div class="mesh-overview-stat">
      <span>Status</span>
      <strong class:mesh-overview-value-success={status?.enabled}>{status ? (status.enabled ? 'Enabled' : 'Disabled') : 'Not loaded'}</strong>
    </div>
    <div class="mesh-overview-stat">
      <span>Nodes</span>
      <strong>{nodeCount}</strong>
    </div>
    <div class="mesh-overview-stat">
      <span>Active sessions</span>
      <strong>{activeSessionCount}</strong>
    </div>
    <div class="mesh-overview-stat">
      <span>Active invites</span>
      <strong>{activeInviteCount}</strong>
    </div>
  </div>

  {#if status?.enabled && (status.peer_id || status.transport || storeWarning)}
    <div class="mesh-overview-context">
      <span>{status.peer_id ? `Peer ${status.peer_id}` : 'Peer identity unavailable'}</span>
      {#if status.transport}<span>{status.transport}</span>{/if}
      <span>{status.known_peer_count} known {status.known_peer_count === 1 ? 'peer' : 'peers'}</span>
      {#if storeWarning}<span class="mesh-overview-warning">{storeWarning}</span>{/if}
    </div>
  {/if}
</section>
