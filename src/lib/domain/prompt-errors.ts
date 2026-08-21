import { RequestError } from '@agentclientprotocol/sdk';
import type { PromptAttachment } from '$lib/domain/types';

export type PromptErrorKind =
  | 'quota_exceeded'
  | 'rate_limited'
  | 'authentication'
  | 'context_window_exceeded'
  | 'invalid_request'
  | 'provider'
  | 'unknown';

export interface PromptError {
  kind: PromptErrorKind;
  title: string;
  message: string;
  provider: string | null;
  model: string | null;
  retryable: boolean;
  details: string;
}

export interface PromptFailure extends PromptError {
  id: string;
  sessionId: string;
  turnEventIndex: number;
  prompt: string;
  attachments: PromptAttachment[];
}

interface ProviderErrorData {
  category?: unknown;
  kind?: unknown;
  message?: unknown;
  provider?: unknown;
  model?: unknown;
  retryable?: unknown;
}

const PROMPT_ERROR_TITLES: Record<PromptErrorKind, string> = {
  quota_exceeded: 'Usage limit reached',
  rate_limited: 'Provider is rate limiting requests',
  authentication: 'Provider authentication required',
  context_window_exceeded: 'Context window exceeded',
  invalid_request: 'Provider rejected the request',
  provider: 'Provider request failed',
  unknown: 'Prompt failed'
};

export function normalizePromptError(error: unknown): PromptError {
  if (error instanceof RequestError && isProviderErrorData(error.data)) {
    const kind = normalizePromptErrorKind(error.data.kind);
    const provider = stringValue(error.data.provider);
    const message = stringValue(error.data.message) ?? error.message;
    return {
      kind,
      title: PROMPT_ERROR_TITLES[kind],
      message: normalizeProviderErrorMessage(message, kind),
      provider,
      model: stringValue(error.data.model),
      retryable: error.data.retryable === true,
      details: formatRequestErrorDetails(error)
    };
  }

  const details = error instanceof Error ? error.message : 'Failed to send ACP prompt.';
  const kind = inferLegacyPromptErrorKind(details);
  const context = extractLegacyQuerymtContext(details);
  return {
    kind,
    title: PROMPT_ERROR_TITLES[kind],
    message: normalizeLegacyPromptErrorMessage(details, kind),
    provider: context.provider,
    model: context.model,
    retryable: kind === 'rate_limited',
    details
  };
}

function isProviderErrorData(value: unknown): value is ProviderErrorData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as ProviderErrorData;
  return data.category === 'provider' || isKnownPromptErrorKind(data.kind);
}

function isKnownPromptErrorKind(value: unknown): boolean {
  return ['quota_exceeded', 'rate_limited', 'authentication', 'context_window_exceeded', 'invalid_request'].includes(
    String(value)
  );
}

function normalizePromptErrorKind(value: unknown): PromptErrorKind {
  switch (value) {
    case 'quota_exceeded':
    case 'rate_limited':
    case 'authentication':
    case 'context_window_exceeded':
    case 'invalid_request':
      return value;
    default:
      return 'provider';
  }
}

function inferLegacyPromptErrorKind(message: string): PromptErrorKind {
  const normalized = message.toLowerCase();
  if (/quota_exceeded|usage_limit_reached|usage limit|insufficient_quota/.test(normalized)) return 'quota_exceeded';
  if (/rate_limited|rate limit|too many requests/.test(normalized)) return 'rate_limited';
  if (
    /authentication|auth error|invalid api key|no api key|missing api key|no credentials|unauthorized|forbidden/.test(
      normalized
    )
  ) {
    return 'authentication';
  }
  if (/context_window_exceeded|context length/.test(normalized)) return 'context_window_exceeded';
  return 'unknown';
}

function normalizeLegacyPromptErrorMessage(message: string, kind: PromptErrorKind): string {
  if (kind === 'quota_exceeded') return 'The usage limit has been reached.';
  if (kind === 'authentication') {
    const authMessage = message.match(/auth error:\s*(.+)$/i)?.[1] ?? message;
    return normalizeProviderErrorMessage(authMessage, kind);
  }
  return message;
}

function normalizeProviderErrorMessage(message: string, kind: PromptErrorKind): string {
  if (kind !== 'authentication') return message;

  const missingCredentials = /(?:no|missing)\s+(?:an?\s+)?(?:api key|credentials?)|api key\s+(?:was\s+)?not found/i.test(
    message
  );
  if (!missingCredentials) return message.replace(/^auth error:\s*/i, '');

  const envName = message.match(/\b([A-Z][A-Z0-9_]*_API_KEY)\b/)?.[1];
  return envName
    ? `No API key is configured. Add one in Settings → Providers, or set ${envName}.`
    : 'No credentials are configured. Connect the provider in Settings → Providers.';
}

function extractLegacyQuerymtContext(message: string): { provider: string | null; model: string | null } {
  const match = message.match(/\(provider=([^,)]+),\s*model=([^)]+)\)/i);
  return {
    provider: match?.[1]?.trim() || null,
    model: match?.[2]?.trim() || null
  };
}

export function formatPromptErrorMessage(error: PromptError): string {
  if (!error.provider) return error.message;
  return `${formatProviderName(error.provider)}: ${error.message}`;
}

export function formatPromptErrorForClipboard(error: PromptError, includeDetails = false): string {
  const lines = [error.title, formatPromptErrorMessage(error)];
  if (includeDetails) {
    if (error.provider) lines.push(`Provider: ${error.provider}`);
    if (error.model) lines.push(`Model: ${error.model}`);
    lines.push('', 'Technical details:', error.details);
  }
  return lines.join('\n');
}

function formatProviderName(provider: string): string {
  const names: Record<string, string> = {
    openai: 'OpenAI',
    'azure-openai': 'Azure OpenAI',
    azure_openai: 'Azure OpenAI',
    xai: 'xAI'
  };
  const normalized = provider.trim();
  return (
    names[normalized.toLowerCase()] ??
    normalized
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function formatRequestErrorDetails(error: RequestError): string {
  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      data: error.data
    },
    null,
    2
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
