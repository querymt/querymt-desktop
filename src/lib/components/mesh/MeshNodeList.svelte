<script lang="ts">
  import { Check, Copy, Ellipsis, Link, LoaderCircle, Plus, RefreshCw, XCircle } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import { formatSessionTimestamp } from '$lib/domain/sessions';
  import type { RemoteNodeInfo, RemoteSessionListInfo } from '$lib/querymt/generated/types';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';

  let {
    nodes,
    sessionsByNode,
    loadingNodeId = null,
    attachingSessionKey = null,
    dismissingSessionKey = null,
    nodeErrors = {},
    canCreate = false,
    canAttach = false,
    canListSessions = false,
    canDismiss = false,
    onCreate,
    onOpenAttach,
    onAttachSession,
    onLoadSessions,
    onDismiss
  }: {
    nodes: RemoteNodeInfo[];
    sessionsByNode: Record<string, RemoteSessionListInfo | undefined>;
    loadingNodeId?: string | null;
    attachingSessionKey?: string | null;
    dismissingSessionKey?: string | null;
    nodeErrors?: Record<string, string | undefined>;
    canCreate?: boolean;
    canAttach?: boolean;
    canListSessions?: boolean;
    canDismiss?: boolean;
    onCreate: (nodeId: string) => void;
    onOpenAttach: (nodeId: string) => void;
    onAttachSession: (nodeId: string, sessionId: string) => void;
    onLoadSessions: (nodeId: string) => void;
    onDismiss: (nodeId: string, sessionId: string) => void;
  } = $props();

  let copiedNodeId = $state<string | null>(null);
  let copiedSessionId = $state<string | null>(null);

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

  async function copySessionId(event: MouseEvent, sessionId: string) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
    try {
      await navigator.clipboard.writeText(sessionId);
      copiedSessionId = sessionId;
      window.setTimeout(() => {
        if (copiedSessionId === sessionId) copiedSessionId = null;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy remote session ID', error);
    }
  }

  function dismissSession(event: MouseEvent, nodeId: string, sessionId: string) {
    event.stopPropagation();
    (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
    onDismiss(nodeId, sessionId);
  }

  function sessionKey(nodeId: string, sessionId: string) {
    return `${nodeId}:${sessionId}`;
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
    {#each nodes as node}
      {@const loadedSessions = sessionsByNode[node.id]}
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
        <div class="mesh-item-actions">
          <IconTooltipButton label={`Create session on ${node.label || node.id}`} icon={Plus} disabled={!canCreate} onclick={() => onCreate(node.id)} />
          <IconTooltipButton label={`Attach session from ${node.label || node.id}`} icon={Link} disabled={!canAttach} onclick={() => onOpenAttach(node.id)} />
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
                {@const pendingAttach = attachingSessionKey === sessionKey(node.id, session.id)}
                {@const pendingDismiss = dismissingSessionKey === sessionKey(node.id, session.id)}
                {@const sessionTitle = session.title ?? session.id}
                {@const identicon = createRoundIdenticon(session.id)}
                <div class="model-picker-row session-row mesh-remote-session-row">
                  <button
                    class="session-row-navigation"
                    type="button"
                    aria-label={`Attach remote session ${sessionTitle}`}
                    disabled={!canAttach || pendingAttach || pendingDismiss}
                    onclick={() => onAttachSession(node.id, session.id)}
                  ></button>
                  <span class="session-row-identicon" aria-hidden="true">
                    <svg
                      class="session-identicon-svg"
                      style={`--identicon-color: ${identicon.color}`}
                      width={identicon.width}
                      height={identicon.width}
                      viewBox={`0 0 ${identicon.width} ${identicon.width}`}
                      preserveAspectRatio="xMinYMin"
                    >
                      <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill="currentColor" />
                      <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                        {#each identicon.arcs as arc}
                          <path d={arc.d} stroke-width={arc.strokeWidth} />
                        {/each}
                      </g>
                    </svg>
                  </span>
                  <span class="session-row-main">
                    <span class="session-row-title-line">
                      <span class="session-row-title">{sessionTitle}</span>
                    </span>
                    <span class="session-row-meta">
                      <span>{session.cwd ?? 'No working directory'}</span>
                      <span>{formatSessionTimestamp(session.updated_at ?? null)}</span>
                    </span>
                  </span>
                  <span class="session-row-side mesh-remote-session-side">
                    {#if pendingAttach}
                      <span class="mesh-remote-session-pending" role="status" aria-label={`Attaching ${sessionTitle}`}>
                        <LoaderCircle size={15} class="animate-spin" aria-hidden="true" />
                      </span>
                    {/if}
                    <details class="session-row-menu">
                      <summary class="session-row-menu-trigger" aria-label={`Session actions for ${sessionTitle}`} title="Session actions"><Ellipsis size={16} /></summary>
                      <div class="session-row-menu-content">
                        <button type="button" aria-label={`Copy remote session ID for ${sessionTitle}`} onclick={(event) => copySessionId(event, session.id)}>
                          {#if copiedSessionId === session.id}<Check size={14} />Copied{:else}<Copy size={14} />Copy session ID{/if}
                        </button>
                        <button
                          class="session-row-menu-danger"
                          type="button"
                          aria-label={pendingDismiss ? `Dismissing ${sessionTitle}` : `Dismiss ${sessionTitle}`}
                          disabled={!canDismiss || pendingDismiss}
                          onclick={(event) => dismissSession(event, node.id, session.id)}
                        >
                          {#if pendingDismiss}<LoaderCircle size={14} class="animate-spin" />Dismissing{:else}<XCircle size={14} />Dismiss session{/if}
                        </button>
                      </div>
                    </details>
                  </span>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>
{/if}
