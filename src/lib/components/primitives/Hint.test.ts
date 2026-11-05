import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import Hint from './Hint.svelte';
import { hideHint } from './hint-host.svelte';
import { placeHint } from './hint-position';

afterEach(() => {
  hideHint();
  cleanup();
});

const tooltips = () => document.querySelectorAll('.app-tooltip-content');

describe('Hint (shared tooltip host)', () => {
  it('renders many hints without any per-hint tooltip or portal nodes', () => {
    const before = document.body.childElementCount;
    for (let i = 0; i < 200; i++) render(Hint, { text: `hint ${i}`, 'aria-label': `h${i}` });
    expect(tooltips()).toHaveLength(0);
    // Only the testing-library containers were added: one per render, nothing from Hint itself.
    expect(document.body.childElementCount - before).toBeLessThanOrEqual(200 + 1);
  });

  it('shows one tooltip on hover and hides it on leave, tagging the trigger with aria-describedby', async () => {
    render(Hint, { text: 'First', 'aria-label': 'first' });
    render(Hint, { text: 'Second', 'aria-label': 'second' });
    const first = screen.getByLabelText('first');
    const second = screen.getByLabelText('second');
    expect(first).not.toHaveAttribute('aria-describedby');

    await fireEvent.pointerEnter(first, { pointerType: 'mouse' });
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    expect(tooltips()[0]).toHaveTextContent('First');
    expect(first).toHaveAttribute('aria-describedby', tooltips()[0].id);

    // Moving to another hint reuses the same element and switches text.
    await fireEvent.pointerLeave(first);
    await fireEvent.pointerEnter(second, { pointerType: 'mouse' });
    await waitFor(() => expect(tooltips()[0]).toHaveTextContent('Second'));
    expect(tooltips()).toHaveLength(1);
    expect(first).not.toHaveAttribute('aria-describedby');

    await fireEvent.pointerLeave(second);
    await waitFor(() => expect(tooltips()).toHaveLength(0));
  });

  it('opens immediately on keyboard focus, closes on blur and Escape', async () => {
    render(Hint, { text: 'Focusable', tabindex: 0, 'aria-label': 'focusable' });
    const el = screen.getByLabelText('focusable');
    el.focus();
    await waitFor(() => expect(tooltips()[0]).toHaveTextContent('Focusable'));
    el.blur();
    await waitFor(() => expect(tooltips()).toHaveLength(0));
    el.focus();
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(tooltips()).toHaveLength(0));
  });

  it('does not open when disabled or on touch pointers, and dismisses on press', async () => {
    render(Hint, { text: 'Off', disabled: true, 'aria-label': 'off' });
    await fireEvent.pointerEnter(screen.getByLabelText('off'), { pointerType: 'mouse' });
    render(Hint, { text: 'Touch', 'aria-label': 'touch' });
    await fireEvent.pointerEnter(screen.getByLabelText('touch'), { pointerType: 'touch' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(tooltips()).toHaveLength(0);

    render(Hint, { text: 'Press', 'aria-label': 'press' });
    const press = screen.getByLabelText('press');
    await fireEvent.pointerEnter(press, { pointerType: 'mouse' });
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    await fireEvent.pointerDown(press);
    await waitFor(() => expect(tooltips()).toHaveLength(0));
  });

  it('renders the detail line and multiline styling', async () => {
    render(Hint, { text: 'Title', detail: 'More', 'aria-label': 'detailed' });
    await fireEvent.pointerEnter(screen.getByLabelText('detailed'), { pointerType: 'mouse' });
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    expect(tooltips()[0]).toHaveClass('app-tooltip-multiline');
    expect(tooltips()[0].querySelector('.app-tooltip-detail')).toHaveTextContent('More');
  });

  it('runs caller handlers alongside the tooltip handlers', async () => {
    let entered = 0;
    render(Hint, { text: 'Chained', 'aria-label': 'chained', onpointerenter: () => (entered += 1) });
    await fireEvent.pointerEnter(screen.getByLabelText('chained'), { pointerType: 'mouse' });
    expect(entered).toBe(1);
    await waitFor(() => expect(tooltips()).toHaveLength(1));
  });
});

describe('Hint accessibility and robustness', () => {
  it('keeps a caller aria-describedby and appends the tooltip id while open', async () => {
    render(Hint, { text: 'Tip', tabindex: 0, 'aria-label': 'described', 'aria-describedby': 'external' });
    const el = screen.getByLabelText('described');
    expect(el).toHaveAttribute('aria-describedby', 'external');
    el.focus();
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    expect(el.getAttribute('aria-describedby')).toBe(`external ${tooltips()[0].id}`);
    el.blur();
    await waitFor(() => expect(el).toHaveAttribute('aria-describedby', 'external'));
  });

  it('shows the focus tooltip again after a press that was released elsewhere', async () => {
    render(Hint, { text: 'Again', tabindex: 0, 'aria-label': 'again' });
    const el = screen.getByLabelText('again');
    await fireEvent.pointerDown(el);
    // Released away from the element, so the element itself never sees pointerup.
    await fireEvent.pointerUp(document.body);
    el.focus();
    await waitFor(() => expect(tooltips()).toHaveLength(1));
  });

  it('suppresses the focus tooltip while the press is still held', async () => {
    render(Hint, { text: 'Held', tabindex: 0, 'aria-label': 'held' });
    const el = screen.getByLabelText('held');
    await fireEvent.pointerDown(el);
    el.focus();
    expect(tooltips()).toHaveLength(0);
    await fireEvent.pointerUp(document.body);
  });

  it('dismisses when the anchor leaves the DOM without polling', async () => {
    render(Hint, { text: 'Gone', tabindex: 0, 'aria-label': 'gone' });
    const el = screen.getByLabelText('gone');
    el.focus();
    await waitFor(() => expect(tooltips()).toHaveLength(1));
    el.remove();
    await fireEvent.pointerMove(window);
    await waitFor(() => expect(tooltips()).toHaveLength(0));
  });
});

describe('placeHint', () => {
  const anchor = { left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20 };
  const viewport = { width: 800, height: 600 };
  const box = { width: 80, height: 24 };

  it('centers below the anchor by default with a 6px gap', () => {
    expect(placeHint(anchor, box, 'bottom', 'center', viewport)).toEqual({ left: 80, top: 126, side: 'bottom' });
  });

  it('flips when the preferred side does not fit and clamps to the viewport', () => {
    const top = { ...anchor, top: 2, bottom: 22 };
    expect(placeHint(top, box, 'top', 'center', viewport).side).toBe('bottom');
    const edge = { left: 2, top: 100, right: 20, bottom: 120, width: 18, height: 20 };
    expect(placeHint(edge, box, 'left', 'center', viewport)).toMatchObject({ side: 'right' });
    expect(placeHint({ ...anchor, left: 790, right: 800, width: 10 }, box, 'bottom', 'center', viewport).left).toBe(716);
  });
});
