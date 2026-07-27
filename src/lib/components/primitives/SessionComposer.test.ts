import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.svelte';
import { getModelSelectionKey } from '$lib/querymt/config-options';

const elementAnimateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

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
  vi.restoreAllMocks();
  if (elementAnimateDescriptor) {
    Object.defineProperty(Element.prototype, 'animate', elementAnimateDescriptor);
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate');
  }
});

function captureAnimationKeyframes() {
  const captured: Keyframe[][] = [];
  const animate = vi.fn((keyframes: Keyframe[] | PropertyIndexedKeyframes | null) => {
    captured.push(Array.from(keyframes as Iterable<Keyframe>));
    let finish: Animation['onfinish'] = null;
    const animation = {
      cancel: vi.fn(),
      currentTime: 0,
      effect: null,
      playState: 'finished',
      get onfinish() {
        return finish;
      },
      set onfinish(callback) {
        finish = callback;
        if (callback) {
          const event = new Event('finish') as AnimationPlaybackEvent;
          queueMicrotask(() => callback.call(animation as unknown as Animation, event));
        }
      }
    } as unknown as Animation;
    return animation;
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate
  });
  return captured;
}

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

  it('embeds the session target selector in the workspace input', () => {
    renderComposer({
      targetOptions: [
        { id: 'local', label: 'Local' },
        { id: 'eulr', label: 'eulr' }
      ],
      selectedTargetId: 'local',
      onTargetChange: vi.fn()
    });

    const targetSelect = screen.getByRole('button', { name: 'Session target' });
    expect(targetSelect.closest('.workspace-input-shell')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: 'Session target' })).toHaveLength(1);
  });

  it('renders profile as an icon control pill', () => {
    renderComposer({
      profileOptions: [
        { id: 'default', label: 'Default profile' },
        { id: 'review', label: 'Review profile' }
      ],
      selectedProfileId: 'default',
      onProfileChange: vi.fn()
    });

    const profileSelect = screen.getByRole('button', { name: 'Profile' });
    expect(profileSelect).toHaveClass('composer-split-pill');
    expect(profileSelect).toHaveClass('composer-control-pill');
    expect(screen.getByText('Default profile')).toBeInTheDocument();
  });

  it('morphs between stable overlaid blank-session and send states', async () => {
    const { container, rerender } = renderComposer({ launch: true, prompt: '' });
    const morph = container.querySelector('.composer-action-morph');
    const createState = container.querySelector('.composer-action-morph-create');
    const sendState = container.querySelector('.composer-action-morph-send');

    expect(screen.getByRole('button', { name: 'Start blank session' })).toBeInTheDocument();
    expect(morph).toHaveClass('is-creating');
    expect(morph).not.toHaveClass('is-sending');
    expect(createState).toHaveAttribute('aria-hidden', 'false');
    expect(sendState).toHaveAttribute('aria-hidden', 'true');
    expect(createState?.querySelector('.lucide-plus')).not.toBeNull();
    expect(sendState?.querySelector('.lucide-send-horizontal')).not.toBeNull();

    await rerender({ prompt: 'Fix the failing tests' });

    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument();
    expect(morph).not.toHaveClass('is-creating');
    expect(morph).toHaveClass('is-sending');
    expect(createState).toHaveAttribute('aria-hidden', 'true');
    expect(sendState).toHaveAttribute('aria-hidden', 'false');
  });

  it('opens the model picker when the model pill is clicked', async () => {
    renderComposer();

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    expect(screen.getByText('Switch model')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search models, providers, nodes…')).toBeInTheDocument();
  });

  it('distinguishes local and mesh copies of the same model', async () => {
    const onModelChange = vi.fn();
    const remoteModel = { ...modelOptions[0], node_id: 'node-1', node_label: 'Build server' };
    renderComposer({
      modelOptions: [modelOptions[0], remoteModel],
      selectedModelId: getModelSelectionKey(remoteModel),
      onModelChange
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    const rows = screen.getAllByRole('button', { name: /Claude Sonnet 4/i }).filter((button) => button.classList.contains('model-picker-row'));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.querySelector('.lucide-check'))).toHaveLength(1);
    expect(rows[1].querySelector('.lucide-check')).not.toBeNull();

    await fireEvent.click(rows[1]);
    expect(onModelChange).toHaveBeenCalledWith(getModelSelectionKey(remoteModel));
  });

  it('opens the model picker with Cmd+M from the prompt', async () => {
    renderComposer();

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'm', metaKey: true });

    expect(screen.getByText('Switch model')).toBeInTheDocument();
  });

  it('sends with Enter by default and keeps Shift+Enter for a new line', async () => {
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt });
    const prompt = screen.getAllByPlaceholderText(/Ask QueryMT/i)[0];

    expect(await fireEvent.keyDown(prompt, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSendPrompt).not.toHaveBeenCalled();

    expect(await fireEvent.keyDown(prompt, { key: 'Enter' })).toBe(false);
    expect(onSendPrompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['shift-enter', { shiftKey: true }],
    ['ctrl-enter', { ctrlKey: true }],
    ['cmd-enter', { metaKey: true }]
  ] as const)('sends only with the selected %s shortcut', async (sendShortcut, modifiers) => {
    const onSendPrompt = vi.fn();
    renderComposer({ onSendPrompt, sendShortcut });
    const prompt = screen.getAllByPlaceholderText(/Ask QueryMT/i)[0];

    expect(await fireEvent.keyDown(prompt, { key: 'Enter' })).toBe(true);
    expect(onSendPrompt).not.toHaveBeenCalled();

    expect(await fireEvent.keyDown(prompt, { key: 'Enter', ...modifiers })).toBe(false);
    expect(onSendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not send while loading or composing text with an IME', async () => {
    const onSendPrompt = vi.fn();
    const { rerender } = renderComposer({ onSendPrompt });
    const prompt = screen.getAllByPlaceholderText(/Ask QueryMT/i)[0];

    await fireEvent.keyDown(prompt, { key: 'Enter', isComposing: true });
    expect(onSendPrompt).not.toHaveBeenCalled();

    await rerender({ loading: true });
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it('uses the selected shortcut in the collapsed composer', async () => {
    const onSendPrompt = vi.fn();
    renderComposer({
      collapsed: true,
      docked: true,
      sessionOnly: true,
      chatView: true,
      sendShortcut: 'ctrl-enter',
      onSendPrompt
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    await fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(onSendPrompt).not.toHaveBeenCalled();

    await fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    expect(onSendPrompt).toHaveBeenCalledTimes(1);
  });

  it('renders the full composer while fixed and following', () => {
    const { container } = renderComposer({ docked: true, collapsed: false, sessionOnly: true, chatView: true });

    expect(container.querySelector('.session-composer-dock-expanded')).not.toBeNull();
    expect(screen.getByPlaceholderText('Write a reply for this session...').tagName).toBe('TEXTAREA');
    expect(container.querySelector('textarea')).not.toBeNull();
  });

  it('renders the compact composer while fixed and free-scrolling', () => {
    const { container } = renderComposer({ docked: true, collapsed: true, sessionOnly: true, chatView: true });

    expect(container.querySelector('.session-composer-dock-compact')).not.toBeNull();
    expect(container.querySelector('.session-composer-dock-input')).not.toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('preserves the prompt while morphing between composer states', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const prompt = 'Keep this draft';
    const { container, rerender } = renderComposer({
      docked: true,
      collapsed: false,
      sessionOnly: true,
      chatView: true,
      prompt
    });

    expect(screen.getByPlaceholderText('Write a reply for this session...')).toHaveValue(prompt);

    await rerender({ collapsed: true });
    expect(container.querySelector('.session-composer-dock-compact')).not.toBeNull();
    expect(screen.getByPlaceholderText('Write a reply for this session...')).toHaveValue(prompt);

    await rerender({ collapsed: false });
    expect(container.querySelector('.session-composer-dock-expanded')).not.toBeNull();
    expect(screen.getByPlaceholderText('Write a reply for this session...')).toHaveValue(prompt);
  });

  it('morphs without scaling text or icons', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const keyframes = captureAnimationKeyframes();
    const { rerender } = renderComposer({
      docked: true,
      collapsed: false,
      sessionOnly: true,
      chatView: true
    });

    await rerender({ collapsed: true });
    await Promise.resolve();
    await Promise.resolve();

    const transforms = keyframes.flat().map((frame) => String(frame.transform ?? ''));
    expect(transforms.some((transform) => transform.includes('translateY'))).toBe(true);
    expect(transforms.every((transform) => !transform.includes('scale'))).toBe(true);
  });

  it('dismisses composer errors', async () => {
    const onDismissError = vi.fn();
    renderComposer({ error: 'Prompt failed', onDismissError });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});
