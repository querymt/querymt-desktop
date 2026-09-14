import { describe, expect, it } from 'vitest';
import { createEmbeddedAgentConfig, EMBEDDED_AGENT_ID } from './embedded-agent';

describe('createEmbeddedAgentConfig', () => {
  it('creates a fixed host-managed same-origin agent', () => {
    expect(createEmbeddedAgentConfig({ protocol: 'https:', host: 'qmt.example:8443' } as Location)).toEqual({
      id: EMBEDDED_AGENT_ID,
      name: 'QMTCODE',
      transport: 'websocket',
      commandLine: '',
      websocketUrl: 'wss://qmt.example:8443/acp/ws',
      enabled: true,
      autoStart: true
    });
  });
});
