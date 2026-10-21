import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionToolReadOutput from './SessionToolReadOutput.svelte';
import type { ReadFileOutputView } from '$lib/domain/session-tool-read-output';
import { getHighlighter } from './shiki';
import { tick } from 'svelte';

const codeToTokens = vi.hoisted(() => vi.fn());

const mockHighlighter = vi.hoisted(() => ({
  codeToHtml: vi.fn(),
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
  codeToTokens.mockReturnValue({ tokens: [[{ content: 'const value = 1;' }], []], rootStyle: {} });
});

afterEach(() => {
  cleanup();
});

describe('SessionToolReadOutput', () => {
  it('renders a line-number gutter without a redundant path subheader', () => {
    const { container } = render(SessionToolReadOutput, { view: view({ truncated: true }) });

    expect(container.querySelector('.session-tool-read-meta')).toBeNull();
    expect(screen.queryByText('src/app.ts')).toBeNull();
    expect(screen.queryByText('truncated')).toBeNull();
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

  it('keeps highlighted tokens when an equivalent read view arrives with a new object identity', async () => {
    codeToTokens.mockReturnValue({
      tokens: [[{ content: 'const value = 1;', htmlStyle: { '--shiki-dark': '#c586c0' } }], []],
      rootStyle: { '--shiki-dark': '#eeeeee' }
    });
    const { container, rerender } = render(SessionToolReadOutput, { view: view() });
    await waitFor(() => expect(container.querySelector('.session-tool-read-text span[style]')).not.toBeNull());
    const token = container.querySelector('.session-tool-read-text span[style]');
    await rerender({ view: view() });
    await waitFor(() => expect(container.querySelector('.session-tool-read-text span[style]')).not.toBeNull());
    expect(container.querySelector('.session-tool-read-text span[style]')).toBe(token);
    expect(codeToTokens).toHaveBeenCalledOnce();
  });

  it('updates gutters and metadata without rehighlighting identical source', async () => {
    const { container, rerender } = render(SessionToolReadOutput, { view: view() });
    await waitFor(() => expect(codeToTokens).toHaveBeenCalledOnce());
    const row = container.querySelector('.session-tool-read-text');
    const next = view({ truncated: true });
    next.sections[0].lines[0].lineNumber = '00100';
    await rerender({ view: next });
    expect(screen.getByText('00100')).toBeInTheDocument();
    expect(container.querySelector('.session-tool-read-text')).toBe(row);
    expect(codeToTokens).toHaveBeenCalledOnce();
  });

  it('rehighlights when the source or its language path actually changes', async () => {
    const { container, rerender } = render(SessionToolReadOutput, { view: view() });
    await waitFor(() => expect(codeToTokens).toHaveBeenCalledOnce());
    const next = view();
    next.sections[0].lines[0].text = 'const changed = 2;';
    codeToTokens.mockReturnValue({ tokens: [[{ content: 'const changed = 2;' }], []], rootStyle: {} });
    await rerender({ view: next });
    await waitFor(() => expect(codeToTokens).toHaveBeenCalledTimes(2));
    expect(container.querySelector('.session-tool-read-row')).toHaveTextContent('const changed = 2;');
    next.sections[0].path = 'README.unknown';
    await rerender({ view: structuredClone(next) });
    expect(container.querySelector('.session-tool-read-text span')).toBeNull();
    expect(container.querySelector('.session-tool-read-row')).toHaveTextContent('const changed = 2;');
  });

  it('discards stale async highlighting instead of painting the wrong source', async () => {
    let release!: (value: typeof mockHighlighter) => void;
    vi.mocked(getHighlighter).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { container, rerender } = render(SessionToolReadOutput, { view: view() });
    const next = view();
    next.sections[0].lines[0].text = 'new source';
    codeToTokens.mockReturnValue({ tokens: [[{ content: 'new source' }], []], rootStyle: {} });
    await rerender({ view: next });
    await waitFor(() => expect(codeToTokens).toHaveBeenCalledOnce());
    release(mockHighlighter);
    await tick();
    await tick();
    expect(codeToTokens).toHaveBeenCalledOnce();
    expect(container.querySelector('.session-tool-read-row')).toHaveTextContent('new source');
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

    expect(screen.queryByText('+1')).toBeNull();
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();
    expect(screen.getAllByText('00001')).toHaveLength(2);
  });

  it('falls back to escaped plain text when the language is unsupported', async () => {
    render(
      SessionToolReadOutput,
      {
        view: view({
          path: 'README.unknown',
          sections: [
            {
              path: 'README.unknown',
              truncated: false,
              lines: [
                { lineNumber: '00001', text: 'const value = 1;' },
                { lineNumber: '00002', text: '' }
              ]
            }
          ]
        })
      }
    );

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
