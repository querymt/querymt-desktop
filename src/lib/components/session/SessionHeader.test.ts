import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionHeader from './SessionHeader.svelte';
import { session } from './session-fixture';
import type { DesktopSessionSummary } from '$lib/domain/types';

const usageFixture = {
  contextUsed: 24_000,
  contextLimit: 100_000,
  cumulativeCostUsd: 0.05,
  activeWorkMs: 12_000,
  activeWorkStartedAt: null
};

afterEach(cleanup);

describe('SessionHeader', () => {
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
    expect(within(mobileContext).getByText('session-1')).toBeInTheDocument();
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

  it('places runtime before the title and packs metadata in path, id, profile, context, time order', () => {
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
    expect(order[3]).toContain('session-header-context-slot');
    expect(order[4]).toContain('session-header-meta-desktop');
    expect(meta?.children[4]?.textContent).toContain('Just now');
    expect(meta?.querySelector('.session-header-status-wrap')).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Visible context' });
    expect(heading.previousElementSibling).toHaveClass('session-header-status-wrap');
    expect(header?.querySelectorAll('.session-header-title-line > .session-header-status-wrap')).toHaveLength(1);
    expect(meta?.querySelector('.session-context-dial')).toHaveTextContent('24%');

    const mobileDial = mobile?.querySelector(':scope > .session-context-dial');
    const mobileId = mobile?.querySelector('.session-header-mobile-id');
    expect(mobileId).not.toBeNull();
    expect(mobileDial).not.toBeNull();
    expect(mobileId!.nextElementSibling).toBe(mobileDial);
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
    expect(chip).toHaveTextContent('01a072b3-a266');
    await fireEvent.click(chip);

    expect(writeText).toHaveBeenCalledWith('01a072b3-a266-4c5d-8e9f-102030405060');
    // The copied confirmation overlays the id instead of replacing it, so the chip keeps its width.
    expect(within(chip).getByText('01a072b3-a266')).toBeInTheDocument();
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
    [false, false, []],
    [true, false, ['Resolved']],
    [false, true, ['Archived']],
    [true, true, ['Resolved', 'Archived']]
  ] as const)('shows independent lifecycle icons in metadata, never beside the title (resolved=%s, archived=%s)', (resolved, archived, labels) => {
    const summary: DesktopSessionSummary = { agentId: 'agent-1', agentName: 'Agent', sessionId: 'session-1', title: 'A long session title that must stay on its own line', cwd: '/tmp/work', updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'idle', lifecycle: { session_id: 'session-1', resolved, archived, resolved_at: null, archived_at: null } };
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
        expect(icon).toHaveAttribute('title', label);
        expect(icon.querySelector('svg')).toHaveAttribute('width', '13');
        expect(icon.closest('button, a')).toBeNull();
        if (label === 'Resolved') {
          expect(icon).toHaveClass('session-header-lifecycle-icon-resolved');
          expect(icon.querySelector('.lucide-circle-check-big')).not.toBeNull();
        } else {
          expect(icon).not.toHaveClass('session-header-lifecycle-icon-resolved');
          expect(icon.querySelector('.lucide-archive')).not.toBeNull();
        }
      }
      if (labels.length) {
        const group = metadata.querySelector('.session-header-lifecycle')!;
        expect(group.nextElementSibling).toHaveClass(selector === '.session-header-meta' ? 'session-header-workspace' : 'session-header-mobile-workspace');
      } else expect(metadata.querySelector('.session-header-lifecycle')).toBeNull();
    }
    expect(container.querySelector('.session-header-meta .session-header-status-wrap')).toBeNull();
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
