import { describe, expect, it, vi } from 'vitest';
import { DesktopAcpClient } from './acp-client';

vi.mock('./browser-client', () => ({ BrowserClient: vi.fn() }));

describe('DesktopAcpClient forkSession', () => {
  it('uses native ACP fork with QueryMT historical message metadata', async () => {
    const client = new DesktopAcpClient({ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'agent', enabled: true, autoStart: true });
    const unstable_forkSession = vi.fn(async () => ({ sessionId: 'fork-1' }));
    (client as unknown as { connection: { unstable_forkSession: typeof unstable_forkSession } }).connection = { unstable_forkSession };

    await expect(client.forkSession('source-1', '/tmp/work', 'assistant-2')).resolves.toEqual({ sessionId: 'fork-1' });
    expect(unstable_forkSession).toHaveBeenCalledWith({
      sessionId: 'source-1',
      cwd: '/tmp/work',
      mcpServers: [],
      _meta: { querymt: { message_id: 'assistant-2' } }
    });
  });
});
