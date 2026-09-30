import '@testing-library/jest-dom/vitest';
import { ChevronUp } from '@lucide/svelte';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IconTooltipButton from './IconTooltipButton.svelte';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IconTooltipButton', () => {
  it('keeps native disabled from firing clicks and from exposing a tooltip root', async () => {
    const onclick = vi.fn();
    render(IconTooltipButton, {
      icon: ChevronUp,
      label: 'Previous response',
      disabled: true,
      onclick
    });

    const button = screen.getByRole('button', { name: 'Previous response' });
    expect(button).toBeDisabled();
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();

    await fireEvent.pointerEnter(button);
    await fireEvent.focus(button);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(document.querySelector('.app-tooltip-content')).toBeNull();
  });

  it('keeps aria-disabled buttons focusable, non-operational, and tooltip-capable', async () => {
    const onclick = vi.fn();
    render(IconTooltipButton, {
      icon: ChevronUp,
      label: 'Previous response',
      ariaDisabled: true,
      onclick
    });

    const button = screen.getByRole('button', { name: 'Previous response' });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    button.focus();
    expect(button).toHaveFocus();
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();

    await fireEvent.pointerMove(button);
    await fireEvent.pointerEnter(button);
    await fireEvent.focus(button);
    await vi.waitFor(() => {
      expect(document.querySelector('.app-tooltip-content')).toHaveTextContent('Previous response');
    });
  });

  it('invokes onclick for the default enabled control', async () => {
    const onclick = vi.fn();
    render(IconTooltipButton, {
      icon: ChevronUp,
      label: 'Next response',
      onclick
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Next response' }));
    expect(onclick).toHaveBeenCalledOnce();
  });
});
