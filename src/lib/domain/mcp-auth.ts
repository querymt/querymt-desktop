import type { McpAuthRequiredNotification, SkippedMcpServer } from '$lib/querymt/generated/types';

/**
 * OAuth-protected MCP servers that a session could not connect. Two wire
 * sources report the same thing, both typed by the generated agent contract:
 *  - `session/new` / `session/load` `_meta.querymt.skippedMcpServers`
 *  - the `querymt/session/mcpAuthRequired` extension notification
 * `_meta` and notification params are untyped JSON at the transport boundary,
 * so a small runtime guard validates them before they are used as the types.
 */

export type { McpAuthRequiredNotification, SkippedMcpServer };

export const MCP_PROVIDER_PREFIX = 'mcp:';
export const SKIPPED_MCP_SERVERS_META_KEY = 'skippedMcpServers';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Guard for one `SkippedMcpServer`; drops entries without a server name or provider id. */
function parseSkippedServer(value: unknown): SkippedMcpServer | null {
  const entry = record(value);
  const server_name = nonEmpty(entry?.server_name);
  const provider_id = nonEmpty(entry?.provider_id);
  if (!entry || !server_name || !provider_id) return null;
  const error = nonEmpty(entry.error);
  return error === undefined ? { server_name, provider_id } : { server_name, provider_id, error };
}

/** Servers a `session/new` or `session/load` response reports as skipped. */
export function readSkippedMcpServers(meta: unknown): SkippedMcpServer[] {
  const list = record(record(meta)?.querymt)?.[SKIPPED_MCP_SERVERS_META_KEY];
  if (!Array.isArray(list)) return [];
  return mergeSkippedMcpServers([], list.map(parseSkippedServer).filter((s): s is SkippedMcpServer => s !== null));
}

/** Validate `querymt/session/mcpAuthRequired` params; `null` when unusable. */
export function parseMcpAuthRequired(params: unknown): McpAuthRequiredNotification | null {
  const value = record(params);
  const server = parseSkippedServer(value);
  const session_id = nonEmpty(value?.session_id);
  if (!value || !server || !session_id) return null;
  return {
    version: typeof value.version === 'number' ? value.version : 1,
    session_id,
    ...server
  };
}

/** The skipped-server part of a notification. */
export function skippedServerFromNotification(notification: McpAuthRequiredNotification): SkippedMcpServer {
  const { server_name, provider_id, error } = notification;
  return error === undefined ? { server_name, provider_id } : { server_name, provider_id, error };
}

/** Merge by server name; later entries win. */
export function mergeSkippedMcpServers(
  current: SkippedMcpServer[],
  incoming: SkippedMcpServer[]
): SkippedMcpServer[] {
  const byName = new Map(current.map((server) => [server.server_name, server]));
  for (const server of incoming) byName.set(server.server_name, server);
  return [...byName.values()];
}

/** `mcp:<server>` ids name MCP server logins, which share the agent's `_querymt/auth/*` methods. */
export function isMcpAuthId(providerId: string | null | undefined): boolean {
  return Boolean(providerId?.startsWith(MCP_PROVIDER_PREFIX));
}

/** Server name of an `mcp:<server>` auth id. */
export function mcpServerOfAuthId(id: string): string {
  return id.startsWith(MCP_PROVIDER_PREFIX) ? id.slice(MCP_PROVIDER_PREFIX.length) : id;
}

/** Split auth status entries: LLM providers vs MCP server logins (which are not providers). */
export function splitAuthEntries<T extends { provider: string }>(entries: T[]): { providers: T[]; mcpServers: T[] } {
  const providers: T[] = [];
  const mcpServers: T[] = [];
  for (const entry of entries) (isMcpAuthId(entry.provider) ? mcpServers : providers).push(entry);
  return { providers, mcpServers };
}

export function describeSkippedMcpServer(server: SkippedMcpServer): string {
  return server.error
    ? `MCP server "${server.server_name}" is unavailable: ${server.error}`
    : `MCP server "${server.server_name}" needs sign-in. Its tools are not available in this session.`;
}
