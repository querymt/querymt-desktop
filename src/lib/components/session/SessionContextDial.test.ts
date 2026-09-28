import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SessionContextDial from './SessionContextDial.svelte';

const usage = {
  contextUsed: 130_000,
  contextLimit: 1_100_000,
  cumulativeCostUsd: null,
  activeWorkMs: 0,
  activeWorkStartedAt: null
};

function dial(): HTMLElement {
  const root = document.querySelector<HTMLElement>('.session-context-dial');
  expect(root).not.toBeNull();
  return root!;
}

afterEach(cleanup);

describe('SessionContextDial', () => {
  it('renders a fixed ring and the used count, not a stretched meter', () => {
    render(SessionContextDial, { usage });

    const root = dial();
    expect(root.className).not.toContain('session-context-tone');
    expect(root.classList.contains('session-context-dial-calm')).toBe(true);
    expect(screen.getByRole('meter', { name: 'Context window' })).toBeTruthy();
    expect(root).toHaveTextContent('12%');
    expect(root).not.toHaveTextContent('130k');
    expect(root.getAttribute('title')).toBe('130k of 1.1m · 12% of the context window, 970k left');
    expect(root.querySelector('.session-context-dial-arc')).not.toBeNull();
    expect(root.querySelector('.session-usage-meter')).toBeNull();
  });

  it('stays hidden until the session reports a reading', () => {
    render(SessionContextDial, {
      usage: {
        contextUsed: null,
        contextLimit: null,
        cumulativeCostUsd: null,
        activeWorkMs: 0,
        activeWorkStartedAt: null
      }
    });

    expect(document.querySelector('.session-context-dial')).toBeNull();
    expect(screen.queryByText('No usage yet')).toBeNull();
  });

  it('switches the figure to remaining and warns once the window is tight', () => {
    render(SessionContextDial, {
      usage: { ...usage, contextUsed: 990_000 }
    });

    const root = dial();
    expect(root.classList.contains('session-context-dial-tight')).toBe(true);
    expect(root).toHaveTextContent('90%');
    expect(root).not.toHaveTextContent('left');
    expect(root.getAttribute('title')).toContain('90% of the context window');
    expect(root.getAttribute('title')).toContain('110k left');
  });

  it('marks a nearly full window as full', () => {
    render(SessionContextDial, {
      usage: { ...usage, contextUsed: 1_060_000 }
    });

    expect(dial().classList.contains('session-context-dial-full')).toBe(true);
    expect(screen.getByText('96%')).toBeTruthy();
  });

  it('shows used tokens without an arc when the limit is unknown', () => {
    render(SessionContextDial, {
      usage: { ...usage, contextLimit: null }
    });

    const root = dial();
    expect(root.getAttribute('role')).toBe('img');
    expect(root.querySelector('.session-context-dial-arc')).toBeNull();
    expect(root).toHaveTextContent('130k');
    expect(root.getAttribute('title')).toBe('130k in the context window');
  });
});
