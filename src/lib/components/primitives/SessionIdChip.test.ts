import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionIdChip from './SessionIdChip.svelte';

const sessionId = '01a07139-4691-70e3-aa22-9d22b14bf1da';

function stubClipboard() {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true
  });
  return writeText;
}

afterEach(cleanup);

describe('SessionIdChip', () => {
  it('renders a constant-width short id and copies the full session id', async () => {
    const writeText = stubClipboard();
    render(SessionIdChip, { sessionId });

    const chip = screen.getByRole('button', { name: 'Copy session ID' });
    expect(chip).toHaveTextContent('01a07139-4691');
    expect(chip).toHaveClass('session-id-chip');

    await fireEvent.click(chip);
    expect(writeText).toHaveBeenCalledWith(sessionId);

    // The overlay appears over the id; the id itself stays so the chip width never changes.
    expect(screen.getByText('01a07139-4691')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('copied');
  });

  it('hides the copied overlay after a moment', async () => {
    stubClipboard();
    render(SessionIdChip, { sessionId });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy session ID' }));
    expect(screen.getByRole('status')).toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stops click propagation so embedding rows are not activated', async () => {
    stubClipboard();
    render(SessionIdChip, { sessionId });

    const bubbled = vi.fn();
    document.body.addEventListener('click', bubbled);
    try {
      await fireEvent.click(screen.getByRole('button', { name: 'Copy session ID' }));
      expect(bubbled).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('click', bubbled);
    }
  });
});
