<script lang="ts">
  import { Bot, Clock3, FolderKanban, Layers3, MessagesSquare } from '@lucide/svelte';
  import type { RuntimeCard as RuntimeCardType } from '$lib/domain/types';

  export let runtime: RuntimeCardType;

  const statusTone: Record<RuntimeCardType['status'], string> = {
    running: 'text-[var(--success)] bg-[var(--bg-card-hover)]',
    starting: 'text-[var(--warn)] bg-[var(--bg-card-hover)]',
    degraded: 'text-[var(--accent)] bg-[var(--accent-dim)]',
    stopped: 'text-[var(--muted)] bg-[var(--bg-card-hover)]'
  };

  const statusDotTone: Record<RuntimeCardType['status'], string> = {
    running: 'status-dot-running',
    starting: 'status-dot-starting',
    degraded: 'status-dot-degraded',
    stopped: 'status-dot-stopped'
  };
</script>

<article class="panel-strong p-4">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="flex items-center gap-3">
        <span class="icon-swatch">
          <Bot size={16} />
        </span>
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold">{runtime.name}</h3>
          <div class="mt-1 flex items-center gap-2 text-xs text-[var(--muted)]">
            <span class={`status-dot ${statusDotTone[runtime.status]}`}></span>
            <span class="capitalize">{runtime.status}</span>
            <span>•</span>
            <span class="truncate">{runtime.profile}</span>
          </div>
        </div>
      </div>
    </div>
    <span class={`badge ${statusTone[runtime.status]}`}>{runtime.activeSessions} active</span>
  </div>

  <div class="mt-4 grid gap-3 sm:grid-cols-2">
    <div class="panel-stat">
      <div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
        <FolderKanban size={13} />
        <span>Workspace</span>
      </div>
      <div class="panel-stat-value truncate">{runtime.workspace}</div>
    </div>
    <div class="panel-stat">
      <div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
        <MessagesSquare size={13} />
        <span>Sessions</span>
      </div>
      <div class="panel-stat-value">{runtime.activeSessions}</div>
    </div>
    <div class="panel-stat sm:col-span-2">
      <div class="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
        <Clock3 size={13} />
        <span>Last activity</span>
      </div>
      <div class="panel-stat-value truncate-2">{runtime.lastActivity}</div>
    </div>
  </div>

  <details class="details-reset surface-muted mt-4 px-4 py-3">
    <summary class="flex items-center justify-between gap-3 text-sm font-medium">
      <span class="flex items-center gap-2">
        <Layers3 size={14} />
        <span>Details</span>
      </span>
      <span class="text-xs text-[var(--muted)]">Model and runtime id</span>
    </summary>
    <div class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <div class="muted text-xs uppercase tracking-[0.16em]">Model</div>
        <div class="mt-1 break-all">{runtime.model}</div>
      </div>
      <div>
        <div class="muted text-xs uppercase tracking-[0.16em]">Runtime id</div>
        <div class="mt-1 break-all">{runtime.id}</div>
      </div>
    </div>
  </details>
</article>
