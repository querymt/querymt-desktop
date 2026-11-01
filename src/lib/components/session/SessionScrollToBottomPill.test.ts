import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

    await fireEvent.click(button);
    expect(onScrollToBottom).toHaveBeenCalledOnce();
  });

  it('uses the compact composer-styled button', () => {
    render(SessionScrollToBottomPill, { visible: true, onScrollToBottom: vi.fn() });

    const button = screen.getByRole('button', { name: 'Scroll to latest message and follow new content' });
    expect(button).toHaveClass('icon-btn', 'icon-btn-compact', 'session-scroll-bottom-btn');
    expect(button.closest('.session-scroll-bottom-slot')).not.toBeNull();
  });

  it('shares the activity bar halo and page-colored fill', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const body = appCss.match(/\.session-scroll-bottom-slot \.session-scroll-bottom-btn \{([^}]+)\}/)?.[1] ?? '';
    expect(body).toContain('background: var(--body-bg-base);');
    expect(body).toContain('0 0 0 4px var(--body-bg-base)');
    expect(body).toContain('border-radius: var(--radius-control);');
    expect(body).not.toContain('bg-panel-strong');
  });

  it('stays hidden while the view follows current content', () => {
    render(SessionScrollToBottomPill, { visible: false, onScrollToBottom: vi.fn() });

    expect(screen.queryByRole('button', { name: /Scroll to latest message/i })).not.toBeInTheDocument();
  });
});
