import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk';

export async function createTauriAcpStream(agentId: string): Promise<Stream> {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  let pendingOutput = '';
  let closed = false;
  let stdoutGeneration: number | null = null;
  let attachPromise: Promise<number> | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const detachStdout = async () => {
    closed = true;
    pendingOutput = '';
    try {
      const generation = stdoutGeneration ?? (attachPromise ? await attachPromise : null);
      if (generation == null) return;
      stdoutGeneration = generation;
      await invoke('querymt_agent_detach_stdout', { agentId, generation });
    } catch {
      // Teardown still completes if the backend process is already gone.
    }
  };

  const input = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (closed) return;
      const channel = new Channel<string>((line) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${line}\n`));
      });
      attachPromise = invoke<number>('querymt_agent_attach_stdout', {
        agentId,
        channel
      });
      stdoutGeneration = await attachPromise;
      if (closed) {
        await detachStdout();
      }
    },
    async cancel() {
      await detachStdout();
    }
  });

  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      pendingOutput += decoder.decode(chunk, { stream: true });
      const lines = pendingOutput.split('\n');
      pendingOutput = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          await invoke('querymt_agent_write_acp_line', { request: { agentId, line } });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to forward ACP line to Tauri: ${detail}`);
        }
      }
    },
    async close() {
      const tail = pendingOutput.trim();
      try {
        if (tail) {
          await invoke('querymt_agent_write_acp_line', { request: { agentId, line: tail } });
        }
      } finally {
        await detachStdout();
      }
    },
    async abort() {
      await detachStdout();
    }
  });

  return ndJsonStream(output, input);
}
