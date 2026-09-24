import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
import SessionToolBlock from './SessionToolBlock.svelte';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

const goto = vi.hoisted(() => vi.fn(async () => undefined));
const loadSessionToolPatchDiff = vi.hoisted(() =>
  vi.fn(async () => {
    const { default: MockPatchDiff } = await import('./SessionToolPatchDiff.stub.svelte');
    return { default: MockPatchDiff };
  })
);
const loadSessionToolReadOutput = vi.hoisted(() =>
  vi.fn(async () => {
    const { default: MockReadOutput } = await import('./SessionToolReadOutput.stub.svelte');
    return { default: MockReadOutput };
  })
);
const loadSessionToolTerminalOutput = vi.hoisted(() =>
  vi.fn(async () => {
    const { default: MockTerminalOutput } = await import('./SessionToolTerminalOutput.stub.svelte');
    return { default: MockTerminalOutput };
  })
);
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
  page: { params: { agentId: 'agent-1' } }
}));
vi.mock('./session-tool-patch-diff', () => ({ loadSessionToolPatchDiff }));
vi.mock('./SessionToolPatchDiff.svelte', async () => {
  const { default: MockPatchDiff } = await import('./SessionToolPatchDiff.stub.svelte');
  return { default: MockPatchDiff };
});
vi.mock('./session-tool-read-output', () => ({ loadSessionToolReadOutput }));
vi.mock('./SessionToolReadOutput.svelte', async () => {
  const { default: MockReadOutput } = await import('./SessionToolReadOutput.stub.svelte');
  return { default: MockReadOutput };
});
vi.mock('./session-tool-terminal-output', () => ({ loadSessionToolTerminalOutput }));
vi.mock('./SessionToolTerminalOutput.svelte', async () => {
  const { default: MockTerminalOutput } = await import('./SessionToolTerminalOutput.stub.svelte');
  return { default: MockTerminalOutput };
});

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

afterEach(() => {
  cleanup();
  writeText.mockClear();
  goto.mockClear();
  chatPreferencesStore.setDeveloperMode(false);
  loadSessionToolPatchDiff.mockReset();
  loadSessionToolPatchDiff.mockImplementation(async () => {
    const { default: MockPatchDiff } = await import('./SessionToolPatchDiff.stub.svelte');
    return { default: MockPatchDiff };
  });
  loadSessionToolReadOutput.mockReset();
  loadSessionToolReadOutput.mockImplementation(async () => {
    const { default: MockReadOutput } = await import('./SessionToolReadOutput.stub.svelte');
    return { default: MockReadOutput };
  });
  loadSessionToolTerminalOutput.mockReset();
  loadSessionToolTerminalOutput.mockImplementation(async () => {
    const { default: MockTerminalOutput } = await import('./SessionToolTerminalOutput.stub.svelte');
    return { default: MockTerminalOutput };
  });
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
    expect(screen.getByText('Read file').closest('details')).not.toHaveClass('session-tool-block-diff');
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
    expect(toolGroup).not.toHaveClass('session-tool-block-diff');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByText(/"command": "bun"/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show source data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide source data' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy parameters' }));
    expect(writeText).toHaveBeenCalledWith('{\n  "command": "bun",\n  "args": [\n    "run",\n    "check"\n  ]\n}');
  });

  it('shows compact added and removed counts for completed edits', () => {
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}'
      }
    });

    const added = screen.getByText('+1');
    const removed = screen.getByText('-2');
    expect(added).toHaveClass('session-tool-change-added');
    expect(removed).toHaveClass('session-tool-change-removed');
    expect(screen.getByRole('group', { name: 'Edit file - src/app.ts +1 -2' })).toHaveClass('session-tool-block-diff');
  });

  it('keeps generated diffs and raw parameters collapsed until the tool row expands', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
        result: 'OK src/app.ts updated'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    expect(toolGroup).not.toHaveAttribute('open');
    expect(screen.queryByRole('region', { name: 'File diff' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
    expect(screen.queryByText(/"oldString"/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show source data' })).toBeNull();

    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(toolGroup).toHaveAttribute('open');
    expect(toolGroup).toHaveClass('session-tool-block-diff');
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    expect(await screen.findByTestId('session-tool-diff')).toHaveAttribute('data-hide-file-header', 'true');
    expect(screen.queryByText('Diff')).toBeNull();
    expect(screen.queryByText('Diffs')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();

    const showSource = screen.getByRole('button', { name: 'Show source data' });
    expect(showSource).toHaveAttribute('aria-expanded', 'false');
    expect(showSource.querySelector('.lucide-chevrons-left-right-ellipsis')).not.toBeNull();
  });

  it('reveals and hides raw source data for a completed edit diff', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
        result: 'OK src/app.ts updated'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show source data' }));
    const hideSource = screen.getByRole('button', { name: 'Hide source data' });
    expect(hideSource).toHaveAttribute('aria-expanded', 'true');
    expect(hideSource.querySelector('.lucide-chevrons-right-left')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toHaveTextContent(/"oldString": "one\\ntwo\\nthree"/);
    expect(screen.getByRole('region', { name: 'Tool result' })).toHaveTextContent('OK src/app.ts updated');

    await fireEvent.click(hideSource);
    const showSource = screen.getByRole('button', { name: 'Show source data' });
    expect(showSource).toHaveAttribute('aria-expanded', 'false');
    expect(showSource.querySelector('.lucide-chevrons-left-right-ellipsis')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('resets raw source data to hidden when the tool row is closed and reopened', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
        result: 'OK src/app.ts updated'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    const summary = toolGroup!.querySelector('summary')!;
    await fireEvent.click(summary);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show source data' }));
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toBeInTheDocument();

    await fireEvent.click(summary);
    expect(toolGroup).not.toHaveAttribute('open');
    await fireEvent(toolGroup!, new Event('toggle'));
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();

    await fireEvent.click(summary);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    const showSource = screen.getByRole('button', { name: 'Show source data' });
    expect(showSource).toHaveAttribute('aria-expanded', 'false');
    expect(showSource.querySelector('.lucide-chevrons-left-right-ellipsis')).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('shows a stable error when the diff preview fails to load', async () => {
    loadSessionToolPatchDiff.mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'));

    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    await fireEvent.click(toolGroup!.querySelector('summary')!);

    const error = await screen.findByText('Unable to load diff preview.');
    expect(error).toHaveClass('session-tool-diff-error');
    expect(screen.getByRole('region', { name: 'File diff' })).toBeInTheDocument();
    expect(screen.queryByTestId('session-tool-diff')).toBeNull();
  });

  it('renders replace_symbol diffs only after expand', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'replace-1',
        title: 'Run replace_symbol',
        kind: 'replace_symbol',
        status: 'completed',
        arguments: JSON.stringify({
          replacements: [
            { path: 'src/a.ts', oldText: 'alpha', newText: 'beta' },
            { path: 'src/b.ts', old_text: 'gamma', new_text: 'delta' }
          ]
        })
      }
    });

    expect(screen.queryByRole('region', { name: 'File diff' })).toBeNull();
    const toolGroup = screen.getByText('Replace symbol').closest('details');
    expect(toolGroup).toHaveClass('session-tool-block-diff');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    const stubs = await screen.findAllByTestId('session-tool-diff');
    expect(stubs).toHaveLength(2);
    expect(stubs[0]).toHaveAttribute('data-hide-file-header', 'false');
    expect(stubs[1]).toHaveAttribute('data-hide-file-header', 'false');
    expect(screen.queryByText('Diffs')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    const showSource = screen.getByRole('button', { name: 'Show source data' });
    expect(showSource).toHaveAttribute('aria-expanded', 'false');
    expect(showSource.querySelector('.lucide-chevrons-left-right-ellipsis')).not.toBeNull();
  });

  it('hides the source data toggle for generated diffs when developer mode is off', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
        result: 'OK src/app.ts updated'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show source data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide source data' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('clears stale source data when developer mode is turned off and does not reopen it on re-enable', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'edit-1',
        title: 'Run edit',
        kind: 'edit',
        status: 'completed',
        arguments: '{"path":"src/app.ts","oldString":"one\\ntwo\\nthree","newString":"one\\nfour"}',
        result: 'OK src/app.ts updated'
      }
    });

    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toBeNull();
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'File diff' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show source data' }));
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tool result' })).toBeInTheDocument();

    chatPreferencesStore.setDeveloperMode(false);
    await tick();
    expect(screen.queryByRole('button', { name: 'Show source data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide source data' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();

    chatPreferencesStore.setDeveloperMode(true);
    await tick();
    const showSource = screen.getByRole('button', { name: 'Show source data' });
    expect(showSource).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('shows the requested line range in the read summary', () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-2',
        title: 'Run read_tool',
        kind: 'read_tool',
        status: 'in_progress',
        arguments: '{"path":"src/app.ts","offset":140,"limit":75}'
      }
    });

    expect(screen.getByRole('group', { name: 'Read file - src/app.ts (lines 141-215)' })).toBeInTheDocument();
  });

  it('renders only the highlighted read view by default, with raw data behind the developer toggle', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    render(SessionToolBlock, {
      tool: {
        id: 'read-3',
        title: 'Run read_tool',
        kind: 'read_tool',
        status: 'completed',
        arguments: '{"path":"src/app.ts","offset":10}',
        result: '<path>src/app.ts</path>\n<type>file</type>\n<content>\n00011| const value = 1;\n</content>'
      }
    });

    const toolGroup = screen.getByRole('group', { name: 'Read file - src/app.ts (lines 11+)' });
    await fireEvent.click(toolGroup.querySelector('summary')!);

    const viewer = await screen.findByTestId('session-tool-read-output');
    expect(viewer).toHaveTextContent('src/app.ts (1 lines)');
    expect(screen.queryByText('<path>src/app.ts</path>')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Show source data' }));
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toHaveTextContent('"path": "src/app.ts"');
    expect(screen.getByRole('region', { name: 'Tool result' })).toHaveTextContent('00011| const value = 1;');
    expect(screen.getByRole('region', { name: 'Tool result' })).toHaveTextContent('</content>');
    expect(screen.getByTestId('session-tool-read-output')).toBeInTheDocument();
  });

  it('renders the read viewer for live ACP calls that carry the semantic kind', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-live',
        title: 'Run read_tool',
        kind: 'read',
        status: 'completed',
        arguments: '{"path":"src/app.ts"}',
        result: '<path>src/app.ts</path>\n<type>file</type>\n<content>\n00011| const value = 1;\n</content>'
      }
    });

    const toolGroup = screen.getByRole('group', { name: 'Read - src/app.ts' });
    await fireEvent.click(toolGroup.querySelector('summary')!);
    expect(await screen.findByTestId('session-tool-read-output')).toBeInTheDocument();
  });

  it('renders the read viewer for get_function symbol reads', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'get-function-1',
        title: 'Run get_function',
        kind: 'read',
        status: 'completed',
        arguments: '{"paths":["src/app.ts"],"names":["value"]}',
        result: [
          '/tmp/project/src/app.ts',
          '- value [1-1] hash=abc bytes=16 lines=1',
          '00001| export const value = 1;'
        ].join('\n')
      }
    });

    const toolGroup = screen.getByRole('group', { name: 'Read - /tmp/project/src/app.ts' });
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const viewer = await screen.findByTestId('session-tool-read-output');
    expect(viewer).toHaveTextContent('/tmp/project/src/app.ts');
  });

  it('falls back to the plain result view when read output cannot be parsed', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-4',
        title: 'Run read_tool',
        kind: 'read_tool',
        status: 'completed',
        arguments: '{"path":"src/app.ts"}',
        result: 'ENOENT: no such file'
      }
    });

    const toolGroup = screen.getByText('Read file').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Tool result' })).toHaveTextContent('ENOENT: no such file');
    expect(screen.queryByTestId('session-tool-read-output')).toBeNull();
  });

  it('renders shell stdout as a terminal without the parameters JSON', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-2',
        title: 'Run shell',
        kind: 'shell',
        status: 'completed',
        arguments: '{"command":"ls"}',
        result: '{"stdout":"src\\npackage.json","stderr":"","exit_code":0}'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal.textContent).toContain('$ ls');
    expect(terminal.textContent).toContain('src\npackage.json');
    expect(terminal.textContent).toContain('exit 0');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('renders failed shell stderr as terminal output without the raw JSON', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-3',
        title: 'Run shell',
        kind: 'shell',
        status: 'failed',
        arguments: '{"command":"make"}',
        result: '{"stdout":"","stderr":"make: *** No targets specified and no makefile found.  Stop.","exit_code":2}'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal.textContent).toContain('$ make');
    expect(terminal.textContent).toContain('make: *** No targets specified and no makefile found.  Stop.');
    expect(terminal.textContent).toContain('exit 2');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('falls back to plain text shell output when the result is not JSON', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-4',
        title: 'Run shell',
        kind: 'shell',
        status: 'completed',
        arguments: '{"command":"echo","args":["hi"]}',
        result: 'legacy plain output'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal.textContent).toContain('$ echo hi');
    expect(terminal.textContent).toContain('legacy plain output');
    expect(terminal.textContent).not.toContain('exit');
  });

  it('keeps shell parameters visible while the command is still running', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-5',
        title: 'Run shell',
        kind: 'shell',
        status: 'in_progress',
        arguments: '{"command":"bun","args":["run","check"]}'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Tool parameters' })).toBeInTheDocument();
    expect(screen.queryByTestId('session-tool-terminal-output')).toBeNull();
  });

  it('keeps completed non-read, non-shell results plain', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'search-1',
        title: 'Run search_text',
        kind: 'search_text',
        status: 'completed',
        arguments: '{"pattern":"ToolCall"}',
        result: 'src/a.ts:1: ToolCall'
      }
    });

    const toolGroup = screen.getByText('Search text').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Tool result' })).toHaveTextContent('src/a.ts:1: ToolCall');
    expect(screen.queryByTestId('session-tool-read-output')).toBeNull();
    expect(screen.queryByTestId('session-tool-terminal-output')).toBeNull();
  });

  it('surfaces failed status and preserves error detail after expand', async () => {
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
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
    const toolGroup = screen.getByText('Edit file').closest('details');
    expect(toolGroup).not.toHaveClass('session-tool-block-diff');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Tool result' })).toHaveTextContent('oldString not found');
    expect(screen.queryByRole('region', { name: 'File diff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show source data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide source data' })).toBeNull();
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

describe('session tool diff viewport', () => {
  function cssRuleBody(selector: string) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return appCss.match(new RegExp(`(?:^|\\n)${escaped} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  }

  const sessionToolDiffRule = cssRuleBody('.session-tool-diff');
  const sessionToolDiffNoHeaderRule = cssRuleBody('.session-tool-diff-no-header');

  it('shows up to 40 unwrapped code rows before the host scrolls', () => {
    expect(sessionToolDiffRule).toContain('overflow: auto;');
    expect(sessionToolDiffRule).toContain('--diffs-line-height: 18px;');
    expect(sessionToolDiffRule).toContain('--session-tool-diff-chrome: 52px;');
    expect(sessionToolDiffRule).toContain(
      'max-height: calc(var(--diffs-line-height) * 40 + var(--session-tool-diff-chrome));'
    );
    expect(sessionToolDiffRule).not.toMatch(/^\s*height:/m);
    expect(sessionToolDiffNoHeaderRule).toContain('--session-tool-diff-chrome: 18px;');
  });
});
