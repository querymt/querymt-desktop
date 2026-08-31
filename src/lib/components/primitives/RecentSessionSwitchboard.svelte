<script lang="ts">
  import { goto } from '$app/navigation';
  import { Ellipsis, Search } from '@lucide/svelte';
  import { createRoundIdenticon } from '$lib/vendor/round-identicon';
  import { formatSessionTimestamp, getSessionWorkspaceName } from '$lib/domain/sessions';
  import type { RecentSessionSummary } from '$lib/domain/types';

  let {
    sessions,
    activeAgentId,
    activeSessionId,
    isMacPlatform = false,
    visibleCount = 4,
    floating = false,
    alignLeft = null,
    alignWidth = null,
    dockedComposerVisible = false,
    onOpenSession = null
  }: {
    sessions: RecentSessionSummary[];
    activeAgentId?: string | null;
    activeSessionId?: string | null;
    isMacPlatform?: boolean;
    visibleCount?: number;
    floating?: boolean;
    alignLeft?: number | null;
    alignWidth?: number | null;
    dockedComposerVisible?: boolean;
    onOpenSession?: ((session: RecentSessionSummary) => void | Promise<void>) | null;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let searchElement = $state<HTMLInputElement | null>(null);

  const visibleSessions = $derived(sessions.slice(0, visibleCount));
  const hiddenSessions = $derived(sessions.slice(visibleCount));
  const filteredHiddenSessions = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return hiddenSessions;
    }

    return hiddenSessions.filter((session) => {
      return (
        session.title.toLowerCase().includes(normalizedQuery) ||
        session.cwd.toLowerCase().includes(normalizedQuery) ||
        session.agentName.toLowerCase().includes(normalizedQuery)
      );
    });
  });
  const shortcutPrefix = $derived(isMacPlatform ? 'Cmd' : 'Alt');
  const dockStyle = $derived.by(() => {
    if (!floating || alignLeft == null || alignWidth == null) {
      return '';
    }

    return `left:${alignLeft}px;width:${alignWidth}px;transform:none;`;
  });
  const dockClass = $derived(
    `recent-session-switcher ${floating ? 'recent-session-switcher-floating' : ''} ${dockedComposerVisible ? 'recent-session-switcher-floating-with-composer' : ''}`
  );

  function isActive(session: RecentSessionSummary): boolean {
    return session.agentId === activeAgentId && session.sessionId === activeSessionId;
  }

  $effect(() => {
    if (!open) {
      query = '';
      return;
    }

    queueMicrotask(() => searchElement?.focus());
  });

  async function openSession(session: RecentSessionSummary) {
    open = false;
    if (onOpenSession) {
      await onOpenSession(session);
      return;
    }

    await goto(`/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`);
  }

  function keycap(index: number): string {
    return `${shortcutPrefix}+${index + 1}`;
  }

  function closePopover() {
    open = false;
  }
</script>

{#if sessions.length > 1}
  <section class={dockClass} style={dockStyle} aria-label="Recent sessions">
    {#if !floating}
      <div class="recent-session-switcher-header">
        <div>
          <div class="recent-session-switcher-title">Recent sessions</div>
          <div class="recent-session-switcher-subtitle">Jump between the last conversations you opened.</div>
        </div>
      </div>
    {/if}

    <div class="recent-session-switcher-row">
      {#each visibleSessions as session, index}
        {@const identicon = createRoundIdenticon(session.sessionId)}
        <button
          class={`recent-session-chip ${isActive(session) ? 'recent-session-chip-active' : ''}`}
          type="button"
          aria-current={isActive(session) ? 'page' : undefined}
          onclick={() => void openSession(session)}
        >
          <span class="recent-session-chip-identicon" aria-hidden="true">
            <svg width={identicon.width} height={identicon.width} viewBox={`0 0 ${identicon.width} ${identicon.width}`} preserveAspectRatio="xMinYMin">
              <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill={identicon.color} />
              {#each identicon.paths as path}
                <path d={path} fill={identicon.color} />
              {/each}
            </svg>
          </span>
          <span class="recent-session-chip-main">
            <span class="recent-session-chip-title">{session.title}</span>
            <span class="recent-session-chip-meta">
              {getSessionWorkspaceName(session.cwd)} · {formatSessionTimestamp(session.updatedAt)}
            </span>
          </span>
          <span class="recent-session-chip-keycap">{keycap(index)}</span>
        </button>
      {/each}

      {#if hiddenSessions.length > 0}
        <button
          class={`recent-session-more ${open ? 'recent-session-more-active' : ''}`}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onclick={() => (open = !open)}
        >
          <Ellipsis size={16} />
          <span>More</span>
          <span class="badge">{hiddenSessions.length}</span>
        </button>
      {/if}
    </div>
  </section>
{/if}

{#if open}
  <button class="model-picker-backdrop" type="button" aria-label="Close recent sessions" onclick={closePopover}></button>
  <div class="model-picker-modal recent-session-modal !p-0" data-blocking-overlay="true">
    <div class="border-b border-[var(--border)] px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium">Recent sessions</div>
          <div class="muted text-xs">Search and jump back into a conversation.</div>
        </div>
      </div>
    </div>

    <div class="p-4">
      <div class="model-search-shell">
        <Search size={15} />
        <input
          bind:this={searchElement}
          class="model-search-input"
          placeholder="Search recent sessions…"
          value={query}
          oninput={(event) => {
            query = (event.currentTarget as HTMLInputElement).value;
          }}
        />
      </div>

      <div class="picker-scroll-frame mt-3">
        <div class="picker-scroll-area max-h-[22rem] space-y-3">
          {#if filteredHiddenSessions.length > 0}
            <div class="model-picker-list">
              {#each filteredHiddenSessions as session, index}
                {@const identicon = createRoundIdenticon(session.sessionId)}
                <button class="model-picker-row recent-session-modal-row" type="button" onclick={() => void openSession(session)}>
                  <span class="recent-session-chip-identicon" aria-hidden="true">
                    <svg width={identicon.width} height={identicon.width} viewBox={`0 0 ${identicon.width} ${identicon.width}`} preserveAspectRatio="xMinYMin">
                      <circle cx={identicon.center} cy={identicon.center} r={identicon.centerRadius} fill={identicon.color} />
                      {#each identicon.paths as path}
                        <path d={path} fill={identicon.color} />
                      {/each}
                    </svg>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">{session.title}</div>
                    <div class="muted truncate text-xs">
                      {session.agentName} · {getSessionWorkspaceName(session.cwd)} · {formatSessionTimestamp(session.updatedAt)}
                    </div>
                  </div>
                  <span class="recent-session-chip-keycap">{keycap(index + visibleCount)}</span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="surface-muted px-3 py-3 text-xs text-[var(--muted)]">No recent sessions match "{query}".</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
