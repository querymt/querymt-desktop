<script lang="ts">
  import { ChevronRight, FolderKanban, MessagesSquare, RefreshCw } from '@lucide/svelte';
  import { formatSessionTimestamp, getSessionWorkspaceName } from '$lib/domain/sessions';
  import type { DesktopSessionSummary } from '$lib/domain/types';

  let {
    sessions,
    loading = false,
    error = null,
    emptyMessage = 'No sessions returned yet.',
    onRefresh = null,
    onOpenSession = null
  }: {
    sessions: DesktopSessionSummary[];
    loading?: boolean;
    error?: string | null;
    emptyMessage?: string;
    onRefresh?: (() => void) | null;
    onOpenSession?: ((session: DesktopSessionSummary) => void) | null;
  } = $props();

  const groupedSessions = $derived.by(() => {
    const groups = new Map<string, Map<string, DesktopSessionSummary[]>>();

    for (const session of sessions) {
      const agentKey = session.agentName;
      const workspaceKey = getSessionWorkspaceName(session.cwd);
      const workspaceGroups = groups.get(agentKey) ?? new Map<string, DesktopSessionSummary[]>();
      const existing = workspaceGroups.get(workspaceKey) ?? [];
      existing.push(session);
      workspaceGroups.set(workspaceKey, existing);
      groups.set(agentKey, workspaceGroups);
    }

    return [...groups.entries()].map(([agentName, workspaceGroups]) => [
      agentName,
      [...workspaceGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    ]) as Array<[string, Array<[string, DesktopSessionSummary[]]>]>;
  });
</script>

<div class="panel-strong overflow-hidden">
  <div class="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
    <div>
      <div class="text-sm font-medium">Session index</div>
      <div class="panel-copy mt-1">Grouped by agent and workspace, with the detail view moved into its own route.</div>
    </div>
    {#if onRefresh}
      <button class="icon-btn" type="button" aria-label="Refresh sessions" onclick={onRefresh}>
        <RefreshCw size={16} />
      </button>
    {/if}
  </div>

  {#if error}
    <div class="alert-error rounded-none border-x-0 border-t-0">{error}</div>
  {/if}

  <div class="divide-y divide-[var(--border)]">
    {#if loading}
      <div class="muted px-4 py-4 text-sm">Loading sessions…</div>
    {:else if sessions.length === 0}
      <div class="muted px-4 py-4 text-sm">{emptyMessage}</div>
    {:else}
      {#each groupedSessions as [agentName, workspaceGroups]}
        <section class="px-4 py-4">
          <div class="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
            <MessagesSquare size={13} />
            <span>{agentName}</span>
          </div>

          <div class="space-y-4">
            {#each workspaceGroups as [workspaceName, workspaceSessions]}
              <div>
                <div class="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                  <FolderKanban size={13} />
                  <span>{workspaceName}</span>
                  <span class="badge">{workspaceSessions.length}</span>
                </div>

                <div class="space-y-2">
                  {#each workspaceSessions as session}
                    <button class="click-card list-row surface-muted p-4" type="button" onclick={() => onOpenSession?.(session)}>
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="truncate text-sm font-medium">{session.title}</div>
                          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                            <span class="badge capitalize">{session.status}</span>
                            <span>{formatSessionTimestamp(session.updatedAt)}</span>
                          </div>
                          <div class="mt-2 truncate text-sm text-[var(--muted)]">{session.cwd}</div>
                        </div>
                        <span class="icon-btn shrink-0" aria-hidden="true">
                          <ChevronRight size={16} />
                        </span>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>
