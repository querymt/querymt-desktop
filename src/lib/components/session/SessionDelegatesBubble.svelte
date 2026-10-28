<script lang="ts">
  import { AlertTriangle, ArrowUpRight, Check, CircleEllipsis, LoaderCircle, Network } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import { buildSessionConversation, getTurnDelegates, type SessionConversationTurn } from '$lib/domain/session-conversation';
  import { parseObject, stringValue } from '$lib/domain/session-tool-args';
  import { getDelegateTargetAgentId, getSessionToolPresentation } from '$lib/domain/session-tool-presentation';
  import type { ActiveSessionViewModel, DesktopSessionSummary, SessionToolCallItem } from '$lib/domain/types';

  let {
    agentId,
    session,
    turn: providedTurn,
    variant = 'activity',
    sessionId = null,
    sessions = [],
    open = $bindable(false),
    onOpen
  }: {
    agentId: string;
    session?: ActiveSessionViewModel;
    turn?: SessionConversationTurn;
    variant?: 'activity' | 'turn';
    sessionId?: string | null;
    sessions?: DesktopSessionSummary[];
    open?: boolean;
    onOpen?: () => void;
  } = $props();

  type DelegateEntry = {
    id: string;
    name: string;
    detail: string;
    href: string | null;
    status: SessionToolCallItem['status'];
    statusLabel: string;
  };

  const panelId = $props.id();
  let panelElement = $state<HTMLElement>();
  let triggerElement = $state<HTMLButtonElement>();
  let previousContext: string | null = null;
  let panelBelow = $state(false);

  const turn = $derived(providedTurn ?? (session ? buildSessionConversation(session).at(-1) : undefined));
  const delegateTools = $derived(getTurnDelegates(turn));
  const visible = $derived(delegateTools.length > 0 && (
    variant === 'turn' || (!!session && !['idle', 'completed', 'failed'].includes(session.runState))
  ));
  const hint = $derived(`${delegateTools.length} ${delegateTools.length === 1 ? 'delegate' : 'delegates'} in this turn`);
  const delegates: DelegateEntry[] = $derived(delegateTools.map((tool) => {
    const childSessionId = tool.childSessionId?.trim();
    const child = sessions.find((candidate) => candidate.agentId === agentId && candidate.sessionId === childSessionId);
    const args = parseObject(tool.arguments);
    const state = tool.delegationState;
    const status = state === 'forked' ? 'in_progress'
      : state === 'completed' ? 'completed'
      : state === 'failed' || state === 'cancelled' || tool.status === 'failed' ? 'failed'
      : 'pending';
    return {
      id: tool.id,
      name: getDelegateTargetAgentId(tool) ?? 'Delegate',
      detail: child?.title.trim() || (args ? stringValue(args.objective) : '') || childSessionId || 'Session starting...',
      href: agentId && childSessionId
        ? `/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(childSessionId)}`
        : null,
      status,
      statusLabel: state === 'cancelled' ? 'Cancelled'
        : !state && tool.status !== 'failed' ? 'Status unavailable'
        : getSessionToolPresentation({ ...tool, status }).statusLabel
    };
  }));

  $effect(() => {
    const context = JSON.stringify([agentId, session?.sessionId ?? sessionId, turn?.id]);
    if (context !== previousContext || !visible) open = false;
    previousContext = context;
  });

  $effect(() => {
    if (!open || variant !== 'turn' || !panelElement) return;
    const panel = panelElement;
    const updatePlacement = () => {
      const row = triggerElement?.closest('.session-assistant-message-actions')?.getBoundingClientRect();
      if (!row) return;
      const height = panel.getBoundingClientRect().height;
      panelBelow = row.top < height + 8 && window.innerHeight - row.bottom > row.top;
    };
    updatePlacement();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updatePlacement) : null;
    observer?.observe(panel);
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  });

  function togglePanel(event: MouseEvent) {
    triggerElement = event.currentTarget as HTMLButtonElement;
    open = !open;
    if (open) onOpen?.();
  }

  function handleOutsideInteraction(event: MouseEvent | FocusEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (panelElement?.contains(event.target) || triggerElement?.contains(event.target)) return;
    open = false;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    if (panelElement?.contains(document.activeElement)) triggerElement?.focus();
    open = false;
  }
</script>

<svelte:document onkeydown={handleKeyDown} onmousedown={handleOutsideInteraction} onfocusin={handleOutsideInteraction} />

{#if visible}
  <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
    <Tooltip.Root disableHoverableContent>
      <Tooltip.Trigger
        type="button"
        class={variant === 'turn'
          ? 'session-turn-diff-pill session-turn-delegates-pill'
          : `session-queued-bubble session-delegates-bubble ${open ? 'open' : ''}`}
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={hint}
        onclick={togglePanel}
      >
        {#if variant === 'turn'}
          <Network size={13} aria-hidden="true" />
          <span aria-hidden="true">{delegates.length}</span>
          <ArrowUpRight size={12} class="session-turn-diff-pill-arrow" aria-hidden="true" />
        {:else}
          <Network size={14} aria-hidden="true" />
          <span class="session-queued-bubble-title">{delegates.length}</span>
        {/if}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="app-tooltip-content" sideOffset={6}>
          {hint}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}

{#snippet delegateCopy(delegate: DelegateEntry)}
  <span
    class={`session-tool-status session-delegate-status session-delegate-status-${delegate.status}`}
    role="img"
    aria-label={delegate.statusLabel}
  >
    {#if delegate.status === 'failed'}
      <AlertTriangle size={13} aria-hidden="true" />
    {:else if delegate.status === 'in_progress'}
      <LoaderCircle size={13} class="animate-spin" aria-hidden="true" />
    {:else if delegate.status === 'completed'}
      <Check size={13} aria-hidden="true" />
    {:else}
      <CircleEllipsis size={13} aria-hidden="true" />
    {/if}
  </span>
  <span class="session-delegate-copy">
    <strong>{delegate.name}</strong>{' '}<span>{delegate.detail}</span>
  </span>
{/snippet}

{#if open && visible}
  <section
    bind:this={panelElement}
    id={panelId}
    class="session-queued-panel session-delegates-panel"
    class:session-turn-delegates-panel={variant === 'turn'}
    class:session-turn-delegates-panel-below={variant === 'turn' && panelBelow}
    aria-label="Delegates in this turn"
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Allow keyboard scrolling while delegate sessions are starting.) -->
    <div class="session-queued-panel-list" role="region" aria-label="Delegate sessions" tabindex="0">
      {#each delegates as delegate (delegate.id)}
        {#if delegate.href}
          <a class="session-delegate-session" href={delegate.href} aria-label={`Open ${delegate.name} session`}>
            {@render delegateCopy(delegate)}
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        {:else}
          <div class="session-delegate-session">
            {@render delegateCopy(delegate)}
          </div>
        {/if}
      {/each}
    </div>
  </section>
{/if}
