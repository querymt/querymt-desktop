import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionTurnNavItem } from '$lib/domain/session-turn-navigation';
import SessionTurnNavigationRail from './SessionTurnNavigationRail.svelte';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

const items: SessionTurnNavItem[] = [
  { id: 't1:request', turnId: 't1', kind: 'request', label: 'User request 1 of 2' },
  { id: 't1:response', turnId: 't1', kind: 'response', label: 'Agent response 1 of 2' },
  { id: 't2:request', turnId: 't2', kind: 'request', label: 'User request 2 of 2' },
  { id: 't2:response', turnId: 't2', kind: 'response', label: 'Agent response 2 of 2' }
];

function denseItems(count: number): SessionTurnNavItem[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return [
      {
        id: `t${n}:request`,
        turnId: `t${n}`,
        kind: 'request' as const,
        label: `User request ${n} of ${count}`
      },
      {
        id: `t${n}:response`,
        turnId: `t${n}`,
        kind: 'response' as const,
        label: `Agent response ${n} of ${count}`
      }
    ];
  }).flat();
}

function mockRect(
  element: Element,
  rect: { top: number; bottom: number; height?: number; left?: number; width?: number }
) {
  const height = rect.height ?? rect.bottom - rect.top;
  const left = rect.left ?? 0;
  const width = rect.width ?? 24;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: rect.top,
    top: rect.top,
    bottom: rect.bottom,
    left,
    right: left + width,
    width,
    height,
    toJSON() {
      return this;
    }
  } as DOMRect);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SessionTurnNavigationRail', () => {
  it('keeps 24px tick targets with a decorative mark and ordinal labels', () => {
    const tickRule = appCss.match(/\.session-turn-nav-tick \{([\s\S]*?)\}/)?.[1] ?? '';
    const markRule = appCss.match(/\.session-turn-nav-tick::before \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(tickRule).toContain('min-width: 24px;');
    expect(tickRule).toContain('min-height: 24px;');
    expect(tickRule).toContain('width: 24px;');
    expect(tickRule).toContain('height: 24px;');
    expect(markRule).toContain("content: '';");
    expect(appCss).toContain('overflow-y: auto;');
  });

  it('renders previous/next response controls and highlights the active tick', async () => {
    const onNavigate = vi.fn();
    render(SessionTurnNavigationRail, {
      items,
      activeId: 't1:response',
      previousResponseId: null,
      nextResponseId: 't2:response',
      onNavigate
    });

    const previous = screen.getByRole('button', { name: 'Previous response' });
    const next = screen.getByRole('button', { name: 'Next response' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toBeDisabled();
    expect(next).not.toHaveAttribute('aria-disabled');
    expect(next).toBeEnabled();

    expect(screen.getByRole('button', { name: 'Agent response 1 of 2' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Agent response 2 of 2' })).not.toHaveAttribute(
      'aria-current'
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 2 of 2' }));
    expect(onNavigate).toHaveBeenCalledWith('t2:response');

    await fireEvent.click(next);
    expect(onNavigate).toHaveBeenCalledWith('t2:response');
  });

  it('does not navigate from a boundary previous control but keeps it focusable', async () => {
    const onNavigate = vi.fn();
    render(SessionTurnNavigationRail, {
      items,
      activeId: 't1:request',
      previousResponseId: null,
      nextResponseId: 't1:response',
      onNavigate
    });

    const previous = screen.getByRole('button', { name: 'Previous response' });
    previous.focus();
    expect(previous).toHaveFocus();
    await fireEvent.click(previous);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('exposes exact previous/next tooltip copy when enabled and at the boundary', async () => {
    render(SessionTurnNavigationRail, {
      items,
      activeId: 't1:response',
      previousResponseId: null,
      nextResponseId: 't2:response',
      onNavigate: vi.fn()
    });

    const previous = screen.getByRole('button', { name: 'Previous response' });
    const next = screen.getByRole('button', { name: 'Next response' });

    await fireEvent.pointerMove(previous);
    await fireEvent.pointerEnter(previous);
    await fireEvent.focus(previous);
    await vi.waitFor(() => {
      const tips = [...document.querySelectorAll('.app-tooltip-content')].map((node) =>
        node.textContent?.trim()
      );
      expect(tips).toContain('Previous response');
    });

    await fireEvent.pointerLeave(previous);
    await fireEvent.blur(previous);
    await fireEvent.pointerMove(next);
    await fireEvent.pointerEnter(next);
    await fireEvent.focus(next);
    await vi.waitFor(() => {
      const tips = [...document.querySelectorAll('.app-tooltip-content')].map((node) =>
        node.textContent?.trim()
      );
      expect(tips).toContain('Next response');
    });
  });

  it('scrolls only the tick list so a newly active button becomes visible', async () => {
    const onNavigate = vi.fn();
    const many = denseItems(12);
    const { rerender } = render(SessionTurnNavigationRail, {
      items: many,
      activeId: 't1:response',
      previousResponseId: null,
      nextResponseId: 't2:response',
      onNavigate
    });
    await tick();

    const scroller = document.querySelector('.session-turn-navigation-ticks');
    expect(scroller).toBeInstanceOf(HTMLElement);
    const ticks = scroller as HTMLElement;
    Object.defineProperty(ticks, 'scrollTop', { configurable: true, writable: true, value: 0 });

    mockRect(ticks, { top: 100, bottom: 160, height: 60 });
    const hidden = screen.getByRole('button', { name: 'Agent response 12 of 12' });
    mockRect(hidden, { top: 400, bottom: 424, height: 24 });

    await rerender({
      items: many,
      activeId: 't12:response',
      previousResponseId: 't11:response',
      nextResponseId: null,
      onNavigate
    });
    await tick();

    expect(ticks.scrollTop).toBe(264);
  });
});
