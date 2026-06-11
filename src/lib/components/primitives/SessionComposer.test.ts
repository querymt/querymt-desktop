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

afterEach(() => cleanup());

describe('SessionComposer', () => {
  it('keeps workspace input editable and forwards typed paths', async () => {
    const onCwdInput = vi.fn();
    render(SessionComposer, {
      cwd: '',
      prompt: '',
      modelOptions,
      selectedModelId: modelOptions[0].id,
      onCwdInput,
      onPromptInput: vi.fn(),
      onSendPrompt: vi.fn()
    });

    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    await fireEvent.input(input, { target: { value: '/Users/wiking/project' } });

    expect(onCwdInput).toHaveBeenCalledWith('/Users/wiking/project');
  });

  it('opens the model picker when the model pill is clicked', async () => {
    render(SessionComposer, {
      cwd: '',
      prompt: '',
      modelOptions,
      selectedModelId: modelOptions[0].id,
      onCwdInput: vi.fn(),
      onPromptInput: vi.fn(),
      onSendPrompt: vi.fn()
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    expect(screen.getByText('Switch model')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search models, providers, nodes…')).toBeInTheDocument();
  });

  it('opens the model picker with Cmd+M from the prompt', async () => {
    render(SessionComposer, {
      cwd: '',
      prompt: '',
      modelOptions,
      selectedModelId: modelOptions[0].id,
      onCwdInput: vi.fn(),
      onPromptInput: vi.fn(),
      onSendPrompt: vi.fn()
    });

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'm', metaKey: true });

    expect(screen.getByText('Switch model')).toBeInTheDocument();
  });
});
