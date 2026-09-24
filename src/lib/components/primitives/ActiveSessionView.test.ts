import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSessionViewModel } from '$lib/domain/types';
import { calculateImageFit } from '$lib/components/session/SessionAttachmentPreview.svelte';
import { SESSION_TURN_NAV_VISIBLE_GAP } from '$lib/domain/session-turn-navigation';
import { createEmptyActiveSession } from '$lib/domain/session-updates';
import { SESSION_TURN_DEFAULT_HEIGHT, SESSION_TURN_GAP } from '$lib/domain/session-turn-window';
import ActiveSessionView from './ActiveSessionView.svelte';

vi.mock('$app/state', () => ({
  page: { params: { agentId: 'agent-1' } }
}));

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll('.session-header, .app-shell-custom-titlebar').forEach((node) => node.remove());
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

  it('shows a running delegation link when the child session arrives', async () => {
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
      status: 'in_progress',
      kind: 'delegate',
      arguments: '{"target_agent_id":"linus","objective":"Review the diff"}',
      eventIndex: 2
    }];
    const { rerender } = render(ActiveSessionView, { session });
    expect(screen.queryByRole('button', { name: 'Open linus session' })).toBeNull();

    await rerender({
      session: {
        ...session,
        toolCalls: [{ ...session.toolCalls[0], childSessionId: 'child-session-1' }]
      }
    });

    expect(screen.getByRole('button', { name: 'Open linus session' })).toBeInTheDocument();
    expect(screen.getByText('Running')).toHaveClass('sr-only');
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

function makeRect(partial: {
  top?: number;
  bottom?: number;
  height?: number;
  left?: number;
  width?: number;
}): DOMRect {
  const top = partial.top ?? 0;
  const height = partial.height ?? Math.max(0, (partial.bottom ?? 0) - top);
  const bottom = partial.bottom ?? top + height;
  const left = partial.left ?? 0;
  const width = partial.width ?? 0;
  return {
    x: left,
    y: top,
    top,
    bottom,
    left,
    right: left + width,
    width,
    height,
    toJSON() {
      return this;
    }
  } as DOMRect;
}

function stubScroller(element: HTMLElement, initialTop = 0) {
  let scrollTop = 0;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    scrollTop = options.top ?? 0;
  });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 200 });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    }
  });
  Object.defineProperty(element, 'scrollTo', { configurable: true, value: scrollTo });
  return {
    scrollTo,
    setScrollTop(value: number) {
      scrollTop = value;
    },
    initialTop
  };
}

function scrollTopOf(call: ScrollToOptions): number {
  return call.top ?? 0;
}

async function flushNavFrames() {
  await tick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await tick();
}

async function flushIdleSettle() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
  await tick();
}

describe('ActiveSessionView turn navigation', () => {
  it('hides the rail when the conversation is empty', () => {
    const empty = createEmptyActiveSession();
    empty.sessionId = 'session-empty';
    render(ActiveSessionView, { session: empty });

    expect(screen.queryByRole('navigation', { name: 'Turn navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous response' })).not.toBeInTheDocument();
  });

  it('renders ordinal ticks and keeps boundary chevrons non-native-disabled', async () => {
    const onManualNavigate = vi.fn();
    stubScroller(document.documentElement);
    render(ActiveSessionView, { session: longStreamingSession(2), onManualNavigate });
    await tick();

    const rail = screen.getByRole('navigation', { name: 'Turn navigation' });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User request 1 of 2' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'User request 2 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent response 1 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agent response 2 of 2' })).toBeInTheDocument();

    const previous = screen.getByRole('button', { name: 'Previous response' });
    const next = screen.getByRole('button', { name: 'Next response' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous).not.toBeDisabled();
    expect(next).not.toHaveAttribute('aria-disabled');
    expect(next).toBeEnabled();
  });

  it('jumps a virtualized response in two phases: rough mount then exact header-cleared scroll', async () => {
    const onManualNavigate = vi.fn();
    const scroller = stubScroller(document.documentElement);
    const header = document.createElement('header');
    header.className = 'session-header';
    document.body.append(header);

    const turnIndex = 5;
    const turnStart = turnIndex * (SESSION_TURN_DEFAULT_HEIGHT + SESSION_TURN_GAP);
    const requestHeight = 400;
    const responseLayoutTop = turnStart + requestHeight;
    const headerBottom = 72;
    const inset = headerBottom + SESSION_TURN_NAV_VISIBLE_GAP;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scrollTop = document.documentElement.scrollTop;
      if (this === document.documentElement) return makeRect({ top: 0, height: 200 });
      if (this === header) return makeRect({ top: 0, bottom: headerBottom, height: headerBottom });
      if (this.classList.contains('session-conversation-window')) {
        return makeRect({ top: -scrollTop, height: 4000 });
      }
      const partId = this.dataset.turnPartId;
      if (partId === `turn-user-${turnIndex}:response`) {
        return makeRect({ top: responseLayoutTop - scrollTop, height: 80 });
      }
      if (partId === `turn-user-${turnIndex}:request`) {
        return makeRect({ top: turnStart - scrollTop, height: requestHeight });
      }
      const turnId = this.dataset.turnId;
      if (turnId === `turn-user-${turnIndex}`) {
        return makeRect({ top: turnStart - scrollTop, height: requestHeight + 80 });
      }
      return originalRect.call(this);
    });

    render(ActiveSessionView, { session: longStreamingSession(12), onManualNavigate });
    await tick();

    expect(document.querySelector(`[data-turn-id="turn-user-${turnIndex}"]`)).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 6 of 12' }));

    expect(onManualNavigate).toHaveBeenCalledOnce();
    expect(scroller.scrollTo).toHaveBeenNthCalledWith(1, { top: turnStart - inset, behavior: 'auto' });
    expect(scrollTopOf(scroller.scrollTo.mock.calls[0][0])).toBe(turnStart - inset);

    await flushNavFrames();
    await vi.waitFor(() => expect(scroller.scrollTo).toHaveBeenCalledTimes(2));

    expect(scroller.scrollTo).toHaveBeenNthCalledWith(2, {
      top: responseLayoutTop - inset,
      behavior: 'smooth'
    });
    expect(scrollTopOf(scroller.scrollTo.mock.calls[0][0])).not.toBe(scrollTopOf(scroller.scrollTo.mock.calls[1][0]));
    expect(document.querySelector(`[data-turn-part-id="turn-user-${turnIndex}:response"]`)).toBeInTheDocument();
    header.remove();
  });

  it('aligns a mounted target below the sticky header using the custom scroller origin', async () => {
    const onManualNavigate = vi.fn();
    const shell = document.createElement('div');
    shell.className = 'app-shell-custom-titlebar';
    const header = document.createElement('header');
    header.className = 'session-header';
    document.body.append(shell, header);
    const scroller = stubScroller(shell);
    scroller.setScrollTop(50);

    const scrollerTop = 40;
    const headerBottom = 112;
    const nodeTop = 200;
    const inset = headerBottom - scrollerTop + SESSION_TURN_NAV_VISIBLE_GAP;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === shell) return makeRect({ top: scrollerTop, height: 200 });
      if (this === header) return makeRect({ top: 16, bottom: headerBottom, height: headerBottom - 16 });
      if (this.classList.contains('session-conversation-window')) {
        return makeRect({ top: scrollerTop, height: 800 });
      }
      const partId = this.dataset.turnPartId;
      if (partId === 'turn-user-0:response') {
        return makeRect({ top: nodeTop, height: 80 });
      }
      return originalRect.call(this);
    });

    render(ActiveSessionView, {
      target: shell,
      props: { session: longStreamingSession(2), onManualNavigate }
    });
    await tick();

    const rail = screen.getByRole('navigation', { name: 'Turn navigation' });
    expect(rail.getAttribute('style')).toContain(`--session-turn-nav-inset: ${inset}px`);

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 1 of 2' }));
    expect(onManualNavigate).toHaveBeenCalledOnce();
    expect(scroller.scrollTo).toHaveBeenCalledWith({
      top: 50 + nodeTop - scrollerTop - inset,
      behavior: 'smooth'
    });
    expect(scrollTopOf(scroller.scrollTo.mock.calls[0][0])).toBe(122);
    shell.remove();
    header.remove();
  });

  it('keeps programmatic navigation open until the mounted jump settles', async () => {
    const onManualNavigate = vi.fn();
    const onManualNavigateComplete = vi.fn();
    stubScroller(document.documentElement);
    render(ActiveSessionView, {
      session: longStreamingSession(2),
      onManualNavigate,
      onManualNavigateComplete
    });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 1 of 2' }));
    expect(onManualNavigate).toHaveBeenCalledOnce();
    expect(onManualNavigateComplete).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('scrollend'));
    await tick();
    expect(onManualNavigateComplete).toHaveBeenCalledOnce();
  });

  it('does not complete a two-phase jump until the exact phase settles', async () => {
    const onManualNavigate = vi.fn();
    const onManualNavigateComplete = vi.fn();
    const scroller = stubScroller(document.documentElement);
    const header = document.createElement('header');
    header.className = 'session-header';
    document.body.append(header);

    const turnIndex = 5;
    const turnStart = turnIndex * (SESSION_TURN_DEFAULT_HEIGHT + SESSION_TURN_GAP);
    const requestHeight = 400;
    const responseLayoutTop = turnStart + requestHeight;
    const headerBottom = 72;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scrollTop = document.documentElement.scrollTop;
      if (this === document.documentElement) return makeRect({ top: 0, height: 200 });
      if (this === header) return makeRect({ top: 0, bottom: headerBottom, height: headerBottom });
      if (this.classList.contains('session-conversation-window')) {
        return makeRect({ top: -scrollTop, height: 4000 });
      }
      const partId = this.dataset.turnPartId;
      if (partId === `turn-user-${turnIndex}:response`) {
        return makeRect({ top: responseLayoutTop - scrollTop, height: 80 });
      }
      if (partId === `turn-user-${turnIndex}:request`) {
        return makeRect({ top: turnStart - scrollTop, height: requestHeight });
      }
      const turnId = this.dataset.turnId;
      if (turnId === `turn-user-${turnIndex}`) {
        return makeRect({ top: turnStart - scrollTop, height: requestHeight + 80 });
      }
      return originalRect.call(this);
    });

    render(ActiveSessionView, {
      session: longStreamingSession(12),
      onManualNavigate,
      onManualNavigateComplete
    });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 6 of 12' }));
    expect(onManualNavigate).toHaveBeenCalledOnce();
    expect(onManualNavigateComplete).not.toHaveBeenCalled();
    expect(scroller.scrollTo).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('scrollend'));
    await tick();
    expect(onManualNavigateComplete).not.toHaveBeenCalled();

    await flushNavFrames();
    await vi.waitFor(() => expect(scroller.scrollTo).toHaveBeenCalledTimes(2));
    expect(onManualNavigateComplete).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('scrollend'));
    await tick();
    expect(onManualNavigateComplete).toHaveBeenCalledOnce();
    header.remove();
  });

  it('completes the previous jump when a replacement navigation starts', async () => {
    const onManualNavigate = vi.fn();
    const onManualNavigateComplete = vi.fn();
    stubScroller(document.documentElement);
    render(ActiveSessionView, {
      session: longStreamingSession(2),
      onManualNavigate,
      onManualNavigateComplete
    });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 1 of 2' }));
    expect(onManualNavigate).toHaveBeenCalledOnce();
    expect(onManualNavigateComplete).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 2 of 2' }));
    expect(onManualNavigate).toHaveBeenCalledTimes(2);
    expect(onManualNavigateComplete).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event('scrollend'));
    await tick();
    expect(onManualNavigateComplete).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight jump on session change without completing it', async () => {
    const onManualNavigate = vi.fn();
    const onManualNavigateComplete = vi.fn();
    stubScroller(document.documentElement);
    const { rerender } = render(ActiveSessionView, {
      session: longStreamingSession(2),
      onManualNavigate,
      onManualNavigateComplete
    });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 1 of 2' }));
    expect(onManualNavigate).toHaveBeenCalledOnce();

    const nextSession = longStreamingSession(2);
    nextSession.sessionId = 'session-other';
    await rerender({ session: nextSession, onManualNavigate, onManualNavigateComplete });
    await tick();

    window.dispatchEvent(new Event('scrollend'));
    await tick();
    expect(onManualNavigateComplete).not.toHaveBeenCalled();
  });

  it('clears programmatic navigation after idle frames when scrollend never fires', async () => {
    const onManualNavigateComplete = vi.fn();
    stubScroller(document.documentElement);
    render(ActiveSessionView, {
      session: longStreamingSession(2),
      onManualNavigateComplete
    });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Agent response 1 of 2' }));
    expect(onManualNavigateComplete).not.toHaveBeenCalled();

    await flushIdleSettle();
    expect(onManualNavigateComplete).toHaveBeenCalledOnce();
  });

  it('keeps previous and next non-operational when no agent responses exist', async () => {
    const session = createEmptyActiveSession();
    session.sessionId = 'session-requests';
    session.runState = 'completed';
    session.transcript = [
      {
        id: 'user-1',
        kind: 'user_message_chunk',
        text: 'Only a prompt',
        messageId: 'user-message-1',
        eventIndex: 0
      }
    ];
    render(ActiveSessionView, { session });
    await tick();

    expect(screen.getByRole('button', { name: 'User request 1 of 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agent response/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous response' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next response' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the request active when the conversation root starts below the viewport origin', async () => {
    const scroller = stubScroller(document.documentElement);
    const header = document.createElement('header');
    header.className = 'session-header';
    document.body.append(header);

    const rootTop = 84;
    const headerBottom = 72;
    const inset = headerBottom + SESSION_TURN_NAV_VISIBLE_GAP;
    const requestHeight = 70;
    const responseHeight = 80;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const scrollTop = document.documentElement.scrollTop;
      if (this === document.documentElement) return makeRect({ top: 0, height: 200 });
      if (this === header) return makeRect({ top: 0, bottom: headerBottom, height: headerBottom });
      if (this.classList.contains('session-conversation-window')) {
        return makeRect({ top: rootTop - scrollTop, height: 400 });
      }
      const partId = this.dataset.turnPartId;
      if (partId === 'turn-user-0:request') {
        return makeRect({ top: rootTop - scrollTop, height: requestHeight });
      }
      if (partId === 'turn-user-0:response') {
        return makeRect({ top: rootTop + requestHeight - scrollTop, height: responseHeight });
      }
      if (this.dataset.turnId === 'turn-user-0') {
        return makeRect({ top: rootTop - scrollTop, height: requestHeight + responseHeight });
      }
      return originalRect.call(this);
    });

    render(ActiveSessionView, { session: longStreamingSession(1) });
    await flushNavFrames();

    // Clamped viewport.top + inset would be 88 and skip the 70px request.
    // True conversation readY is scrollTop + 88 - 84 = scrollTop + 4.
    expect(inset).toBe(88);
    expect(screen.getByRole('button', { name: 'User request 1 of 1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Agent response 1 of 1' })).not.toHaveAttribute('aria-current');

    scroller.setScrollTop(65);
    await fireEvent.scroll(window);
    await tick();
    expect(screen.getByRole('button', { name: 'User request 1 of 1' })).toHaveAttribute('aria-current', 'true');

    scroller.setScrollTop(66);
    await fireEvent.scroll(window);
    await tick();
    expect(screen.getByRole('button', { name: 'Agent response 1 of 1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'User request 1 of 1' })).not.toHaveAttribute('aria-current');
    header.remove();
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
