import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountingSnapshot } from '$lib/querymt/generated/types';
import SessionHeader from './SessionHeader.svelte';
import { session } from './session-fixture';
import type { DesktopSessionSummary } from '$lib/domain/types';

const usageFixture = {
  contextUsed: 24_000,
  contextLimit: 100_000,
  standardCostUsd: null,
  accounting: { version: 1, cycle: null, session: { knownSubtotalUsd: 0.05, completeTotalUsd: 0.05, complete: true, billing: 'metered', reasons: [], pricedAttempts: 1, excludedAttempts: 0, unresolvedAttempts: 0, incompleteAttempts: 0, unaccountedGenerations: 0 } } as unknown as AccountingSnapshot,
  activeWorkMs: 12_000,
  activeWorkStartedAt: null
};

afterEach(cleanup);

describe('SessionHeader', () => {
  it.each(['thinking', 'streaming', 'tool-running'] as const)('preserves known %s execution over a stale unknown summary', (runState) => {
    render(SessionHeader, { session: session({ runState }), summaryStatus: 'unknown', title: 'Active', workspace: 'work', updatedAt: 'Now' });
    expect(screen.getByLabelText('Status: Working')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status: Status unavailable')).not.toBeInTheDocument();
  });

  it('keeps observed failed execution visible while a dependency is live', () => {
    render(SessionHeader, { session: session({ runState: 'failed', dependencyLabel: 'Verifying delegate result' }),
      title: 'Failed', workspace: 'work', updatedAt: 'Now' });
    expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();
  });

  it.each([false, true])('offers pin/unpin only inside the ellipsis menu (pinned=%s)', async (pinned) => {
    const onSetPinned = vi.fn(async () => {});
    const onSetLifecycle = vi.fn(async () => {});
    const summary = { sessionId: 'session-1', title: 'Task', pin: { session_id: 'session-1', pinned, pinned_at: pinned ? '2026-10-20T10:00:00Z' : null } } as DesktopSessionSummary;
    const { container } = render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Just now', canPin: true, onSetPinned, onSetLifecycle });
    expect(screen.queryByRole('button', { name: /^(Pin|Unpin) session$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^(Pin|Unpin) session$/ })).not.toBeInTheDocument();
    expect(container.querySelector('.session-header-pin')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: pinned ? 'Unpin session' : 'Pin session' }));
    expect(onSetPinned).toHaveBeenCalledExactlyOnceWith(!pinned);
    expect(onSetLifecycle).not.toHaveBeenCalled();
  });

  it('keeps pending pin actions disabled and errors inside the ellipsis menu', async () => {
    const summary = { sessionId: 'session-1', title: 'Task' } as DesktopSessionSummary;
    const { rerender } = render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Just now', canPin: true, pinPending: true, pinError: 'Owner offline', onSetPinned: vi.fn(async () => {}) });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Task' }));
    expect(screen.getByRole('menuitem', { name: 'Pin session' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Owner offline');
    await rerender({ canPin: false });
    expect(screen.queryByRole('menuitem', { name: 'Pin session' })).not.toBeInTheDocument();
  });

  it('presents session identity and a compact ready state', () => {
    render(SessionHeader, {
      session: session(),
      title: 'Refine session hierarchy',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now'
    });

    const metadata = document.querySelector<HTMLElement>('.session-header-meta');
    const mobileContext = screen.getByLabelText('Session context');
    expect(metadata).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Refine session hierarchy' })).toBeInTheDocument();
    expect(within(metadata!).getByText('querymt-desktop')).toHaveClass('copy-chip-label');
    expect(metadata!.querySelector('.session-header-workspace')).not.toBeNull();
    expect(within(metadata!).getByText('QMTCODE')).toBeInTheDocument();
    expect(within(mobileContext).getByText('querymt-desktop')).toBeInTheDocument();
    expect(within(mobileContext).getByText('session-')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remote session on/ })).not.toBeInTheDocument();
    expect(document.querySelector('.session-header-context')).toBeNull();
  });

  it('shows an icon-only remote host tooltip before the workspace on desktop and mobile', async () => {
    const props = {
      session: session(), title: 'Remote task', workspace: 'querymt-desktop',
      updatedAt: 'Just now', remoteHost: 'flkr'
    };
    const { rerender } = render(SessionHeader, props);
    const desktopMeta = document.querySelector<HTMLElement>('.session-header-meta');
    const mobileMeta = screen.getByLabelText('Session context');
    const desktopIcon = within(desktopMeta!).getByRole('button', { name: 'Remote session on flkr' });
    const mobileIcon = within(mobileMeta).getByRole('button', { name: 'Remote session on flkr' });
    expect(desktopIcon.querySelector('.lucide-network')).not.toBeNull();
    expect(mobileIcon.querySelector('.lucide-network')).not.toBeNull();
    expect(desktopIcon.nextElementSibling).toHaveClass('session-header-workspace');
    expect(mobileIcon.nextElementSibling).toHaveClass('session-header-mobile-workspace');
    await fireEvent.pointerEnter(desktopIcon);
    expect(await screen.findByText('Remote session on flkr', { selector: '.app-tooltip-content' })).toBeInTheDocument();

    await rerender({ ...props, remoteHost: null });
    expect(screen.queryByRole('button', { name: 'Remote session on flkr' })).not.toBeInTheDocument();
  });

  it('places runtime before the title and packs metadata in path, id, profile, time order without a context dial', () => {
    render(SessionHeader, {
      session: session({
        usage: usageFixture,
        sessionId: '01a072b3-a266-4c5d-8e9f-102030405060'
      }),
      title: 'Visible context',
      workspace: 'querymt-desktop',
      profileLabel: 'def',
      updatedAt: 'Just now'
    });

    const header = document.querySelector('.session-header');
    const meta = document.querySelector('.session-header-meta');
    const mobile = document.querySelector('.session-header-mobile-meta');
    expect(header).not.toBeNull();
    expect(header!.querySelector('.session-header-context')).toBeNull();
    expect(header!.querySelector(':scope > .session-usage-bar')).toBeNull();
    expect(meta?.querySelector('.session-header-meta-line')).toBeNull();

    const order = [...(meta?.children ?? [])].map((child) => child.className);
    expect(order[0]).toContain('session-header-workspace');
    expect(order[1]).toContain('session-header-session-id');
    expect(order[2]).toContain('session-header-meta-desktop');
    expect(meta?.children[2]?.textContent).toContain('def');
    expect(order[3]).toContain('session-header-meta-desktop');
    expect(meta?.children[3]?.textContent).toContain('Just now');
    expect(meta?.querySelector('.session-header-context-slot, .session-context-dial')).toBeNull();
    expect(meta?.querySelector('.session-header-status-wrap')).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Visible context' });
    expect(heading.previousElementSibling).toHaveClass('session-header-status-wrap');
    expect(header?.querySelectorAll('.session-header-title-line > .session-header-status-wrap')).toHaveLength(1);
    expect(mobile?.querySelector('.session-context-dial')).toBeNull();
    expect(mobile?.querySelector('.session-header-mobile-id')).not.toBeNull();

    // The context ring lives inside the first action, merged with the details trigger.
    const actions = header!.querySelector('.session-header-action-group')!;
    const trigger = screen.getByLabelText('Session details');
    expect(actions.firstElementChild).toBe(trigger.closest('details'));
    expect(trigger.querySelector('.session-context-dial')).toHaveTextContent('24%');
    expect(trigger.querySelector('.lucide-info')).toBeNull();
  });

  it('merges the details trigger with the context ring and opens the same details from it', async () => {
    render(SessionHeader, { session: session({ usage: usageFixture }), title: 'Merged', workspace: 'work', updatedAt: 'Now' });
    const trigger = screen.getByLabelText('Session details');
    const details = document.querySelector<HTMLDetailsElement>('.session-header-details')!;
    const ring = trigger.querySelector('.session-context-dial')!;

    // Purely visual inside the trigger: no second meter, title or role to compete with the button.
    expect(ring).toHaveAttribute('aria-hidden', 'true');
    expect(ring).not.toHaveAttribute('title');
    expect(trigger.querySelector('[role="meter"], [role="img"]')).toBeNull();
    expect(details.open).toBe(false);
    await fireEvent.click(ring);
    expect(details.open).toBe(true);
    expect(document.querySelector('.session-header-details-panel')).toHaveTextContent('Session');

    await fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    expect(await screen.findByText(/of the context window/, { selector: '.app-tooltip-detail' })).toBeInTheDocument();
  });

  it('falls back to the info icon when no context reading exists', () => {
    render(SessionHeader, { session: session(), title: 'No context', workspace: 'work', updatedAt: 'Now' });
    const trigger = screen.getByLabelText('Session details');
    expect(trigger.querySelector('.lucide-info')).not.toBeNull();
    expect(trigger.querySelector('.session-context-dial')).toBeNull();
  });

  it('keeps cache and token details out of the compact header', async () => {
    const counts = { inputTokens: 75, outputTokens: 162, reasoningTokens: 1024, cacheReadTokens: 500, cacheWriteTokens: 0 };
    render(SessionHeader, {
      session: session({ usage: { ...usageFixture, breakdown: { latestRequest: counts, sessionTotals: counts, partial: false } } }),
      title: 'Detailed usage', workspace: 'querymt-desktop', updatedAt: 'Just now'
    });
    expect(document.querySelector('.session-header-meta')?.textContent).not.toContain('Cache');
    expect(document.querySelector('.session-header-mobile-meta')?.textContent).not.toContain('Cache');
    expect(document.querySelector<HTMLDetailsElement>('.session-header-details')?.open).toBe(false);
    await fireEvent.click(screen.getByLabelText('Session details'));
    expect(screen.getByRole('button', { name: 'Latest request' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.session-usage-breakdown')?.closest('details')).not.toBeNull();
  });

  it('keeps cost and active time inside the details popover', async () => {
    render(SessionHeader, {
      session: session({ usage: usageFixture }),
      title: 'Popover stats',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    await fireEvent.click(screen.getByLabelText('Session details'));
    const panel = document.querySelector<HTMLElement>('.session-header-details-panel');
    expect(panel).not.toBeNull();
    expect(within(panel!).getByText('$0.05')).toBeInTheDocument();
    expect(within(panel!).getByText('12s')).toBeInTheDocument();
    expect(within(panel!).getByText('76k free')).toBeInTheDocument();
    const contextStat = within(panel!).getByText('Context').closest('.session-usage-stat');
    expect(contextStat?.querySelector('svg')).not.toBeNull();
    expect(panel!.querySelector('.session-usage-meter')).toBeNull();
    expect(panel!.querySelector('.session-context-dial')).toBeNull();
  });

  it('shows a short session id chip that copies the full id', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    render(SessionHeader, {
      session: session({ sessionId: '01a072b3-a266-4c5d-8e9f-102030405060' }),
      title: 'Chip test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    const metadata = document.querySelector<HTMLElement>('.session-header-meta');
    expect(metadata).not.toBeNull();
    const chip = within(metadata!).getByRole('button', { name: 'Copy session ID' });
    expect(chip).toHaveTextContent('01a072b3');
    expect(chip).not.toHaveTextContent('01a072b3-');
    await fireEvent.click(chip);

    expect(writeText).toHaveBeenCalledWith('01a072b3-a266-4c5d-8e9f-102030405060');
    // The copied confirmation overlays the id instead of replacing it, so the chip keeps its width.
    expect(within(chip).getByText('01a072b3')).toBeInTheDocument();
    expect(within(chip).getByRole('status')).toHaveTextContent('copied');
  });

  it('hides the session id chip while no session is loaded', () => {
    render(SessionHeader, {
      session: session({ sessionId: null }),
      title: 'Unloaded test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    expect(screen.queryByRole('button', { name: 'Copy session ID' })).not.toBeInTheDocument();
  });

  it('makes complete session metadata available from the compact details popover', async () => {
    render(SessionHeader, {
      session: session({ sessionId: '01a072b3-a266-4c5d-8e9f-102030405060' }),
      title: 'Mobile details test',
      workspace: 'querymt-desktop',
      workspacePath: '/projects/querymt-org/querymt-desktop',
      agentName: 'QMTCODE',
      profileLabel: 'Default',
      updatedAt: 'Just now'
    });

    await fireEvent.click(screen.getByLabelText('Session details'));
    const panel = document.querySelector<HTMLElement>('.session-header-details-panel');
    const details = document.querySelector<HTMLElement>('.session-header-mobile-details');
    expect(panel).not.toBeNull();
    expect(details).not.toBeNull();
    expect(within(panel!).getByText('Ready')).toBeInTheDocument();
    expect(within(details!).getByText('querymt-desktop')).toBeInTheDocument();
    expect(within(details!).getByText('QMTCODE')).toBeInTheDocument();
    expect(within(details!).getByText('Default')).toBeInTheDocument();
    expect(within(details!).getByText('Just now')).toBeInTheDocument();
    expect(within(details!).getByRole('button', { name: 'Copy session ID' })).toHaveTextContent('01a072b3-a266');
  });

  it('collapses session details on outside clicks but keeps the trigger toggle', async () => {
    render(SessionHeader, {
      session: session(),
      title: 'Outside click test',
      workspace: 'querymt-desktop',
      updatedAt: 'Just now'
    });

    const summary = screen.getByLabelText('Session details');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');

    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');

    // Pointer downs inside the panel keep it open.
    await fireEvent.mouseDown(screen.getByText('Session'));
    expect(details).toHaveAttribute('open');

    await fireEvent.mouseDown(document.body);
    expect(details).not.toHaveAttribute('open');

    // The trigger still toggles the popover natively.
    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    await fireEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
  });

  it('keeps resolution, archive and execution failure independent and exposes restore in the header', async () => {
    const onSetLifecycle = vi.fn(async () => {});
    render(SessionHeader, {
      session: session({ runState: 'failed', lastError: 'Provider failed' }),
      summary: { agentId: 'agent-1', agentName: 'Agent', sessionId: 'session-1', title: 'Finished attempt', cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'completed', lifecycle: { session_id: 'session-1', resolved: true, archived: true, resolved_at: null, archived_at: null } },
      title: 'Finished attempt', workspace: 'work', updatedAt: 'Just now', canManageLifecycle: true, onSetLifecycle
    });
    expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();
    const metadata = document.querySelector<HTMLElement>('.session-header-meta')!;
    expect(within(metadata).getByRole('img', { name: 'Resolved' })).toBeInTheDocument();
    expect(within(metadata).getByRole('img', { name: 'Archived' })).toBeInTheDocument();
    expect(document.querySelector('.session-lifecycle-badge')).toBeNull();
    await fireEvent.click(screen.getByLabelText('Session details'));
    expect(screen.getByText('Provider failed')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Finished attempt' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(onSetLifecycle).toHaveBeenCalledWith({ archived: false });
    expect(screen.getByLabelText('Status: Failed')).toBeInTheDocument();
  });

  it.each([
    [false, false, false, []],
    [false, true, false, ['Resolved']],
    [false, false, true, ['Archived']],
    [false, true, true, ['Resolved', 'Archived']],
    [true, false, false, ['Pinned']],
    [true, true, false, ['Pinned', 'Resolved']],
    [true, false, true, ['Pinned', 'Archived']],
    [true, true, true, ['Pinned', 'Resolved', 'Archived']]
  ] as const)('shows independent status icons in metadata, never beside the title (pinned=%s, resolved=%s, archived=%s)', (pinned, resolved, archived, labels) => {
    const summary: DesktopSessionSummary = { agentId: 'agent-1', agentName: 'Agent', sessionId: 'session-1', title: 'A long session title that must stay on its own line', cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'idle', pin: { session_id: 'session-1', pinned, pinned_at: pinned ? '2026-10-20T10:00:00Z' : null }, lifecycle: { session_id: 'session-1', resolved, archived, resolved_at: null, archived_at: null } };
    const { container } = render(SessionHeader, { session: session(), summary, title: summary.title, workspace: 'work', updatedAt: 'Just now' });
    const heading = screen.getByRole('heading', { name: summary.title });
    expect(heading.parentElement).toHaveClass('session-header-title-line');
    expect(heading.previousElementSibling).toHaveClass('session-header-status-wrap');
    expect(heading.parentElement?.querySelector('.session-header-lifecycle')).toBeNull();
    expect(container.querySelector('.session-lifecycle-badge')).toBeNull();
    for (const selector of ['.session-header-meta', '.session-header-mobile-meta']) {
      const metadata = container.querySelector<HTMLElement>(selector)!;
      expect([...metadata.querySelectorAll('.session-header-lifecycle-icon')].map((icon) => icon.getAttribute('aria-label'))).toEqual(labels);
      for (const label of labels) {
        const icon = within(metadata).getByRole('img', { name: label });
        expect(icon).not.toHaveAttribute('title');
        expect(icon.querySelector('svg')).toHaveAttribute('width', '13');
        expect(icon.closest('button, a')).toBeNull();
        if (label === 'Resolved') {
          expect(icon).toHaveClass('session-header-lifecycle-icon-resolved');
          expect(icon.querySelector('.lucide-circle-check-big')).not.toBeNull();
        } else {
          expect(icon).not.toHaveClass('session-header-lifecycle-icon-resolved');
          expect(icon.querySelector(label === 'Pinned' ? '.lucide-pin' : '.lucide-archive')).not.toBeNull();
        }
      }
      if (labels.length) {
        const group = metadata.querySelector('.session-header-lifecycle')!;
        expect(group.nextElementSibling).toHaveClass(selector === '.session-header-meta' ? 'session-header-workspace' : 'session-header-mobile-workspace');
      } else expect(metadata.querySelector('.session-header-lifecycle')).toBeNull();
    }
    expect(container.querySelector('.session-header-meta .session-header-status-wrap')).toBeNull();
  });

  it('updates the pinned indicator from confirmed summary changes even when lifecycle is unavailable', async () => {
    const summary = { sessionId: 'session-1', title: 'Task', lifecycle: null } as DesktopSessionSummary;
    const { container, rerender } = render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Just now' });
    expect(screen.queryByRole('img', { name: 'Pinned' })).not.toBeInTheDocument();

    await rerender({ summary: { ...summary, pin: { session_id: 'session-1', pinned: true, pinned_at: '2026-10-20T10:00:00Z' } } });
    for (const selector of ['.session-header-meta', '.session-header-mobile-meta']) {
      const metadata = container.querySelector<HTMLElement>(selector)!;
      expect(within(metadata).getByRole('img', { name: 'Pinned' })).not.toHaveAttribute('title');
    }
    expect(screen.queryByRole('img', { name: 'Resolved' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Archived' })).not.toBeInTheDocument();

    await rerender({ summary: { ...summary, pin: { session_id: 'session-1', pinned: false, pinned_at: null } } });
    expect(screen.queryByRole('img', { name: 'Pinned' })).not.toBeInTheDocument();
    expect(container.querySelector('.session-header-lifecycle')).toBeNull();
  });

  it('keeps unknown lifecycle state out of the title and metadata', () => {
    const summary: DesktopSessionSummary = { agentId: 'agent-1', agentName: 'Agent', sessionId: 'session-1', title: 'Unknown lifecycle', cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'idle', lifecycle: null };
    const { container } = render(SessionHeader, { session: session(), summary, title: summary.title, workspace: 'work', updatedAt: 'Just now' });
    expect(container.querySelector('.session-header-lifecycle, .session-lifecycle-badge')).toBeNull();
    expect(screen.queryByText('Lifecycle unavailable')).not.toBeInTheDocument();
  });

  it('keeps header actions available without a context banner', async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    render(SessionHeader, {
      session: session({ runState: 'thinking', usage: usageFixture }),
      title: 'Active task',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now',
      onBack,
      onRefresh
    });

    expect(screen.getByLabelText('Status: Working')).toBeInTheDocument();
    expect(document.querySelector('.session-header-context')).toBeNull();
    expect(screen.queryByRole('button', { name: /Fork latest turn|Undo latest turn|Redo last undone turn/ })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await fireEvent.click(screen.getByLabelText('Session details'));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });
});

describe('SessionHeader restyle', () => {
  it('moves debug events into the More menu and drops the standalone debug button', async () => {
    const onDebug = vi.fn();
    const summary = { sessionId: 'session-1', title: 'Task' } as DesktopSessionSummary;
    render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Now', showDebug: true, debugLabel: 'Debug events (2)', onDebug });

    expect(screen.queryByRole('button', { name: /Debug events/ })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Task' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Debug events (2)' }));
    expect(onDebug).toHaveBeenCalledOnce();
  });

  it('hides the debug entry when developer mode is off', async () => {
    const summary = { sessionId: 'session-1', title: 'Task' } as DesktopSessionSummary;
    render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Now', showDebug: false, onDebug: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Task' }));
    expect(screen.queryByRole('menuitem', { name: /Debug events/ })).not.toBeInTheDocument();
  });

  it('keeps the More menu reachable for debug before a summary has loaded', async () => {
    const onDebug = vi.fn();
    render(SessionHeader, { session: session(), title: 'Loading', workspace: 'work', updatedAt: 'Now', showDebug: true, onDebug });
    await fireEvent.click(screen.getByRole('button', { name: 'Session actions for Loading' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Debug events' }));
    expect(onDebug).toHaveBeenCalledOnce();
  });

  it('uses ghost compact buttons with bits-ui tooltips and no native titles', async () => {
    const { container } = render(SessionHeader, {
      session: session(), summary: { sessionId: 'session-1', title: 'Task' } as DesktopSessionSummary,
      title: 'Task', workspace: 'work', updatedAt: 'Now'
    });

    for (const name of ['Back to sessions', 'Refresh session', 'Session details', 'Session actions for Task']) {
      const control = screen.getByLabelText(name);
      expect(control).toHaveClass('icon-btn-compact');
      expect(control).not.toHaveAttribute('title');
    }
    // Copy chips in the metadata keep their own titles; only the header buttons and status dot moved to bits-ui.
    expect(container.querySelector('.session-header-action-group > [title], .session-header-details > summary[title], .session-header-back[title], .session-header-status-wrap[title]')).toBeNull();
    expect(container.querySelector('.session-row-status-tooltip')).toBeNull();

    await fireEvent.pointerEnter(screen.getByRole('button', { name: 'Refresh session' }), { pointerType: 'mouse' });
    expect(await screen.findByText('Refresh session', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('shows the status label in a bits-ui tooltip on the dot', async () => {
    render(SessionHeader, { session: session({ runState: 'thinking' }), title: 'Busy', workspace: 'work', updatedAt: 'Now' });
    await fireEvent.pointerEnter(screen.getByLabelText('Status: Working').parentElement as HTMLElement, { pointerType: 'mouse' });
    expect(await screen.findByText('Working', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('keeps frosted glass on the header and its dissolve zone, with stronger side insets hiding corners', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const rules = (selector: string) => appCss.match(new RegExp(`\\n${selector} \\{([^}]+)\\}`))?.[1] ?? '';
    const header = rules('\\.session-header');
    expect(header).toContain('border: 0;');
    expect(header).toContain('border-radius: 0;');
    // The header itself must not be a backdrop root, or the ::after dissolve
    // zone could no longer blur the transcript.
    expect(header).not.toContain('backdrop-filter');
    expect(header).not.toContain('box-shadow');
    const glass = appCss.match(/\n\n\.session-header::before \{([^}]+)\}/)?.[1] ?? '';
    expect(glass).toContain('background: color-mix(in srgb, var(--body-bg-base) 94%, transparent);');
    expect(glass).toContain('backdrop-filter: blur(12px) saturate(140%);');
    expect(glass).toContain('inset 2rem 0 1.25rem -0.5rem var(--body-bg-base)');
    expect(glass).toContain('inset -2rem 0 1.25rem -0.5rem var(--body-bg-base)');
    expect(glass).toContain('inset 0 0 12px 6px var(--body-bg-base)');
    const fade = appCss.match(/\n\n\.session-header::after \{([^}]+)\}/)?.[1] ?? '';
    expect(fade).toContain('backdrop-filter: blur(3px);');
    expect(fade).toContain('height: 1.125rem;');
    expect(fade).toContain('mask-image: linear-gradient(to bottom, #000 30%, transparent);');
    expect(header).not.toContain('--shadow-sm');
    expect(header).not.toContain('--nav-bg');
    expect(rules('\\.session-header-action-group')).not.toContain('border-left');
  });
});

describe('SessionHeader calmer metadata row', () => {
  it('separates items with spacing instead of dot separators', () => {
    const summary = { sessionId: 'session-1', title: 'Task', workspace: { workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p', baselineMode: 'local_changes', lifecycle: 'ready', ownerSessionId: null, handedOffTo: null } } as DesktopSessionSummary;
    render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', profileLabel: 'def', agentName: 'QMT', updatedAt: '5m' });

    const meta = document.querySelector<HTMLElement>('.session-header-meta')!;
    const mobile = document.querySelector<HTMLElement>('.session-header-mobile-meta')!;
    expect(meta.querySelectorAll('[aria-hidden="true"]:not(svg)')).toHaveLength(0);
    expect(meta.textContent).not.toContain('\u00b7');
    expect(mobile.textContent).not.toContain('\u00b7');
    expect(meta).toHaveTextContent('def');
    expect(meta).toHaveTextContent('5m');
  });

  it('shows an 8-character session id and still copies the full one', () => {
    render(SessionHeader, { session: session({ sessionId: '01a072b3-a266-4c5d-8e9f-102030405060' }), title: 'Id', workspace: 'work', updatedAt: 'now' });
    expect(document.querySelector('.session-header-meta .session-id-chip-value')).toHaveTextContent(/^01a072b3$/);
    expect(document.querySelector('.session-header-mobile-id')).toHaveTextContent(/^01a072b3$/);
  });

  it('shows the compact time in the row with the full date in a bits-ui tooltip and the details panel', async () => {
    render(SessionHeader, { session: session(), title: 'Time', workspace: 'work', updatedAt: '5m', updatedAtFull: 'Oct 31, 2026, 4:10 PM' });
    const updated = document.querySelector<HTMLElement>('.session-header-meta .session-header-updated')!;
    expect(updated).toHaveTextContent(/^5m$/);
    expect(updated).not.toHaveAttribute('title');
    expect(document.querySelector('.session-header-details-panel')).toHaveTextContent('Oct 31, 2026, 4:10 PM');

    await fireEvent.pointerEnter(updated, { pointerType: 'mouse' });
    expect(await screen.findByText('Oct 31, 2026, 4:10 PM', { selector: '.app-tooltip-content' })).toBeInTheDocument();
  });

  it('keeps chips as plain dim text at rest with the faint pill fill only on hover', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const block = (selector: string) => appCss.match(new RegExp(`\\n${selector.replace(/[.[\]]/g, '\\$&')} \\{([^}]+)\\}`))?.[1] ?? '';
    const rest = block('.session-header-meta .session-id-chip,\n.session-header-meta .copy-chip');
    expect(rest).toContain('margin-inline: -0.35rem;');
    expect(rest).not.toContain('background');
    const hover = block('.session-header-meta .session-id-chip:hover,\n.session-header-meta .copy-chip:hover');
    expect(hover).toContain('background: var(--composer-pill-surface-hover);');
    expect(block('.session-header-meta')).toContain('gap: 0.75rem;');
  });

  it('colours the dot like the session list: a completed turn is green, ready stays muted', () => {
    const { rerender } = render(SessionHeader, { session: session({ runState: 'completed' }), title: 'Done', workspace: 'work', updatedAt: 'now' });
    expect(screen.getByLabelText('Status: Turn complete')).toHaveClass('session-header-status-dot-success');
    rerender({ session: session({ runState: 'idle' }) });
    expect(screen.getByLabelText('Status: Ready')).toHaveClass('session-header-status-dot-muted');
  });

  it('nudges the dot down so it sits on the lowercase text centre', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const wrap = appCss.match(/\n\.session-header-title-line > \.session-header-status-wrap \{([^}]+)\}/)?.[1] ?? '';
    expect(wrap).toContain('transform: translateY(1px);');
  });

  it('centres the status dot in a column as wide as the first metadata icon', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const block = (selector: string) => appCss.match(new RegExp(`\\n${selector.replace(/[.[\]>]/g, '\\$&')} \\{([^}]+)\\}`))?.[1] ?? '';
    const wrap = block('.session-header-title-line > .session-header-status-wrap');
    const icon = block('.session-header-lifecycle-icon');
    const iconWidth = icon.match(/width: (\d+px);/)?.[1];
    expect(iconWidth).toBe('13px');
    // Same width as the pin/resolved/archived icon, with the dot centred in it.
    expect(wrap).toContain(`width: ${iconWidth};`);
    expect(wrap).toContain('justify-content: center;');
  });

  it('does not clip the session id or the first chip hover pill', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const block = (selector: string) => appCss.match(new RegExp(`\\n${selector.replace(/[.[\]>]/g, '\\$&')} \\{([^}]+)\\}`))?.[1] ?? '';
    // The generic `.session-header-meta span` rule clips overflow; the id wrapper must outrank it
    // or the id's hover fill loses its rounded corners and looks square next to the workspace pill.
    expect(block('.session-header-meta > span.session-header-session-id')).toContain('overflow: visible;');
    // Room for the first chip's pill inside the row's clip box, with the text kept on the title's edge.
    const row = block('.session-header-meta');
    expect(row).toContain('padding-inline: 0.35rem;');
    expect(row).toContain('margin-inline: -0.35rem;');
  });
});

describe('SessionHeader worktree', () => {
  const workspace = { workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p', baselineMode: 'local_changes', lifecycle: 'missing', ownerSessionId: null, handedOffTo: null };

  it('shows the branch chip and worktree detail rows', async () => {
    const summary = { sessionId: 'session-1', title: 'Task', workspace } as DesktopSessionSummary;
    render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Just now' });
    const chip = screen.getByTestId('header-worktree-chip');
    expect(chip).toHaveTextContent('qmt/ws_1');
    expect(chip).toHaveTextContent('missing');
    expect(chip).not.toHaveAttribute('title');
    await fireEvent.pointerEnter(chip, { pointerType: 'mouse' });
    expect(await screen.findByText(/Checkout \/w\/ws_1/, { selector: '.app-tooltip-content' })).toBeInTheDocument();
    expect(screen.getByText('Worktree branch')).toBeInTheDocument();
    expect(screen.getByText('local changes')).toBeInTheDocument();
  });

  it('shows no worktree chip for plain sessions', () => {
    const summary = { sessionId: 'session-1', title: 'Task' } as DesktopSessionSummary;
    render(SessionHeader, { session: session(), summary, title: 'Task', workspace: 'work', updatedAt: 'Just now' });
    expect(screen.queryByTestId('header-worktree-chip')).not.toBeInTheDocument();
  });
});

