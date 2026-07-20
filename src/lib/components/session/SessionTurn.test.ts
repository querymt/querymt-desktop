import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionConversationTurn } from '$lib/domain/session-conversation';
import SessionTurn from './SessionTurn.svelte';

const turn: SessionConversationTurn = {
  id: 'turn-1',
  user: {
    id: 'user-1',
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
      html: '<p>Implemented the fix.</p>',
      text: 'Implemented the fix.',
      relatedEvents: []
    }
  ]
};

afterEach(cleanup);

describe('SessionTurn', () => {
  it('renders reasoning, tools, and assistant text in content order', () => {
    const { container } = render(SessionTurn, { turn });
    const orderedText = Array.from(container.querySelector('.session-turn-content')?.children ?? []).map((element) =>
      element.textContent?.replace(/\s+/g, ' ').trim()
    );

    expect(orderedText).toHaveLength(5);
    expect(orderedText[0]).toContain('Inspecting components');
    expect(orderedText[1]).toContain('read_tool');
    expect(orderedText[2]).toContain('Preparing the fix');
    expect(orderedText[3]).toContain('edit');
    expect(orderedText[4]).toContain('Implemented the fix.');
  });

  it('keeps all reasoning and tool disclosures collapsed by default regardless of status', () => {
    const { container } = render(SessionTurn, { turn });
    const details = Array.from(container.querySelectorAll('details'));

    expect(details).toHaveLength(4);
    expect(details.every((element) => !element.open)).toBe(true);
  });

  it('allows each technical entry to be expanded independently', async () => {
    const { container } = render(SessionTurn, { turn });
    const details = Array.from(container.querySelectorAll('details'));
    const firstSummary = details[0].querySelector('summary');

    expect(firstSummary).not.toBeNull();
    await fireEvent.click(firstSummary!);

    expect(details[0].open).toBe(true);
    expect(details.slice(1).every((element) => !element.open)).toBe(true);
  });
});
