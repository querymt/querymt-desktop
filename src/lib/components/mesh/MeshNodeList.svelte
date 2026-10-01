<script lang="ts">
  import { Check, Copy, Info } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import AppSwitch from '$lib/components/primitives/AppSwitch.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import type { RemoteNodeInfo } from '$lib/querymt/generated/types';

  let {
    nodes,
    onIncludeSessions
  }: {
    nodes: RemoteNodeInfo[];
    onIncludeSessions: (nodeId: string, enabled: boolean) => void;
  } = $props();

  let copiedNodeId = $state<string | null>(null);
  const sortedNodes = $derived([...nodes].sort((a, b) => a.id.localeCompare(b.id)));

  function compactNodeId(nodeId: string) {
    if (nodeId.length <= 24) return nodeId;
    return `${nodeId.slice(0, 12)}...${nodeId.slice(-8)}`;
  }

  async function copyNodeId(nodeId: string) {
    try {
      await navigator.clipboard.writeText(nodeId);
      copiedNodeId = nodeId;
      window.setTimeout(() => {
        if (copiedNodeId === nodeId) copiedNodeId = null;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy remote peer ID', error);
    }
  }

  function visibleTransport(value: string) {
    const transport = value.trim();
    return transport && transport.toLowerCase() !== 'unknown' ? transport : null;
  }

  function lastSeenLabel(value?: string) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return value;

    const elapsedMs = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

{#if nodes.length === 0}
  <div class="mesh-empty-row">No mesh nodes reported. Refresh the mesh to check for available peers.</div>
{:else}
  <div class="mesh-item-list mesh-node-list">
    {#each sortedNodes as node (node.id)}
      <article class="mesh-item-row mesh-item-row-stacked">
        <div class="mesh-item-main">
          <div class="mesh-node-title-line">
            <div class="mesh-item-title">{node.label || node.id}</div>
            <span class="mesh-node-session-count">{node.active_sessions} active</span>
          </div>
          <div class="mesh-item-description mesh-node-description">
            <button
              class="mesh-node-peer-button"
              type="button"
              aria-label={copiedNodeId === node.id ? 'Remote peer ID copied' : `Copy remote peer ID ${node.id}`}
              title={node.id}
              onclick={() => copyNodeId(node.id)}
            >
              <span>{compactNodeId(node.id)}</span>
              {#if copiedNodeId === node.id}<Check size={11} aria-hidden="true" />{:else}<Copy size={11} aria-hidden="true" />{/if}
            </button>
            {#if visibleTransport(node.transport)}
              <span class="mesh-node-description-separator" aria-hidden="true">·</span>
              <span>{visibleTransport(node.transport)}</span>
            {/if}
            {#if lastSeenLabel(node.last_seen_at)}
              <span class="mesh-node-description-separator" aria-hidden="true">·</span>
              <span>last seen {lastSeenLabel(node.last_seen_at)}</span>
            {/if}
          </div>
        </div>
        {#if chatPreferencesStore.showRemoteSessions}
          <div class="mesh-node-inclusion">
            <span>Include</span>
            <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
              <Tooltip.Root disableHoverableContent>
                <Tooltip.Trigger class="mesh-node-inclusion-info" type="button" aria-label={`About including sessions from ${node.label || node.id}`}>
                  <Info size={14} aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content class="app-tooltip-content mesh-node-inclusion-tooltip" sideOffset={6}>
                    Include sessions from remote host {node.label || node.id} in the Sessions list.
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
            <AppSwitch
              checked={chatPreferencesStore.remoteSessionPeers.includes(node.id)}
              ariaLabel={`Include ${node.label || node.id} in Sessions`}
              onCheckedChange={(enabled) => onIncludeSessions(node.id, enabled)}
            />
          </div>
        {:else}
          <div class="mesh-node-inclusion">
            <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
              <Tooltip.Root disableHoverableContent>
                <Tooltip.Trigger class="mesh-node-inclusion-info" type="button" aria-label="About enabling remote sessions">
                  <Info size={14} aria-hidden="true" />
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content class="app-tooltip-content mesh-node-inclusion-tooltip" sideOffset={6}>
                    To include sessions from remote hosts in the Sessions list, enable Show remote sessions in Settings.
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>
        {/if}
      </article>
    {/each}
  </div>
{/if}
