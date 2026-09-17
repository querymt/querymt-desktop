const WEBSOCKET_SCHEMES = new Set(['ws:', 'wss:']);

export function normalizeAcpWebSocketEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const url = new URL(explicitScheme ? trimmed : `ws://${trimmed}`);
  if (!WEBSOCKET_SCHEMES.has(url.protocol)) {
    throw new Error('Enter a server address as host:port.');
  }
  if (url.username || url.password) {
    throw new Error('Server addresses must not contain credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('Server addresses must not contain query parameters or fragments.');
  }
  if (!['', '/', '/ws', '/acp/ws'].includes(url.pathname)) {
    throw new Error('Enter only the server host and port.');
  }

  return url.host;
}

export function usesSecureWebSocket(value: string): boolean {
  return value.trim().toLowerCase().startsWith('wss://');
}

export function acpWebSocketUrl(value: string, secure = false): string {
  const endpoint = normalizeAcpWebSocketEndpoint(value);
  return endpoint ? `${secure ? 'wss' : 'ws'}://${endpoint}/acp/ws` : '';
}

export function embeddedAcpWebSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') {
    throw new Error(`Cannot derive an ACP WebSocket URL from ${location.protocol}`);
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/acp/ws`;
}
