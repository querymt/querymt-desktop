import type { AgentConfig } from '$lib/domain/types';
import { embeddedAcpWebSocketUrl } from '$lib/querymt/websocket-url';

export const EMBEDDED_AGENT_ID = 'qmtcode-embedded';

export function createEmbeddedAgentConfig(location: Pick<Location, 'protocol' | 'host'>): AgentConfig {
  return {
    id: EMBEDDED_AGENT_ID,
    name: 'QMTCODE',
    transport: 'websocket',
    commandLine: '',
    websocketUrl: embeddedAcpWebSocketUrl(location),
    enabled: true,
    autoStart: true
  };
}
