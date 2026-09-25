import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SessionToolTerminalOutput from './SessionToolTerminalOutput.svelte';

describe('SessionToolTerminalOutput', () => {
  it('renders a titlebar with the command as a prompt line', () => {
    const { container } = render(SessionToolTerminalOutput, {
      command: 'bun run check',
      stdout: '',
      stderr: '',
      exitCode: null
    });

    expect(screen.getByTestId('session-tool-terminal-output')).toHaveClass('session-tool-terminal-widget');
    expect(container.querySelector('.session-tool-terminal-titlebar')).toBeInTheDocument();
    expect(container.querySelector('.session-tool-terminal-title')).toHaveTextContent('shell');
    expect(container.querySelector('.session-tool-terminal-command')).toHaveTextContent('bun run check');
    expect(container.querySelector('.session-tool-terminal-prompt')).toHaveTextContent('$');
    expect(container.querySelector('.session-tool-terminal-exit')).toBeNull();
  });

  it('renders stdout and stderr as styled terminal lines', () => {
    const { container } = render(SessionToolTerminalOutput, {
      command: 'make',
      stdout: 'compiling\n',
      stderr: 'make: *** No targets specified.',
      exitCode: 2
    });

    const lines = container.querySelectorAll('.session-tool-terminal-line');
    // prompt + 1 stdout + 1 stderr
    expect(lines).toHaveLength(3);
    expect(lines[1]).toHaveTextContent('compiling');
    expect(lines[2]).toHaveTextContent('make: *** No targets specified.');
    const exit = container.querySelector('.session-tool-terminal-exit');
    expect(exit).toHaveTextContent('exit 2');
    expect(exit).toHaveClass('session-tool-terminal-exit-failed');
  });

  it('keeps a neutral exit badge for zero exit codes', () => {
    const { container } = render(SessionToolTerminalOutput, {
      command: 'ls',
      stdout: 'src\n',
      exitCode: 0
    });

    const exit = container.querySelector('.session-tool-terminal-exit');
    expect(exit).toHaveTextContent('exit 0');
    expect(exit).not.toHaveClass('session-tool-terminal-exit-failed');
  });

  it('applies ansi colors as inline styles and keeps unstyled text plain', () => {
    const { container } = render(SessionToolTerminalOutput, {
      stdout: '\x1b[32mok\x1b[0m plain'
    });

    const segments = container.querySelectorAll('.session-tool-terminal-segment');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveStyle({ color: 'rgb(13, 188, 121)' });
    expect(segments[1]).not.toHaveAttribute('style');
    expect(segments[1]!.textContent).toBe(' plain');
  });

  it('applies bold/dim styling classes', () => {
    const { container } = render(SessionToolTerminalOutput, { stdout: '\x1b[1mhead\x1b[22m\x1b[2mtail' });
    expect(container.querySelector('.session-tool-terminal-bold')).toHaveTextContent('head');
    expect(container.querySelector('.session-tool-terminal-dim')).toHaveTextContent('tail');
  });

  it('renders a dim placeholder when the command produced no output', () => {
    const { container } = render(SessionToolTerminalOutput, { command: 'true', stdout: '', stderr: '' });
    expect(container.querySelector('.session-tool-terminal-empty')).toHaveTextContent('(no output)');
  });

  it('renders without a prompt line or placeholder when no command is provided', () => {
    const { container } = render(SessionToolTerminalOutput, { stdout: 'legacy text' });
    expect(container.querySelector('.session-tool-terminal-command')).toBeNull();
    expect(container.querySelector('.session-tool-terminal-empty')).toBeNull();
    expect(container.querySelectorAll('.session-tool-terminal-line')).toHaveLength(1);
  });
});
