import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.svelte';

const modelOptions = [
  {
    id: 'anthropic/claude-sonnet-4',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    label: 'Claude Sonnet 4'
  }
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderComposer(props: Record<string, unknown> = {}) {
  return render(SessionComposer, {
    cwd: '',
    prompt: '',
    modelOptions,
    selectedModelId: modelOptions[0].id,
    onCwdInput: vi.fn(),
    onPromptInput: vi.fn(),
    onSendPrompt: vi.fn(),
    ...props
  });
}

describe('SessionComposer', () => {
  it('keeps workspace input editable and forwards typed paths', async () => {
    const onCwdInput = vi.fn();
    renderComposer({ onCwdInput });

    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    await fireEvent.input(input, { target: { value: '/Users/wiking/project' } });

    expect(onCwdInput).toHaveBeenCalledWith('/Users/wiking/project');
  });

  it('opens the model picker when the model pill is clicked', async () => {
    renderComposer();

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    expect(screen.getByText('Switch model')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search models, providers, nodes…')).toBeInTheDocument();
  });

  it('opens the model picker with Cmd+M from the prompt', async () => {
    renderComposer();

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'm', metaKey: true });

    expect(screen.getByText('Switch model')).toBeInTheDocument();
  });

  it('sends with Cmd+Enter on macOS', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt });

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'Enter', metaKey: true });

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not send with Ctrl+Enter on macOS', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt });

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'Enter', ctrlKey: true });

    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it('sends with Ctrl+Enter on non-macOS platforms', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Windows NT 10.0' });
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt });

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'Enter', ctrlKey: true });

    expect(onSendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not send with Cmd+Enter on non-macOS platforms', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' });
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt });

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'Enter', metaKey: true });

    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it('dismisses composer errors', async () => {
    const onDismissError = vi.fn();
    renderComposer({ error: 'Prompt failed', onDismissError });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
