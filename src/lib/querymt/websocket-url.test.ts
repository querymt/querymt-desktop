import { describe, expect, it } from 'vitest';
import { acpWebSocketUrl, embeddedAcpWebSocketUrl, normalizeAcpWebSocketEndpoint, usesSecureWebSocket } from './websocket-url';

describe('normalizeAcpWebSocketEndpoint', () => {
  it.each([
    ['127.0.0.1:3030', '127.0.0.1:3030'],
    ['ws://127.0.0.1:3030', '127.0.0.1:3030'],
    ['ws://127.0.0.1:3030/ws', '127.0.0.1:3030'],
    ['wss://agent.example/acp/ws', 'agent.example'],
    ['ws://[::1]:3030/acp/ws', '[::1]:3030']
  ])('normalizes %s to a host and port', (input, expected) => {
    expect(normalizeAcpWebSocketEndpoint(input)).toBe(expected);
  });

  it.each([
    'https://agent.example/acp/ws',
    'ws://user:secret@agent.example/acp/ws',
    'ws://agent.example/acp/ws?token=secret',
    'ws://agent.example/acp/ws#fragment',
    'ws://agent.example/custom/path'
  ])('rejects unsupported or unsafe address %s', (input) => {
    expect(() => normalizeAcpWebSocketEndpoint(input)).toThrow();
  });
});

describe('acpWebSocketUrl', () => {
  it('adds transport details only when opening the connection', () => {
    expect(acpWebSocketUrl('127.0.0.1:42069')).toBe('ws://127.0.0.1:42069/acp/ws');
    expect(acpWebSocketUrl('agent.example', true)).toBe('wss://agent.example/acp/ws');
    expect(usesSecureWebSocket('wss://agent.example/acp/ws')).toBe(true);
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
