import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountingSnapshot } from '$lib/querymt/generated/types';
import SessionUsageBar from './SessionUsageBar.svelte';

const usage = { contextUsed: 48_000, contextLimit: 200_000, accounting: { version: 1, cycle: null, session: { knownSubtotalUsd: 0.125, completeTotalUsd: 0.125, complete: true, billing: 'metered', reasons: [], pricedAttempts: 1, excludedAttempts: 0, unresolvedAttempts: 0, incompleteAttempts: 0, unaccountedGenerations: 0 } } as unknown as AccountingSnapshot, standardCostUsd: null, activeWorkMs: 62_000, activeWorkStartedAt: null };
const counts = { inputTokens: 100, outputTokens: 162, reasoningTokens: 1024, cacheReadTokens: 700, cacheWriteTokens: 200 };
const detailed = { ...usage, breakdown: { latestRequest: counts, sessionTotals: { ...counts, cacheReadTokens: 1700 }, partial: false } };
afterEach(cleanup);

function inputChart() { return screen.getByRole('img', { name: /input token breakdown/ }); }
function outputChart() { return screen.getByRole('img', { name: /output token breakdown/ }); }
function readButton() { return screen.getByRole('button', { name: /^Cache read:/ }); }

describe('SessionUsageBar', () => {
  it('shows only two normalized rings and defaults to latest request', () => {
    render(SessionUsageBar, { usage: detailed });
    expect(screen.getByRole('button', { name: 'Latest request' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    const input = inputChart();
    expect(input.querySelector('[data-token="inputTokens"]')?.getAttribute('stroke-dasharray')).toBe('10 90');
    expect(input.querySelector('[data-token="cacheReadTokens"]')?.getAttribute('stroke-dasharray')).toBe('70 30');
    expect(input.querySelector('[data-token="cacheWriteTokens"]')?.getAttribute('stroke-dashoffset')).toBe('-80');
    const output = outputChart().querySelector('[data-token="outputTokens"]');
    expect(parseFloat(output!.getAttribute('stroke-dasharray')!)).toBeCloseTo(162 / 1186 * 100);
    expect(outputChart().getAttribute('aria-label')).toContain('Reasoning: 1,024 tokens');
    expect(screen.getByText('70% reused')).toBeTruthy();
    expect(screen.getByText('86% reasoning')).toBeTruthy();
  });

  it('switches scopes without duplicating charts or changing context and session cost', async () => {
    render(SessionUsageBar, { usage: detailed });
    await fireEvent.click(screen.getByRole('button', { name: 'Session totals' }));
    expect(screen.getByRole('button', { name: 'Session totals' }).getAttribute('aria-pressed')).toBe('true');
    expect(inputChart().getAttribute('aria-label')).toContain('Session totals');
    expect(screen.getByText('85% reused')).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('$0.13')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('24');
  });

  it('inspects exact counts on hover and restores the overview on leaving', async () => {
    render(SessionUsageBar, { usage: detailed });
    await fireEvent.pointerEnter(readButton());
    const center = document.querySelector('.session-usage-ring-center');
    expect(center?.textContent).toContain('700');
    expect(screen.getByText('70.0% of input')).toBeTruthy();
    expect(inputChart().querySelector('[data-token="inputTokens"]')?.classList.contains('session-usage-arc-dimmed')).toBe(true);
    await fireEvent.pointerLeave(readButton());
    expect(screen.getByText('70% reused')).toBeTruthy();
  });

  it('supports focus and tap inspection, persistent selection, and Escape clearing', async () => {
    render(SessionUsageBar, { usage: detailed });
    await fireEvent.focus(readButton());
    expect(document.querySelector('.session-usage-ring-center')?.textContent).toContain('700');
    await fireEvent.click(readButton());
    await fireEvent.blur(readButton());
    expect(readButton().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('70.0% of input')).toBeTruthy();
    await fireEvent.keyDown(readButton(), { key: 'Escape' });
    expect(readButton().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('70% reused')).toBeTruthy();
  });

  it('clears selections when switching scope and keeps reasoning separate', async () => {
    render(SessionUsageBar, { usage: detailed });
    const button = screen.getByRole('button', { name: /^Output \(excluding reasoning\)/ });
    await fireEvent.click(button);
    expect(document.querySelectorAll('.session-usage-ring-center')[1].textContent).toContain('162');
    await fireEvent.click(screen.getByRole('button', { name: 'Session totals' }));
    expect(screen.getByText('86% reasoning')).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('distinguishes missing counts from zeros and suppresses uncertain percentages', async () => {
    render(SessionUsageBar, { usage: { ...usage, breakdown: { latestRequest: { ...counts, cacheWriteTokens: null }, sessionTotals: null, partial: true } } });
    expect(inputChart().getAttribute('aria-label')).toContain('Proportions show reported tokens only.');
    expect(screen.getByText('Reported tokens only')).toBeTruthy();
    expect(screen.queryByText(/% reused/)).toBeNull();
    const button = screen.getByRole('button', { name: 'Cache write: not reported' });
    await fireEvent.click(button);
    expect(screen.getByText('Not reported')).toBeTruthy();
    expect(screen.getByText('Count unavailable')).toBeTruthy();
  });

  it('labels partial session totals and avoids advertising a complete cache ratio', async () => {
    render(SessionUsageBar, { usage: { ...detailed, breakdown: { ...detailed.breakdown, partial: true } } });
    await fireEvent.click(screen.getByRole('button', { name: 'Session totals' }));
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.queryByText(/% reused/)).toBeNull();
    expect(screen.getAllByText('Reported tokens only')).toHaveLength(2);
  });

  it('falls back to available session totals when the latest request did not report usage', () => {
    render(SessionUsageBar, { usage: { ...detailed, breakdown: { ...detailed.breakdown, latestRequest: null } } });
    expect(screen.getByRole('button', { name: 'Latest request' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Session totals' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps zero and tiny categories reachable without relying on arc hit targets', async () => {
    render(SessionUsageBar, { usage: { ...usage, breakdown: { latestRequest: { ...counts, inputTokens: 0, cacheReadTokens: 1, cacheWriteTokens: 1000000, outputTokens: 0, reasoningTokens: 0 }, sessionTotals: null, partial: false } } });
    expect(outputChart().querySelector('.session-usage-arc')).toBeNull();
    expect(screen.getByText('No tokens reported')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Uncached input: 0 tokens' }));
    expect(document.querySelector('.session-usage-ring-center')?.textContent).toContain('0');
    await fireEvent.click(readButton());
    expect(document.querySelector('.session-usage-ring-center')?.textContent).toContain('1');
  });

  it('updates ratios and exact counts with live usage', async () => {
    const { rerender } = render(SessionUsageBar, { usage: detailed });
    await fireEvent.click(readButton());
    await rerender({ usage: { ...detailed, breakdown: { ...detailed.breakdown, latestRequest: { ...counts, cacheReadTokens: 1700 } } } });
    expect(document.querySelector('.session-usage-ring-center')?.textContent).toContain('1,700');
    expect(screen.getByText('85.0% of input')).toBeTruthy();
  });

  it('preserves the compact context meter and footer for agents without metadata', () => {
    render(SessionUsageBar, { usage });
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Token usage scope' })).toBeNull();
    const meter = screen.getByRole('meter', { name: 'Current context occupancy' });
    expect(meter.getAttribute('aria-valuenow')).toBe('24');
    expect(meter.getAttribute('aria-valuetext')).toBe('48,000 of 200,000 tokens used');
    expect(meter.querySelector('span')?.style.width).toBe('24%');
    expect(screen.getByText('152k free')).toBeTruthy();
    expect(screen.getByText('$0.13')).toBeTruthy();
    expect(screen.getByText('1m 2s')).toBeTruthy();
  });

  it('omits context before the first usage update', () => {
    render(SessionUsageBar, { usage: { ...usage, contextUsed: null, contextLimit: null, accounting: undefined, activeWorkMs: 0 } });
    expect(screen.queryByText('Context')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('0s')).toBeTruthy();
  });

  it('shows the live indicator', () => {
    render(SessionUsageBar, { usage: { ...usage, activeWorkStartedAt: Date.now() - 5000 } });
    expect(screen.getByLabelText('Active now')).toBeTruthy();
  });

  it('makes usage explanations available through the focusable help control', async () => {
    render(SessionUsageBar, { usage: detailed });
    screen.getByRole('button', { name: 'About token usage' }).focus();
    await fireEvent.pointerEnter(screen.getByRole('button', { name: 'About token usage' }));
    expect(await screen.findByText(/separate from current context occupancy/, { selector: '.session-usage-help-content' })).toBeTruthy();
  });

  function withSession(session: Record<string, unknown>, cycle: unknown = null) {
    return { ...usage, accounting: { ...usage.accounting, cycle, session: { ...usage.accounting.session, ...session } } } as never;
  }

  it('labels a complete total as an estimated API cost', () => {
    render(SessionUsageBar, { usage });
    expect(screen.getByText('Estimated API cost')).toBeTruthy();
    expect(screen.getByText('$0.13')).toBeTruthy();
  });

  it('labels an incomplete total as a known subtotal with reasons', () => {
    render(SessionUsageBar, { usage: withSession({ completeTotalUsd: null, complete: false, knownSubtotalUsd: 0.05,
      reasons: [{ kind: 'valuation', reason: { kind: 'missing_rate', category: 'cache_write' } }] }) });
    expect(screen.getByText('Known API subtotal')).toBeTruthy();
    expect(screen.getByText('Incomplete')).toBeTruthy();
    expect(screen.getByText('$0.05').closest('.session-usage-stat')?.getAttribute('title')).toContain('No cache write rate is configured');
    expect(screen.queryByText('Estimated API cost')).toBeNull();
  });

  it('shows excluded subscription usage without a dollar figure', () => {
    render(SessionUsageBar, { usage: withSession({ billing: 'excluded', pricedAttempts: 0, excludedAttempts: 2, knownSubtotalUsd: 0, completeTotalUsd: 0 }) });
    expect(screen.getByText('Subscription usage excluded')).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('discloses excluded usage in mixed sessions and shows the cycle budget separately', () => {
    const budget = { knownSubtotalUsd: 0.2, completeTotalUsd: null, reasons: [{ kind: 'valuation', reason: { kind: 'missing_rate', category: 'cache_read' } }],
      incompleteAttempts: 1, bestEffort: true };
    const cycle = { cycleId: 'c1', scope: usage.accounting.session, budget };
    render(SessionUsageBar, { usage: withSession({ billing: 'mixed', excludedAttempts: 1 }, cycle) });
    expect(screen.getByText('Estimated API cost')).toBeTruthy();
    expect(screen.getByText('Subscription usage excluded')).toBeTruthy();
    expect(screen.getByText('Cycle budget')).toBeTruthy();
    expect(screen.getByText('$0.20')).toBeTruthy();
    expect(screen.getByText('Best-effort')).toBeTruthy();
  });

  it('shows standard ACP cost from agents without QueryMT accounting', () => {
    render(SessionUsageBar, { usage: { ...usage, accounting: undefined, standardCostUsd: 0.42 } });
    expect(screen.getByText('Cost')).toBeTruthy();
    expect(screen.getByText('$0.42').closest('.session-usage-stat')?.getAttribute('title')).toContain('reported by the agent');
    expect(screen.queryByText('Estimated API cost')).toBeNull();
  });

  it('prefers QueryMT accounting over standard cost', () => {
    render(SessionUsageBar, { usage: { ...usage, standardCostUsd: 9 } });
    expect(screen.getByText('Estimated API cost')).toBeTruthy();
    expect(screen.queryByText('$9.00')).toBeNull();
  });
});
