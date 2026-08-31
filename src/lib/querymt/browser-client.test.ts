import { describe, expect, it, vi } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { BrowserClient } from './browser-client';

function notification(sessionId: string, text: string): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      messageId: `message-${text}`,
      content: { type: 'text', text }
    }
  };
}

describe('BrowserClient replay capture', () => {
  it('captures load replay without invoking reactive handlers', async () => {
    const client = new BrowserClient();
    const handler = vi.fn();
    client.onSessionUpdate(handler);
    const capture = client.beginSessionReplay('session-1');

    await client.sessionUpdate(notification('session-1', 'historical'));
    await client.sessionUpdate(notification('session-2', 'unrelated'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.completeSessionReplay(capture)).toEqual([notification('session-1', 'historical')]);
  });

  it('captures concurrent loads independently by session', async () => {
    const client = new BrowserClient();
    const first = client.beginSessionReplay('session-1');
    const second = client.beginSessionReplay('session-2');

    await client.sessionUpdate(notification('session-2', 'second'));
    await client.sessionUpdate(notification('session-1', 'first'));

    expect(client.completeSessionReplay(first)).toEqual([notification('session-1', 'first')]);
    expect(client.completeSessionReplay(second)).toEqual([notification('session-2', 'second')]);
  });

  it('delivers post-response updates normally after capture completes', async () => {
    const client = new BrowserClient();
    const handler = vi.fn();
    client.onSessionUpdate(handler);
    const capture = client.beginSessionReplay('session-1');
    client.completeSessionReplay(capture);

    await client.sessionUpdate(notification('session-1', 'live'));
    expect(handler).toHaveBeenCalledWith(notification('session-1', 'live'));
  });
});
