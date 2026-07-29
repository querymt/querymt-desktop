import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionConversationTurn } from '$lib/domain/session-conversation';
import SessionTurn from './SessionTurn.svelte';

const turn: SessionConversationTurn = {
  id: 'turn-1',
  forkMessageId: 'assistant-1',
  user: {
    id: 'user-1',
    messageId: 'message-1',
    html: '<p>Inspect the app</p>',
    text: 'Inspect the app'
  },
  content: [
    {
      type: 'reasoning',
      id: 'reasoning-1',
      html: '<p>Inspecting components</p>',
      isLive: true
    },
    {
      type: 'tool',
      id: 'tool-1',
      tool: {
        id: 'tool-1',
        title: 'read_tool',
        status: 'in_progress',
        kind: 'read_tool',
        arguments: '{"path":"src/app.ts"}'
      }
    },
    {
      type: 'reasoning',
      id: 'reasoning-2',
      html: '<p>Preparing the fix</p>',
      isLive: true
    },
    {
      type: 'tool',
      id: 'tool-2',
      tool: {
        id: 'tool-2',
        title: 'edit',
        status: 'failed',
        kind: 'edit',
        result: 'oldString not found'
      }
    },
    {
      type: 'assistant',
      id: 'assistant-1',
      messageId: 'assistant-1',
      html: '<p>Implemented the fix.</p>',
      text: 'Implemented the fix.',
      relatedEvents: []
    }
  ]
};

afterEach(cleanup);

describe('SessionTurn', () => {
  it('calls the fork action for the completed response boundary', async () => {
    const onFork = vi.fn();
    const { getByRole } = render(SessionTurn, { turn, forkAvailable: true, onFork });

    await fireEvent.click(getByRole('button', { name: 'Fork into new session' }));

    expect(onFork).toHaveBeenCalledOnce();
  });

  it('calls targeted undo with the user message id when available', async () => {
    const onUndo = vi.fn();
    const { getByRole } = render(SessionTurn, { turn, undoAvailable: true, onUndo });

    await fireEvent.click(getByRole('button', { name: 'Undo to this prompt' }));

    expect(onUndo).toHaveBeenCalledWith('message-1');
  });

  it('hides fork and undo when they are not actionable', () => {
    const { queryByRole } = render(SessionTurn, { turn, undoAvailable: false, forkAvailable: false, reverted: true });

    expect(queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();
  });

  it('shows only functional message actions', () => {
    const { getByRole, queryByRole } = render(SessionTurn, { turn });

    expect(getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Edit prompt' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Share response' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('folds settled work behind a concise summary while keeping the final answer visible', () => {
    const { getByRole, getByText, queryByText } = render(SessionTurn, { turn: { ...turn, settled: true } });

    expect(getByRole('button', { name: /Worked through 2 tool calls and 2 reasoning steps/ })).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Inspecting components')).not.toBeInTheDocument();
    expect(getByText('Implemented the fix.')).toBeInTheDocument();
  });

  it('restores the original reasoning and tool order when settled work is expanded', async () => {
    const { container, getByRole } = render(SessionTurn, { turn: { ...turn, settled: true } });

    await fireEvent.click(getByRole('button', { name: /Worked through 2 tool calls and 2 reasoning steps/ }));
    const orderedText = Array.from(container.querySelector('.session-work-list')?.children ?? []).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );

    expect(orderedText).toHaveLength(4);
    expect(orderedText[0]).toContain('Inspecting components');
    expect(orderedText[1]).toContain('Read file');
    expect(orderedText[2]).toContain('Preparing the fix');
    expect(orderedText[3]).toContain('Edit file');
  });

  it('keeps current work visible but collapses older active entries', async () => {
    const { getByRole, getByText, queryByText } = render(SessionTurn, { turn: { ...turn, settled: false } });

    expect(getByRole('button', { name: '+2 previous work entries' })).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Inspecting components')).not.toBeInTheDocument();
    expect(getByRole('region', { name: 'Agent work' }).querySelector('.session-reasoning-preview')).toHaveTextContent('Preparing the fix');
    expect(getByText('Edit file')).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: '+2 previous work entries' }));
    expect(getByRole('button', { name: 'Show fewer work entries' })).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('region', { name: 'Agent work' })).toHaveTextContent('Inspecting components');
  });
});
