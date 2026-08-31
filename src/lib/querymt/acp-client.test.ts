import { describe, expect, it, vi } from 'vitest';
import { DesktopAcpClient } from './acp-client';

const beginSessionReplay = vi.fn(() => ({ sessionId: 'session-1', notifications: [] }));
const completeSessionReplay = vi.fn(() => []);
const abortSessionReplay = vi.fn();
vi.mock('./browser-client', () => ({
  BrowserClient: class {
    beginSessionReplay = beginSessionReplay;
    completeSessionReplay = completeSessionReplay;
    abortSessionReplay = abortSessionReplay;
  }
}));

describe('DesktopAcpClient session metadata', () => {
  it('includes the desktop session-load operation id in ACP metadata', async () => {
    const client = new DesktopAcpClient({ id: 'agent-1', name: 'Agent', transport: 'stdio', commandLine: 'agent', enabled: true, autoStart: true });
    const loadSession = vi.fn(async () => ({ configOptions: [] }));
    (client as unknown as { connection: { loadSession: typeof loadSession } }).connection = { loadSession };

    await expect(client.loadSession('session-1', '/tmp/work', 'operation-1')).resolves.toEqual({
      response: { configOptions: [] },
      replay: []
    });
    expect(beginSessionReplay).toHaveBeenCalledWith('session-1');
    expect(completeSessionReplay).toHaveBeenCalledTimes(1);
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      cwd: '/tmp/work',
      mcpServers: [],
      _meta: { querymt: { session_load_operation_id: 'operation-1' } }
    });
  });

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
