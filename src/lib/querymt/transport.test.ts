import { describe, expect, it, vi } from 'vitest';
import { createWebSocketAcpStream } from './transport';

class MockWebSocket extends EventTarget {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];

  constructor(readonly url: string) {
    super();
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  receive(message: string) {
    this.dispatchEvent(new MessageEvent('message', { data: message }));
  }
}

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
