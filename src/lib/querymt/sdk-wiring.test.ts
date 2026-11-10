import { describe, expect, it, vi } from 'vitest';
import { agent, client, type AgentConnection } from '@agentclientprotocol/sdk/unstable';

// Exercises the handler wiring DesktopAcpClient uses against the real SDK, so
// schema validation (including compaction updates) is not mocked away.
describe('ACP SDK wiring', () => {
  it('delivers compaction updates and extension notifications, and serves extension requests', async () => {
    const sessionUpdates: Array<Record<string, unknown>> = [];
    const extNotifications: Array<{ method: string; params: unknown }> = [];
    const capabilities = vi.fn();
    let agentSide!: AgentConnection;

    const agentApp = agent()
      .onConnect((connection) => { agentSide = connection; })
      .onRequest('initialize', ({ params }) => {
        capabilities(params.clientCapabilities);
        return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
      })
      .onRequest('_querymt/capabilities', (value: unknown) => value, () => ({ querymt_control_version: 1 }));

    const clientApp = client()
      .onNotification('session/update', ({ params }) => { sessionUpdates.push(params.update as Record<string, unknown>); })
      .onNotification('*', ({ method, params }) => { extNotifications.push({ method, params }); });

    const connection = clientApp.connect(agentApp);
    await connection.agent.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { session: { compaction: {} } }
    });
    expect(capabilities).toHaveBeenCalledWith(expect.objectContaining({ session: { compaction: {} } }));

    await agentSide.client.notify('session/update', {
      sessionId: 's1',
      update: { sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' }
    });
    await agentSide.client.notify('session/update', {
      sessionId: 's1',
      update: { sessionUpdate: 'compaction_summary_chunk', compactionId: 'c1', content: { type: 'text', text: 'hi' } }
    });
    await agentSide.client.notify('_querymt/session/runtimeChanged', { session_id: 's1' });

    await vi.waitFor(() => expect(sessionUpdates).toHaveLength(2));
    expect(sessionUpdates[0]).toMatchObject({ sessionUpdate: 'compaction_update', compactionId: 'c1', status: 'in_progress' });
    expect(sessionUpdates[1]).toMatchObject({ sessionUpdate: 'compaction_summary_chunk', content: { text: 'hi' } });
    await vi.waitFor(() => expect(extNotifications).toEqual([
      { method: '_querymt/session/runtimeChanged', params: { session_id: 's1' } }
    ]));

    const response = await connection.agent.request<{ querymt_control_version: number }, Record<string, unknown>>(
      '_querymt/capabilities', {}
    );
    expect(response.querymt_control_version).toBe(1);
    connection.close();
  });
});
