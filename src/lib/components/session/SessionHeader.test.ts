import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionHeader from './SessionHeader.svelte';
import type { ActiveSessionViewModel } from '$lib/domain/types';

function session(overrides: Partial<ActiveSessionViewModel> = {}): ActiveSessionViewModel {
  return {
    sessionId: 'session-1',
    transcript: [],
    toolCalls: [],
    plans: [],
    events: [],
    configOptions: [],
    runState: 'idle',
    activityLabel: null,
    activeToolCallId: null,
    lastStopReason: null,
    lastError: null,
    usage: {
      contextUsed: 24_000,
      contextLimit: 100_000,
      cumulativeCostUsd: 0.05,
      activeWorkMs: 12_000,
      activeWorkStartedAt: null
    },
    undo: { stack: [], pendingOperation: null, lastRevertedFiles: [], lastMessage: null },
    ...overrides
  };
}

afterEach(cleanup);

describe('SessionHeader', () => {
  it('presents session identity and a compact ready state', () => {
    render(SessionHeader, {
      session: session(),
      title: 'Refine session hierarchy',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now'
    });

    expect(screen.getByRole('heading', { name: 'Refine session hierarchy' })).toBeInTheDocument();
    expect(screen.getByText('querymt-desktop')).toBeInTheDocument();
    expect(screen.getByText('QMTCODE')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Context')).toBeInTheDocument();
  });

  it('moves usage into session details and exposes header actions', async () => {
    const onBack = vi.fn();
    const onRefresh = vi.fn();
    render(SessionHeader, {
      session: session({ runState: 'thinking' }),
      title: 'Active task',
      workspace: 'querymt-desktop',
      agentName: 'QMTCODE',
      updatedAt: 'Just now',
      onBack,
      onRefresh
    });

    expect(screen.getByText('Working')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }));
    await fireEvent.click(screen.getByLabelText('Session details'));

    expect(onBack).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByText('24k / 100k')).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
  });
});
