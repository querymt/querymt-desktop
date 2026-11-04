import { RequestError } from '@agentclientprotocol/sdk';

export interface ErrorReport {
  /** One line for the UI: the error message plus the agent's reason when it gave one. */
  summary: string;
  /** Pretty-printed JSON for support: error code, message, data and caller context. */
  details: string;
}

function agentReason(data: unknown): string | null {
  if (typeof data === 'string') return data.trim() || null;
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  for (const key of ['error', 'message', 'reason']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Turns a failed agent call into a readable summary and a copyable report. JSON-RPC errors
 * carry the useful reason in `data`, which `Error.message` alone ("Invalid params") hides.
 * `context` is appended verbatim, so callers can include what they sent.
 */
export function describeError(error: unknown, fallback: string, context: Record<string, unknown> = {}): ErrorReport {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const data = error instanceof RequestError ? error.data : (error as { data?: unknown } | null)?.data;
  const reason = agentReason(data);
  const summary = reason && !message.includes(reason) ? `${message}: ${reason}` : message;
  const code = error instanceof RequestError ? error.code : (error as { code?: unknown } | null)?.code;

  const details = JSON.stringify(
    { ...context, error: { name: error instanceof Error ? error.name : typeof error, code, message, data } },
    null,
    2
  );
  return { summary, details };
}
