import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionConversationTurn } from '$lib/domain/session-conversation';
import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
import { agentsStore } from '$lib/stores/agents.svelte';
import type { DesktopSessionSummary } from '$lib/domain/types';
import { buildSessionLinkIndex } from '$lib/domain/sessions';
import * as frontMatter from '$lib/domain/message-frontmatter';
import SessionTurn from './SessionTurn.svelte';

const originalAgentConfigs = agentsStore.configs;
const preloadSessionToolPatchDiff = vi.hoisted(() => vi.fn());
vi.mock('./session-tool-patch-diff', () => ({ preloadSessionToolPatchDiff }));

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  chatPreferencesStore.setDeveloperMode(false);
  agentsStore.configs = originalAgentConfigs;
  agentsStore.sessionsByAgent = {};
  agentsStore.activeAgentId = null;
});

describe('SessionTurn known session references', () => {
  const id = '019aa123-4567-789a-bcde-0123456789ab';
  const unknown = '019bb123-4567-789a-bcde-0123456789ab';
  const summary: DesktopSessionSummary = {
    agentId: 'agent-1', agentName: 'Agent', sessionId: id, title: 'Related work', cwd: '/tmp/work',
    updatedAt: null, runtimeId: 'agent-1', runtimeName: 'Agent', source: 'acp', status: 'idle', location: 'local'
  };

  function referenceTurn(text = `See ${id} and ${unknown}.`): SessionConversationTurn {
    return {
      id: 'references', forkMessageId: 'answer', settled: true,
      user: { id: 'prompt', messageId: 'prompt', text, html: '' },
      content: [{ type: 'assistant', id: 'answer', messageId: 'answer', text, html: '', relatedEvents: [] }]
    };
  }

  function knownSessions(sessions: DesktopSessionSummary[]) {
    agentsStore.configs = [{ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'qmtcode --acp', enabled: true, autoStart: true }];
    agentsStore.sessionLinkIndex = buildSessionLinkIndex(sessions);
    agentsStore.activeAgentId = 'agent-1';
  }

  it('links known sessions in both prompt and response while leaving unrelated UUIDs plain', async () => {
    knownSessions([summary]);
    const { container, getByRole } = render(SessionTurn, { turn: referenceTurn() });
    for (const selector of ['.session-message-body', '.session-agent-body']) {
      const body = container.querySelector(selector)!;
      const links = body.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute('href', `/sessions/agent-1/${id}`);
      expect(links[0].firstElementChild).toHaveClass('lucide-monitor');
      expect(links[0].textContent).toBe(id);
      expect(body).toHaveTextContent(unknown);
    }
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await fireEvent.click(getByRole('button', { name: 'Copy prompt' }));
    expect(writeText).toHaveBeenCalledWith(referenceTurn().user!.text);
  });

  it('uses the app tooltip on hover and keyboard focus without a native title', async () => {
    knownSessions([summary]);
    const { container, findByRole, queryByRole, unmount } = render(SessionTurn, { turn: referenceTurn() });
    const link = container.querySelector<HTMLAnchorElement>('.session-agent-body a')!;
    expect(link).not.toHaveAttribute('title');
    await fireEvent.pointerEnter(link);
    const tooltip = await findByRole('tooltip', { hidden: true });
    expect(tooltip).toHaveClass('app-tooltip-content');
    expect(tooltip).toHaveTextContent('Open local session: Related work');
    expect(link).toHaveAttribute('aria-describedby', tooltip.id);
    await fireEvent.keyDown(link, { key: 'Escape' });
    expect(queryByRole('tooltip', { hidden: true })).toBeNull();
    await fireEvent.pointerLeave(link);
    link.focus();
    await tick();
    expect(await findByRole('tooltip', { hidden: true })).toHaveTextContent('Open local session: Related work');
    unmount();
    await tick();
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('turns unknown references into delegate links after background discovery without rerendering the turn', async () => {
    knownSessions([]);
    const stop = vi.fn();
    const source = vi.spyOn(agentsStore, 'activeSessionReferenceSource', 'get').mockReturnValue('endpoint-1');
    const discover = vi.spyOn(agentsStore, 'watchSessionReferences').mockImplementation(() => {
      queueMicrotask(() => { agentsStore.sessionLinkIndex = buildSessionLinkIndex([
        { ...summary, parentSessionId: 'parent', forkOrigin: 'delegation' }
      ]); });
      return stop;
    });
    try {
      const { container, findAllByRole, unmount } = render(SessionTurn, { turn: referenceTurn() });
      expect(discover).toHaveBeenCalledWith('agent-1', [id, unknown]);
      const links = await findAllByRole('link', { name: `${id}: Open local delegate: Related work` });
      expect(links).toHaveLength(2);
      expect(container.querySelectorAll('.session-reference .lucide-bot')).toHaveLength(2);
      expect(container.querySelector('.session-agent-body')).toHaveTextContent(`See ${id} and ${unknown}.`);
      unmount();
      expect(stop).toHaveBeenCalledTimes(2);
    } finally {
      discover.mockRestore();
      source.mockRestore();
    }
  });

  it('updates the prefix when known session locality changes', async () => {
    knownSessions([summary]);
    const { container } = render(SessionTurn, { turn: referenceTurn() });
    expect(container.querySelectorAll('.session-reference .lucide-monitor')).toHaveLength(2);
    agentsStore.sessionLinkIndex = buildSessionLinkIndex([{ ...summary, location: 'remote', remoteNodeLabel: 'Build host' }]);
    await tick();
    expect(container.querySelector('.session-reference .lucide-monitor')).toBeNull();
    expect(container.querySelectorAll('.session-reference .lucide-network')).toHaveLength(2);
    const link = container.querySelector('.session-agent-body a')!;
    expect(link).toHaveAttribute('href', `/sessions/agent-1/${id}`);
    expect(link).toHaveAccessibleName(`${id}: Open remote session on Build host: Related work`);
    expect(link.textContent).toBe(id);
  });

  it('reacts to sessions arriving and being removed without changing the message', async () => {
    knownSessions([]);
    const { container } = render(SessionTurn, { turn: referenceTurn() });
    expect(container.querySelector('a.session-reference')).toBeNull();
    agentsStore.sessionLinkIndex = buildSessionLinkIndex([summary]);
    await tick();
    expect(container.querySelectorAll('a.session-reference')).toHaveLength(2);
    agentsStore.sessionLinkIndex = buildSessionLinkIndex([]);
    await tick();
    expect(container.querySelector('a.session-reference')).toBeNull();
    expect(container.querySelector('.session-message-body')).toHaveTextContent(`See ${id} and ${unknown}.`);
  });

  it('keeps a streaming tail untouched and links it when the response settles', async () => {
    knownSessions([summary]);
    const response = referenceTurn();
    const { container, rerender } = render(SessionTurn, { turn: { ...response, settled: false } });
    expect(container.querySelector('.session-agent-body-tail')).toHaveTextContent(id);
    expect(container.querySelector('.session-agent-body a')).toBeNull();
    await rerender({ turn: response });
    expect(container.querySelector('.session-agent-body a')).toHaveAttribute('href', `/sessions/agent-1/${id}`);
  });

  it('enhances replacement HTML without leaving stale session links', async () => {
    knownSessions([summary]);
    const { container, rerender } = render(SessionTurn, { turn: referenceTurn(`See ${id}.`) });
    expect(container.querySelectorAll('a.session-reference')).toHaveLength(2);
    await rerender({ turn: referenceTurn(`Now ${unknown}.`) });
    expect(container.querySelector('a.session-reference')).toBeNull();
    expect(container.querySelector('.session-agent-body')).toHaveTextContent(`Now ${unknown}.`);
  });
});

describe('SessionTurn', () => {
  const metadataMessage = (text: string): SessionConversationTurn => ({
    id: 'metadata-turn', forkMessageId: null,
    user: { id: 'metadata-user', messageId: 'metadata-message', text, html: '<h2>Metadata must not leak from cached HTML</h2>' },
    content: []
  });

  it.each(['type: callback\nevent: timer.elapsed', 'key: [broken', '- not-a-mapping'])('hides front matter without warnings in normal mode: %s', (yaml) => {
    const validate = vi.spyOn(frontMatter, 'validateMessageFrontMatter');
    const { container, getByText, queryByRole } = render(SessionTurn, { turn: metadataMessage(`---\n${yaml}\n---\n**Visible body**`) });
    expect(getByText('Visible body').tagName).toBe('STRONG');
    expect(container.querySelector('.session-message-user')).not.toHaveTextContent(yaml);
    expect(container).not.toHaveTextContent('Metadata must not leak');
    expect(container).not.toHaveTextContent('YAML validation');
    expect(queryByRole('button', { name: 'Show metadata' })).not.toBeInTheDocument();
    expect(queryByRole('region', { name: 'Message metadata' })).not.toBeInTheDocument();
    expect(validate).not.toHaveBeenCalled();
  });

  it('keeps metadata collapsed in developer mode and copies the unmodified prompt', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    const validate = vi.spyOn(frontMatter, 'validateMessageFrontMatter');
    const text = '---\n# Keep this comment\ntype: callback\nnested:\n  delay: 60\n---\nVisible body';
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onDisclosureChange = vi.fn();
    const { getByRole, queryByRole } = render(SessionTurn, { turn: metadataMessage(text), onDisclosureChange });
    const toggle = getByRole('button', { name: 'Show metadata' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(queryByRole('region', { name: 'Message metadata' })).not.toBeInTheDocument();
    expect(validate).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Copy prompt' }));
    expect(writeText).toHaveBeenLastCalledWith(text);

    await fireEvent.click(toggle);
    const inspector = getByRole('region', { name: 'Message metadata' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(inspector.id).toBe(toggle.getAttribute('aria-controls'));
    expect(inspector.querySelector('code')).toHaveTextContent('# Keep this comment');
    expect(inspector.querySelector('code')).toHaveClass('language-yaml');
    expect(validate).toHaveBeenCalledOnce();
    expect(onDisclosureChange).toHaveBeenCalledWith(toggle, true);
    await fireEvent.click(within(inspector).getByRole('button', { name: 'Copy metadata' }));
    expect(writeText).toHaveBeenLastCalledWith(text.slice(0, text.indexOf('Visible body')));
    await fireEvent.click(getByRole('button', { name: 'Hide metadata' }));
    expect(queryByRole('region', { name: 'Message metadata' })).not.toBeInTheDocument();
  });

  it('shows invalid YAML as escaped source with a developer-only diagnostic', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    const text = '---\nkey: [broken\nhtml: <img src=x onerror=alert(1)>\n---\nVisible body';
    const { container, getByRole } = render(SessionTurn, { turn: metadataMessage(text) });
    expect(container).not.toHaveTextContent('YAML validation');
    await fireEvent.click(getByRole('button', { name: 'Show metadata' }));
    const inspector = getByRole('region', { name: 'Message metadata' });
    expect(inspector).toHaveTextContent('YAML validation:');
    expect(inspector.querySelector('code')?.textContent).toContain('key: [broken');
    expect(inspector.querySelector('img')).toBeNull();
    expect(container.querySelector('.session-message-user')).toHaveTextContent('Visible body');
  });

  it('closes metadata on developer-mode changes and when showing a different message', async () => {
    chatPreferencesStore.setDeveloperMode(true);
    const original = metadataMessage('---\nkey: value\n---\nBody');
    const { getByRole, queryByRole, rerender } = render(SessionTurn, { turn: original });
    await fireEvent.click(getByRole('button', { name: 'Show metadata' }));
    chatPreferencesStore.setDeveloperMode(false);
    await tick();
    expect(queryByRole('region', { name: 'Message metadata' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Show metadata' })).not.toBeInTheDocument();
    chatPreferencesStore.setDeveloperMode(true);
    await tick();
    expect(getByRole('button', { name: 'Show metadata' })).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(getByRole('button', { name: 'Show metadata' }));
    await rerender({ turn: { ...original, user: { ...original.user!, id: 'another-message' } } });
    expect(queryByRole('region', { name: 'Message metadata' })).not.toBeInTheDocument();
    expect(getByRole('button', { name: 'Show metadata' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('extracts a split prefix from the first text run while preserving attachments and later Markdown', () => {
    const text = '---\nkey: secret\n---\nVisible body';
    const message = metadataMessage(text);
    message.user!.blocks = [
      { type: 'image', data: 'aW1n', mimeType: 'image/png', name: 'photo.png' },
      { type: 'text', text: '---\nkey: sec' },
      { type: 'text', text: 'ret\n---\nVisible body' },
      { type: 'resource', uri: 'attachment:///notes.txt', mimeType: 'text/plain', name: 'notes.txt' },
      { type: 'text', text: '---\nlater: stays visible\n---\nMore body' }
    ];
    const { container, getByRole, getByText } = render(SessionTurn, { turn: message });
    expect(getByRole('button', { name: 'Open photo.png' })).toBeInTheDocument();
    expect(getByText('notes.txt')).toBeInTheDocument();
    expect(container.querySelector('.session-message-user')).toHaveTextContent('Visible body');
    expect(container.querySelector('.session-message-user')).toHaveTextContent('later: stays visible');
    expect(container.querySelector('.session-message-user')).not.toHaveTextContent('key: secret');
  });

  it('shows a neutral placeholder for metadata-only messages', () => {
    const { container, queryByRole, getByText } = render(SessionTurn, { turn: metadataMessage('---\nkey: secret\n---') });
    expect(getByText('No message body')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('key: secret');
    expect(queryByRole('button', { name: 'Show metadata' })).not.toBeInTheDocument();
  });

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

  it('keeps undo attached to a turn even when no response was recorded', async () => {
    const onUndo = vi.fn();
    const { getByRole, queryByRole } = render(SessionTurn, {
      turn: { ...turn, content: [] },
      undoAvailable: true,
      onUndo
    });

    await fireEvent.click(getByRole('button', { name: 'Undo to this prompt' }));

    expect(onUndo).toHaveBeenCalledWith('message-1');
    expect(queryByRole('button', { name: 'Redo this turn' })).not.toBeInTheDocument();
  });

  it('redos from the reverted turn when available', async () => {
    const onRedo = vi.fn();
    const { getByRole } = render(SessionTurn, { turn, reverted: true, redoAvailable: true, onRedo });

    await fireEvent.click(getByRole('button', { name: 'Redo this turn' }));

    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('keeps redo attached to a turn even when no response was recorded', async () => {
    const onRedo = vi.fn();
    const { getByRole } = render(SessionTurn, {
      turn: { ...turn, content: [] },
      reverted: true,
      redoAvailable: true,
      onRedo
    });

    await fireEvent.click(getByRole('button', { name: 'Redo this turn' }));

    expect(onRedo).toHaveBeenCalledOnce();
  });

  it('hides fork, undo, and redo when they are not actionable', () => {
    const { queryByRole } = render(SessionTurn, { turn, undoAvailable: false, forkAvailable: false, reverted: true });

    expect(queryByRole('button', { name: 'Fork into new session' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Undo to this prompt' })).not.toBeInTheDocument();
    expect(queryByRole('button', { name: 'Redo this turn' })).not.toBeInTheDocument();
  });

  it('summarizes changes from every work group in one diff pill after the duration', () => {
    const changedTurn: SessionConversationTurn = {
      ...turn,
      durationMs: 42000,
      settled: true,
      content: [
        {
          type: 'tool', id: 'edit', tool: {
            id: 'edit', title: 'Run edit', kind: 'edit', status: 'completed', result: 'OK added=3 deleted=2'
          }
        },
        ...turn.content,
        {
          type: 'tool', id: 'write', tool: {
            id: 'write', title: 'Run write_file', kind: 'edit', status: 'completed',
            arguments: '{"path":"new.ts","content":"hello\\nworld\\n"}',
            result: '{"path":"new.ts","bytes":12}'
          }
        }
      ]
    };
    const { getByRole, getByText, getAllByRole } = render(SessionTurn, { turn: changedTurn });

    const pill = getByRole('button', { name: 'Turn changes: 5 lines added, 2 lines deleted' });
    expect(getAllByRole('button', { name: /Turn changes:/ })).toHaveLength(1);
    expect(getByText('Worked for 42s').nextElementSibling).toBe(pill);
    expect(pill).toHaveTextContent('+5');
    expect(pill).toHaveTextContent('-2');
    expect(pill.querySelector('.lucide-diff')).toHaveAttribute('aria-hidden', 'true');
    expect(pill.lastElementChild).toHaveClass('lucide-arrow-up-right');
    expect(pill.lastElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(pill.querySelector('.session-tool-change-added')).toHaveTextContent('+5');
    expect(pill.querySelector('.session-tool-change-removed')).toHaveTextContent('-2');
    expect(pill.closest('.session-assistant-message-actions')).toBeInTheDocument();
  });

  it('toggles turn diffs through a borderless button without a native tooltip', async () => {
    const onToggleDiff = vi.fn();
    const changedTurn: SessionConversationTurn = {
      ...turn,
      content: [...turn.content, {
        type: 'tool', id: 'edit-completed', tool: {
          id: 'edit-completed', title: 'edit', kind: 'edit', status: 'completed', result: 'OK added=1 deleted=2'
        }
      }]
    };
    const { getByRole, rerender } = render(SessionTurn, {
      turn: changedTurn, diffOpen: false, diffPanelId: 'turn-panel', onToggleDiff
    });
    const button = getByRole('button', { name: 'Turn changes: 1 line added, 2 lines deleted' });
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const arrow = button.lastElementChild;
    expect(arrow).toHaveClass('lucide-arrow-up-right', 'session-turn-diff-pill-arrow');
    await fireEvent.click(button);
    expect(onToggleDiff).toHaveBeenCalledTimes(1);

    await rerender({ turn: changedTurn, diffOpen: true, diffPanelId: 'turn-panel', onToggleDiff });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'turn-panel');
    expect(button.lastElementChild).toBe(arrow);
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const activeArrowRule = appCss.match(/\.session-turn-diff-pill\[aria-expanded='true'\] \.session-turn-diff-pill-arrow\s*\{([^}]+)\}/)?.[1];
    expect(activeArrowRule).toContain('color: var(--accent);');
    expect(activeArrowRule).toContain('transform: rotate(180deg);');
    const arrowRule = appCss.match(/\.session-turn-diff-pill-arrow\s*\{([^}]+)\}/)?.[1];
    expect(arrowRule).toContain('transform: rotate(0deg);');
    expect(arrowRule).toContain('transition: transform 0.16s ease, color 0.16s ease;');
    expect(appCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.session-turn-diff-pill-arrow\s*\{\s*transition: none;/);
    await fireEvent.click(button);
    expect(onToggleDiff).toHaveBeenCalledTimes(2);

    await rerender({ turn: changedTurn, diffOpen: false, diffPanelId: 'turn-panel', onToggleDiff });
    expect(button.lastElementChild).toBe(arrow);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('preloads the renderer on pointer intent and keyboard focus without opening the panel', async () => {
    preloadSessionToolPatchDiff.mockClear();
    const onToggleDiff = vi.fn();
    const onPreloadDiff = vi.fn();
    const changedTurn: SessionConversationTurn = {
      ...turn,
      content: [{ type: 'tool', id: 'edit', tool: {
        id: 'edit', title: 'edit', kind: 'edit', status: 'completed', result: 'OK added=1 deleted=1'
      } }]
    };
    const { getByRole } = render(SessionTurn, { turn: changedTurn, onToggleDiff, onPreloadDiff });
    const pill = getByRole('button', { name: 'Turn changes: 1 line added, 1 line deleted' });
    expect(preloadSessionToolPatchDiff).not.toHaveBeenCalled();
    await fireEvent.pointerEnter(pill);
    expect(preloadSessionToolPatchDiff).toHaveBeenCalledTimes(1);
    await fireEvent.focus(pill);
    expect(preloadSessionToolPatchDiff).toHaveBeenCalledTimes(2);
    expect(onPreloadDiff).toHaveBeenCalledTimes(2);
    expect(onToggleDiff).not.toHaveBeenCalled();
    expect(pill).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([1, 2])('shows only a bare count for %i distinct files inside the diff pill', async (fileCount) => {
    const changedTurn: SessionConversationTurn = {
      ...turn,
      content: [
        { type: 'tool', id: 'first', tool: {
          id: 'first', title: 'Run edit', kind: 'edit', status: 'completed',
          arguments: '{"path":"a.ts","oldString":"one","newString":"two"}',
          result: 'OK added=1 deleted=1'
        } },
        { type: 'tool', id: 'second', tool: {
          id: 'second', title: 'Run write_file', kind: 'edit', status: 'completed',
          arguments: JSON.stringify({ path: fileCount === 1 ? 'a.ts' : 'b.ts', content: 'hello\nworld\n' })
        } }
      ]
    };
    const { getByRole, queryByRole } = render(SessionTurn, { turn: changedTurn });
    const button = getByRole('button', {
      name: `Turn changes: 3 lines added, 1 line deleted, ${fileCount} ${fileCount === 1 ? 'file' : 'files'} changed`
    });
    const count = button.querySelector('.session-turn-diff-pill-files')!;
    expect(count.textContent).toBe(String(fileCount));
    expect(count.previousElementSibling).toHaveClass('lucide-diff');
    expect(button.textContent?.trim()).toBe(`${fileCount} +3 -1`);
    expect(button.lastElementChild).toHaveClass('lucide-arrow-up-right');
    button.focus();
    await fireEvent.pointerEnter(button);
    expect(queryByRole('tooltip')).toBeNull();
    expect(button).not.toHaveAttribute('data-tooltip-trigger');
    expect(button).not.toHaveAttribute('title');
  });

  it('shows only the line totals when the changed file paths are unavailable', async () => {
    const changedTurn: SessionConversationTurn = {
      ...turn,
      content: [{ type: 'tool', id: 'receipt', tool: {
        id: 'receipt', title: 'Run edit', kind: 'edit', status: 'completed', result: 'OK added=2 deleted=1'
      } }]
    };
    const { getByRole, queryByRole } = render(SessionTurn, { turn: changedTurn });
    const button = getByRole('button', { name: 'Turn changes: 2 lines added, 1 line deleted' });
    expect(button.querySelector('.session-turn-diff-pill-files')).toBeNull();
    expect(button.textContent?.trim()).toBe('+2 -1');
    button.focus();
    await fireEvent.pointerEnter(button);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('hides the diff pill when the turn contains no completed changes', () => {
    const { getByText, queryByRole } = render(SessionTurn, { turn: { ...turn, durationMs: 2000, settled: true } });

    expect(getByText('Worked for 2s')).toBeInTheDocument();
    expect(queryByRole('button', { name: /Turn changes:/ })).toBeNull();
  });

  it('updates the pill as tools complete even without a duration', async () => {
    const pendingTool = {
      id: 'write', title: 'Run write_file', kind: 'edit', status: 'in_progress' as const,
      arguments: '{"path":"new.ts","content":"hello\\n"}'
    };
    const activeTurn: SessionConversationTurn = {
      ...turn,
      settled: false,
      content: [{ type: 'tool', id: 'write', tool: pendingTool }]
    };
    const { queryByRole, getByRole, queryByText, rerender } = render(SessionTurn, { turn: activeTurn });
    expect(queryByRole('button', { name: /Turn changes:/ })).toBeNull();

    await rerender({ turn: {
      ...activeTurn,
      content: [{ type: 'tool', id: 'write', tool: { ...pendingTool, status: 'completed' } }]
    } });
    expect(getByRole('button', { name: 'Turn changes: 1 line added, 0 lines deleted, 1 file changed' })).toHaveTextContent('1 +1 -0');
    expect(queryByText(/Worked for/)).toBeNull();
  });

  it('keeps the diff pill borderless and uses a subtle surface', () => {
    const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const pillRule = appCss.match(/\.session-turn-diff-pill\s*\{([^}]+)\}/)?.[1];
    expect(pillRule).toMatch(/border:\s*0\s*;/);
    expect(pillRule).toMatch(/border-radius:\s*999px\s*;/);
    expect(pillRule).toMatch(/background:\s*var\(--icon-surface\)\s*;/);
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

  it('keeps failed tool calls inside collapsed previous work entries', async () => {
    const activeTurn: SessionConversationTurn = {
      id: 'turn-failed-history',
      forkMessageId: null,
      content: [
        {
          type: 'tool',
          id: 'tool-failed',
          tool: {
            id: 'tool-failed',
            title: 'read_tool',
            status: 'failed',
            kind: 'read_tool'
          }
        },
        {
          type: 'reasoning',
          id: 'reasoning-1',
          html: '<p>Older thought</p>',
          isLive: false
        },
        {
          type: 'tool',
          id: 'tool-ok',
          tool: {
            id: 'tool-ok',
            title: 'search',
            status: 'completed',
            kind: 'search'
          }
        },
        {
          type: 'reasoning',
          id: 'reasoning-2',
          html: '<p>Latest thought</p>',
          isLive: true
        },
        {
          type: 'tool',
          id: 'tool-latest',
          tool: {
            id: 'tool-latest',
            title: 'edit',
            status: 'in_progress',
            kind: 'edit'
          }
        }
      ],
      settled: false
    };

    const { getByRole, getByText, queryByText } = render(SessionTurn, { turn: activeTurn });

    expect(getByRole('button', { name: '+3 previous work entries' })).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Read file')).not.toBeInTheDocument();
    expect(queryByText('Older thought')).not.toBeInTheDocument();
    expect(getByRole('region', { name: 'Agent work' }).querySelector('.session-reasoning-preview')).toHaveTextContent('Latest thought');
    expect(getByText('Edit file')).toBeInTheDocument();

    await fireEvent.click(getByRole('button', { name: '+3 previous work entries' }));
    expect(getByRole('button', { name: 'Show fewer work entries' })).toHaveAttribute('aria-expanded', 'true');
    expect(getByText('Read file')).toBeInTheDocument();
    expect(getByRole('region', { name: 'Agent work' })).toHaveTextContent('Older thought');
  });

  it('shows the failed work count only in developer mode', async () => {
    const { getByRole, queryByText } = render(SessionTurn, { turn: { ...turn, settled: true } });

    expect(getByRole('button', { name: 'Worked through 2 tool calls and 2 reasoning steps' })).toBeInTheDocument();
    expect(queryByText('1 failed')).not.toBeInTheDocument();

    chatPreferencesStore.setDeveloperMode(true);
    await tick();

    expect(getByRole('button', { name: 'Worked through 2 tool calls and 2 reasoning steps, 1 failed' })).toBeInTheDocument();
    expect(queryByText('1 failed')).toBeInTheDocument();
  });

  it('collapses consecutive reasoning summaries into one disclosure and previews the latest', async () => {
    const consecutiveTurn: SessionConversationTurn = {
      id: 'turn-summaries',
      forkMessageId: 'assistant-summaries',
      user: {
        id: 'user-summaries',
        messageId: 'message-summaries',
        html: '<p>plan</p>',
        text: 'plan'
      },
      content: [
        {
          type: 'reasoning',
          id: 'reasoning-1',
          html: '<p>Inspecting the codec</p>',
          text: 'Inspecting the codec',
          isLive: false,
          summary: true
        },
        {
          type: 'reasoning',
          id: 'reasoning-2',
          html: '<p>Checking tests</p>',
          text: 'Checking tests',
          isLive: false,
          summary: true
        },
        {
          type: 'tool',
          id: 'tool-1',
          tool: {
            id: 'tool-1',
            title: 'read_tool',
            status: 'completed',
            kind: 'read_tool'
          }
        },
        {
          type: 'assistant',
          id: 'assistant-summaries',
          messageId: 'assistant-summaries',
          html: '<p>Done.</p>',
          text: 'Done.',
          relatedEvents: []
        }
      ],
      settled: true
    };

    const { container, getByRole } = render(SessionTurn, { turn: consecutiveTurn });
    await fireEvent.click(getByRole('button', { name: /Worked through 1 tool call and 2 reasoning steps/ }));

    const workItems = Array.from(container.querySelector('.session-work-list')?.children ?? []);
    expect(workItems).toHaveLength(2);
    expect(workItems[0].tagName).toBe('DETAILS');
    expect(workItems[0]).toHaveClass('session-reasoning');
    expect(workItems[0].querySelector('.session-reasoning-preview')).toHaveTextContent('Checking tests');
    expect(Array.from(workItems[0].querySelectorAll('.session-reasoning-summary-item')).map((item) => item.textContent)).toEqual([
      '- Inspecting the codec',
      '- Checking tests'
    ]);
    expect(workItems[1]).toHaveTextContent('Read file');
  });

  it('renders summary markdown instead of showing raw emphasis markers', async () => {
    const markdownTurn: SessionConversationTurn = {
      id: 'turn-markdown-summaries',
      forkMessageId: 'assistant-markdown-summaries',
      content: [
        {
          type: 'reasoning',
          id: 'reasoning-1',
          html: '<p><strong>Verifying tool call distribution</strong></p>',
          text: '**Verifying tool call distribution**',
          isLive: false,
          summary: true
        },
        {
          type: 'reasoning',
          id: 'reasoning-2',
          html: '<p><strong>Planning batch reading of OpenSpec artifacts</strong></p>',
          text: '**Planning batch reading of OpenSpec artifacts**',
          isLive: false,
          summary: true
        }
      ],
      settled: true
    };

    const { container, getByRole } = render(SessionTurn, { turn: markdownTurn });
    await fireEvent.click(getByRole('button', { name: /Worked through 2 reasoning steps/ }));

    const reasoning = container.querySelector('.session-reasoning');
    expect(reasoning?.querySelector('.session-reasoning-preview')).toHaveTextContent(
      'Planning batch reading of OpenSpec artifacts'
    );
    expect(reasoning?.textContent).not.toContain('**');
    expect(Array.from(reasoning?.querySelectorAll('.session-reasoning-summary-item') ?? []).map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '- Verifying tool call distribution',
      '- Planning batch reading of OpenSpec artifacts'
    ]);
    expect(reasoning?.querySelectorAll('.session-reasoning-summary-markdown strong')).toHaveLength(2);
  });

  it('does not let a single reasoning summary expand', async () => {
    const singleSummaryTurn: SessionConversationTurn = {
      id: 'turn-single-summary',
      forkMessageId: 'assistant-single-summary',
      content: [
        {
          type: 'reasoning',
          id: 'reasoning-1',
          html: '<p>Checking tests</p>',
          text: 'Checking tests',
          isLive: false,
          summary: true
        },
        {
          type: 'tool',
          id: 'tool-1',
          tool: {
            id: 'tool-1',
            title: 'read_tool',
            status: 'completed',
            kind: 'read_tool'
          }
        }
      ],
      settled: true
    };

    const { container, getByRole } = render(SessionTurn, { turn: singleSummaryTurn });
    await fireEvent.click(getByRole('button', { name: /Worked through 1 tool call and 1 reasoning step/ }));

    const reasoning = container.querySelector('.session-reasoning');
    expect(reasoning).not.toBeNull();
    expect(reasoning?.tagName).toBe('DIV');
    expect(reasoning).toHaveClass('session-reasoning-static');
    expect(reasoning?.querySelector('.session-reasoning-preview')).toHaveTextContent('Checking tests');
    expect(reasoning?.querySelector('.session-reasoning-disclosure')).toBeNull();
    expect(container.querySelector('details.session-reasoning')).toBeNull();
  });

  it('keeps consecutive ordinary reasoning blocks as separate disclosures', async () => {
    const ordinaryTurn: SessionConversationTurn = {
      id: 'turn-ordinary-reasoning',
      forkMessageId: 'assistant-ordinary',
      content: [
        {
          type: 'reasoning',
          id: 'reasoning-1',
          html: '<p>First thought</p>',
          text: 'First thought',
          isLive: false
        },
        {
          type: 'reasoning',
          id: 'reasoning-2',
          html: '<p>Second thought</p>',
          text: 'Second thought',
          isLive: false
        }
      ],
      settled: true
    };

    const { container, getByRole } = render(SessionTurn, { turn: ordinaryTurn });
    await fireEvent.click(getByRole('button', { name: /Worked through 2 reasoning steps/ }));

    const workItems = Array.from(container.querySelector('.session-work-list')?.children ?? []);
    expect(workItems).toHaveLength(2);
    expect(workItems[0].tagName).toBe('DETAILS');
    expect(workItems[1].tagName).toBe('DETAILS');
    expect(container.querySelectorAll('.session-reasoning-summary-item')).toHaveLength(0);
  });
});
