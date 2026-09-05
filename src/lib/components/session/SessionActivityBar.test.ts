import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActiveSessionViewModel } from '$lib/domain/types';
import SessionActivityBar from './SessionActivityBar.svelte';

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
    usage: { contextUsed: null, contextLimit: null, cumulativeCostUsd: null, activeWorkMs: 0, activeWorkStartedAt: null },
    undo: { stack: [], pendingOperation: null, lastRevertedFiles: [], lastMessage: null },
    ...overrides
  };
}

afterEach(cleanup);

describe('SessionActivityBar', () => {
  it('stays out of the conversation when the session is idle', () => {
    render(SessionActivityBar, { session: session() });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows focused feedback while the agent is working', () => {
    render(SessionActivityBar, { session: session({ runState: 'thinking', activityLabel: 'Reviewing files…' }) });

    expect(screen.getByRole('status')).toHaveTextContent('Reviewing files…');
    expect(screen.getByRole('status')).toHaveTextContent('Double Esc to cancel');
  });

  it('leaves stopping to the composer stop button instead of an inline cancel control', () => {
    render(SessionActivityBar, { session: session({ runState: 'streaming' }) });

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });

  it('shows the active semantic tool and preview without duplicate shimmer content', () => {
    render(SessionActivityBar, {
      session: session({
        runState: 'tool-running',
        activeToolCallId: 'shell-1',
        toolCalls: [
          {
            id: 'shell-1',
            title: 'Run shell',
            kind: 'shell',
            status: 'in_progress',
            arguments: '{"command":"bun","args":["run","check"]}'
          }
        ]
      })
    });

    expect(screen.getByRole('status')).toHaveTextContent('Run command · bun run check');
    expect(screen.getByRole('status').querySelector('.session-activity-shimmer')).not.toBeInTheDocument();
  });

  it('announces failures as alerts', () => {
    render(SessionActivityBar, { session: session({ runState: 'failed', lastError: 'shell failed.' }) });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed: shell failed.');
  });
});
