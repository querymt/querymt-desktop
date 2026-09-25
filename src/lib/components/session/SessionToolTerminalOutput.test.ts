import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SessionToolTerminalOutput from './SessionToolTerminalOutput.svelte';

describe('SessionToolTerminalOutput', () => {
  it('renders the command as a prompt line without a subheader', () => {
    const { container } = render(SessionToolTerminalOutput, {
      command: 'bun run check',
      stdout: '',
      stderr: ''
    });

    expect(screen.getByTestId('session-tool-terminal-output')).toHaveClass('session-tool-terminal-widget');
    expect(container.querySelector('.session-tool-terminal-titlebar')).toBeNull();
    expect(container.querySelector('.session-tool-terminal-command')).toHaveTextContent('bun run check');
    expect(container.querySelector('.session-tool-terminal-command-line')).toHaveTextContent('$ bun run check');
    expect(container.querySelector('.session-tool-terminal-prompt')).toHaveTextContent('$');
    expect(container.querySelector('.session-tool-terminal-exit')).toBeNull();
  });

  it('renders stdout and stderr as styled terminal lines', () => {
    const { container } = render(SessionToolTerminalOutput, {
      command: 'make',
      stdout: 'compiling\n',
      stderr: 'make: *** No targets specified.'
    });

    const lines = container.querySelectorAll('.session-tool-terminal-line');
    // prompt + 1 stdout + 1 stderr
    expect(lines).toHaveLength(3);
    expect(lines[1]).toHaveTextContent('compiling');
    expect(lines[2]).toHaveTextContent('make: *** No targets specified.');
    expect(container.querySelector('.session-tool-terminal-exit')).toBeNull();
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

  it('uses an inset dim divider after the command line', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const rule = css.match(/\.session-tool-terminal-command-line::after \{([^}]*)\}/)?.[1];
    expect(rule).toContain('display: block;');
    expect(rule).toContain('margin: 0.4rem 0.35rem;');
    expect(rule).toContain('border-bottom: 1px solid color-mix(in srgb, var(--terminal-muted) 35%, transparent);');
  });

  it('renders without a prompt line or placeholder when no command is provided', () => {
    const { container } = render(SessionToolTerminalOutput, { stdout: 'legacy text' });
    expect(container.querySelector('.session-tool-terminal-command')).toBeNull();
    expect(container.querySelector('.session-tool-terminal-command-line')).toBeNull();
    expect(container.querySelector('.session-tool-terminal-empty')).toBeNull();
    expect(container.querySelectorAll('.session-tool-terminal-line')).toHaveLength(1);
  });
});
