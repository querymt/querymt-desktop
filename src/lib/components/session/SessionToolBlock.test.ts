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

  it('keeps running shell parameters behind the developer source toggle', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-1',
        title: 'Run shell',
        kind: 'shell',
        status: 'in_progress',
        arguments: '{"command":"bun","args":["run","check"]}'
      }
    });

    chatPreferencesStore.setDeveloperMode(true);
    const toolGroup = screen.getByText('Run command').closest('details');
    expect(toolGroup).not.toBeNull();
    expect(toolGroup).not.toHaveClass('session-tool-block-diff');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    expect(await screen.findByTestId('session-tool-terminal-output')).toHaveTextContent('$ bun run check');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Show source data' }));
    expect(screen.getByRole('region', { name: 'Tool parameters' })).toHaveTextContent('"command": "bun"');
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
    expect(toolGroup).toHaveClass('session-tool-block-attached');
    await fireEvent.click(toolGroup.querySelector('summary')!);

    const viewer = await screen.findByTestId('session-tool-read-output');
    expect(viewer.parentElement).toHaveClass('session-tool-content');
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

  it('places read badges before the chevron without a second header', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-multiple',
        title: 'Run get_function',
        kind: 'read',
        status: 'completed',
        arguments: '{"paths":["src/a.ts","src/b.ts"],"names":["value"]}',
        result: JSON.stringify({ results: [
          { path: 'src/a.ts', content: '00001| const a = 1;\n(File has more lines. Use offset)' },
          { path: 'src/b.ts', content: '00001| const b = 2;' }
        ] })
      }
    });

    const summary = screen.getByText('Read').closest('summary')!;
    expect(summary.querySelector('.session-tool-read-more')).toHaveTextContent('+1');
    expect(summary.querySelector('.session-tool-read-truncated')).toBeNull();

    chatPreferencesStore.setDeveloperMode(true);
    await tick();
    const badges = [...summary.querySelectorAll('.session-tool-read-more, .session-tool-read-truncated')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['+1', 'truncated']);
    expect(badges.every((badge) => badge.classList.contains('session-tool-pill'))).toBe(true);
    expect(badges[1]!.compareDocumentPosition(summary.querySelector('.session-tool-disclosure')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    chatPreferencesStore.setDeveloperMode(false);
    await tick();
    expect(summary.querySelector('.session-tool-read-truncated')).toBeNull();
    await fireEvent.click(summary);
    expect(await screen.findByTestId('session-tool-read-output')).toBeInTheDocument();
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

  it('routes descriptive read-kind calls through the read viewer', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-live-2',
        title: 'Read file',
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
    expect(await screen.findByRole('region', { name: 'Read output' })).toHaveClass('session-tool-output-fallback');
    expect(screen.getByRole('region', { name: 'Read output' })).toHaveTextContent('ENOENT: no such file');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
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
    expect(toolGroup).toHaveClass('session-tool-block-attached');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal.parentElement).toHaveClass('session-tool-content');
    expect(terminal.textContent).toContain('$ ls');
    expect(terminal.textContent).toContain('src\npackage.json');
    const summary = toolGroup!.querySelector('summary')!;
    const exit = summary.querySelector('.session-tool-terminal-exit')!;
    expect(exit).toHaveTextContent('exit 0');
    expect(exit).toHaveClass('session-tool-pill');
    expect(exit).not.toHaveClass('session-tool-terminal-exit-failed');
    expect(exit.compareDocumentPosition(summary.querySelector('.session-tool-disclosure')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terminal.textContent).not.toContain('exit 0');
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
    expect(toolGroup!.querySelector('.session-tool-terminal-exit')).toHaveTextContent('exit 2');
    expect(toolGroup!.querySelector('.session-tool-terminal-exit')).toHaveClass('session-tool-pill', 'session-tool-terminal-exit-failed');
    expect(terminal.textContent).not.toContain('exit 2');
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
        result: '[WARN] legacy plain output'
      }
    });

    const toolGroup = screen.getByText('Run command').closest('details');
    await fireEvent.click(toolGroup!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal.textContent).toContain('$ echo hi');
    expect(terminal.textContent).toContain('[WARN] legacy plain output');
    expect(terminal.textContent).not.toContain('exit');
    expect(toolGroup!.querySelector('.session-tool-terminal-exit')).toBeNull();
  });

  it('shows a running shell console without exposing parameters', async () => {
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
    expect(await screen.findByTestId('session-tool-terminal-output')).toHaveTextContent('$ bun run check');
    expect(toolGroup!.querySelector('.session-tool-terminal-exit')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
  });

  it('keeps running read parameters hidden while waiting for output', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-running', title: 'Run read_tool', kind: 'read', status: 'in_progress',
        arguments: '{"path":"src/app.ts"}'
      }
    });
    await fireEvent.click(screen.getByText('Read').closest('details')!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Read output' })).toHaveTextContent('Waiting for read output...');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
  });

  it('renders JSON-wrapped symbol output as a read view without input JSON', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'symbol-json',
        title: 'Run get_symbol',
        kind: 'read',
        status: 'completed',
        arguments: '{"paths":["src/app.ts"],"symbol":"value"}',
        result: JSON.stringify({ results: [{ path: 'src/app.ts', content: '00001| export const value = 1;' }] })
      }
    });
    const group = screen.getByText('Read').closest('details')!;
    await fireEvent.click(group.querySelector('summary')!);
    expect(await screen.findByTestId('session-tool-read-output')).toHaveTextContent('src/app.ts (1 lines)');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('keeps malformed JSON out of the default read and shell views', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-json-error', title: 'Run get_function', kind: 'read', status: 'failed',
        arguments: '{"paths":["src/app.ts"]}', result: '{"unexpected":true}'
      }
    });
    await fireEvent.click(screen.getByText('Read').closest('details')!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Read output' })).toHaveTextContent('Unable to display read output.');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByText('"unexpected"')).toBeNull();
  });

  it('renders malformed shell JSON as a console error rather than exposing input', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'shell-json-error', title: 'ls', kind: 'execute', status: 'failed',
        arguments: '{"command":"ls"}', result: '{"unexpected":true}'
      }
    });
    await fireEvent.click(screen.getByText('Run command').closest('details')!.querySelector('summary')!);
    const terminal = await screen.findByTestId('session-tool-terminal-output');
    expect(terminal).toHaveTextContent('$ ls');
    expect(terminal).toHaveTextContent('Unable to decode shell output.');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tool result' })).toBeNull();
  });

  it('shows JSON error messages as readable read output', async () => {
    render(SessionToolBlock, {
      tool: {
        id: 'read-error', title: 'Run get_symbol', kind: 'read', status: 'failed',
        arguments: '{"paths":["src/app.ts"]}', result: '{"error":"Symbol not found"}'
      }
    });
    await fireEvent.click(screen.getByText('Read').closest('details')!.querySelector('summary')!);
    expect(await screen.findByRole('region', { name: 'Read output' })).toHaveTextContent('Symbol not found');
    expect(screen.queryByRole('region', { name: 'Tool parameters' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Open linus session' })).toHaveClass('session-tool-pill');
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

describe('session tool output wrapping', () => {
  it('joins the read and shell viewers to the expanded tool summary like a file diff', () => {
    expect(appCss).toContain('.session-tool-block-attached[open] > .session-tool-summary {');
    expect(appCss).toContain('.session-tool-block-attached[open] > .session-tool-content {');
    expect(appCss).toContain(':is(.session-tool-read-output, .session-tool-terminal-widget, .session-tool-output-fallback) {');
  });

  it('wraps read source beside a fixed gutter without horizontal scrolling', () => {
    const code = appCss.match(/\.session-tool-content \.session-tool-read-code \{([^}]*)\}/)?.[1];
    const text = appCss.match(/\.session-tool-read-text \{([^}]*)\}/)?.[1];
    const viewport = appCss.match(/\.session-tool-read-output \{([^}]*)\}/)?.[1];
    expect(code).toContain('grid-template-columns: max-content minmax(0, 1fr)');
    expect(code).toContain('overflow-x: hidden');
    expect(text).toContain('white-space: pre-wrap');
    expect(text).toContain('overflow-wrap: anywhere');
    expect(viewport).toContain('overflow-x: hidden');
  });

  it('wraps long console lines and commands without horizontal scrolling', () => {
    const consoleRule = appCss.match(/\.session-tool-content \.session-tool-terminal \{([^}]*)\}/)?.[1];
    const line = appCss.match(/\.session-tool-terminal-line \{([^}]*)\}/)?.[1];
    expect(consoleRule).toContain('white-space: pre-wrap');
    expect(consoleRule).toContain('overflow-x: hidden');
    expect(line).toContain('min-width: 0');
    expect(line).toContain('overflow-wrap: anywhere');
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
