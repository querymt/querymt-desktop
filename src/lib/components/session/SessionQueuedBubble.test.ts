import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionQueuedBubble from './SessionQueuedBubble.svelte';
import type { PendingSessionInput } from '$lib/domain/types';

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

  it('shows the waiting count hint with correct pluralization', async () => {
    const { rerender } = render(SessionQueuedBubble, {
      inputs: [queuedInput({ inputId: 'a', prompt: 'Run the test suite' })]
    });

    const bubble = screen.getByRole('button', { name: /1 waiting message/ });
    expect(bubble).toHaveAttribute('aria-label', '1 waiting message');
    expect(bubble.querySelector('.session-queued-bubble-title')).toHaveTextContent('1');

    await rerender({
      inputs: [
        queuedInput({ inputId: 'a', prompt: 'Run the test suite' }),
        queuedInput({ inputId: 'b', prompt: 'Deploy to staging' })
      ]
    });
    expect(screen.getByRole('button', { name: /2 waiting messages/ })).toHaveAttribute('aria-label', '2 waiting messages');
  });

  it('opens a body-level panel listing every waiting message and closes on Escape', async () => {
    render(SessionQueuedBubble, {
      inputs: [
        queuedInput({ inputId: 'a', prompt: 'Run the test suite', state: 'queued' }),
        queuedInput({ inputId: 'b', prompt: 'Deploy to staging', state: 'sending' })
      ]
    });

    const bubble = screen.getByRole('button', { name: /2 waiting messages/ });
    expect(bubble).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(bubble);
    expect(bubble).toHaveAttribute('aria-expanded', 'true');

    const panel = document.querySelector('.session-queued-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelectorAll('.session-queued-panel-item')).toHaveLength(2);
    expect(panel).toHaveTextContent('Run the test suite');
    expect(panel).toHaveTextContent('Deploy to staging');
    expect(panel).toHaveTextContent('sending');

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.session-queued-panel')).toBeNull();
    expect(bubble).toHaveAttribute('aria-expanded', 'false');
  });

  it('falls back to an attachment count for waiting inputs without a prompt', async () => {
    render(SessionQueuedBubble, {
      inputs: [
        queuedInput({
          inputId: 'a',
          prompt: '',
          attachments: [{ id: 'file-1', name: 'log.txt', mimeType: 'text/plain', data: 'aGk=', size: 2 }]
        })
      ]
    });

    const bubble = screen.getByRole('button', { name: /1 waiting message/ });
    await fireEvent.click(bubble);

    const panel = document.querySelector('.session-queued-panel');
    expect(panel).toHaveTextContent('1 attachment(s)');
  });

  it('removes queued inputs but does not offer removal for steering', async () => {
    const onDiscardQueued = vi.fn();
    render(SessionQueuedBubble, {
      inputs: [
        queuedInput({ inputId: 'steer-1', prompt: 'Steer left', delivery: 'steer', state: 'accepted' }),
        queuedInput({ inputId: 'queue-1', prompt: 'Queue next', delivery: 'queue', state: 'queued' })
      ],
      onDiscardQueued
    });

    await fireEvent.click(screen.getByRole('button', { name: /2 waiting messages/ }));

    const removeButtons = screen.getAllByRole('button', { name: 'Remove queued message' });
    expect(removeButtons).toHaveLength(1);
    await fireEvent.click(removeButtons[0]);
    expect(onDiscardQueued).toHaveBeenCalledWith('queue-1');
  });

  it('disables queued removal while the request is pending', async () => {
    render(SessionQueuedBubble, {
      inputs: [queuedInput({ inputId: 'queue-1', discardPending: true })],
      onDiscardQueued: vi.fn()
    });

    await fireEvent.click(screen.getByRole('button', { name: /1 waiting message/ }));

    expect(screen.getByRole('button', { name: 'Remove queued message' })).toBeDisabled();
  });

  it('marks steered and queued inputs with distinct icons in submission order', async () => {
    render(SessionQueuedBubble, {
      inputs: [
        queuedInput({ inputId: 'b', prompt: 'Queue next', delivery: 'queue', state: 'queued', createdAt: 2 }),
        queuedInput({ inputId: 'a', prompt: 'Steer left', delivery: 'steer', state: 'accepted', createdAt: 1 })
      ]
    });

    await fireEvent.click(screen.getByRole('button', { name: /2 waiting messages/ }));

    const items = document.querySelectorAll('.session-queued-panel-item');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('.lucide-navigation')).not.toBeNull();
    expect(items[0]).toHaveTextContent('accepted');
    expect(items[0]).toHaveTextContent('Steer left');
    expect(items[1].querySelector('.lucide-plus')).not.toBeNull();
    expect(items[1]).toHaveTextContent('queued');
    expect(items[1]).toHaveTextContent('Queue next');
  });
});
