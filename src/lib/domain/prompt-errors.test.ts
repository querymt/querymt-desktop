import { RequestError } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { formatPromptErrorForClipboard, formatPromptErrorMessage, normalizePromptError } from './prompt-errors';

describe('normalizePromptError', () => {
  it('normalizes structured ACP quota failures', () => {
    const error = new RequestError(-32010, 'Provider request failed', {
      category: 'provider',
      kind: 'quota_exceeded',
      message: 'The usage limit has been reached',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      retryable: false
    });

    expect(normalizePromptError(error)).toEqual({
      kind: 'quota_exceeded',
      title: 'Usage limit reached',
      message: 'The usage limit has been reached',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      retryable: false,
      details: expect.stringContaining('"code": -32010')
    });
  });

  it('recognizes quota failures from older QueryMT agents', () => {
    const error = new Error(
      'internal error: LLM streaming error (provider=codex, model=gpt-5.6-sol): LLM Provider Error: The usage limit has been reached (kind=QuotaExceeded, type=usage_limit_reached)'
    );

    expect(normalizePromptError(error)).toEqual({
      kind: 'quota_exceeded',
      title: 'Usage limit reached',
      message: 'The usage limit has been reached.',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      retryable: false,
      details: expect.stringContaining('internal error: LLM streaming error')
    });
  });

  it('normalizes structured authentication failures into user language', () => {
    const error = new RequestError(-32010, 'Provider request failed', {
      category: 'provider',
      kind: 'authentication',
      message: "No API key found for provider 'groq'. Set GROQ_API_KEY or run 'qmt auth login groq'",
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      retryable: false
    });

    const normalized = normalizePromptError(error);
    expect(normalized).toEqual({
      kind: 'authentication',
      title: 'Provider authentication required',
      message: 'No API key is configured. Add one in Settings → Providers, or set GROQ_API_KEY.',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      retryable: false,
      details: expect.stringContaining("qmt auth login groq")
    });
    expect(formatPromptErrorMessage(normalized)).toBe(
      'Groq: No API key is configured. Add one in Settings → Providers, or set GROQ_API_KEY.'
    );
  });

  it('normalizes legacy QueryMT authentication failures without duplicating raw diagnostics', () => {
    const raw =
      "internal error: LLM provider initialization error (provider=groq, model=openai/gpt-oss-20b): Auth Error: No API key found for provider 'groq'. Set GROQ_API_KEY or run 'qmt auth login groq'";
    const normalized = normalizePromptError(new Error(raw));

    expect(normalized).toEqual({
      kind: 'authentication',
      title: 'Provider authentication required',
      message: 'No API key is configured. Add one in Settings → Providers, or set GROQ_API_KEY.',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      retryable: false,
      details: raw
    });
    expect(formatPromptErrorForClipboard(normalized)).toBe(
      'Provider authentication required\nGroq: No API key is configured. Add one in Settings → Providers, or set GROQ_API_KEY.'
    );
    expect(formatPromptErrorForClipboard(normalized, true)).toContain(raw);
  });

  it('uses user-facing provider names without exposing model details', () => {
    const normalized = normalizePromptError(
      new RequestError(-32010, 'Provider request failed', {
        category: 'provider',
        kind: 'quota_exceeded',
        message: 'The usage limit has been reached',
        provider: 'azure_openai',
        model: 'gpt-5.6-sol',
        retryable: false
      })
    );

    expect(formatPromptErrorMessage(normalized)).toBe('Azure OpenAI: The usage limit has been reached');
    expect(formatPromptErrorForClipboard(normalized)).not.toContain('gpt-5.6-sol');
    expect(formatPromptErrorForClipboard(normalized, true)).toContain('Model: gpt-5.6-sol');
  });
});
