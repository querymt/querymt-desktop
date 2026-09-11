import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSessionViewModel } from '$lib/domain/types';
import { calculateImageFit } from '$lib/components/session/SessionAttachmentPreview.svelte';
import { createEmptyActiveSession } from '$lib/domain/session-updates';
import ActiveSessionView from './ActiveSessionView.svelte';

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

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
  vi.unstubAllGlobals();
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
