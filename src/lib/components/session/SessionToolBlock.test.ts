import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionToolBlock from './SessionToolBlock.svelte';

const goto = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
  page: { params: { agentId: 'agent-1' } }
}));

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

afterEach(() => {
  cleanup();
  writeText.mockClear();
  goto.mockClear();
});

describe('SessionToolBlock', () => {
  it('renders a semantic compact summary with explicit status', () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-1',
        title: 'Run read_tool',
        kind: 'read_tool',
        status: 'completed',
        arguments: '{"path":"src/app.ts"}'
      }
    });

    expect(screen.getByText('Read file')).toBeInTheDocument();
    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toHaveClass('sr-only');
  });

  it('expands pretty-printed details and copies parameters', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-1',
        title: 'Run shell',
        kind: 'shell',
        status: 'in_progress',
        arguments: '{"command":"bun","args":["run","check"]}'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    expect(toolGroup).not.toBeNull();
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(screen.getByText(/"command": "bun"/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy parameters' }));
    expect(writeText).toHaveBeenCalledWith('{\n  "command": "bun",\n  "args": [\n    "run",\n    "check"\n  ]\n}');
  });

  it('surfaces failed status and preserves error detail', () => {
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'failed',
        result: 'oldString not found'
      }
    });

    expect(screen.getByText('Failed')).toHaveClass('sr-only');
    expect(screen.getByRole('region', { name: 'Tool result' })).toHaveTextContent('oldString not found');
  });

  it('opens the delegated child session without expanding the tool row', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'delegate-1',
        title: 'Run delegate',
        kind: 'delegate',
        status: 'in_progress',
        arguments: '{"target_agent_id":"linus","objective":"Review the current bearer-auth diff"}',
        childSessionId: 'child-session-1'
      }
    });

    const toolGroup = screen.getByText('Delegate task').closest('details');
    expect(toolGroup).not.toBeNull();
    expect(toolGroup).not.toHaveAttribute('open');
    await fireEvent.click(screen.getByRole('button', { name: 'Open linus session' }));
    expect(goto).toHaveBeenCalledWith('/sessions/agent-1/child-session-1');
    expect(toolGroup).not.toHaveAttribute('open');
  });

  it('hides the session pill until a child session exists', () => {
    render(SessionToolBlock, {
      tool: {
        id: 'delegate-1',
        title: 'Run delegate',
        kind: 'delegate',
        status: 'in_progress',
        arguments: '{"target_agent_id":"linus","objective":"Review the current bearer-auth diff"}'
      }
    });

    expect(screen.queryByRole('button', { name: 'Open linus session' })).toBeNull();
  });
});
