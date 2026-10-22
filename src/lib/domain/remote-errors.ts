import { RequestError } from '@agentclientprotocol/sdk';

/** Error category the agent reports when a remote mesh node runs an incompatible agent. */
export const REMOTE_UPGRADE_REQUIRED_CATEGORY = 'remote_upgrade_required';

/**
 * A remote mesh node lacks the session-interaction contract and must be
 * upgraded. This is a permanent condition, never a transient failure.
 */
export class RemoteNodeUpgradeRequiredError extends Error {
  readonly node: string;
  readonly cause: unknown;

  constructor(node: string, cause?: unknown) {
    super(formatRemoteUpgradeRequiredMessage(node));
    this.name = 'RemoteNodeUpgradeRequiredError';
    this.node = node;
    this.cause = cause;
  }
}

export function formatRemoteUpgradeRequiredMessage(node: string): string {
  const label = node.trim() || 'unknown node';
  return `Remote node "${label}" must be upgraded: it runs a QueryMT agent that does not support session interactions. Upgrade every mesh node to the same agent version.`;
}

/**
 * Map the agent's upgrade-required error (`data.category ===
 * "remote_upgrade_required"`) to a typed desktop error. Returns `null` for any
 * other error.
 */
export function toRemoteNodeUpgradeRequired(error: unknown): RemoteNodeUpgradeRequiredError | null {
  if (error instanceof RemoteNodeUpgradeRequiredError) return error;
  const data = readErrorData(error);
  if (!data || data.category !== REMOTE_UPGRADE_REQUIRED_CATEGORY) return null;
  const node = typeof data.node === 'string' ? data.node : '';
  return new RemoteNodeUpgradeRequiredError(node, error);
}

/** Rethrow-friendly mapping: the typed error when applicable, else the original. */
export function mapRemoteUpgradeRequired(error: unknown): unknown {
  return toRemoteNodeUpgradeRequired(error) ?? error;
}

function readErrorData(error: unknown): Record<string, unknown> | null {
  const data =
    error instanceof RequestError
      ? error.data
      : typeof error === 'object' && error !== null
        ? (error as { data?: unknown }).data
        : null;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
}
