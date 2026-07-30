<script lang="ts">
  import { Check, Copy } from '@lucide/svelte';
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

  let copiedPeerId = $state(false);

  const storeWarning = $derived.by(() => {
    if (!status?.enabled) return null;
    const missing = [];
    if (!status.has_mesh_state_store) missing.push('mesh state');
    if (!status.has_invite_store) missing.push('invite');
    return missing.length > 0 ? `${missing.join(' and ')} storage unavailable` : null;
  });

  function compactPeerId(peerId: string) {
    if (peerId.length <= 24) return peerId;
    return `${peerId.slice(0, 12)}...${peerId.slice(-8)}`;
  }

  async function copyPeerId(peerId: string) {
    try {
      await navigator.clipboard.writeText(peerId);
      copiedPeerId = true;
      window.setTimeout(() => (copiedPeerId = false), 1200);
    } catch (error) {
      console.error('Failed to copy peer ID', error);
    }
  }
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
      <span class="mesh-overview-context-item mesh-overview-peer">
        <span class="mesh-overview-context-label">Peer</span>
        {#if status.peer_id}
          <button
            class="mesh-overview-peer-button"
            type="button"
            aria-label={copiedPeerId ? 'Peer ID copied' : `Copy peer ID ${status.peer_id}`}
            title={status.peer_id}
            onclick={() => copyPeerId(status.peer_id!)}
          >
            <span>{compactPeerId(status.peer_id)}</span>
            {#if copiedPeerId}<Check size={11} aria-hidden="true" />{:else}<Copy size={11} aria-hidden="true" />{/if}
          </button>
        {:else}
          <span class="mesh-overview-context-value">Unavailable</span>
        {/if}
      </span>
      {#if status.transport}
        <span class="mesh-overview-context-item">
          <span class="mesh-overview-context-label">Transport</span>
          <span class="mesh-overview-context-value">{status.transport}</span>
        </span>
      {/if}
      <span class="mesh-overview-context-item">
        <span class="mesh-overview-context-label">Known peers</span>
        <span class="mesh-overview-context-value mesh-overview-context-count">{status.known_peer_count}</span>
      </span>
      {#if storeWarning}<span class="mesh-overview-context-item mesh-overview-warning" title={storeWarning}>{storeWarning}</span>{/if}
    </div>
  {/if}
</section>
