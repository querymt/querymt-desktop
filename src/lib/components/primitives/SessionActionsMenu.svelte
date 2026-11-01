<script lang="ts">
  import { getContext } from 'svelte';
  import { DropdownMenu, Tooltip } from 'bits-ui';
  import { Archive, ArchiveRestore, Bug, Check, Copy, Ellipsis, GitBranch, GitBranchPlus, LoaderCircle, Pin, PinOff, RotateCcw, Trash2 } from '@lucide/svelte';
  import type { DesktopSessionSummary, SessionLifecyclePatch } from '$lib/domain/types';

  let {
    session, canManage = false, pending = false, error = null,
    canPin = false, onSetPinned = null,
    onSetLifecycle = null, onCopy = null, onDelete = null, copied = false,
    onCreateWorktree = null, onHandoffWorktree = null,
    onDebug = null, debugLabel = 'Debug events', tooltip = false,
    triggerClass = 'session-row-menu-trigger', open = $bindable(false)
  }: {
    session: Pick<DesktopSessionSummary, 'sessionId' | 'title' | 'lifecycle' | 'pin'>;
    canManage?: boolean;
    canPin?: boolean;
    onSetPinned?: ((pinned: boolean) => Promise<unknown>) | null;
    pending?: boolean;
    error?: string | null;
    onSetLifecycle?: ((patch: SessionLifecyclePatch) => Promise<unknown>) | null;
    onCopy?: (() => void | Promise<void>) | null;
    onDelete?: (() => void) | null;
    /** Gated by the caller on capability, ownership and read-only state; null hides the entry. */
    onCreateWorktree?: (() => void) | null;
    onHandoffWorktree?: (() => void) | null;
    /** Opens the debug events view; null hides the entry. */
    onDebug?: (() => void) | null;
    debugLabel?: string;
    /** Use a bits-ui tooltip on the trigger instead of a native title. */
    tooltip?: boolean;
    copied?: boolean;
    triggerClass?: string;
    open?: boolean;
  } = $props();

  const getOverlayTarget = getContext<() => HTMLElement | null>('app-overlay-target');
  const portalTarget = $derived(getOverlayTarget?.() ?? undefined);
  let saving = $state(false);
  let localError = $state<string | null>(null);
  const busy = $derived(pending || saving);

  async function togglePin() {
    if (!onSetPinned || busy) return;
    saving = true;
    localError = null;
    try { await onSetPinned(!session.pin?.pinned); open = false; }
    catch (cause) { localError = cause instanceof Error ? cause.message : 'Could not update session pin.'; }
    finally { saving = false; }
  }

  async function update(patch: SessionLifecyclePatch) {
    if (!onSetLifecycle || busy) return;
    saving = true;
    localError = null;
    try {
      await onSetLifecycle(patch);
      open = false;
    } catch (cause) {
      localError = cause instanceof Error ? cause.message : 'Could not update session lifecycle. Try again.';
    } finally {
      saving = false;
    }
  }
</script>

{#snippet triggerIcon()}
  {#if busy}<LoaderCircle size={16} class="animate-spin" />{:else}<Ellipsis size={16} />{/if}
{/snippet}

<DropdownMenu.Root bind:open>
  {#if tooltip}
    <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
      <Tooltip.Root disableHoverableContent disabled={open}>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <DropdownMenu.Trigger {...props} class={triggerClass} aria-label={`Session actions for ${session.title}`}>
              {@render triggerIcon()}
            </DropdownMenu.Trigger>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content class="app-tooltip-content" sideOffset={6}>Session actions</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  {:else}
    <DropdownMenu.Trigger class={triggerClass} aria-label={`Session actions for ${session.title}`} title="Session actions">
      {@render triggerIcon()}
    </DropdownMenu.Trigger>
  {/if}
  <DropdownMenu.Portal to={portalTarget}>
    <DropdownMenu.Content class="session-actions-content" sideOffset={5} align="end" loop>
      {#if localError || error}<div class="session-actions-error" role="alert">{localError || error} Retry the action.</div>{/if}
      {#if canPin && onSetPinned}
        <DropdownMenu.Item disabled={busy} closeOnSelect={false} onSelect={togglePin}>
          {#if session.pin?.pinned}<PinOff size={14} />Unpin session{:else}<Pin size={14} />Pin session{/if}
        </DropdownMenu.Item>
      {/if}
      {#if canManage && session.lifecycle && onSetLifecycle}
        <DropdownMenu.Item disabled={busy} closeOnSelect={false} onSelect={() => update({ resolved: !session.lifecycle!.resolved })}>
          {#if session.lifecycle.resolved}<RotateCcw size={14} />Reopen{:else}<Check size={14} />Mark resolved{/if}
        </DropdownMenu.Item>
        <DropdownMenu.Item disabled={busy} closeOnSelect={false} onSelect={() => update({ archived: !session.lifecycle!.archived })}>
          {#if session.lifecycle.archived}<ArchiveRestore size={14} />Restore{:else}<Archive size={14} />Archive{/if}
        </DropdownMenu.Item>
      {:else}
        <div class="session-actions-hint">Lifecycle controls unavailable{#if !session.lifecycle}: state is unknown{/if}.</div>
      {/if}
      {#if onCreateWorktree}
        <DropdownMenu.Item disabled={busy} onSelect={() => onCreateWorktree?.()}>
          <GitBranchPlus size={14} />New worktree session
        </DropdownMenu.Item>
      {/if}
      {#if onHandoffWorktree}
        <DropdownMenu.Item disabled={busy} onSelect={() => onHandoffWorktree?.()}>
          <GitBranch size={14} />Hand off worktree
        </DropdownMenu.Item>
      {/if}
      {#if onDebug}
        <DropdownMenu.Item onSelect={() => onDebug?.()}>
          <Bug size={14} />{debugLabel}
        </DropdownMenu.Item>
      {/if}
      {#if onCopy}
        <DropdownMenu.Item closeOnSelect={false} onSelect={() => onCopy?.()} aria-label={`Copy session ID for ${session.title}`}>
          {#if copied}<Check size={14} />Copied{:else}<Copy size={14} />Copy session ID{/if}
        </DropdownMenu.Item>
      {/if}
      {#if onDelete}
        <DropdownMenu.Separator class="session-actions-separator" />
        <DropdownMenu.Item class="session-actions-danger" disabled={busy} onSelect={() => onDelete?.()} aria-label={`Delete session ${session.title}`}>
          <Trash2 size={14} />Delete session
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
