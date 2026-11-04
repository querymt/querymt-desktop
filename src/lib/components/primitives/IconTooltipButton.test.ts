import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshCw } from '@lucide/svelte';
import IconTooltipButton from './IconTooltipButton.svelte';

afterEach(cleanup);

describe('IconTooltipButton', () => {
  it('keeps the tooltip while busy so a spinner explains itself, but ignores clicks', async () => {
    const onclick = vi.fn();
    render(IconTooltipButton, { icon: RefreshCw, label: 'Refreshing agent status and connections…', busy: true, onclick });
    const button = screen.getByRole('button', { name: 'Refreshing agent status and connections…' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();
    await fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    await waitFor(() => expect(document.querySelector('.app-tooltip-content')).toHaveTextContent('Refreshing agent status and connections…'));
  });

  it('runs the action when not busy', async () => {
    const onclick = vi.fn();
    render(IconTooltipButton, { icon: RefreshCw, label: 'Refresh agents', onclick });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh agents' }));
    expect(onclick).toHaveBeenCalledOnce();
  });
});
