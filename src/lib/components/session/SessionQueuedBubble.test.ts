import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionQueuedBubble from './SessionQueuedBubble.svelte';
import SessionActivityBar from './SessionActivityBar.svelte';
import { session } from './session-fixture';
import type { PendingSessionInput } from '$lib/domain/types';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

afterEach(cleanup);

function queuedInput(overrides: Partial<PendingSessionInput> = {}): PendingSessionInput {
  return {
    inputId: 'input-1',
    delivery: 'queue',
    state: 'queued',
    prompt: 'Run the test suite',
    attachments: [],
    createdAt: 0,
    ...overrides
  };
}

describe('SessionQueuedBubble', () => {
  it('renders nothing when no messages are queued', () => {
    const { container } = render(SessionQueuedBubble, { inputs: [] });

    expect(container.querySelector('.session-queued-bubble')).toBeNull();
    expect(document.querySelector('.session-queued-panel')).toBeNull();
  });

  it('preserves the original compact icon/count with the waiting label only as its accessible name and tooltip', async () => {
    const { rerender } = render(SessionQueuedBubble, {
      inputs: [queuedInput({ inputId: 'a' })]
    });

    const trigger = screen.getByRole('button', { name: '1 waiting message' });
    expect(trigger).toHaveTextContent(/^1$/);
    expect(trigger.querySelector('.lucide-clock')).not.toBeNull();
    expect(screen.queryByText('1 waiting message')).toBeNull();

    await rerender({
      inputs: [queuedInput({ inputId: 'a' }), queuedInput({ inputId: 'b' })]
    });
    expect(screen.getByRole('button', { name: '2 waiting messages' })).toHaveTextContent(/^2$/);
    expect(screen.queryByText('2 waiting messages')).toBeNull();
  });

  it('opens within the activity dock without a body portal or visible heading and closes on Escape', async () => {
    const { container } = render(SessionQueuedBubble, {
      inputs: [
        queuedInput({ inputId: 'a', prompt: 'Run the test suite' }),
        queuedInput({ inputId: 'b', prompt: 'Deploy to staging', state: 'sending' })
      ]
    });

    const bubble = screen.getByRole('button', { name: '2 waiting messages' });
    expect(bubble).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(bubble);
    expect(bubble).toHaveAttribute('aria-expanded', 'true');

    const panel = screen.getByRole('region', { name: 'Waiting messages' });
    expect(container).toContainElement(panel);
    expect(panel.parentElement).toBe(bubble.parentElement);
    expect(bubble).toHaveAttribute('aria-controls', panel.id);
    expect(bubble).not.toHaveAttribute('aria-haspopup');
    expect(panel).not.toHaveAttribute('style');
    expect(panel.querySelector('.session-queued-panel-heading')).toBeNull();
    expect(within(panel).queryByText('Waiting messages')).toBeNull();
    expect(panel.querySelectorAll('.session-queued-panel-item')).toHaveLength(2);
    expect(panel).toHaveTextContent('Run the test suite');
    expect(panel).toHaveTextContent('Deploy to staging');
    expect(panel).toHaveTextContent('sending');

    const list = within(panel).getByRole('region', { name: 'Waiting message list' });
    expect(list).toHaveAttribute('tabindex', '0');
    list.focus();
    await fireEvent.keyDown(list, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
    expect(bubble).toHaveFocus();
  });

  it('stays open while scrolling inside the panel, toggles on the icon, and closes on outside clicks', async () => {
    render(SessionQueuedBubble, { inputs: [queuedInput()] });
    const bubble = screen.getByRole('button', { name: '1 waiting message' });
    await fireEvent.click(bubble);

    const list = screen.getByRole('region', { name: 'Waiting message list' });
    await fireEvent.scroll(list);
    await fireEvent.mouseDown(list);
    expect(screen.getByRole('region', { name: 'Waiting messages' })).toBeInTheDocument();

    await fireEvent.click(bubble);
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();

    await fireEvent.click(bubble);
    await fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();
  });

  it('resets the disclosure after the last waiting input is removed', async () => {
    const { rerender } = render(SessionQueuedBubble, { inputs: [queuedInput()] });
    await fireEvent.click(screen.getByRole('button', { name: '1 waiting message' }));

    await rerender({ inputs: [] });
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();

    await rerender({ inputs: [queuedInput()] });
    expect(screen.getByRole('button', { name: '1 waiting message' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('falls back to an attachment count for waiting inputs without a prompt', async () => {
    render(SessionQueuedBubble, {
      inputs: [queuedInput({
        prompt: '',
        attachments: [{ id: 'file-1', name: 'log.txt', mimeType: 'text/plain', data: 'aGk=', size: 2 }]
      })]
    });

    await fireEvent.click(screen.getByRole('button', { name: '1 waiting message' }));
    expect(screen.getByRole('region', { name: 'Waiting messages' })).toHaveTextContent('1 attachment(s)');
  });

  it('removes queued inputs but does not offer removal for steering or sending inputs', async () => {
    const onDiscardQueued = vi.fn();
    render(SessionQueuedBubble, {
      inputs: [
        queuedInput({ inputId: 'steer-1', delivery: 'steer', state: 'accepted' }),
        queuedInput({ inputId: 'queue-1' }),
        queuedInput({ inputId: 'sending-1', state: 'sending' })
      ],
      onDiscardQueued
    });

    await fireEvent.click(screen.getByRole('button', { name: '3 waiting messages' }));
    const removeButtons = screen.getAllByRole('button', { name: 'Remove queued message' });
    expect(removeButtons).toHaveLength(1);
    await fireEvent.click(removeButtons[0]);
    expect(onDiscardQueued).toHaveBeenCalledExactlyOnceWith('queue-1');
  });

  it('does not offer queued removal when unsupported', async () => {
    render(SessionQueuedBubble, { inputs: [queuedInput()] });
    await fireEvent.click(screen.getByRole('button', { name: '1 waiting message' }));
    expect(screen.queryByRole('button', { name: 'Remove queued message' })).toBeNull();
  });

  it('disables queued removal while the request is pending', async () => {
    const onDiscardQueued = vi.fn();
    render(SessionQueuedBubble, {
      inputs: [queuedInput({ discardPending: true })],
      onDiscardQueued
    });

    await fireEvent.click(screen.getByRole('button', { name: '1 waiting message' }));
    const remove = screen.getByRole('button', { name: 'Remove queued message' });
    expect(remove).toBeDisabled();
    remove.click();
    expect(onDiscardQueued).not.toHaveBeenCalled();
  });

  it('distinguishes steering and queue inputs in stable submission order without mutating inputs', async () => {
    const inputs = [
      queuedInput({ inputId: 'b', prompt: 'Queue next', createdAt: 2 }),
      queuedInput({ inputId: 'a', prompt: 'Steer left', delivery: 'steer', state: 'accepted', createdAt: 1 }),
      queuedInput({ inputId: 'c', prompt: 'Same timestamp', createdAt: 2 })
    ];
    render(SessionQueuedBubble, { inputs });
    await fireEvent.click(screen.getByRole('button', { name: '3 waiting messages' }));

    const items = document.querySelectorAll('.session-queued-panel-item');
    expect(items).toHaveLength(3);
    expect(items[0].querySelector('.lucide-navigation')).not.toBeNull();
    expect(items[0]).toHaveTextContent('Steering message: accepted');
    expect(items[0]).toHaveTextContent('Steer left');
    expect(items[1].querySelector('.lucide-plus')).not.toBeNull();
    expect(items[1]).toHaveTextContent('Queued message: queued');
    expect(items[1]).toHaveTextContent('Queue next');
    expect(items[2]).toHaveTextContent('Same timestamp');
    expect(inputs.map((input) => input.inputId)).toEqual(['b', 'a', 'c']);
  });

  it('keeps the compact trigger before the activity status on the session page', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/routes/sessions/[agentId]/[sessionId]/+page.svelte'), 'utf8');
    const activityDock = page.split('class="session-activity-bar-dock"')[1].split('</div>')[0];
    expect(activityDock).toContain('<SessionQueuedBubble');
    expect(activityDock).toContain('<SessionActivityBar');
    expect(activityDock.indexOf('<SessionQueuedBubble')).toBeLessThan(activityDock.indexOf('<SessionActivityBar'));
  });

  it('keeps the original activity row intact when the list is toggled', async () => {
    const { container } = render(SessionQueuedBubble, { inputs: [queuedInput()] });
    container.className = 'session-activity-bar-dock';
    render(SessionActivityBar, {
      target: container,
      props: { session: session({ runState: 'streaming' }) }
    });

    const bubble = screen.getByRole('button', { name: '1 waiting message' });
    const activity = screen.getByRole('status');
    expect(container.firstElementChild).toBe(bubble);
    expect(bubble.nextElementSibling).toBe(activity);
    expect(activity).not.toHaveTextContent('Double Esc to cancel');
    expect(activity).toHaveAttribute('data-tooltip-trigger');

    await fireEvent.click(bubble);
    expect(screen.getByRole('region', { name: 'Waiting messages' }).parentElement).toBe(container);
    expect(screen.getByRole('status')).toBe(activity);
    expect(container.firstElementChild).toBe(bubble);
    expect(bubble).toHaveTextContent(/^1$/);

    await fireEvent.click(bubble);
    expect(bubble.nextElementSibling).toBe(activity);
    expect(screen.queryByRole('region', { name: 'Waiting messages' })).toBeNull();
  });

  it.each([1, 12, 1234])('keeps the full count %i next to a long activity label', (count) => {
    const { container } = render(SessionQueuedBubble, {
      inputs: Array.from({ length: count }, (_, index) => queuedInput({ inputId: `input-${index}` }))
    });
    container.className = 'session-activity-bar-dock';
    render(SessionActivityBar, {
      target: container,
      props: { session: session({
        runState: 'thinking',
        activityLabel: `Run command · sleep 120; ssh ${'long-command-argument '.repeat(30)}`
      }) }
    });

    const trigger = screen.getByRole('button', { name: `${count} waiting ${count === 1 ? 'message' : 'messages'}` });
    expect(trigger).toHaveTextContent(new RegExp(`^${count}$`));
    expect(trigger.nextElementSibling).toBe(screen.getByRole('status'));
    const bubbleRules = appCss.match(/\.session-queued-bubble \{([^}]+)\}/)?.[1] ?? '';
    expect(bubbleRules).toContain('flex: 0 0 auto;');
  });

  it('anchors the panel above the full activity row without changing its layout and bounds a wrapping, scrollable list', () => {
    const rules = (selector: string) => appCss.match(new RegExp(`\\.${selector} \\{([^}]+)\\}`))?.[1] ?? '';
    const panel = rules('session-queued-panel');
    expect(panel).toContain('width: 100%;');
    expect(panel).toContain('min-width: 0;');
    expect(panel).toContain('position: absolute;');
    expect(panel).toContain('left: 0;');
    expect(panel).toContain('bottom: calc(100% + 0.5rem);');
    expect(panel).toContain('pointer-events: auto;');
    expect(rules('session-activity-bar-dock')).toContain('display: flex;');
    expect(rules('session-activity-bar-dock')).not.toContain('flex-direction: column;');
    expect(rules('session-composer-morph-shell')).toContain('grid-area: 1 / 1;');
    expect(rules('session-queued-panel-prompt')).toContain('overflow-wrap: anywhere;');
    expect(rules('session-queued-panel-prompt')).toContain('white-space: pre-wrap;');
    expect(rules('session-queued-panel-list')).toMatch(/max-height:.*dvh/);
    expect(rules('session-queued-panel-list')).toContain('overflow-y: auto;');
    expect(rules('session-queued-panel-list')).toContain('grid-auto-rows: max-content;');
  });
});
