<script lang="ts">
  import { Link, LoaderCircle, Plus, RefreshCw, XCircle } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { RemoteNodeInfo, RemoteSessionListInfo } from '$lib/querymt/generated/types';

  let {
    nodes,
    sessionsByNode,
    loadingNodeId = null,
    dismissingSessionKey = null,
    nodeErrors = {},
    canCreate = false,
    canAttach = false,
    canListSessions = false,
    canDismiss = false,
    onCreate,
    onAttach,
    onLoadSessions,
    onDismiss
  }: {
    nodes: RemoteNodeInfo[];
    sessionsByNode: Record<string, RemoteSessionListInfo | undefined>;
    loadingNodeId?: string | null;
    dismissingSessionKey?: string | null;
    nodeErrors?: Record<string, string | undefined>;
    canCreate?: boolean;
    canAttach?: boolean;
    canListSessions?: boolean;
    canDismiss?: boolean;
    onCreate: (nodeId: string) => void;
    onAttach: (nodeId: string, sessionId?: string) => void;
    onLoadSessions: (nodeId: string) => void;
    onDismiss: (nodeId: string, sessionId: string) => void;
  } = $props();

  function sessionKey(nodeId: string, sessionId: string) {
    return `${nodeId}:${sessionId}`;
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
    {#each nodes as node}
      {@const loadedSessions = sessionsByNode[node.id]}
      <article class="mesh-item-row mesh-item-row-stacked">
        <div class="mesh-item-main">
          <div class="mesh-node-title-line">
            <div class="mesh-item-title">{node.label || node.id}</div>
            <span class="mesh-node-session-count">{node.active_sessions} active</span>
          </div>
          <div class="mesh-item-description">{node.id} · {node.transport}{lastSeenLabel(node.last_seen_at) ? ` · last seen ${lastSeenLabel(node.last_seen_at)}` : ''}</div>
        </div>
        <div class="mesh-item-actions">
          <IconTooltipButton label={`Create session on ${node.label || node.id}`} icon={Plus} disabled={!canCreate} onclick={() => onCreate(node.id)} />
          <IconTooltipButton label={`Attach session from ${node.label || node.id}`} icon={Link} disabled={!canAttach} onclick={() => onAttach(node.id)} />
          <IconTooltipButton
            label={loadingNodeId === node.id ? `Loading sessions from ${node.label || node.id}` : `${loadedSessions ? 'Refresh' : 'Load'} sessions from ${node.label || node.id}`}
            icon={loadingNodeId === node.id ? LoaderCircle : RefreshCw}
            iconClass={loadingNodeId === node.id ? 'animate-spin' : ''}
            disabled={!canListSessions || loadingNodeId === node.id}
            onclick={() => onLoadSessions(node.id)}
          />
        </div>

        {#if nodeErrors[node.id]}
          <div class="mesh-node-feedback mesh-node-feedback-error" role="alert">
            <span>{nodeErrors[node.id]}</span>
            <button type="button" onclick={() => onLoadSessions(node.id)}>Retry</button>
          </div>
        {:else if loadingNodeId === node.id && !loadedSessions}
          <div class="mesh-node-feedback" role="status"><LoaderCircle size={13} class="animate-spin" /> Loading remote sessions…</div>
        {:else if loadedSessions}
          <div class="mesh-remote-session-list">
            {#if loadedSessions.sessions.length === 0}
              <div class="mesh-remote-session-empty">No remote sessions on this node.</div>
            {:else}
              {#each loadedSessions.sessions as session}
                {@const pendingDismiss = dismissingSessionKey === sessionKey(node.id, session.id)}
                <div class="mesh-remote-session-row">
                  <div class="mesh-item-main">
                    <div class="mesh-item-title">{session.title ?? session.id}</div>
                    <div class="mesh-item-description">{session.cwd ?? 'No working directory'}{session.updated_at ? ` · ${session.updated_at}` : ''}</div>
                  </div>
                  <div class="mesh-item-actions">
                    <IconTooltipButton label={`Attach ${session.title ?? session.id}`} icon={Link} disabled={!canAttach || pendingDismiss} onclick={() => onAttach(node.id, session.id)} />
                    <IconTooltipButton
                      label={pendingDismiss ? `Dismissing ${session.title ?? session.id}` : `Dismiss ${session.title ?? session.id}`}
                      icon={pendingDismiss ? LoaderCircle : XCircle}
                      iconClass={pendingDismiss ? 'animate-spin' : ''}
                      tone="danger"
                      disabled={!canDismiss || pendingDismiss}
                      onclick={() => onDismiss(node.id, session.id)}
                    />
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>
{/if}
