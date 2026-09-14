import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopAcpClient } from './acp-client';
import { createWebSocketAcpStream } from './transport';

/** Provides a controllable in-memory WebSocket for transport contract tests. */
class MockWebSocket extends EventTarget {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  static respond: ((socket: MockWebSocket, message: string) => void) | null = null;
  readyState = 0;
  sent: string[] = [];

  /** Opens asynchronously to mirror the browser WebSocket lifecycle. */
  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  /** Records an outgoing frame and forwards it to the configured test responder. */
  send(message: string) {
    this.sent.push(message);
    MockWebSocket.respond?.(this, message);
  }

  /** Transitions the mock socket to closed and emits its close event. */
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  /** Delivers a raw incoming frame to WebSocket message listeners. */
  receive(message: string) {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

afterEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.respond = null;
  vi.unstubAllGlobals();
});

describe('createWebSocketAcpStream', () => {
  it('reports an unexpected socket close once', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const onDisconnect = vi.fn();
    await createWebSocketAcpStream('ws://127.0.0.1:3030/ws', onDisconnect);
    const socket = MockWebSocket.instances.at(-1)!;

    socket.close();
    socket.dispatchEvent(new Event('error'));

    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledWith(expect.stringContaining('WebSocket closed'));
  });

  it('forwards backend-wire mixed prompt payloads without transforming blocks or metadata', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = await createWebSocketAcpStream('ws://127.0.0.1:3030/ws');
    const socket = MockWebSocket.instances.at(-1)!;
    const payload = {
      jsonrpc: '2.0' as const,
      id: 42,
      method: 'session/prompt' as const,
      params: {
        sessionId: 'session-1',
        prompt: [
          { type: 'text', text: 'Inspect these files' },
          { type: 'image', data: 'aW1n', mimeType: 'image/png', _meta: { querymt: { filename: 'photo.png' } } },
          {
            type: 'resource',
            resource: { uri: 'attachment:///pdf-1/report.pdf', blob: 'cGRm', mimeType: 'application/pdf' },
            _meta: { querymt: { filename: 'report.pdf' } }
          },
          {
            type: 'resource',
            resource: { uri: 'attachment:///file-1/data.bin', blob: 'Ymlu', mimeType: 'application/octet-stream' },
            _meta: { querymt: { filename: 'data.bin' } }
          }
        ],
        _meta: { querymt: { client_prompt_id: 'client-wire-1' } }
      }
    };

    const writer = stream.writable.getWriter();
    await writer.write(payload);

    expect(socket.sent).toEqual([JSON.stringify(payload)]);
    expect(JSON.parse(socket.sent[0])).toEqual(payload);
  });

  it('delivers a raw extension frame through DesktopAcpClient with a canonical method', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const client = new DesktopAcpClient({
      id: 'agent-1',
      name: 'Agent',
      transport: 'websocket',
      commandLine: '',
      websocketUrl: '127.0.0.1:3030',
      enabled: true,
      autoStart: true
    });
    const callback = vi.fn();
    client.onExtensionNotification(callback);
    MockWebSocket.respond = (socket, raw) => {
      const request = JSON.parse(raw) as { id: number; method: string };
      if (request.method === 'initialize') {
        queueMicrotask(() => socket.receive(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] }
        })));
      } else if (request.method === '_querymt/capabilities') {
        queueMicrotask(() => socket.receive(JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            querymt_control_version: 1,
            agent: { id: 'agent-1', display_name: 'Agent', kind: 'local', version: '1' },
            transport: { acp: true, stdio: false, websocket: true, mesh: false },
            features: {},
            methods: [],
            notifications: ['querymt/session/delegationUpdate']
          }
        })));
      }
    };
    await client.connect();
    const socket = MockWebSocket.instances[0];
    const params = {
      version: 1,
      sessionId: 'session-1',
      delegationId: 'delegation-1',
      toolCallId: 'call_051b11680c804b03a8243580',
      state: 'requested',
      targetAgentId: 'linus',
      objective: 'Review the current bearer-auth diff',
      requestedAt: 1789350676,
      updatedAt: 1789350676
    };

    socket.receive(JSON.stringify({
      jsonrpc: '2.0',
      method: 'querymt/session/delegationUpdate',
      params
    }));

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({
      method: 'querymt/session/delegationUpdate',
      params
    }));
    await client.disconnect();
  });

  it('sends JSON-RPC messages and exposes incoming frames', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = await createWebSocketAcpStream('ws://127.0.0.1:3030/ws');
    const socket = MockWebSocket.instances.at(-1)!;

    const writer = stream.writable.getWriter();
    await writer.write({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(socket.sent).toEqual(['{"jsonrpc":"2.0","id":1,"method":"initialize"}']);

    const reader = stream.readable.getReader();
    socket.receive('{"jsonrpc":"2.0","method":"session/update","params":{}}');
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: { jsonrpc: '2.0', method: 'session/update', params: {} }
    });
  });
});
