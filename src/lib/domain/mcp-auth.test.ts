import { describe, expect, it } from 'vitest';
import {
  describeSkippedMcpServer,
  isMcpAuthId,
  mcpServerOfAuthId,
  splitAuthEntries,
  mergeSkippedMcpServers,
  parseMcpAuthRequired,
  readSkippedMcpServers,
  skippedServerFromNotification
} from './mcp-auth';

describe('mcp-auth', () => {
  it('reads skippedMcpServers from session _meta', () => {
    const meta = {
      querymt: {
        skippedMcpServers: [
          { server_name: 'linear', provider_id: 'mcp:linear' },
          { server_name: 'down', provider_id: 'mcp:down', error: 'dns failure' },
          { provider_id: 'mcp:nameless' },
          { server_name: 'no-provider' },
          'garbage'
        ]
      }
    };
    expect(readSkippedMcpServers(meta)).toEqual([
      { server_name: 'linear', provider_id: 'mcp:linear' },
      { server_name: 'down', provider_id: 'mcp:down', error: 'dns failure' }
    ]);
  });

  it('returns nothing for missing or malformed meta', () => {
    expect(readSkippedMcpServers(undefined)).toEqual([]);
    expect(readSkippedMcpServers({ querymt: { skippedMcpServers: 'x' } })).toEqual([]);
  });

  it('parses the mcpAuthRequired notification', () => {
    const parsed = parseMcpAuthRequired({
      version: 1, session_id: 's1', server_name: 'linear', provider_id: 'mcp:linear'
    });
    expect(parsed).toEqual({ version: 1, session_id: 's1', server_name: 'linear', provider_id: 'mcp:linear' });
    expect(skippedServerFromNotification(parsed!)).toEqual({ server_name: 'linear', provider_id: 'mcp:linear' });
    expect(parseMcpAuthRequired({ session_id: 's1', server_name: 'x', provider_id: 'mcp:x', error: 'dns' })?.error).toBe('dns');
    expect(parseMcpAuthRequired({ session_id: 's1' })).toBeNull();
    expect(parseMcpAuthRequired({ server_name: 'x', provider_id: 'mcp:x' })).toBeNull();
    expect(parseMcpAuthRequired(null)).toBeNull();
  });

  it('merges by server name with later entries winning', () => {
    const merged = mergeSkippedMcpServers(
      [{ server_name: 'a', provider_id: 'mcp:a' }],
      [{ server_name: 'a', provider_id: 'mcp:a', error: 'boom' }, { server_name: 'b', provider_id: 'mcp:b' }]
    );
    expect(merged).toEqual([
      { server_name: 'a', provider_id: 'mcp:a', error: 'boom' },
      { server_name: 'b', provider_id: 'mcp:b' }
    ]);
  });

  it('detects mcp providers and describes entries', () => {
    expect(isMcpAuthId('mcp:linear')).toBe(true);
    expect(isMcpAuthId('anthropic')).toBe(false);
    expect(isMcpAuthId(undefined)).toBe(false);
    expect(describeSkippedMcpServer({ server_name: 'l', provider_id: 'mcp:l' })).toContain('needs sign-in');
    expect(describeSkippedMcpServer({ server_name: 'l', provider_id: 'mcp:l', error: 'dns' })).toContain('unavailable: dns');
  });

  it('splits auth entries into LLM providers and MCP server logins', () => {
    const entries = [{ provider: 'anthropic' }, { provider: 'mcp:linear' }, { provider: 'openai' }];
    expect(splitAuthEntries(entries)).toEqual({
      providers: [{ provider: 'anthropic' }, { provider: 'openai' }],
      mcpServers: [{ provider: 'mcp:linear' }]
    });
    expect(mcpServerOfAuthId('mcp:linear')).toBe('linear');
    expect(mcpServerOfAuthId('anthropic')).toBe('anthropic');
  });
});
