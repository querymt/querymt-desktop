import { describe, expect, it } from 'vitest';
import { embeddedAcpWebSocketUrl, normalizeAcpWebSocketUrl } from './websocket-url';

describe('normalizeAcpWebSocketUrl', () => {
  it.each([
    ['127.0.0.1:3030', 'ws://127.0.0.1:3030/acp/ws'],
    ['ws://127.0.0.1:3030', 'ws://127.0.0.1:3030/acp/ws'],
    ['ws://127.0.0.1:3030/ws', 'ws://127.0.0.1:3030/acp/ws'],
    ['wss://agent.example/acp/ws', 'wss://agent.example/acp/ws'],
    ['ws://[::1]:3030/acp/ws', 'ws://[::1]:3030/acp/ws']
  ])('normalizes %s', (input, expected) => {
    expect(normalizeAcpWebSocketUrl(input)).toBe(expected);
  });

  it.each([
    'https://agent.example/acp/ws',
    'ws://user:secret@agent.example/acp/ws',
    'ws://agent.example/acp/ws?token=secret',
    'ws://agent.example/acp/ws#fragment'
  ])('rejects unsupported or unsafe URL %s', (input) => {
    expect(() => normalizeAcpWebSocketUrl(input)).toThrow();
  });
});

describe('embeddedAcpWebSocketUrl', () => {
  it('uses same-origin ACP over WebSocket', () => {
    expect(embeddedAcpWebSocketUrl({ protocol: 'http:', host: 'localhost:3000' } as Location)).toBe(
      'ws://localhost:3000/acp/ws'
    );
    expect(embeddedAcpWebSocketUrl({ protocol: 'https:', host: 'qmt.example' } as Location)).toBe(
      'wss://qmt.example/acp/ws'
    );
  });
});
