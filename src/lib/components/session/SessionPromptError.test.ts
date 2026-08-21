import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionPromptError from './SessionPromptError.svelte';

const failure = {
  id: 'failure-1',
  sessionId: 'session-1',
  turnEventIndex: 0,
  prompt: 'Continue the task',
  attachments: [],
  kind: 'quota_exceeded' as const,
  title: 'Usage limit reached',
  message: 'The usage limit has been reached',
  provider: 'codex',
  model: 'gpt-5.6-sol',
  retryable: false,
  details: '{"kind":"quota_exceeded"}'
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionPromptError', () => {
  it('renders quota context, copy, and dismiss actions without retry', () => {
    render(SessionPromptError, { failure, onDismiss: vi.fn(), onRetry: vi.fn() });

    expect(screen.getByRole('alert')).toHaveTextContent('Usage limit reached');
    expect(screen.getByRole('alert')).toHaveTextContent('Codex: The usage limit has been reached');
    expect(screen.getByRole('alert')).not.toHaveTextContent('gpt-5.6-sol');
    expect(screen.queryByRole('button', { name: 'Change model' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy with details' })).toBeInTheDocument();
  });

  it('does not add a provider prefix to non-provider failures', () => {
    render(SessionPromptError, {
      failure: { ...failure, kind: 'unknown', provider: null, model: null, message: 'The session disconnected.' },
      onDismiss: vi.fn()
    });

    expect(screen.getByRole('alert')).toHaveTextContent('The session disconnected.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Provider:');
  });

  it('copies short and technical forms and retries transient failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onRetry = vi.fn();
    render(SessionPromptError, {
      failure: { ...failure, kind: 'rate_limited', title: 'Provider is rate limiting requests', retryable: true },
      onDismiss: vi.fn(),
      onRetry
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(writeText).toHaveBeenLastCalledWith('Provider is rate limiting requests\nCodex: The usage limit has been reached');
    await fireEvent.click(screen.getByRole('button', { name: 'Copy with details' }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Provider: codex'));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Model: gpt-5.6-sol'));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Technical details:'));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
