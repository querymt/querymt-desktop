import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SessionActivityBar from './SessionActivityBar.svelte';
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
      contextUsed: null,
      contextLimit: null,
      cumulativeCostUsd: null,
      activeWorkMs: 0,
      activeWorkStartedAt: null
    },
    undo: { stack: [], pendingOperation: null, lastRevertedFiles: [], lastMessage: null },
    ...overrides
  };
}

describe('SessionActivityBar', () => {
  it('stays out of the conversation when the session is idle', () => {
    render(SessionActivityBar, { session: session() });

    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Session usage')).not.toBeInTheDocument();
  });

  it('shows focused feedback while the agent is working', () => {
    render(SessionActivityBar, { session: session({ runState: 'thinking', activityLabel: 'Reviewing files…' }) });

    expect(screen.getAllByText('Reviewing files…')).not.toHaveLength(0);
    expect(screen.getByText('Double Esc to cancel')).toBeInTheDocument();
  });

  it('keeps failures visible without showing permanent usage chrome', () => {
    render(SessionActivityBar, { session: session({ runState: 'failed', lastError: 'Connection lost' }) });

    expect(screen.getByText('Failed: Connection lost')).toBeInTheDocument();
    expect(screen.queryByLabelText('Session usage')).not.toBeInTheDocument();
  });
});
