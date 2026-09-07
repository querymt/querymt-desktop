import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionConversationTurn } from '$lib/domain/session-conversation';
import SessionTurn from './SessionTurn.svelte';

const turn: SessionConversationTurn = {
  id: 'turn-1',
  forkMessageId: 'assistant-1',
  user: {
    id: 'user-1',
    messageId: 'message-1',
    html: '<p>Inspect the app</p>',
    text: 'Inspect the app'
  },
  content: [
    {
      type: 'reasoning',
      id: 'reasoning-1',
      html: '<p>Inspecting components</p>',
      isLive: true
    },
    {
      type: 'tool',
      id: 'tool-1',
      tool: {
        id: 'tool-1',
        title: 'read_tool',
        status: 'in_progress',
        kind: 'read_tool',
        arguments: '{"path":"src/app.ts"}'
      }
    },
    {
      type: 'reasoning',
      id: 'reasoning-2',
      html: '<p>Preparing the fix</p>',
      isLive: true
    },
    {
      type: 'tool',
      id: 'tool-2',
      tool: {
        id: 'tool-2',
        title: 'edit',
        status: 'failed',
        kind: 'edit',
        result: 'oldString not found'
      }
    },
    {
      type: 'assistant',
      id: 'assistant-1',
      messageId: 'assistant-1',
      html: '<p>Implemented the fix.</p>',
      text: 'Implemented the fix.',
      relatedEvents: []
    }
  ]
};

afterEach(cleanup);

describe('SessionTurn', () => {
  it('normalizes lines-first fence meta when copying the response', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const fencedTurn: SessionConversationTurn = {
      id: 'turn-fenced',
      forkMessageId: 'assistant-fenced',
      content: [
        {
          type: 'assistant',
          id: 'assistant-fenced',
          messageId: 'assistant-fenced',
          html: '<p>Fenced</p>',
          text: 'Look:\n\n```496:499:crates/agent/src/api/agent.rs\nlet value = 1;\n```',
          relatedEvents: []
        }
      ],
      settled: true
    };

    const { getByRole } = render(SessionTurn, { turn: fencedTurn });
    await fireEvent.click(getByRole('button', { name: 'Copy response' }));

    expect(writeText).toHaveBeenCalledWith(
      'Look:\n\n```crates/agent/src/api/agent.rs:496-499\nlet value = 1;\n```'
    );
  });

  it('renders consecutive streamed text blocks as a single markdown flow', () => {
    const streamedTurn: SessionConversationTurn = {
      id: 'turn-streamed',
      forkMessageId: null,
      content: [
        {
          type: 'assistant',
          id: 'assistant-streamed',
          messageId: 'assistant-streamed',
          html: '<p>Hello world</p>',
          text: 'Hello world',
          blocks: [
            { type: 'text', text: 'Hel' },
            { type: 'text', text: 'lo wo' },
            { type: 'text', text: 'rld' }
          ],
          relatedEvents: []
        }
      ],
      settled: true
    };

    render(SessionTurn, { turn: streamedTurn });
    const bodies = document.querySelectorAll('.session-agent-body.markdown-body');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toHaveTextContent('Hello world');
  });

  it('renders precomputed html without re-parsing markdown', async () => {
    const markdown = await import('$lib/domain/markdown');
    const spy = vi.spyOn(markdown, 'renderMarkdownToHtml');
    const settledTurn: SessionConversationTurn = {
      id: 'turn-cached-html',
      forkMessageId: 'assistant-cached',
      user: {
        id: 'user-cached',
        messageId: 'user-cached',
        html: '<p>Cached prompt</p>',
        text: 'Cached prompt'
      },
      content: [
        {
          type: 'assistant',
          id: 'assistant-cached',
          messageId: 'assistant-cached',
          html: '<p>Cached answer</p>',
          text: 'Cached answer',
          relatedEvents: []
        }
      ],
      settled: true
    };

    render(SessionTurn, { turn: settledTurn });

    expect(document.querySelector('.session-message-body')).toHaveTextContent('Cached prompt');
    expect(document.querySelector('.session-agent-body')).toHaveTextContent('Cached answer');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('renders each settled text segment from its own markdown, not the parent html', () => {
    const mixedTurn: SessionConversationTurn = {
      id: 'turn-mixed-segments',
      forkMessageId: null,
      user: {
        id: 'user-mixed',
        messageId: 'user-mixed',
        html: '<p>Before After</p>',
        text: 'Before After',
        blocks: [
          { type: 'text', text: 'Before' },
          { type: 'image', data: 'aW1n', mimeType: 'image/png', name: 'photo.png' },
          { type: 'text', text: 'After' }
        ]
      },
      content: [],
      settled: true
    };

    const { getByRole } = render(SessionTurn, { turn: mixedTurn });
    const bodies = [...document.querySelectorAll('.session-message-body')];

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveTextContent('Before');
    expect(bodies[0]).not.toHaveTextContent('After');
    expect(bodies[1]).toHaveTextContent('After');
    expect(bodies[1]).not.toHaveTextContent('Before');
    expect(getByRole('button', { name: 'Open photo.png' })).toBeInTheDocument();
  });

  it('freezes completed markdown and only streams the open tail', () => {
    const liveTurn: SessionConversationTurn = {
      id: 'turn-live-split',
      forkMessageId: null,
      content: [
        {
          type: 'assistant',
          id: 'assistant-live',
          messageId: 'assistant-live',
          html: '<p>Ignored live html</p>',
          text: '# Title\n\nHello wo',
          relatedEvents: []
        }
      ],
      settled: false
    };

    render(SessionTurn, { turn: liveTurn });
    const frozen = document.querySelector('.session-agent-body-frozen');
    const tail = document.querySelector('.session-agent-body-tail');

    expect(frozen).toHaveTextContent('Title');
    expect(frozen).not.toHaveTextContent('Hello wo');
    expect(tail).toHaveTextContent('Hello wo');
    expect(document.querySelectorAll('.session-agent-body.markdown-body')).toHaveLength(1);
  });

  it('streams live reasoning as frozen markdown plus an open tail', () => {
    const liveReasoningTurn: SessionConversationTurn = {
      id: 'turn-live-reasoning',
      forkMessageId: null,
      content: [
        {
          type: 'reasoning',
          id: 'reasoning-live',
          html: '',
          text: '# Title\n\nHello wo',
          isLive: true
        }
      ],
      settled: false
    };

    const { getByRole } = render(SessionTurn, { turn: liveReasoningTurn });
    const work = getByRole('region', { name: 'Agent work' });
    const frozen = work.querySelector('.session-reasoning-frozen');
    const tail = work.querySelector('.session-reasoning-tail');

    expect(work.querySelector('.session-reasoning-preview')).toHaveTextContent('Title');
    expect(frozen).toHaveTextContent('Title');
    expect(frozen).not.toHaveTextContent('Hello wo');
    expect(tail).toHaveTextContent('Hello wo');
  });

  it('renders shared image triggers, file cards, and unavailable image fallbacks without captions', () => {
    const attachmentTurn: SessionConversationTurn = {
      id: 'attachments',
      forkMessageId: null,
      user: {
        id: 'user-attachments',
        messageId: 'u-attachments',
        text: '',
        html: '',
        blocks: [
          { type: 'image', data: 'aW1n', mimeType: 'image/png', name: 'photo.png' },
          { type: 'resource', uri: 'attachment:///f/notes.txt', mimeType: 'text/plain', name: 'notes.txt', size: 4 },
          { type: 'image', data: null, mimeType: 'image/jpeg', name: 'broken.jpg', unavailable: true }
        ]
      },
      content: []
    };
    const { container, getByRole, getByText, queryByRole } = render(SessionTurn, { turn: attachmentTurn });

    const trigger = getByRole('button', { name: 'Open photo.png' });
    expect(trigger).toHaveAttribute('title', 'photo.png');
    expect(within(trigger).getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'data:image/png;base64,aW1n');
    expect(within(trigger).getByRole('img', { name: 'photo.png' })).toHaveClass('session-image-thumbnail');
    expect(container.querySelector('figcaption')).toBeNull();
    expect(getByText('notes.txt')).toBeInTheDocument();
    expect(getByRole('status')).toHaveTextContent('broken.jpg');
    expect(queryByRole('button', { name: 'Open broken.jpg' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument();
  });

  it('replaces a malformed image with the accessible fallback', async () => {
    const malformedTurn: SessionConversationTurn = {
      id: 'malformed-image',
      forkMessageId: null,
      user: {
        id: 'user-malformed-image',
        messageId: 'u-malformed-image',
        text: '',
        html: '',
        blocks: [{ type: 'image', data: 'invalid', mimeType: 'image/png', name: 'broken.png' }]
      },
      content: []
    };
    const { getByRole, queryByRole } = render(SessionTurn, { turn: malformedTurn });

    await fireEvent.error(getByRole('img', { name: 'broken.png' }));

    expect(getByRole('status')).toHaveTextContent('broken.png');
    expect(queryByRole('button', { name: 'Open broken.png' })).not.toBeInTheDocument();
  });

  it('opens the clicked chat image, zooms only with Ctrl+wheel, and wraps valid-image navigation', async () => {
    const attachmentTurn: SessionConversationTurn = {
      id: 'multiple-images',
      forkMessageId: null,
      user: {
        id: 'user-images',
        messageId: 'u-images',
        text: '',
        html: '',
        blocks: [
          { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png', name: 'first.png' },
          { type: 'image', data: null, mimeType: 'image/gif', name: 'unavailable.gif', unavailable: true },
          { type: 'resource', uri: 'attachment:///notes.txt', mimeType: 'text/plain', name: 'notes.txt' },
          { type: 'image', data: 'ZmFpbGVk', mimeType: 'image/png', name: 'failed.png' },
          { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg', name: 'second.jpg' }
        ]
      },
      content: []
    };
    const { getByRole } = render(SessionTurn, { turn: attachmentTurn });
    await fireEvent.error(getByRole('img', { name: 'failed.png' }));

    await fireEvent.click(getByRole('button', { name: 'Open second.jpg' }));
    const dialog = getByRole('dialog', { name: 'second.jpg' });
    const zoomLevel = within(dialog).getByLabelText('Zoom level');

    expect(within(dialog).getByRole('img', { name: 'second.jpg' })).toHaveAttribute('src', 'data:image/jpeg;base64,c2Vjb25k');
    expect(zoomLevel).toHaveTextContent('100%');
    expect(within(dialog).queryByRole('button', { name: /Zoom|Reset/i })).not.toBeInTheDocument();

    await fireEvent.wheel(dialog, { deltaY: -80 });
    expect(zoomLevel).toHaveTextContent('100%');
    for (let step = 0; step < 25; step += 1) await fireEvent.wheel(dialog, { ctrlKey: true, deltaY: -80 });
    expect(zoomLevel).toHaveTextContent('300%');
    await fireEvent.wheel(dialog, { ctrlKey: true, deltaY: -80 });
    expect(zoomLevel).toHaveTextContent('300%');
    for (let step = 0; step < 25; step += 1) await fireEvent.wheel(dialog, { ctrlKey: true, deltaY: 80 });
    expect(zoomLevel).toHaveTextContent('50%');

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(getByRole('dialog', { name: 'first.png' })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'first.png' })).toHaveAttribute('src', 'data:image/png;base64,Zmlyc3Q=');
    expect(zoomLevel).toHaveTextContent('100%');
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(getByRole('dialog', { name: 'second.jpg' })).toBeInTheDocument();
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(getByRole('dialog', { name: 'first.png' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('img', { name: /unavailable\.gif|failed\.png/ })).not.toBeInTheDocument();
  });

  it('closes the image dialog with Escape and restores focus to its thumbnail', async () => {
    const attachmentTurn: SessionConversationTurn = {
      id: 'focus-image',
      forkMessageId: null,
      user: {
        id: 'user-focus-image',
        messageId: 'u-focus-image',
        text: '',
        html: '',
        blocks: [{ type: 'image', data: 'aW1n', mimeType: 'image/png', name: 'photo.png' }]
      },
      content: []
    };
    const { getByRole, queryByRole } = render(SessionTurn, { turn: attachmentTurn });
    const trigger = getByRole('button', { name: 'Open photo.png' });

    await fireEvent.click(trigger);
    await fireEvent.keyDown(getByRole('dialog', { name: 'photo.png' }), { key: 'Escape' });

    expect(queryByRole('dialog', { name: 'photo.png' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await fireEvent.click(trigger);
    const backdrop = document.querySelector('.session-image-lightbox-backdrop');
    expect(backdrop).not.toBeNull();
    await fireEvent.click(backdrop!);

    expect(queryByRole('dialog', { name: 'photo.png' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('calls the fork action for the completed response boundary', async () => {
    const onFork = vi.fn();
    const { getByRole } = render(SessionTurn, { turn, forkAvailable: true, onFork });

    await fireEvent.click(getByRole('button', { name: 'Fork into new session' }));

    expect(onFork).toHaveBeenCalledOnce();
  });

  it('calls targeted undo with the user message id when available', async () => {
    const onUndo = vi.fn();
    const { getByRole } = render(SessionTurn, { turn, undoAvailable: true, onUndo });

    await fireEvent.click(getByRole('button', { name: 'Undo to this prompt' }));

    expect(onUndo).toHaveBeenCalledWith('message-1');
  });

  it('hides fork and undo when they are not actionable', () => {
    const { queryByRole } = render(SessionTurn, { turn, undoAvailable: false, forkAvailable: false, reverted: true });

    expect(queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();
  });

  it('shows only functional message actions', () => {
    const { getByRole, queryByRole } = render(SessionTurn, { turn });

    expect(getByRole('button', { name: 'Copy prompt' })).toBeInTheDocument();
    expect(getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
    expect(queryByRole('button', { name: 'Edit prompt' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Share response' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Read aloud' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('folds settled work behind a concise summary while keeping the final answer visible', () => {
    const { getByRole, getByText, queryByText } = render(SessionTurn, { turn: { ...turn, settled: true } });

    expect(getByRole('button', { name: /Worked through 2 tool calls and 2 reasoning steps/ })).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Inspecting components')).not.toBeInTheDocument();
    expect(getByText('Implemented the fix.')).toBeInTheDocument();
  });

  it('restores the original reasoning and tool order when settled work is expanded', async () => {
    const { container, getByRole } = render(SessionTurn, { turn: { ...turn, settled: true } });

    await fireEvent.click(getByRole('button', { name: /Worked through 2 tool calls and 2 reasoning steps/ }));
    const orderedText = Array.from(container.querySelector('.session-work-list')?.children ?? []).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );

    expect(orderedText).toHaveLength(4);
    expect(orderedText[0]).toContain('Inspecting components');
    expect(orderedText[1]).toContain('Read file');
    expect(orderedText[2]).toContain('Preparing the fix');
    expect(orderedText[3]).toContain('Edit file');
  });

  it('keeps current work visible but collapses older active entries', async () => {
    const { getByRole, getByText, queryByText } = render(SessionTurn, { turn: { ...turn, settled: false } });

    expect(getByRole('button', { name: '+2 previous work entries' })).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Inspecting components')).not.toBeInTheDocument();
    expect(getByRole('region', { name: 'Agent work' }).querySelector('.session-reasoning-preview')).toHaveTextContent('Preparing the fix');
    expect(getByText('Edit file')).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: '+2 previous work entries' }));
    expect(getByRole('button', { name: 'Show fewer work entries' })).toHaveAttribute('aria-expanded', 'true');
    expect(getByRole('region', { name: 'Agent work' })).toHaveTextContent('Inspecting components');
  });
});
