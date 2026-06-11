import { Channel, invoke } from '@tauri-apps/api/core';
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';

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
