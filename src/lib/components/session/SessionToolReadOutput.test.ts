import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionToolReadOutput from './SessionToolReadOutput.svelte';
import type { ReadFileOutputView } from '$lib/domain/session-tool-read-output';

const codeToTokens = vi.hoisted(() => vi.fn());

const mockHighlighter = vi.hoisted(() => ({
  loadLanguage: vi.fn(async () => undefined),
  codeToTokens
}));

vi.mock('./shiki', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./shiki')>();
  return {
    ...actual,
    getHighlighter: vi.fn(async () => mockHighlighter),
    loadLanguage: vi.fn(async () => undefined),
    languageFromPath: vi.fn((path: string) => (path.endsWith('.ts') ? 'typescript' : null))
  };
});

function view(overrides: Partial<ReadFileOutputView> = {}): ReadFileOutputView {
  return {
    path: 'src/app.ts',
    type: 'file',
    truncated: false,
    sections: [
      {
        path: 'src/app.ts',
        truncated: false,
        lines: [
          { lineNumber: '00001', text: 'const value = 1;' },
          { lineNumber: '00002', text: '' }
        ]
      }
    ],
    ...overrides
  };
}

beforeEach(() => {
  codeToTokens.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('SessionToolReadOutput', () => {
  it('renders a gutter with line numbers and a path meta bar', async () => {
    render(SessionToolReadOutput, { view: view({ truncated: true }) });

    expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    expect(screen.getByText('truncated')).toBeInTheDocument();
    expect(screen.getByText('00001')).toBeInTheDocument();
    expect(screen.getByText('00002')).toBeInTheDocument();
  });

  it('applies shiki tokens with dual-theme css variables once highlighting resolves', async () => {
    codeToTokens.mockReturnValue({
      tokens: [
        [
          { content: 'const', htmlStyle: { '--shiki-light': '#999999', '--shiki-dark': '#c586c0' } },
          { content: ' value = 1;' }
        ],
        []
      ],
      rootStyle: { '--shiki-light': '#111111', '--shiki-dark': '#eeeeee' }
    });

    const { container } = render(SessionToolReadOutput, { view: view() });

    await waitFor(() => expect(codeToTokens).toHaveBeenCalled());
    await waitFor(() => {
      const keyword = container.querySelector('.session-tool-read-text span[style]');
      expect(keyword).not.toBeNull();
      const style = keyword!.getAttribute('style')!.replace(/\s+/g, '');
      expect(style).toContain('--shiki-light:#999999');
      expect(style).toContain('--shiki-dark:#c586c0');
    });
    const rootStyle = container.querySelector('.session-tool-read-output')!.getAttribute('style')!.replace(/\s+/g, '');
    expect(rootStyle).toContain('--shiki-dark:#eeeeee');
  });

  it('renders one labeled section per file for multi-section views', async () => {
    codeToTokens.mockReturnValue({
      tokens: [[{ content: 'const a = 1;' }]],
      rootStyle: { '--shiki-light': '#111111', '--shiki-dark': '#eeeeee' }
    });

    render(
      SessionToolReadOutput,
      {
        view: view({
          sections: [
            { path: 'src/a.ts', truncated: false, lines: [{ lineNumber: '00001', text: 'const a = 1;' }] },
            { path: 'src/b.ts', truncated: false, lines: [{ lineNumber: '00001', text: 'const b = 2;' }] }
          ]
        })
      }
    );

    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();
    expect(screen.getAllByText('00001')).toHaveLength(2);
  });

  it('falls back to escaped plain text when the language is unsupported', async () => {
    render(SessionToolReadOutput, { view: view({ path: 'README.unknown' }) });

    await waitFor(() => expect(screen.getByText('00001')).toBeInTheDocument());
    expect(screen.getByText('00001').closest('.session-tool-read-row')).toHaveTextContent('const value = 1;');
    expect(codeToTokens).not.toHaveBeenCalled();
  });

  it('keeps plain text when the highlighter fails', async () => {
    codeToTokens.mockImplementation(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { container } = render(SessionToolReadOutput, { view: view() });
      await waitFor(() => expect(codeToTokens).toHaveBeenCalled());
      expect(container.querySelector('.session-tool-read-row')).toHaveTextContent('const value = 1;');
    } finally {
      warn.mockRestore();
    }
  });
});
