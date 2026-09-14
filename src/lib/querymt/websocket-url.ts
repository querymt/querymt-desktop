const WEBSOCKET_SCHEMES = new Set(['ws:', 'wss:']);

export function normalizeAcpWebSocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const url = new URL(explicitScheme ? trimmed : `ws://${trimmed}`);
  if (!WEBSOCKET_SCHEMES.has(url.protocol)) {
    throw new Error('Enter a ws:// or wss:// ACP WebSocket URL.');
  }
  if (url.username || url.password) {
    throw new Error('WebSocket URLs must not contain credentials.');
  }
  if (url.search || url.hash) {
    throw new Error('WebSocket URL query parameters and fragments are not supported.');
  }

  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/ws';
  }
  return url.toString();
}

export function embeddedAcpWebSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') {
    throw new Error(`Cannot derive an ACP WebSocket URL from ${location.protocol}`);
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/acp/ws`;
}
