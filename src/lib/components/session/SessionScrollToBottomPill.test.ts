import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionScrollToBottomPill from './SessionScrollToBottomPill.svelte';

afterEach(cleanup);

describe('SessionScrollToBottomPill', () => {
  it('renders without measured composer alignment and announces follow behavior', async () => {
    const onScrollToBottom = vi.fn();
    render(SessionScrollToBottomPill, { visible: true, onScrollToBottom });

    const button = screen.getByRole('button', {
      name: 'Scroll to latest message and follow new content'
    });
    expect(button).toHaveTextContent('Latest');

    await fireEvent.click(button);
    expect(onScrollToBottom).toHaveBeenCalledOnce();
  });

  it('stays hidden while the view follows current content', () => {
    render(SessionScrollToBottomPill, { visible: false, onScrollToBottom: vi.fn() });

    expect(screen.queryByRole('button', { name: /Scroll to latest message/i })).not.toBeInTheDocument();
  });
});
