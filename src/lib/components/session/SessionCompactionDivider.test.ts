import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionCompactionDivider from './SessionCompactionDivider.svelte';
import type { SessionCompactionItem } from '$lib/domain/types';

function item(overrides: Partial<SessionCompactionItem> = {}): SessionCompactionItem {
  return { id: 'c1', status: 'completed', summary: '## Goals\n\nShip it.', tokensBefore: 150_000, tokensAfter: 20_000, ...overrides };
}

afterEach(cleanup);

describe('SessionCompactionDivider', () => {
  it('renders a boundary with the token drop and a collapsed, toggleable markdown summary', async () => {
    const { container } = render(SessionCompactionDivider, { compaction: item() });
    expect(screen.getByText('Context compacted')).toBeInTheDocument();
    expect(screen.getByText('150k \u2192 20k tokens')).toBeInTheDocument();
    expect(container.querySelector('.session-turn')).toBeNull();
    expect(container.querySelector('.session-compaction-summary')).toBeNull();

    const toggle = screen.getByRole('button', { name: /show summary/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.session-compaction-summary h2')?.textContent).toBe('Goals');
    await fireEvent.click(toggle);
    expect(container.querySelector('.session-compaction-summary')).toBeNull();
  });

  it('shows a live state with no toggle until summary text exists', () => {
    const { container, rerender } = render(SessionCompactionDivider, {
      compaction: item({ status: 'in_progress', summary: '', tokensAfter: null })
    });
    expect(screen.getByText('Compacting context\u2026')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    return rerender({ compaction: item({ status: 'in_progress', summary: 'partial', tokensAfter: null }) }).then(() => {
      expect(screen.getByRole('button', { name: /show summary/i })).toBeInTheDocument();
    });
  });

  it('shows failure details in the failed tone', () => {
    const { container } = render(SessionCompactionDivider, {
      compaction: item({ status: 'failed', summary: '', error: 'provider down' })
    });
    expect(screen.getByText('Compaction failed')).toBeInTheDocument();
    expect(screen.getByText('provider down')).toBeInTheDocument();
    expect(container.querySelector('.session-compaction')).toHaveClass('session-compaction-failed');
  });
});
