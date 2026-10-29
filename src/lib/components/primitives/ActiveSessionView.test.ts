import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSessionViewModel } from '$lib/domain/types';
import { calculateImageFit } from '$lib/components/session/SessionAttachmentPreview.svelte';
import { createEmptyActiveSession } from '$lib/domain/session-updates';
import ActiveSessionView from './ActiveSessionView.svelte';
import * as turnDiffs from '$lib/domain/session-tool-diff';

vi.mock('$app/state', () => ({
  page: { params: { agentId: 'agent-1' } }
}));

const loadSessionToolPatchDiff = vi.hoisted(() => vi.fn(async () => {
  const { default: MockPatchDiff } = await import('../session/SessionToolPatchDiff.stub.svelte');
  return { default: MockPatchDiff };
}));
vi.mock('../session/session-tool-patch-diff', () => ({
  loadSessionToolPatchDiff,
  preloadSessionToolPatchDiff: vi.fn()
}));

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
}

function setElementGeometry(element: Element, geometry: { clientWidth: number; clientHeight: number }) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: geometry.clientWidth },
    clientHeight: { configurable: true, value: geometry.clientHeight }
  });
}

function loadImage(image: HTMLImageElement, naturalWidth: number, naturalHeight: number) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: naturalWidth },
    naturalHeight: { configurable: true, value: naturalHeight }
  });
  fireEvent.load(image);
}

function sessionWithImages(): ActiveSessionViewModel {
  return {
    sessionId: 'session-images',
    transcript: [
      {
        id: 'user-1',
        kind: 'user_message_chunk',
        text: '',
        messageId: 'user-message-1',
        eventIndex: 1,
        blocks: [
          { type: 'image', data: 'ZHVwbGljYXRl', mimeType: 'image/png', name: 'duplicate.png' },
          { type: 'text', text: 'Between image groups' },
          { type: 'image', data: 'bWlkZGxl', mimeType: 'image/jpeg', name: 'middle.jpg' }
        ]
      },
      {
        id: 'assistant-1',
        kind: 'agent_message_chunk',
        text: '',
        messageId: 'assistant-message-1',
        eventIndex: 2,
        blocks: [
          { type: 'image', data: null, mimeType: 'image/gif', name: 'unavailable.gif', unavailable: true },
          { type: 'resource', uri: 'attachment:///notes.txt', mimeType: 'text/plain', name: 'notes.txt' },
          { type: 'image', data: 'YXNzaXN0YW50', mimeType: 'image/webp', name: 'assistant.webp' }
        ]
      },
      {
        id: 'user-2',
        kind: 'user_message_chunk',
        text: '',
        messageId: 'user-message-2',
        eventIndex: 3,
        blocks: [{ type: 'image', data: 'ZHVwbGljYXRl', mimeType: 'image/png', name: 'duplicate.png' }]
      }
    ],
    toolCalls: [],
    plans: [],
    events: [],
    configOptions: [],
    runState: 'completed',
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
    undo: {
      stack: [],
      pendingOperation: null,
      lastRevertedFiles: [],
      lastMessage: null
    }
  };
}

afterEach(() => {
  cleanup();
  resizeCallback = null;
  loadSessionToolPatchDiff.mockClear();
  vi.unstubAllGlobals();
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('ActiveSessionView turn diffs', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => {
        const animation = {
          cancel: vi.fn(),
          currentTime: 0,
          effect: null,
          playState: 'finished',
          set onfinish(callback: Animation['onfinish']) {
            if (callback) queueMicrotask(() => callback.call(animation as unknown as Animation, new Event('finish') as AnimationPlaybackEvent));
          }
        };
        return animation;
      })
    });
  });

  function diffSession(): ActiveSessionViewModel {
    return {
      ...createEmptyActiveSession(),
      sessionId: 'diff-session',
      runState: 'completed',
      transcript: [
        { id: 'u1', messageId: 'u1', kind: 'user_message_chunk', text: 'First changes', eventIndex: 0 },
        { id: 'a1', messageId: 'a1', kind: 'agent_message_chunk', text: 'First done', eventIndex: 4 },
        { id: 'u2', messageId: 'u2', kind: 'user_message_chunk', text: 'Second changes', eventIndex: 5 },
        { id: 'a2', messageId: 'a2', kind: 'agent_message_chunk', text: 'Second done', eventIndex: 7 }
      ],
      toolCalls: [
        {
          id: 'edit-1', title: 'Run edit', kind: 'edit', status: 'completed', eventIndex: 1,
          arguments: '{"path":"src/a.ts","oldString":"one","newString":"two"}',
          result: 'OK added=1 deleted=1'
        },
        {
          id: 'edit-2', title: 'Run edit', kind: 'edit', status: 'completed', eventIndex: 2,
          arguments: '{"path":"src/a.ts","oldString":"two","newString":"three"}',
          result: 'OK added=1 deleted=1'
        },
        {
          id: 'write-1', title: 'Run write_file', kind: 'edit', status: 'completed', eventIndex: 3,
          arguments: '{"path":"src/b.ts","content":"new file\\n"}',
          result: '{"path":"src/b.ts","bytes":9}'
        },
        {
          id: 'edit-3', title: 'Run edit', kind: 'edit', status: 'completed', eventIndex: 6,
          arguments: '{"path":"src/c.ts","oldString":"before","newString":"after"}',
          result: 'OK added=1 deleted=1'
        }
      ]
    };
  }

  it('reserves diff space in the shell grid using the sidebar motion tokens, not local chat sizing', () => {
    const grid = appCss.match(/\.app-grid \{([^}]+)\}/)?.[1] ?? '';
    expect(grid).toContain('transition: grid-template-columns var(--app-panel-duration) var(--app-panel-easing)');
    expect(appCss).toContain('grid-template-columns: var(--app-sidebar-expanded-width) minmax(0, 1fr) var(--app-diff-panel-space)');
    expect(appCss).toContain('grid-template-columns: var(--app-sidebar-collapsed-width) minmax(0, 1fr) var(--app-diff-panel-space)');
    expect(appCss).not.toContain('@property --app-diff-panel-space');
    expect(appCss).not.toContain('@property --app-sidebar-space');
    const panel = appCss.match(/\.session-turn-diff-panel \{([^}]+)\}/)?.[1] ?? '';
    expect(panel).not.toContain('transform: translateX(calc(');
    expect(appCss).toContain('.app-grid:has(.session-detail-diff-open)');
    expect(appCss).toContain('width: var(--app-diff-panel-width)');
    expect(appCss).not.toContain('.session-page-chat:has(.session-turn-diff-panel)');
    const reduced = appCss.match(/@media \(prefers-reduced-motion: reduce\) \{\n  \.app-sidebar,([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(reduced).toContain('.app-grid');
    expect(reduced).toContain('transition: none');
  });

  it('shares the chat maximum width and renders code edge-to-edge inside styled change sections', () => {
    expect(appCss).toContain('--app-diff-panel-width: min(44vw, var(--session-chat-max))');
    const panel = appCss.match(/\.session-turn-diff-panel \{([^}]+)\}/)?.[1] ?? '';
    expect(panel).toContain('max-width: var(--session-chat-max)');
    const body = appCss.match(/\.session-turn-diff-panel-body \{([^}]+)\}/)?.[1] ?? '';
    expect(body).toContain('padding: 0;');
    const file = appCss.match(/\.session-turn-diff-file \{([^}]+)\}/)?.[1] ?? '';
    expect(file).toContain('margin: 0;');
    expect(file).not.toContain('border-radius');
    const diff = appCss.match(/\.session-turn-diff-panel \.session-tool-diff \{([^}]+)\}/)?.[1] ?? '';
    expect(diff).toContain('--diffs-gap-block: 0px;');
    expect(diff).toContain('--diffs-gap-inline: 0px;');
    expect(diff).toContain('width: 100%;');
    const changeHeader = appCss.match(/\.session-turn-diff-change-header \{([^}]+)\}/)?.[1] ?? '';
    expect(changeHeader).toContain('background: var(--subtle-surface)');
    expect(changeHeader).toContain('border-block: 1px solid var(--subtle-border)');
  });

  it('floats compact bottom controls outside the scroll area without a top header', async () => {
    render(ActiveSessionView, { session: diffSession() });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' }));
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    const close = within(panel).getByRole('button', { name: 'Close turn diff' });
    const count = within(panel).getByText('2 files');
    const controls = panel.querySelector('.session-turn-diff-panel-controls')!;
    expect(panel.querySelector('header')).toBeNull();
    expect(within(panel).queryByRole('heading', { name: 'Turn changes' })).toBeNull();
    expect(panel.firstElementChild).toHaveClass('session-turn-diff-panel-body');
    expect(panel.lastElementChild).toBe(controls);
    expect(controls).toContainElement(close);
    expect(controls).toContainElement(count);
    expect(close).toHaveClass('session-turn-diff-close');
    expect(count).toHaveClass('session-turn-diff-file-count');
    expect(count.children).toHaveLength(0);
    expect(count).not.toHaveAttribute('title');
    expect(panel.querySelector('.session-turn-diff-panel-body')).not.toContainElement(close);

    const controlsRule = appCss.match(/\.session-turn-diff-panel-controls \{([^}]+)\}/)?.[1] ?? '';
    expect(controlsRule).toContain('position: absolute');
    expect(controlsRule).toContain('bottom: max(0.75rem, env(safe-area-inset-bottom))');
    expect(controlsRule).toContain('pointer-events: none');
    expect(appCss).toMatch(/\.session-turn-diff-close,\s*\.session-turn-diff-file-count\s*\{[^}]*border-radius: 999px/);
    expect(appCss).toMatch(/\.session-turn-diff-panel-body::after\s*\{[^}]*height:/);
    expect(appCss).not.toContain('.session-turn-diff-panel-header');
  });

  it('sticks the full file header to the panel scrollport within each file', () => {
    const header = appCss.match(/\.session-turn-diff-file-header \{([^}]+)\}/)?.[1] ?? '';
    expect(header).toContain('position: sticky;');
    expect(header).toContain('top: 0;');
    expect(header).toContain('z-index: 1;');
    expect(header).toContain('background: var(--bg-surface);');
    const file = appCss.match(/\.session-turn-diff-file \{([^}]+)\}/)?.[1] ?? '';
    // A nested overflow container would prevent the header from following the panel scrollport.
    expect(file).not.toMatch(/overflow:\s*(hidden|auto|scroll)/);
  });

  it('keeps floating controls dark with bright labels and shadow-only separation', () => {
    const controls = appCss.match(/\.session-turn-diff-close,\s*\.session-turn-diff-file-count\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(controls).toContain('background: #30343a;');
    expect(controls).toContain('color: #f5f5f5;');
    expect(controls).toContain('border: 0;');
    expect(controls).toContain('box-shadow: 0 3px 8px rgb(0 0 0 / 55%), 0 8px 24px rgb(0 0 0 / 35%);');
    expect(controls).not.toContain('outline:');
    expect(controls).not.toContain('background: var(--text)');
    const hover = appCss.match(/\.session-turn-diff-close:hover \{([^}]+)\}/)?.[1] ?? '';
    expect(hover).toContain('background: #41464e;');
    expect(hover).not.toContain('color:');
  });

  it('observes the shell column so fixed composer, activity, and scroll docks follow centered-page movement', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/routes/sessions/[agentId]/[sessionId]/+page.svelte'), 'utf8');
    expect(page).toContain("const column = sessionPage.closest('.app-main-column')");
    expect(page).toContain('pageResizeObserver.observe(column)');
    expect(page).toContain('pageResizeObserver.observe(sessionPage)');
    expect(page).toContain('dockAlignLeft={dockAlignLeft}');
    expect(page).toContain('alignLeft={dockAlignLeft}');
  });

  it('opens from the pill without a native tooltip and closes from the same pill, close button, or Escape', async () => {
    render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    expect(pill).not.toHaveAttribute('title');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(loadSessionToolPatchDiff).not.toHaveBeenCalled();

    await fireEvent.click(pill);
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    expect(pill).toHaveAttribute('aria-expanded', 'true');
    expect(pill).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByRole('button', { name: 'Close turn diff' })).toHaveFocus();
    expect(await within(panel).findAllByTestId('session-tool-diff')).toHaveLength(3);

    await fireEvent.click(pill);
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(pill).toHaveFocus();

    await fireEvent.click(pill);
    await fireEvent.click(screen.getByRole('button', { name: 'Close turn diff' }));
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(pill).toHaveFocus();

    await fireEvent.click(pill);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(pill).toHaveFocus();
  });

  it('groups repeated changes under custom collapsible headers and hides Pierre headers', async () => {
    render(ActiveSessionView, { session: diffSession() });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' }));
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    const fileHeader = await within(panel).findByRole('button', { name: 'Collapse src/a.ts' });
    expect(within(panel).getByText('2 files')).toBeInTheDocument();
    expect(fileHeader).toHaveAttribute('aria-expanded', 'true');
    expect(await within(panel).findAllByTestId('session-tool-diff')).toHaveLength(3);
    for (const diff of within(panel).getAllByTestId('session-tool-diff')) {
      expect(diff).toHaveAttribute('data-hide-file-header', 'true');
      expect(diff).toHaveAttribute('data-virtualized', 'true');
    }
    const firstChange = within(panel).getByRole('region', { name: 'Change 1 of 2 in src/a.ts' });
    const secondChange = within(panel).getByRole('region', { name: 'Change 2 of 2 in src/a.ts' });
    for (const [index, change] of [firstChange, secondChange].entries()) {
      expect(change).toHaveClass('session-turn-diff-change');
      expect(within(change).getByRole('heading', { name: `Change ${index + 1} of 2` })).toHaveClass('session-turn-diff-change-header');
      expect(within(change).getByTestId('session-tool-diff')).toBeInTheDocument();
    }
    expect(within(panel).queryByRole('heading', { name: 'Change 1 of 1' })).toBeNull();

    await fireEvent.click(fileHeader);
    expect(fileHeader).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).getByRole('button', { name: 'Expand src/a.ts' })).toBe(fileHeader);
    expect(within(panel).getAllByTestId('session-tool-diff')).toHaveLength(1);
    await fireEvent.click(fileHeader);
    expect(within(panel).getAllByTestId('session-tool-diff')).toHaveLength(3);
  });

  it('switches the single panel between turns and clears it on a session change', async () => {
    const { rerender } = render(ActiveSessionView, { session: diffSession() });
    const first = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    const second = screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' });
    await fireEvent.click(first);
    await screen.findByRole('button', { name: 'Collapse src/a.ts' });
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    await fireEvent.click(second);
    expect(screen.getAllByRole('complementary', { name: 'Turn diff' })).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: 'Turn diff' })).toBe(panel);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByRole('button', { name: 'Collapse src/c.ts' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse src/a.ts' })).toBeNull();
    expect(within(panel).getByText('1 file')).toHaveClass('session-turn-diff-file-count');

    await rerender({ session: { ...diffSession(), sessionId: 'other-session' } });
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps an open panel updated as more changes arrive in its turn', async () => {
    const session = diffSession();
    const { rerender } = render(ActiveSessionView, { session });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' }));
    await screen.findByRole('button', { name: 'Collapse src/c.ts' });
    await rerender({ session: {
      ...session,
      toolCalls: [...session.toolCalls, {
        id: 'new-edit', title: 'Run edit', kind: 'edit', status: 'completed', eventIndex: 8,
        arguments: '{"path":"src/d.ts","oldString":"x","newString":"y"}',
        result: 'OK added=1 deleted=1'
      }]
    } });
    expect(await screen.findByRole('button', { name: 'Collapse src/d.ts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn changes: 2 lines added, 2 lines deleted, 2 files changed' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(screen.getByRole('complementary', { name: 'Turn diff' })).getByText('2 files')).toHaveClass('session-turn-diff-file-count');
  });

  it('shows an explicit empty state when only change receipts are available', async () => {
    const session = diffSession();
    session.toolCalls = session.toolCalls.map((tool) => ({ ...tool, arguments: undefined }));
    render(ActiveSessionView, { session });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted' }));
    expect(await screen.findByText(/Diff preview unavailable\./)).toBeInTheDocument();
  });

  it.each(['pointer', 'keyboard'])('pre-renders the hovered turn on %s intent and reveals the same DOM without a preparing frame', async (intent) => {
    const { container } = render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    if (intent === 'pointer') await fireEvent.pointerEnter(pill);
    else pill.focus();
    const diffs = await screen.findAllByTestId('session-tool-diff');
    expect(diffs).toHaveLength(3);
    const preparedPanel = container.querySelector('.session-turn-diff-panel')!;
    expect(preparedPanel).toHaveClass('session-turn-diff-panel-preloading');
    expect(preparedPanel).toHaveAttribute('aria-hidden', 'true');
    expect(preparedPanel).toHaveProperty('inert', true);
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(container.querySelector('.session-detail-shell')).not.toHaveClass('session-detail-diff-open');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Close turn diff' })).toBeNull();
    if (intent === 'keyboard') expect(pill).toHaveFocus();
    else expect(pill).not.toHaveFocus();

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    await fireEvent(window, escape);
    expect(escape.defaultPrevented).toBe(false);
    await fireEvent.click(pill);
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    expect(panel).toBe(preparedPanel);
    expect(within(panel).getAllByTestId('session-tool-diff')).toEqual(diffs);
    expect(panel).not.toHaveTextContent('Preparing diff preview...');
    expect(within(panel).queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close turn diff' })).toHaveFocus();
  });

  it('keeps only the latest hovered turn warm and never replaces a panel that is open', async () => {
    const { container } = render(ActiveSessionView, { session: diffSession() });
    const first = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    const second = screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' });
    await fireEvent.pointerEnter(first);
    await screen.findAllByTestId('session-tool-diff');
    await fireEvent.pointerEnter(second);
    await tick();
    expect(container.querySelectorAll('.session-turn-diff-panel')).toHaveLength(1);
    const prepared = container.querySelector('.session-turn-diff-panel')!;
    expect(prepared).toHaveTextContent('src/c.ts');
    expect(prepared).not.toHaveTextContent('src/a.ts');
    await fireEvent.click(second);
    await fireEvent.pointerEnter(first);
    expect(screen.getByRole('complementary', { name: 'Turn diff' })).toHaveTextContent('src/c.ts');
    expect(container.querySelectorAll('.session-turn-diff-panel')).toHaveLength(1);
  });

  it('invalidates warmed content when the session or tool arguments change', async () => {
    const session = diffSession();
    const { container, rerender } = render(ActiveSessionView, { session });
    await fireEvent.pointerEnter(screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' }));
    await screen.findAllByTestId('session-tool-diff');
    await rerender({ session: {
      ...session,
      toolCalls: session.toolCalls.map((tool) => tool.id === 'edit-3'
        ? { ...tool, arguments: '{"path":"src/c.ts","oldString":"before","newString":"updated"}' } : tool)
    } });
    expect(screen.getByTestId('session-tool-diff')).toHaveTextContent('+updated');
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    await rerender({ session: { ...session, sessionId: 'other-session' } });
    expect(container.querySelector('.session-turn-diff-panel')).toBeNull();
  });

  it('reuses the warm preview on reopening, including scroll and collapsed-file state', async () => {
    const { container } = render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    await fireEvent.pointerEnter(pill);
    await screen.findAllByTestId('session-tool-diff');
    await fireEvent.click(pill);
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    await fireEvent.click(within(panel).getByRole('button', { name: 'Collapse src/a.ts' }));
    const body = panel.querySelector('.session-turn-diff-panel-body')!;
    body.scrollTop = 150;
    await fireEvent.click(pill);
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(container.querySelector('.session-turn-diff-panel')).toBe(panel);
    await fireEvent.click(pill);
    expect(screen.getByRole('complementary', { name: 'Turn diff' })).toBe(panel);
    expect(within(panel).getByRole('button', { name: 'Expand src/a.ts' })).toHaveAttribute('aria-expanded', 'false');
    expect(body.scrollTop).toBe(150);
  });

  it('keeps speculative failures hidden and retries when opening', async () => {
    loadSessionToolPatchDiff.mockRejectedValueOnce(new Error('speculative failure'));
    const { container } = render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    await fireEvent.pointerEnter(pill);
    await tick();
    expect(container.querySelector('.session-turn-diff-panel')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(pill);
    expect(await screen.findAllByTestId('session-tool-diff')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not build patches or load the renderer on a cold click until the slide finishes and the layout can paint', async () => {
    const buildDiffs = vi.spyOn(turnDiffs, 'buildSessionTurnDiffs');
    let finishOpening!: () => void;
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({
        cancel: vi.fn(), currentTime: 0, effect: null, playState: 'running',
        set onfinish(callback: () => void) { finishOpening = callback; }
      }))
    });
    try {
      render(ActiveSessionView, { session: diffSession() });
      await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' }));
      const panel = screen.getByRole('complementary', { name: 'Turn diff' });
      expect(panel).toHaveTextContent('Preparing diff preview...');
      expect(buildDiffs).not.toHaveBeenCalled();
      expect(loadSessionToolPatchDiff).not.toHaveBeenCalled();
      finishOpening();
      expect(buildDiffs).not.toHaveBeenCalled();
      expect(await within(panel).findAllByTestId('session-tool-diff')).toHaveLength(3);
      expect(buildDiffs).toHaveBeenCalledTimes(1);
      expect(loadSessionToolPatchDiff).toHaveBeenCalledTimes(1);
    } finally {
      buildDiffs.mockRestore();
    }
  });

  it('keeps an early-closed preview hidden while warming it for a later opening', async () => {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: vi.fn(() => ({ cancel: vi.fn(), currentTime: 0, effect: null, playState: 'running' }))
    });
    render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    await fireEvent.click(pill);
    await fireEvent.click(screen.getByRole('button', { name: 'Close turn diff' }));
    expect(pill).toHaveFocus();
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(await screen.findAllByTestId('session-tool-diff')).toHaveLength(3);
  });

  it('shows file headers and skeletons while the renderer loads, without hiding the close controls', async () => {
    let finishLoad!: (module: Awaited<ReturnType<typeof loadSessionToolPatchDiff>>) => void;
    loadSessionToolPatchDiff.mockReturnValueOnce(new Promise((resolve) => { finishLoad = resolve; }));
    render(ActiveSessionView, { session: diffSession() });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' }));
    const panel = screen.getByRole('complementary', { name: 'Turn diff' });
    expect(await within(panel).findByRole('button', { name: 'Collapse src/a.ts' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Collapse src/b.ts' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('status', { name: /Loading diff for/ })).toHaveLength(2);
    expect(panel.querySelectorAll('.session-turn-diff-loading-line')).toHaveLength(8);
    expect(panel.querySelector('.session-turn-diff-panel-body')).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).getByRole('button', { name: 'Close turn diff' })).toBeEnabled();
    expect(within(panel).queryByTestId('session-tool-diff')).toBeNull();

    const { default: MockPatchDiff } = await import('../session/SessionToolPatchDiff.stub.svelte');
    finishLoad({ default: MockPatchDiff });
    expect(await within(panel).findAllByTestId('session-tool-diff')).toHaveLength(3);
    expect(within(panel).queryByRole('status')).toBeNull();
    expect(panel.querySelector('.session-turn-diff-panel-body')).toHaveAttribute('aria-busy', 'false');
  });

  it('can close while loading and ignores a late renderer failure', async () => {
    let failLoad!: (error: Error) => void;
    loadSessionToolPatchDiff.mockReturnValueOnce(new Promise((_resolve, reject) => { failLoad = reject; }));
    render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 3 lines added, 2 lines deleted, 2 files changed' });
    await fireEvent.click(pill);
    await screen.findByRole('button', { name: 'Collapse src/a.ts' });
    await fireEvent.click(screen.getByRole('button', { name: 'Close turn diff' }));
    failLoad(new Error('late failure'));
    await tick();
    expect(screen.queryByRole('complementary', { name: 'Turn diff' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pill).toHaveFocus();
  });

  it('reports a failed lazy load and retries when the panel reopens', async () => {
    loadSessionToolPatchDiff.mockRejectedValueOnce(new Error('module unavailable'));
    render(ActiveSessionView, { session: diffSession() });
    const pill = screen.getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted, 1 file changed' });
    await fireEvent.click(pill);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load diff preview.');
    await fireEvent.click(pill);
    await fireEvent.click(pill);
    expect(await screen.findByRole('button', { name: 'Collapse src/c.ts' })).toBeInTheDocument();
  });
});

describe('calculateImageFit', () => {
  it('fits landscape and portrait images to the stage without upscaling small images', () => {
    expect(calculateImageFit(1600, 800, 800, 600)).toEqual({ fitScale: 0.5, width: 800, height: 400 });
    expect(calculateImageFit(800, 1600, 800, 600)).toEqual({ fitScale: 0.375, width: 300, height: 600 });
    expect(calculateImageFit(320, 200, 800, 600)).toEqual({ fitScale: 1, width: 320, height: 200 });
    expect(calculateImageFit(0, 200, 800, 600)).toBeNull();
  });
});

describe('ActiveSessionView image gallery', () => {
  it('keeps lightbox content below the custom titlebar and reserves zoom affordance for thumbnail triggers', () => {
    const titlebarRule = appCss.match(/\.custom-titlebar \{([\s\S]*?)\}/)?.[1] ?? '';
    const customTitlebarRule = appCss.match(/\.app-shell-custom-titlebar \.session-image-lightbox \{([\s\S]*?)\}/)?.[1] ?? '';
    const fittedImageRule = appCss.match(/\.session-image-lightbox-image-fit \{([\s\S]*?)\}/)?.[1] ?? '';
    const thumbnailRule = appCss.match(/\.session-image-trigger \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(titlebarRule).toContain('height: 2.5rem;');
    expect(customTitlebarRule).toContain('top: calc(2.5rem + 1rem);');
    expect(fittedImageRule).not.toContain('cursor: zoom-in;');
    expect(thumbnailRule).toContain('cursor: zoom-in;');
  });

  it('navigates one ordered gallery across segments, roles, and turns while preserving the opener', async () => {
    render(ActiveSessionView, { session: sessionWithImages() });

    expect(screen.queryByRole('button', { name: 'Open unavailable.gif' })).not.toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    const middleTrigger = screen.getByRole('button', { name: 'Open middle.jpg' });
    await fireEvent.click(middleTrigger);
    const dialog = screen.getByRole('dialog', { name: 'middle.jpg' });
    const zoomLevel = within(dialog).getByLabelText('Zoom level');

    const ctrlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    dialog.dispatchEvent(ctrlWheel);
    await vi.waitFor(() => expect(zoomLevel).toHaveTextContent('110%'));

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'assistant.webp' })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'assistant.webp' })).toHaveAttribute(
      'src',
      'data:image/webp;base64,YXNzaXN0YW50'
    );
    expect(zoomLevel).toHaveTextContent('100%');

    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'middle.jpg' })).toBeInTheDocument();
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'duplicate.png' })).toBeInTheDocument();
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'duplicate.png' })).toBeInTheDocument();
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'duplicate.png' })).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close image preview' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(middleTrigger).toHaveFocus();

    const duplicateTriggers = screen.getAllByRole('button', { name: 'Open duplicate.png' });
    await fireEvent.click(duplicateTriggers[1]);
    const duplicateDialog = screen.getByRole('dialog', { name: 'duplicate.png' });
    await fireEvent.keyDown(duplicateDialog, { key: 'ArrowLeft' });

    expect(screen.getByRole('dialog', { name: 'assistant.webp' })).toBeInTheDocument();
  });

  it('uses natural dimensions and stage resize measurements for explicit scroll geometry', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    render(ActiveSessionView, { session: sessionWithImages() });
    await fireEvent.click(screen.getByRole('button', { name: 'Open middle.jpg' }));

    const dialog = screen.getByRole('dialog', { name: 'middle.jpg' });
    const stage = within(dialog).getByTestId('image-lightbox-stage');
    const canvas = within(dialog).getByTestId('image-lightbox-canvas');
    const image = within(dialog).getByRole('img', { name: 'middle.jpg' }) as HTMLImageElement;
    setElementGeometry(stage, { clientWidth: 800, clientHeight: 600 });
    Object.defineProperties(stage, {
      scrollWidth: { configurable: true, get: () => Number.parseFloat(canvas.style.width) || stage.clientWidth },
      scrollHeight: { configurable: true, get: () => Number.parseFloat(canvas.style.height) || stage.clientHeight }
    });
    loadImage(image, 1600, 800);

    await vi.waitFor(() => expect(canvas).toHaveStyle({ width: '800px', height: '400px' }));
    expect(image).toHaveStyle({ width: '800px', height: '400px' });
    expect(stage.scrollWidth).toBeLessThanOrEqual(stage.clientWidth);
    expect(stage.scrollHeight).toBeLessThanOrEqual(stage.clientHeight);
    expect(stage).not.toHaveClass('session-image-lightbox-scroll-zoomed');

    setElementGeometry(stage, { clientWidth: 600, clientHeight: 300 });
    resizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    await vi.waitFor(() => expect(canvas).toHaveStyle({ width: '600px', height: '300px' }));

    const ctrlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    dialog.dispatchEvent(ctrlWheel);
    await vi.waitFor(() => expect(canvas).toHaveStyle({ width: '660px', height: '330px' }));
    expect(stage.scrollWidth).toBeGreaterThan(stage.clientWidth);
    expect(stage.scrollHeight).toBeGreaterThan(stage.clientHeight);
    expect(stage).toHaveClass('session-image-lightbox-scroll-zoomed');
  });

  it('recreates duplicate-source images by gallery key and resets each fitted baseline', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    render(ActiveSessionView, { session: sessionWithImages() });
    const duplicateTriggers = screen.getAllByRole('button', { name: 'Open duplicate.png' });
    await fireEvent.click(duplicateTriggers[0]);

    const dialog = screen.getByRole('dialog', { name: 'duplicate.png' });
    const stage = within(dialog).getByTestId('image-lightbox-stage');
    const canvas = within(dialog).getByTestId('image-lightbox-canvas');
    setElementGeometry(stage, { clientWidth: 500, clientHeight: 400 });
    const firstImage = within(dialog).getByRole('img', { name: 'duplicate.png' }) as HTMLImageElement;
    loadImage(firstImage, 1000, 500);
    await vi.waitFor(() => expect(canvas).toHaveStyle({ width: '500px', height: '250px' }));

    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    const secondImage = within(dialog).getByRole('img', { name: 'duplicate.png' }) as HTMLImageElement;
    expect(secondImage).not.toBe(firstImage);
    expect(secondImage).toHaveAttribute('src', firstImage.getAttribute('src'));
    expect(within(dialog).getByLabelText('Zoom level')).toHaveTextContent('100%');
    loadImage(secondImage, 500, 1000);
    await vi.waitFor(() => expect(canvas).toHaveStyle({ width: '200px', height: '400px' }));
  });

  it('shares modal decode failures across preview instances and skips the failed key', async () => {
    render(ActiveSessionView, { session: sessionWithImages() });
    await fireEvent.click(screen.getByRole('button', { name: 'Open middle.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'middle.jpg' });

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'assistant.webp' })).toBeInTheDocument();
    await fireEvent.error(within(dialog).getByRole('img', { name: 'assistant.webp' }));

    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Open assistant.webp' })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'duplicate.png' })).toBeInTheDocument();
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'middle.jpg' })).toBeInTheDocument();
  });

  it('dismisses and removes the wheel listener when the selected key disappears', async () => {
    const session = sessionWithImages();
    const { rerender } = render(ActiveSessionView, { session });
    await fireEvent.click(screen.getByRole('button', { name: 'Open middle.jpg' }));
    const dialog = screen.getByRole('dialog', { name: 'middle.jpg' });

    const nextSession = sessionWithImages();
    nextSession.transcript = [];
    await rerender({ session: nextSession });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    dialog.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });
});

function longStreamingSession(turnCount: number): ActiveSessionViewModel {
  const session = createEmptyActiveSession();
  session.sessionId = 'session-long';
  session.runState = 'streaming';
  session.transcript = Array.from({ length: turnCount }, (_, index) => [
    {
      id: `user-${index}`,
      kind: 'user_message_chunk' as const,
      text: `Prompt ${index}`,
      messageId: `user-message-${index}`,
      eventIndex: index * 2
    },
    {
      id: `assistant-${index}`,
      kind: 'agent_message_chunk' as const,
      text: index === turnCount - 1 ? `Live answer ${index}` : `Answer ${index}`,
      messageId: `assistant-message-${index}`,
      eventIndex: index * 2 + 1
    }
  ]).flat();
  return session;
}

describe('ActiveSessionView turn window', () => {
  it('keeps the live turn mounted while replacing offscreen settled turns with spacers', async () => {
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(document.documentElement, 'scrollTop', { configurable: true, value: 0 });
    render(ActiveSessionView, { session: longStreamingSession(12) });

    expect(document.querySelector('[data-turn-id="turn-user-11"]')).toBeInTheDocument();
    expect(screen.getByText('Live answer 11')).toBeInTheDocument();
    expect(screen.queryByText('Prompt 10')).not.toBeInTheDocument();
    expect(document.querySelector('.session-turn-spacer')).toBeInTheDocument();
  });

  it('shows a running delegate after dispatch completes and the child session arrives', async () => {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-delegate';
    session.runState = 'tool-running';
    session.activeToolCallId = 'delegate-1';
    session.transcript = [{
      id: 'user-1',
      kind: 'user_message_chunk',
      text: 'Delegate this review',
      messageId: 'user-message-1',
      eventIndex: 1
    }];
    session.toolCalls = [{
      id: 'delegate-1',
      title: 'Run delegate',
      status: 'completed',
      kind: 'delegate',
      arguments: '{"target_agent_id":"linus","objective":"Review the diff"}',
      eventIndex: 2
    }];
    const { rerender } = render(ActiveSessionView, { session });
    expect(screen.queryByRole('button', { name: 'Open linus session' })).toBeNull();
    expect(screen.getByTitle('Status unavailable').querySelector('.lucide-check')).toBeNull();

    await rerender({
      session: {
        ...session,
        toolCalls: [{ ...session.toolCalls[0], childSessionId: 'child-session-1', delegationState: 'forked' }]
      }
    });

    expect(screen.getByRole('button', { name: 'Open linus session' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toHaveClass('sr-only');
    expect(screen.getByTitle('Running').querySelector('.lucide-loader-circle')).toHaveClass('animate-spin');
  });

  it('mounts transcript after an empty first load without waiting for resize', async () => {
    const empty = createEmptyActiveSession();
    empty.sessionId = 'session-long';
    const { rerender } = render(ActiveSessionView, { session: empty });
    expect(screen.getByText('No conversation yet')).toBeInTheDocument();

    await rerender({ session: longStreamingSession(3) });
    await tick();

    expect(screen.queryByText('No conversation yet')).not.toBeInTheDocument();
    expect(screen.getByText('Live answer 2')).toBeInTheDocument();
    expect(screen.getByText('Prompt 0')).toBeInTheDocument();
  });
});

describe('ActiveSessionView turn action settle hold', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function settledConversationSession(overrides: Partial<ActiveSessionViewModel> = {}): ActiveSessionViewModel {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-settle';
    session.runState = 'completed';
    session.transcript = [
      {
        id: 'user-1',
        kind: 'user_message_chunk',
        text: 'Fix the bug',
        messageId: 'user-message-1',
        eventIndex: 1
      },
      {
        id: 'assistant-1',
        kind: 'agent_message_chunk',
        text: 'Fixed.',
        messageId: 'assistant-message-1',
        eventIndex: 2
      }
    ];
    return { ...session, ...overrides };
  }

  async function renderSettledSession(session: ActiveSessionViewModel) {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(document.documentElement, 'scrollTop', { configurable: true, value: 0 });
    const result = render(ActiveSessionView, {
      session,
      undoSupported: true,
      forkSupported: true,
      onUndo: vi.fn(),
      onFork: vi.fn()
    });
    await tick();
    return result;
  }

  it('keeps fork and undo hidden until the session settles', async () => {
    await renderSettledSession(settledConversationSession());

    expect(screen.queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1200);
    await tick();

    expect(screen.getByRole('button', { name: 'Fork into new session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo to this prompt' })).toBeInTheDocument();
  });

  it('holds the actions again when the session resumes streaming mid-settle', async () => {
    const { rerender } = await renderSettledSession(settledConversationSession());
    await vi.advanceTimersByTimeAsync(600);

    await rerender({ session: settledConversationSession({ runState: 'streaming' }) });
    await vi.advanceTimersByTimeAsync(5000);
    await tick();
    expect(screen.queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();

    await rerender({ session: settledConversationSession() });
    await vi.advanceTimersByTimeAsync(600);
    await tick();
    expect(screen.queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(600);
    await tick();
    expect(screen.getByRole('button', { name: 'Fork into new session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo to this prompt' })).toBeInTheDocument();
  });

  it('attaches redo only to the current undo frontier turn', async () => {
    const onRedo = vi.fn();
    const session = settledConversationSession({
      undo: { stack: ['user-message-1'], pendingOperation: null, lastRevertedFiles: [], lastMessage: null },
      transcript: [
        { id: 'user-1', kind: 'user_message_chunk', text: 'First prompt', messageId: 'user-message-1', eventIndex: 1 },
        { id: 'assistant-1', kind: 'agent_message_chunk', text: 'First answer', messageId: 'assistant-message-1', eventIndex: 2 },
        { id: 'user-2', kind: 'user_message_chunk', text: 'Second prompt', messageId: 'user-message-2', eventIndex: 3 },
        { id: 'assistant-2', kind: 'agent_message_chunk', text: 'Second answer', messageId: 'assistant-message-2', eventIndex: 4 }
      ]
    });
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(document.documentElement, 'scrollTop', { configurable: true, value: 0 });
    render(ActiveSessionView, { session, undoSupported: true, onRedo });
    await tick();

    expect(screen.queryByRole('button', { name: 'Redo this turn' })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1200);
    await tick();

    const redo = screen.getByRole('button', { name: 'Redo this turn' });
    expect(redo.closest('[data-turn-id]')).toHaveTextContent('First prompt');
    expect(screen.getAllByRole('button', { name: 'Redo this turn' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();
    await fireEvent.click(redo);
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('does not show redo for an assistant-only turn with an empty undo stack', async () => {
    await renderSettledSession(settledConversationSession({
      transcript: [
        { id: 'assistant-1', kind: 'agent_message_chunk', text: 'Standalone answer', messageId: 'assistant-message-1', eventIndex: 1 }
      ]
    }));
    await vi.advanceTimersByTimeAsync(1200);
    await tick();

    expect(screen.getByText('Standalone answer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redo this turn' })).not.toBeInTheDocument();
  });

  it('renders fork and undo only on the final segment of a multi-segment turn', async () => {
    const session = settledConversationSession({
      transcript: [
        {
          id: 'user-1',
          kind: 'user_message_chunk',
          text: 'run ls for test',
          messageId: 'user-message-1',
          eventIndex: 1
        },
        {
          id: 'thought-1',
          kind: 'agent_thought_chunk',
          text: 'Planning the command.',
          messageId: 'assistant-message-0',
          eventIndex: 2
        },
        {
          id: 'assistant-1',
          kind: 'agent_message_chunk',
          text: "I'll run ls now.",
          messageId: 'assistant-message-1',
          eventIndex: 3
        },
        {
          id: 'thought-2',
          kind: 'agent_thought_chunk',
          text: 'Reading the output.',
          messageId: 'assistant-message-2',
          eventIndex: 5
        },
        {
          id: 'assistant-2',
          kind: 'agent_message_chunk',
          text: 'ls succeeded. Workspace contents listed.',
          messageId: 'assistant-message-3',
          eventIndex: 6
        }
      ],
      toolCalls: [
        {
          id: 'tool-1',
          title: 'ls',
          status: 'completed',
          kind: 'execute',
          eventIndex: 4
        }
      ]
    });
    await renderSettledSession(session);
    await vi.advanceTimersByTimeAsync(1200);
    await tick();

    expect(screen.getAllByRole('button', { name: 'Fork into new session' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Undo to this prompt' })).toHaveLength(1);

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy response' }));
    expect(writeText).toHaveBeenCalledWith("I'll run ls now.\n\nls succeeded. Workspace contents listed.");

    const finalSection = screen.getByRole('button', { name: 'Fork into new session' }).closest('section');
    expect(finalSection).not.toBeNull();
    expect(within(finalSection as HTMLElement).getByText(/Workspace contents/)).toBeInTheDocument();
    expect(within(finalSection as HTMLElement).queryByText(/run ls now/)).not.toBeInTheDocument();
  });

  it('renders the response actions row for turns that end with tool work', async () => {
    const session = settledConversationSession({
      transcript: [
        { id: 'u1', kind: 'user_message_chunk', text: 'run ls', messageId: 'user-message-1', eventIndex: 0 },
        { id: 'r1', kind: 'agent_thought_chunk', text: 'Planning.', messageId: 'assistant-message-0', eventIndex: 1 },
        { id: 'a1', kind: 'agent_message_chunk', text: "I'll run ls now.", messageId: 'assistant-message-1', eventIndex: 2 }
      ],
      toolCalls: [{ id: 't1', title: 'ls', status: 'completed', kind: 'execute', eventIndex: 3 }]
    });
    await renderSettledSession(session);
    await vi.advanceTimersByTimeAsync(1200);
    await tick();

    expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Fork into new session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo to this prompt' })).toBeInTheDocument();
  });
});
