import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionDelegatesBubble from './SessionDelegatesBubble.svelte';
import SessionQueuedBubble from './SessionQueuedBubble.svelte';
import SessionActivityBar from './SessionActivityBar.svelte';
import { session } from './session-fixture';
import { buildSessionConversation } from '$lib/domain/session-conversation';
import { applyDelegationChildSession } from '$lib/domain/session-updates';
import type { ActiveSessionViewModel, DesktopSessionSummary, SessionToolCallItem, SessionTranscriptItem } from '$lib/domain/types';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function user(id = 'prompt-1', eventIndex = 1): SessionTranscriptItem {
  return { id, messageId: id, eventIndex, kind: 'user_message_chunk', text: 'Work on this turn' };
}

function delegate(overrides: Partial<SessionToolCallItem> = {}): SessionToolCallItem {
  return {
    id: 'delegate-1', title: 'Run delegate', kind: 'delegate', status: 'in_progress', eventIndex: 2,
    arguments: JSON.stringify({ target_agent_id: 'reviewer', objective: 'Review the current changes' }),
    childSessionId: 'child-1', delegationState: 'forked',
    ...overrides
  };
}

function active(tools: SessionToolCallItem[] = [delegate()], overrides: Partial<ActiveSessionViewModel> = {}): ActiveSessionViewModel {
  return session({ sessionId: 'parent', runState: 'tool-running', transcript: [user()], toolCalls: tools, ...overrides });
}

function child(overrides: Partial<DesktopSessionSummary> = {}): DesktopSessionSummary {
  return {
    agentId: 'agent-1', agentName: 'Agent', sessionId: 'child-1', title: 'Review layout changes', cwd: '/project',
    updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'thinking',
    ...overrides
  };
}

function renderDelegates(current = active(), extras: Record<string, unknown> = {}) {
  return render(SessionDelegatesBubble, { agentId: 'agent-1', session: current, ...extras });
}

describe('SessionDelegatesBubble', () => {
  it('stays out of the activity row when this turn has no delegates', () => {
    renderDelegates(active([{ id: 'shell', title: 'Run shell', kind: 'execute', status: 'in_progress', eventIndex: 2 }]));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('counts all delegates in the active turn and shows status icons before inline names and descriptions', async () => {
    renderDelegates(active([
      delegate(),
      delegate({ id: 'pending', status: 'completed', delegationState: 'requested', childSessionId: undefined, eventIndex: 3 }),
      delegate({ id: 'done', status: 'completed', delegationState: 'completed', childSessionId: 'done-child', eventIndex: 4 }),
      delegate({ id: 'failed', status: 'completed', delegationState: 'failed', childSessionId: 'failed-child', eventIndex: 5 })
    ]));
    const trigger = screen.getByRole('button', { name: '4 delegates in this turn' });
    expect(trigger).toHaveTextContent(/^4$/);
    expect(screen.queryByText('Delegates')).toBeNull();
    expect(trigger.querySelector('.lucide-network')).not.toBeNull();
    await fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Delegates in this turn' });
    expect(within(panel).getByRole('img', { name: 'Running' }).querySelector('.lucide-loader-circle')).toHaveClass('animate-spin');
    expect(within(panel).getByRole('img', { name: 'Pending' }).querySelector('.lucide-circle-ellipsis')).not.toBeNull();
    expect(within(panel).getByRole('img', { name: 'Completed' }).querySelector('.lucide-check')).not.toBeNull();
    expect(within(panel).getByRole('img', { name: 'Failed' }).querySelector('.lucide-triangle-alert')).not.toBeNull();
    expect(within(panel).queryByText(/^(Running|Pending|Completed|Failed)$/)).toBeNull();
    const link = within(panel).getAllByRole('link')[0];
    expect(link.firstElementChild).toBe(within(link).getByRole('img', { name: 'Running' }));
    expect(link.querySelector('.session-delegate-copy')).toHaveTextContent('reviewer Review the current changes');
    expect(appCss).toMatch(/\.session-delegate-copy \{[^}]*display: block;/);
    expect(appCss).toMatch(/\.session-delegate-status-completed \{[^}]*color: var\(--status-success\);/);
    expect(within(panel).getAllByRole('link')).toHaveLength(3);
  });

  it.each(['activity', 'turn'] as const)('shows actual delegate progress after dispatch completes (%s)', async (variant) => {
    let current = active([
      delegate({ status: 'completed', delegationState: undefined }),
      { id: 'later-tool', title: 'Run shell', kind: 'execute', status: 'completed', eventIndex: 3 }
    ], { runState: variant === 'turn' ? 'completed' : 'tool-running' });
    const props = () => variant === 'turn'
      ? { turn: buildSessionConversation(current)[0] }
      : { session: current };
    const { rerender } = render(SessionDelegatesBubble, { agentId: 'agent-1', variant, ...props() });
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(screen.getByRole('img', { name: 'Status unavailable' }).querySelector('.lucide-circle-ellipsis')).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Completed' })).toBeNull();

    for (const [state, label, icon] of [
      ['forked', 'Running', '.lucide-loader-circle'],
      ['completed', 'Completed', '.lucide-check']
    ] as const) {
      current = applyDelegationChildSession(current, { sessionId: 'parent', toolCallId: 'delegate-1', state });
      await rerender(props());
      expect(screen.getByRole('img', { name: label }).querySelector(icon)).not.toBeNull();
      expect(current.toolCalls[0].status).toBe('completed');
    }
  });

  it('shows cancelled delegation as a warning rather than a successful dispatch', async () => {
    renderDelegates(active([delegate({ status: 'completed', delegationState: 'cancelled' })]));
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(screen.getByRole('img', { name: 'Cancelled' }).querySelector('.lucide-triangle-alert')).not.toBeNull();
    expect(screen.queryByRole('img', { name: 'Completed' })).toBeNull();
  });

  it('shows the total delegate count in the turn pill, including completed and failed sessions', async () => {
    const turn = buildSessionConversation(active([
      delegate({ status: 'completed' }),
      delegate({ id: 'failed', status: 'failed', childSessionId: 'failed-child', eventIndex: 3 }),
      delegate({ id: 'running', eventIndex: 4 })
    ]))[0];
    render(SessionDelegatesBubble, { agentId: 'agent-1', sessionId: 'parent', turn, variant: 'turn' });
    const pill = screen.getByRole('button', { name: '3 delegates in this turn' });
    expect(pill).toHaveClass('session-turn-diff-pill', 'session-turn-delegates-pill');
    expect(pill).not.toHaveClass('session-queued-bubble');
    expect(pill).toHaveTextContent(/^3$/);
    expect(pill.querySelector('.lucide-network')).not.toBeNull();
    expect(pill.querySelector('.session-turn-diff-pill-arrow')).not.toBeNull();
    await fireEvent.click(pill);
    expect(screen.getByRole('region', { name: 'Delegates in this turn' })).toHaveClass('session-turn-delegates-panel');
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('flips a turn popup below a footer near the viewport top and updates placement on scroll', async () => {
    let rowTop = 50;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.matches('.session-assistant-message-actions')) return new DOMRect(0, rowTop, 300, 30);
      if (this.matches('.session-delegates-panel')) return new DOMRect(0, 0, 300, 150);
      return originalRect.call(this);
    });
    const turn = buildSessionConversation(active())[0];
    const { container } = render(SessionDelegatesBubble, { agentId: 'agent-1', turn, variant: 'turn' });
    container.className = 'session-assistant-message-actions';
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    const panel = screen.getByRole('region', { name: 'Delegates in this turn' });
    expect(panel).toHaveClass('session-turn-delegates-panel-below');

    rowTop = 300;
    await fireEvent.scroll(window);
    expect(panel).not.toHaveClass('session-turn-delegates-panel-below');
  });

  it('closes a turn popup when keyboard focus leaves it for another control', async () => {
    renderDelegates();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    outside.focus();
    await fireEvent.focusIn(outside);
    expect(screen.queryByRole('region')).toBeNull();
    outside.remove();
  });

  it('excludes previous-turn delegates even if their stored tool status is still running', async () => {
    renderDelegates(active([
      delegate({ id: 'old', childSessionId: 'old-child', eventIndex: 2 }),
      delegate({ id: 'current', childSessionId: 'current-child', eventIndex: 11 })
    ], { transcript: [user(), user('prompt-2', 10)] }));
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/sessions/agent-1/current-child');
  });

  it('deduplicates tool updates and retains submission order', async () => {
    renderDelegates(active([
      delegate({ id: 'later', childSessionId: 'later-child', eventIndex: 4 }),
      delegate({ id: 'first', childSessionId: 'first-child', eventIndex: 2 }),
      delegate({ id: 'first', childSessionId: 'first-child', eventIndex: 2, status: 'completed' })
    ]));
    await fireEvent.click(screen.getByRole('button', { name: '2 delegates in this turn' }));
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/sessions/agent-1/first-child', '/sessions/agent-1/later-child'
    ]);
  });

  it('recognizes peer delegations using the same tool classification as the transcript', async () => {
    renderDelegates(active([delegate({
      title: 'Run route_delegation_to_peer', kind: 'other', arguments: '{"peer":"remote-worker","objective":"Inspect logs"}'
    })]));
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(screen.getByRole('link', { name: 'Open remote-worker session' })).toHaveAttribute('href', '/sessions/agent-1/child-1');
  });

  it('uses verified child session ids, encodes the route, and shows session titles from the same agent', async () => {
    renderDelegates(active([delegate({ childSessionId: ' child/session ? ' })]), {
      agentId: 'agent/a',
      sessions: [
        child({ agentId: 'other-agent', sessionId: 'child/session ?', title: 'Wrong agent title' }),
        child({ agentId: 'agent/a', sessionId: 'child/session ?', title: 'Verified child title' })
      ]
    });
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    const link = screen.getByRole('link', { name: 'Open reviewer session' });
    expect(link).toHaveAttribute('href', '/sessions/agent%2Fa/child%2Fsession%20%3F');
    expect(link).toHaveTextContent('Verified child title');
    expect(screen.queryByText('Wrong agent title')).toBeNull();
  });

  it('does not invent a session link before the child notification arrives', async () => {
    const current = active([delegate({ childSessionId: undefined, arguments: '{"target_agent_id":"reviewer","session_id":"unverified"}' })]);
    const { rerender } = renderDelegates(current);
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Session starting...')).toBeInTheDocument();

    await rerender({ session: { ...current, toolCalls: [{ ...current.toolCalls[0], childSessionId: 'real-child' }] } });
    expect(screen.getByRole('link', { name: 'Open reviewer session' })).toHaveAttribute('href', '/sessions/agent-1/real-child');
  });

  it('handles absent target metadata without parsing session ids from tool results', async () => {
    renderDelegates(active([delegate({ arguments: 'invalid json', childSessionId: undefined, result: '{"session_id":"not-a-child"}' })]));
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(screen.getByText('Delegate')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('retains finished delegates while the turn is active, then hides the activity control and open list when it ends', async () => {
    const current = active([delegate(), delegate({ id: 'second', childSessionId: 'child-2', eventIndex: 3 })]);
    const { rerender } = renderDelegates(current);
    await fireEvent.click(screen.getByRole('button', { name: '2 delegates in this turn' }));
    const finishedTools = current.toolCalls.map((tool) => ({ ...tool, status: 'completed' as const }));
    await rerender({ session: { ...current, toolCalls: finishedTools } });
    expect(screen.getByRole('button', { name: '2 delegates in this turn' })).toHaveTextContent(/^2$/);
    expect(screen.getAllByRole('link')).toHaveLength(2);

    await rerender({ session: { ...current, runState: 'completed', toolCalls: finishedTools } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it.each(['idle', 'completed', 'failed'] as const)('does not show the activity control for an ended turn (%s)', (runState) => {
    renderDelegates(active([delegate({ status: 'completed' })], { runState }));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps delegate access while the parent turn is awaiting input', () => {
    renderDelegates(active([delegate({ status: 'completed' })], { runState: 'waiting-input' }));
    expect(screen.getByRole('button', { name: '1 delegate in this turn' })).toHaveTextContent(/^1$/);
  });

  it('resets the disclosure at the next turn instead of retaining the previous turn list', async () => {
    const current = active();
    const { rerender } = renderDelegates(current);
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    await rerender({ session: { ...current, transcript: [...current.transcript, user('next-turn', 10)] } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();

    await rerender({ session: {
      ...current, transcript: [...current.transcript, user('next-turn', 10)],
      toolCalls: [...current.toolCalls, delegate({ id: 'next-delegate', eventIndex: 11 })]
    } });
    expect(screen.getByRole('button', { name: '1 delegate in this turn' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('resets the disclosure when switching sessions with identical turn ids', async () => {
    const current = active();
    const { rerender } = renderDelegates(current);
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    await rerender({ session: { ...current, sessionId: 'other-parent' } });
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens above the existing row without a portal and supports scrolling, outside clicks and Escape focus return', async () => {
    const { container } = renderDelegates();
    const trigger = screen.getByRole('button', { name: '1 delegate in this turn' });
    await fireEvent.click(trigger);
    const panel = screen.getByRole('region', { name: 'Delegates in this turn' });
    expect(container).toContainElement(panel);
    expect(panel.parentElement).toBe(trigger.parentElement);
    expect(trigger).toHaveAttribute('aria-controls', panel.id);
    const list = screen.getByRole('region', { name: 'Delegate sessions' });
    expect(list).toHaveAttribute('tabindex', '0');
    await fireEvent.scroll(list);
    expect(panel).toBeInTheDocument();
    screen.getByRole('link').focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(trigger).toHaveFocus();
    await fireEvent.click(trigger);
    await fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('opens through a callback so keyboard activation can close the queue panel before showing delegates', async () => {
    const { container, rerender: rerenderQueue } = render(SessionQueuedBubble, {
      inputs: [{ inputId: 'queue', delivery: 'queue', state: 'queued', prompt: 'Later', attachments: [], createdAt: 0 }]
    });
    await fireEvent.click(screen.getByRole('button', { name: '1 waiting message' }));
    const onOpen = vi.fn(() => { void rerenderQueue({ open: false }); });
    render(SessionDelegatesBubble, { target: container, props: { agentId: 'agent-1', session: active(), onOpen } });
    render(SessionActivityBar, { target: container, props: { session: active() } });
    await fireEvent.click(screen.getByRole('button', { name: '1 delegate in this turn' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Delegates in this turn' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 waiting message' })).toHaveTextContent(/^1$/);
    expect(screen.getByRole('status')).toHaveTextContent('Double Esc to cancel');
  });

  it('keeps both counts in the same activity row without making the composer own them', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/routes/sessions/[agentId]/[sessionId]/+page.svelte'), 'utf8');
    const dock = page.split('class="session-activity-bar-dock"')[1].split('</div>')[0];
    expect(dock.indexOf('<SessionQueuedBubble')).toBeLessThan(dock.indexOf('<SessionDelegatesBubble'));
    expect(dock.indexOf('<SessionDelegatesBubble')).toBeLessThan(dock.indexOf('<SessionActivityBar'));
    expect(dock).toContain('onOpen={() => (queuedInputsOpen = false)}');
    expect(dock).toContain('onOpen={() => (delegatesOpen = false)}');
    expect(appCss).toMatch(/\.session-queued-bubble \{[^}]*flex: 0 0 auto;/);
    expect(appCss).toContain('.session-delegates-bubble ~ .session-activity-bar .session-activity-meta {');
    expect(appCss).toMatch(/\.session-delegate-copy \{[^}]*overflow-wrap: anywhere;/);
  });
});
