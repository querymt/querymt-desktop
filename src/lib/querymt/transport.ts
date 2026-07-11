import { Channel, invoke } from '@tauri-apps/api/core';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';
import type { AnyMessage } from '@agentclientprotocol/sdk/dist/jsonrpc.js';

export async function createTauriAcpStream(agentId: string): Promise<Stream> {
  let pendingOutput = '';
  let closed = false;
  let stdoutChannel: Channel<string> | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const input = new ReadableStream<Uint8Array>({
    async start(controller) {
      stdoutChannel = new Channel<string>((line) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(`${line}\n`));
      });

      await invoke('querymt_agent_attach_stdout', { agentId, channel: stdoutChannel });
    },
    cancel() {
      closed = true;
      stdoutChannel = null;
    }
  });

  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      pendingOutput += decoder.decode(chunk, { stream: true });
      const lines = pendingOutput.split('\n');
      pendingOutput = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        try {
          await invoke('querymt_agent_write_acp_line', {
            request: {
              agentId,
              line
            }
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to forward ACP line to Tauri: ${detail}`);
        }
      }
    },
    async close() {
      const tail = pendingOutput.trim();
      if (tail) {
        await invoke('querymt_agent_write_acp_line', {
          request: {
            agentId,
            line: tail
          }
        });
      }
      closed = true;
      stdoutChannel = null;
      pendingOutput = '';
    },
    abort() {
      closed = true;
      stdoutChannel = null;
      pendingOutput = '';
    }
  });

  return ndJsonStream(output, input);
}

export async function createWebSocketAcpStream(
  url: string,
  onDisconnect?: (reason: string) => void
): Promise<Stream> {
  const socket = await openWebSocket(url);
  let closed = false;
  let notified = false;
  const notifyDisconnect = (reason: string) => {
    if (closed || notified) return;
    notified = true;
    onDisconnect?.(reason);
  };

  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      socket.addEventListener('message', (event) => {
        if (closed || typeof event.data !== 'string') return;
        try {
          controller.enqueue(JSON.parse(event.data) as AnyMessage);
        } catch {
          const error = new Error('ACP WebSocket received invalid JSON-RPC payload.');
          notifyDisconnect(error.message);
          controller.error(error);
        }
      });
      socket.addEventListener('close', (event) => {
        if (closed) return;
        const detail = event.reason ? `WebSocket closed: ${event.reason}` : `WebSocket closed (code ${event.code}).`;
        notifyDisconnect(detail);
        closed = true;
        controller.close();
      });
      socket.addEventListener('error', () => {
        if (closed || notified) return;
        const error = new Error('ACP WebSocket connection failed.');
        notifyDisconnect(error.message);
        closed = true;
        controller.error(error);
      });
    },
    cancel() {
      closed = true;
      socket.close();
    }
  });

  const writable = new WritableStream<AnyMessage>({
    write(message) {
      if (closed || socket.readyState !== WebSocket.OPEN) {
        const error = new Error('ACP WebSocket is not connected.');
        notifyDisconnect(error.message);
        throw error;
      }
      socket.send(JSON.stringify(message));
    },
    close() {
      closed = true;
      socket.close();
    },
    abort() {
      closed = true;
      socket.close();
    }
  });

  return { readable, writable };
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('error', handleError);
    };
    const handleOpen = () => {
      cleanup();
      resolve(socket);
    };
    const handleError = () => {
      cleanup();
      socket.close();
      reject(new Error(`Unable to connect to ACP WebSocket at ${url}.`));
    };
    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('error', handleError, { once: true });
  });
}
