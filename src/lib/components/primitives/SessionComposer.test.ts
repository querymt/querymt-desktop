import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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

  it('moves target and profile into session options', async () => {
    renderComposer({
      launch: true,
      targetOptions: [
        { id: 'local', label: 'Local' },
        { id: 'eulr', label: 'eulr' }
      ],
      selectedTargetId: 'local',
      profileOptions: [
        { id: 'default', label: 'Default profile' },
        { id: 'review', label: 'Review profile' }
      ],
      selectedProfileId: 'default',
      onTargetChange: vi.fn(),
      onProfileChange: vi.fn()
    });

    const workspace = screen.getByPlaceholderText('/absolute/path/to/workspace');
    expect(workspace.closest('.workspace-input-shell')?.querySelector('[aria-label="Session target"]')).toBeNull();

    await fireEvent.click(screen.getByLabelText('Session options'));
    expect(screen.getByRole('button', { name: 'Session target' })).toHaveTextContent('Local');
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveTextContent('Default profile');
  });

  it('keeps launch mode visible and moves reasoning into session options', async () => {
    const onLaunchModeChange = vi.fn();
    const onLaunchReasoningChange = vi.fn();
    renderComposer({
      launch: true,
      launchModeOptions: [
        { id: 'build', label: 'Build' },
        { id: 'plan', label: 'Plan' }
      ],
      selectedLaunchModeId: 'build',
      launchReasoningOptions: [
        { id: 'auto', label: 'Auto' },
        { id: 'high', label: 'High' }
      ],
      selectedLaunchReasoningId: 'auto',
      onLaunchModeChange,
      onLaunchReasoningChange
    });

    const modeSelect = screen.getByRole('button', { name: 'Mode' });
    expect(modeSelect).toHaveClass('composer-control-pill');
    expect(modeSelect).toHaveTextContent('Build');
    const options = screen.getByLabelText('Session options').closest('details');
    const reasoningSelect = screen.getByRole('button', { name: 'Reasoning effort' });
    expect(options).not.toHaveAttribute('open');
    expect(reasoningSelect.closest('.composer-options')).toBe(options);

    await fireEvent.click(screen.getByLabelText('Session options'));
    expect(options).toHaveAttribute('open');
    expect(reasoningSelect).toHaveClass('composer-control-pill');
    expect(reasoningSelect).toHaveTextContent('Auto');
  });

  it('keeps the primary row focused on model, mode, and session options', () => {
    renderComposer({
      launch: true,
      profileOptions: [{ id: 'default', label: 'Default' }],
      launchModeOptions: [{ id: 'build', label: 'Build' }],
      launchReasoningOptions: [{ id: 'auto', label: 'Auto' }]
    });

    const controls = screen
      .getAllByRole('button')
      .filter((button) => button.classList.contains('composer-control-pill') && !button.closest('.composer-options'));
    expect(controls.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
      'Claude Sonnet 4 · anthropic',
      'Mode'
    ]);
    expect(screen.getByLabelText('Session options')).toBeInTheDocument();
    expect(screen.getByLabelText('Session options').closest('.composer-options')).not.toBeNull();
  });

  it('keeps send as the strong primary action', () => {
    renderComposer({ launch: true, prompt: 'Ship the change' });

    expect(screen.getByRole('button', { name: 'Start session' })).toHaveClass('action-btn-primary');
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

    expect(screen.getByRole('dialog', { name: 'Switch model' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search models, providers, nodes…')).toHaveFocus();
  });

  it('shows supported input modality icons and defaults unknown metadata to text', async () => {
    const imageModel = { ...modelOptions[0], id: 'anthropic/claude-vision', model: 'claude-vision', label: 'Claude Vision' };
    renderComposer({
      modelOptions: [modelOptions[0], imageModel],
      modelInfo: {
        [imageModel.id]: {
          capabilities: { modalities: { input: ['text', 'image', 'pdf', 'audio', 'video'], output: ['text'] } },
          limits: { context: 200000 }
        }
      }
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    expect(screen.getByLabelText('Input modalities unknown')).toBeInTheDocument();
    expect(screen.getByLabelText('Model modalities unknown')).toBeInTheDocument();
    expect(screen.getByLabelText('Supports image input')).toBeInTheDocument();
    expect(screen.getByLabelText('Supports pdf input')).toBeInTheDocument();
    expect(screen.getByLabelText('Supports audio input')).toBeInTheDocument();
    expect(screen.getByLabelText('Supports video input')).toBeInTheDocument();
    expect(screen.getByLabelText('200,000 token context window')).toHaveTextContent('200K');
  });

  it('finds models by supported modality', async () => {
    const imageModel = { ...modelOptions[0], id: 'anthropic/claude-vision', model: 'claude-vision', label: 'Claude Vision' };
    renderComposer({
      modelOptions: [modelOptions[0], imageModel],
      modelInfo: {
        [imageModel.id]: { capabilities: { modalities: { input: ['text', 'image'], output: ['text'] } } }
      }
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);
    await fireEvent.input(screen.getByPlaceholderText('Search models, providers, nodes…'), { target: { value: 'image' } });

    const picker = screen.getByRole('dialog', { name: 'Switch model' });
    expect(within(picker).getByRole('button', { name: /Claude Vision/i })).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: /Claude Sonnet 4/i })).not.toBeInTheDocument();
  });

  it('closes the model picker with Escape and restores focus to its trigger', async () => {
    renderComposer();
    const trigger = screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0];

    await fireEvent.click(trigger);
    await fireEvent.keyDown(screen.getByPlaceholderText('Search models, providers, nodes…'), { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Switch model' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('distinguishes local and mesh copies without shifting selected model capabilities', async () => {
    const onModelChange = vi.fn();
    const remoteModel = { ...modelOptions[0], node_id: 'node-1', node_label: 'flkr' };
    renderComposer({
      modelOptions: [modelOptions[0], remoteModel],
      modelInfo: {
        [modelOptions[0].id]: { capabilities: { modalities: { input: ['text', 'image'], output: ['text'] } }, limits: { context: 1_050_000 } },
        [getModelSelectionKey(remoteModel)]: {
          capabilities: { modalities: { input: ['text', 'image'], output: ['text'] } },
          limits: { context: 128_000 }
        }
      },
      selectedModelId: getModelSelectionKey(remoteModel),
      onModelChange
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);

    const rows = screen.getAllByRole('button', { name: /Claude Sonnet 4/i }).filter((button) => button.classList.contains('app-picker-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('anthropic');
    expect(rows[0].querySelector('.app-picker-row-description')).not.toHaveTextContent('claude-sonnet-4');
    expect(within(rows[0]).getByLabelText('1,050,000 token context window')).toHaveTextContent('1M');
    expect(rows[0].querySelector('.app-picker-row-detail')?.firstElementChild).toHaveClass('app-picker-row-context');
    expect(rows[0].querySelector('.app-picker-row-detail')?.lastElementChild).toHaveClass('app-picker-model-modalities');
    expect(within(rows[1]).getByLabelText('Mesh node flkr')).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('128,000 token context window')).toHaveTextContent('128K');
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[1].querySelector('.app-picker-row-title-selected')).toHaveTextContent('Claude Sonnet 4');
    expect(rows[1].querySelector('.lucide-check')).toBeNull();
    expect(rows[0].querySelectorAll('.app-picker-model-modality')).toHaveLength(2);
    expect(rows[1].querySelectorAll('.app-picker-model-modality')).toHaveLength(2);

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

    const shell = container.querySelector('.session-composer-dock-expanded');
    const innerSurface = shell?.firstElementChild;
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');
    expect(shell).not.toBeNull();
    expect(innerSurface).toHaveClass('bg-inherit');
    expect(prompt.tagName).toBe('TEXTAREA');
    expect(prompt).toHaveClass('bg-inherit');
    expect(prompt).not.toHaveClass('bg-transparent');
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
