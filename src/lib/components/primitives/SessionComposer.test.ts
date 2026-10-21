import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import SessionComposer from './SessionComposer.svelte';
import { getModelSelectionKey } from '$lib/querymt/config-options';

const mockSuggestWorkspacePaths = vi.hoisted(() => vi.fn(async (_query: string, _limit: number) => [
  { path: '/tmp/workspace', name: 'workspace' },
  { path: '/tmp/other-project', name: 'other-project' }
]));
vi.mock('$native', () => ({ suggestWorkspacePaths: mockSuggestWorkspacePaths }));

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
  vi.useRealTimers();
  vi.restoreAllMocks();
  mockSuggestWorkspacePaths.mockClear();
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

  it('adds delegate routing to options only when the active agent supports it', async () => {
    const onOpenDelegateModels = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionProfileLabel: 'Quorum',
      delegateModelCount: 2,
      onOpenDelegateModels
    });

    await fireEvent.click(screen.getByLabelText('Session options'));
    const configure = screen.getByRole('button', { name: /Configure · 2/i });
    expect(configure).toBeTruthy();
    await fireEvent.click(configure);
    expect(onOpenDelegateModels).toHaveBeenCalledOnce();
  });

  it('hides delegate routing when the session has no delegate roles', async () => {
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionProfileLabel: 'Default'
    });

    await fireEvent.click(screen.getByLabelText('Session options'));
    expect(screen.queryByText('Delegate routing')).toBeNull();
  });

  it('keeps launch mode visible and moves reasoning into the model picker', async () => {
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
    expect(screen.queryByLabelText('Session options')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reasoning effort' })).not.toBeInTheDocument();
    const modelButton = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic; reasoning effort: Auto' });
    expect(modelButton.querySelector('.composer-reasoning-badge')).toHaveTextContent('Auto');

    await fireEvent.click(modelButton);
    const picker = screen.getByRole('dialog', { name: 'Switch model' });
    const reasoningSelect = within(picker).getByRole('button', { name: 'Reasoning effort' });
    expect(reasoningSelect.closest('.delegate-reasoning-control')).not.toBeNull();
    expect(reasoningSelect).toHaveTextContent('Auto');
    expect(within(picker).getByText('How deeply the agent should think')).toBeInTheDocument();
  });

  it('collapses session options on outside clicks but keeps the trigger toggle', async () => {
    renderComposer({
      launch: true,
      launchModeOptions: [{ id: 'build', label: 'Build' }],
      profileOptions: [{ id: 'default', label: 'Default profile' }],
      launchReasoningOptions: [{ id: 'auto', label: 'Auto' }],
      selectedLaunchReasoningId: 'auto'
    });

    const summary = screen.getByLabelText('Session options');
    const details = summary.closest('details');
    expect(details).not.toHaveAttribute('open');

    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');

    // Pointer downs inside the panel (including its selects) keep it open.
    await fireEvent.mouseDown(screen.getByRole('button', { name: 'Profile' }));
    expect(details).toHaveAttribute('open');

    // Select menus render through a portal outside the <details>; presses in
    // them must not collapse the popover.
    const portalMenu = document.createElement('div');
    portalMenu.className = 'app-select-content';
    const menuOption = document.createElement('div');
    menuOption.setAttribute('role', 'option');
    portalMenu.appendChild(menuOption);
    document.body.appendChild(portalMenu);
    try {
      await fireEvent.mouseDown(menuOption);
      expect(details).toHaveAttribute('open');
    } finally {
      portalMenu.remove();
    }

    await fireEvent.mouseDown(document.body);
    expect(details).not.toHaveAttribute('open');

    // The trigger still toggles the popover natively.
    await fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    await fireEvent.click(summary);
    expect(details).not.toHaveAttribute('open');
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
      .filter((button) => button.classList.contains('composer-control-pill') && !button.closest('.composer-options-host'));
    expect(controls.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())).toEqual([
      'Claude Sonnet 4 from anthropic; reasoning effort: Auto',
      'Mode'
    ]);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Image attachment encoding' })).not.toBeInTheDocument();
    expect(screen.queryByText('Native images')).not.toBeInTheDocument();
    expect(screen.queryByText('Image resources')).not.toBeInTheDocument();
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

  it('selects the highlighted model with the arrow keys and Enter', async () => {
    const onModelChange = vi.fn();
    const other = { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', label: 'GPT-5' };
    renderComposer({
      modelOptions: [modelOptions[0], other],
      onModelChange
    });

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);
    const search = screen.getByPlaceholderText('Search models, providers, nodes…');
    await fireEvent.keyDown(search, { key: 'ArrowDown' });
    await fireEvent.keyDown(search, { key: 'Enter' });

    expect(onModelChange).toHaveBeenCalledWith(other.id);
  });

  it('moves active session reasoning into the model picker and still cycles it from the prompt', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionProfileLabel: 'Default',
      sessionConfigOptions: [{
        id: 'reasoning',
        name: 'Reasoning effort',
        type: 'select',
        currentValue: 'low',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' }
        ]
      }],
      onSessionConfigChange
    });

    await fireEvent.click(screen.getByLabelText('Session options'));
    expect(screen.queryByRole('button', { name: 'Reasoning effort' })).not.toBeInTheDocument();
    expect(screen.queryByText('Adjust reasoning for the next reply')).not.toBeInTheDocument();

    const modelButton = screen.getByRole('button', { name: 'Claude Sonnet 4 from anthropic; reasoning effort: Low' });
    expect(modelButton.querySelector('.composer-reasoning-badge')).toHaveTextContent('Low');
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');
    await fireEvent.keyDown(prompt, { key: 't', ctrlKey: true });
    expect(onSessionConfigChange).toHaveBeenCalledWith('reasoning', 'high');
    expect(modelButton.querySelector('.composer-reasoning-badge')).toHaveTextContent('Low');

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);
    const reasoning = screen.getByRole('button', { name: 'Reasoning effort' });
    expect(reasoning).toHaveTextContent('Low');
    expect(reasoning.closest('.delegate-reasoning-control')).not.toBeNull();
    expect(screen.getByText('Adjust reasoning for the next reply')).toBeInTheDocument();
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

    const picker = screen.getByRole('dialog', { name: 'Switch model' });
    const rows = within(picker).getAllByRole('button', { name: /Claude Sonnet 4/i }).filter((button) => button.classList.contains('delegate-model-choice'));
    expect(rows).toHaveLength(2);
    expect(within(picker).getByText('anthropic', { selector: '.delegate-model-picker-group-title > span' })).toBeInTheDocument();
    expect(within(picker).getByText('anthropic · flkr', { selector: '.delegate-model-picker-group-title > span' })).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('anthropic/claude-sonnet-4');
    expect(within(rows[0]).getByLabelText('1,050,000 token context window')).toHaveTextContent('1M');
    expect(rows[0].querySelector('.app-picker-row-detail')?.firstElementChild).toHaveClass('app-picker-row-context');
    expect(rows[0].querySelector('.app-picker-row-detail')?.lastElementChild).toHaveClass('app-picker-model-modalities');
    expect(within(rows[1]).getByLabelText('Mesh node flkr')).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText('128,000 token context window')).toHaveTextContent('128K');
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true');
    expect(rows[1].querySelector('.delegate-model-choice-name-selected')).toHaveTextContent('Claude Sonnet 4');
    expect(rows[1].querySelector('.lucide-check')).not.toBeNull();
    expect(rows[0].querySelector('.lucide-check')).toBeNull();
    expect(rows[0].querySelectorAll('.app-picker-model-modality')).toHaveLength(2);
    expect(rows[1].querySelectorAll('.app-picker-model-modality')).toHaveLength(2);

    await fireEvent.click(rows[1]);
    expect(onModelChange).toHaveBeenCalledWith(getModelSelectionKey(remoteModel));
  });

  it('shows unknown rather than a recent or first model for an unconfigured session', () => {
    renderComposer({ sessionOnly: true, selectedModelId: '', recentModels: modelOptions });
    expect(screen.getByRole('button', { name: 'Model unknown' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claude Sonnet 4/i })).not.toBeInTheDocument();
  });

  it('keeps an unavailable model identity visible instead of substituting the first model', () => {
    renderComposer({ sessionOnly: true, selectedModelId: 'xai/grok-4.6', recentModels: modelOptions });
    expect(screen.getByRole('button', { name: 'xai/grok-4.6 (unavailable)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Claude Sonnet 4/i })).not.toBeInTheDocument();
  });

  it('disables session model changes while loading or waiting for a config response', async () => {
    const { rerender } = renderComposer({ sessionOnly: true, selectedModelId: '', modelLoading: true });
    expect(screen.getByRole('button', { name: 'Loading model...' })).toBeDisabled();
    await rerender({ modelLoading: false, selectedModelId: modelOptions[0].id, sessionConfigPending: { model: true } });
    expect(screen.getByRole('button', { name: /Claude Sonnet 4/i })).toBeDisabled();
    await rerender({ sessionConfigPending: {} });
    expect(screen.getByRole('button', { name: /Claude Sonnet 4/i })).toBeEnabled();
  });

  it('opens the model picker with Cmd+M from the prompt', async () => {
    renderComposer();

    await fireEvent.keyDown(screen.getAllByPlaceholderText(/Ask QueryMT/i)[0], { key: 'm', metaKey: true });

    expect(screen.getByText('Switch model')).toBeInTheDocument();
  });

  it('offers steer and queue delivery from options while a supported run is active', async () => {
    const onSendPrompt = vi.fn();
    const onStopPrompt = vi.fn();
    const onInputDeliveryChange = vi.fn();
    const { container, rerender } = renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      prompt: 'Change direction',
      agentRunning: true,
      turnControlSupported: true,
      inputDelivery: 'steer',
      onSendPrompt,
      onStopPrompt,
      onInputDeliveryChange
    });

    const sendButton = container.querySelector('button.action-btn-primary') as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton).toHaveAttribute('aria-label', 'Steer');
    expect(sendButton!.querySelector('.lucide-navigation')).not.toBeNull();
    expect(sendButton!.textContent?.trim()).toBe('Steer');
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument();
    await fireEvent.click(sendButton!);
    expect(onSendPrompt).toHaveBeenCalledTimes(1);

    const optionsHost = container.querySelector('.composer-options-host') as HTMLElement | null;
    const options = optionsHost?.querySelector('.composer-options') as HTMLDetailsElement | null;
    expect(options).not.toBeNull();
    options!.open = true;
    const switchGroup = within(optionsHost!).getByRole('group', { name: 'Input delivery' });
    expect(within(switchGroup).getByRole('button', { name: /Steer/ })).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.click(within(switchGroup).getByRole('button', { name: /Queue/ }));
    expect(onInputDeliveryChange).toHaveBeenCalledWith('queue');

    await rerender({ inputDelivery: 'queue' });
    expect(sendButton).toHaveAttribute('aria-label', 'Queue');
    expect(sendButton!.querySelector('.lucide-plus')).not.toBeNull();
    expect(sendButton!.textContent?.trim()).toBe('Queue');
  });

  it('keeps the send icon while idle and only swaps glyphs for active steer/queue runs', async () => {
    const { container, rerender } = renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      prompt: 'Idle reply',
      inputDelivery: 'queue'
    });
    const sendButton = screen.getByRole('button', { name: 'Send reply' });
    expect(sendButton.querySelector('.lucide-send-horizontal')).not.toBeNull();
    expect(sendButton.querySelector('.lucide-plus')).toBeNull();
    expect(container.querySelector('.composer-delivery-switch')).toBeNull();

    await rerender({ agentRunning: true, turnControlSupported: true, inputDelivery: 'steer' });
    expect(container.querySelector('.composer-delivery-switch')).not.toBeNull();
    const steerButton = container.querySelector('button.action-btn-primary');
    expect(steerButton?.querySelector('.lucide-navigation')).not.toBeNull();
    expect(steerButton?.getAttribute('aria-label')).toBe('Steer');

    await rerender({ inputDelivery: 'queue' });
    const queueButton = container.querySelector('button.action-btn-primary');
    expect(queueButton?.querySelector('.lucide-plus')).not.toBeNull();
    expect(queueButton?.getAttribute('aria-label')).toBe('Queue');
  });

  it('hides the delivery row when the active run does not support turn control', () => {
    const { container } = renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      prompt: 'Busy reply',
      agentRunning: true,
      turnControlSupported: false
    });

    expect(container.querySelector('.composer-delivery-switch')).toBeNull();
  });

  it('uses Enter for the active-run delivery action instead of stopping', async () => {
    const onSendPrompt = vi.fn();
    const onStopPrompt = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      prompt: 'Change direction',
      agentRunning: true,
      turnControlSupported: true,
      inputDelivery: 'steer',
      onSendPrompt,
      onStopPrompt
    });

    const prompt = screen.getByPlaceholderText('Write a reply for this session...');
    await fireEvent.keyDown(prompt, { key: 'Enter' });
    expect(onSendPrompt).toHaveBeenCalledTimes(1);
    expect(onStopPrompt).not.toHaveBeenCalled();
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

  it('does not autofocus the expanded composer on narrow viewports', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('max-width: 760px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })));

    renderComposer({ docked: true, collapsed: false, sessionOnly: true, chatView: true });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');
    await Promise.resolve();

    expect(prompt).not.toHaveFocus();
  });

  it('tracks focus requests while the current viewport blocks programmatic focus', async () => {
    let narrowViewport = true;
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: narrowViewport && query.includes('max-width: 760px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })));

    const { rerender } = renderComposer({
      docked: true,
      collapsed: false,
      sessionOnly: true,
      chatView: true,
      promptFocusToken: 0
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');
    expect(prompt).not.toHaveFocus();

    narrowViewport = false;
    await rerender({ promptFocusToken: 1 });

    await waitFor(() => expect(prompt).toHaveFocus());
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

  it('renders compact pending image triggers without captions and keeps removal independent', async () => {
    const onRemoveAttachment = vi.fn();
    const { container } = renderComposer({
      launch: true,
      compact: true,
      attachments: [
        { id: 'img-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' },
        { id: 'file-1', name: 'notes.txt', mimeType: 'text/plain', size: 4, data: 'dGV4dA==' }
      ],
      onRemoveAttachment
    });

    const trigger = screen.getByRole('button', { name: 'Open photo.png' });
    expect(trigger).toHaveAttribute('title', 'photo.png');
    expect(within(trigger).getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'data:image/png;base64,aW1n');
    expect(within(trigger).getByRole('img', { name: 'photo.png' })).toHaveClass('session-image-thumbnail');
    expect(container.querySelector('.session-attachments')).toHaveClass('session-attachments-compact');
    expect(container.querySelector('figcaption')).toBeNull();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }));

    expect(onRemoveAttachment).toHaveBeenCalledWith('img-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the selected pending image in the minimal shared lightbox and navigates the gallery', async () => {
    renderComposer({
      attachments: [
        { id: 'img-1', name: 'first.png', mimeType: 'image/png', size: 3, data: 'Zmlyc3Q=' },
        { id: 'img-2', name: 'second.jpg', mimeType: 'image/jpeg', size: 4, data: 'c2Vjb25k' }
      ]
    });

    const trigger = screen.getByRole('button', { name: 'Open second.jpg' });
    await fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'second.jpg' });
    const zoomLevel = within(dialog).getByLabelText('Zoom level');
    expect(dialog).toHaveClass('session-image-lightbox');
    expect(within(dialog).getByRole('heading', { name: 'second.jpg' })).toHaveClass('session-image-lightbox-filename');
    expect(within(dialog).getByRole('img', { name: 'second.jpg' })).toHaveAttribute('src', 'data:image/jpeg;base64,c2Vjb25k');
    expect(within(dialog).getByRole('img', { name: 'second.jpg' })).toHaveClass('session-image-lightbox-image-fit');
    expect(within(dialog).getByRole('button', { name: 'Close image preview' })).toHaveClass('session-image-lightbox-close');
    expect(zoomLevel).toHaveClass('session-image-lightbox-zoom');
    expect(zoomLevel).toHaveTextContent('100%');
    expect(within(dialog).queryByRole('button', { name: /Zoom|Reset/i })).not.toBeInTheDocument();
    expect(document.querySelector('.session-image-viewport')).toBeNull();
    expect(document.querySelector('.app-dialog-body')).toBeNull();

    await fireEvent.wheel(dialog, { ctrlKey: false, deltaY: -100 });
    expect(zoomLevel).toHaveTextContent('100%');
    const ctrlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    dialog.dispatchEvent(ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(zoomLevel).toHaveTextContent('110%'));

    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'first.png' })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'first.png' })).toHaveAttribute('src', 'data:image/png;base64,Zmlyc3Q=');
    expect(zoomLevel).toHaveTextContent('100%');
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'second.jpg' })).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Close image preview' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows pending attachment count in the collapsed composer', () => {
    renderComposer({
      collapsed: true,
      docked: true,
      sessionOnly: true,
      attachments: [{ id: 'img-1', name: 'photo.png', mimeType: 'image/png', size: 3, data: 'aW1n' }]
    });
    expect(screen.getByLabelText('1 pending attachments')).toHaveTextContent('1');
  });

  it('rejects an oversized resource while keeping valid mixed files', async () => {
    const onAddAttachments = vi.fn();
    renderComposer({ onAddAttachments });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const image = new File(['image'], 'photo.png', { type: 'image/png' });
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' });

    await fireEvent.change(picker, { target: { files: [text, oversized, image] } });
    await vi.waitFor(() => expect(onAddAttachments).toHaveBeenCalledOnce());
    expect(onAddAttachments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: 'notes.txt', mimeType: 'text/plain', size: 5 }),
      expect.objectContaining({ name: 'photo.png', mimeType: 'image/png', size: 5 })
    ]);
    expect(screen.getByRole('alert')).toHaveTextContent('huge.pdf: attachments must be 10 MiB or smaller.');
  });

  it('normalizes dropped files through the shared attachment path', async () => {
    const onAddAttachments = vi.fn();
    renderComposer({ onAddAttachments });
    const file = new File(['drop'], 'dropped.txt', { type: 'text/plain' });

    await fireEvent.drop(screen.getByRole('region', { name: 'Prompt and attachment drop zone' }), {
      dataTransfer: { files: [file] }
    });
    await vi.waitFor(() => expect(onAddAttachments).toHaveBeenCalledOnce());
    expect(onAddAttachments.mock.calls[0][0][0]).toMatchObject({ name: 'dropped.txt', mimeType: 'text/plain', size: 4 });
  });

  it('normalizes clipboard files through the shared attachment path', async () => {
    const onAddAttachments = vi.fn();
    renderComposer({ onAddAttachments });
    const prompt = screen.getAllByPlaceholderText(/Ask QueryMT/i)[0];
    const image = new File(['img'], 'pasted.png', { type: 'image/png' });

    await fireEvent.paste(prompt, { clipboardData: { files: [image] } });
    await vi.waitFor(() => expect(onAddAttachments).toHaveBeenCalledOnce());
    expect(onAddAttachments.mock.calls[0][0][0]).toMatchObject({ name: 'pasted.png', mimeType: 'image/png', size: 3 });
  });

  it('snapshots picked files before the picker reset empties its live FileList', async () => {
    const onAddAttachments = vi.fn();
    renderComposer({ onAddAttachments });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const liveFiles: File[] = [file];

    // Emulate browser behavior: clearing the input value empties the live FileList.
    Object.defineProperty(picker, 'files', { get: () => liveFiles as unknown as FileList, configurable: true });
    Object.defineProperty(picker, 'value', {
      configurable: true,
      get: () => '',
      set: () => {
        liveFiles.length = 0;
      }
    });

    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(onAddAttachments).toHaveBeenCalledOnce());
    expect(onAddAttachments.mock.calls[0][0][0]).toMatchObject({ name: 'notes.txt' });
  });

  it('surfaces attachment quota errors in the collapsed composer', async () => {
    renderComposer({ collapsed: true, docked: true, sessionOnly: true, onAddAttachments: vi.fn() });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' });

    await fireEvent.change(picker, { target: { files: [oversized] } });
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('huge.pdf: attachments must be 10 MiB or smaller.')
    );
  });

  it('serializes overlapping attachment batches so total quota is enforced', async () => {
    const onAddAttachments = vi.fn();
    renderComposer({ onAddAttachments });
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = (name: string, megabytes: number) =>
      new File([new Uint8Array(megabytes * 1024 * 1024)], name, { type: 'application/pdf' });

    await fireEvent.change(picker, { target: { files: [big('first.pdf', 8), big('second.pdf', 4)] } });
    await fireEvent.change(picker, { target: { files: [big('third.pdf', 9)] } });

    await vi.waitFor(() => expect(onAddAttachments).toHaveBeenCalledOnce());
    expect(onAddAttachments.mock.calls[0][0]).toEqual([
      expect.objectContaining({ name: 'first.pdf' }),
      expect.objectContaining({ name: 'second.pdf' })
    ]);
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('third.pdf: attachments cannot exceed 20 MiB total.')
    );
  });

  it('dismisses composer errors', async () => {
    const onDismissError = vi.fn();
    renderComposer({ error: 'Prompt failed', onDismissError });

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe('SessionComposer workspace focus and suggestions', () => {
  it('keeps suggestions open after quickly returning to the workspace field', async () => {
    vi.useFakeTimers();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/workspace', '/tmp/other-project'] });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace') as HTMLInputElement;
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);
    input.focus();
    await tick();
    expect(screen.getByRole('button', { name: /other-project/ })).toBeInTheDocument();
    prompt.focus();
    await vi.advanceTimersByTimeAsync(20);
    input.focus();
    input.setSelectionRange(0, 0);
    await vi.advanceTimersByTimeAsync(200);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(screen.getByRole('button', { name: /other-project/ })).toBeInTheDocument();
  });

  it('keeps the typed path selected and does not let suggestions steal focus', async () => {
    renderComposer({ launch: true, cwd: '/tmp/workspace' });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(5, 14);
    await screen.findByRole('button', { name: /other-project/ });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(14);
  });

  it('lets mouse selection apply a suggested workspace without losing input focus', async () => {
    const onCwdInput = vi.fn();
    renderComposer({ launch: true, cwd: '/tmp/workspace', onCwdInput });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    const suggestion = await screen.findByRole('button', { name: /other-project/ });
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    suggestion.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await fireEvent.click(suggestion);
    expect(onCwdInput).toHaveBeenCalledWith('/tmp/other-project');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: /other-project/ })).not.toBeInTheDocument();
  });

  it.each(['mouse', 'touch'] as const)('applies a suggestion when %s interaction blurs the input before click', async (pointerType) => {
    vi.useFakeTimers();
    const onCwdInput = vi.fn();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/workspace', '/tmp/other-project'], onCwdInput });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    await tick();
    const suggestion = screen.getByRole('button', { name: /other-project/ });
    await fireEvent.pointerDown(suggestion, { pointerType, button: 0 });
    // A webview can blur to the document before click, even with mousedown prevented.
    input.blur();
    await vi.advanceTimersByTimeAsync(300);
    expect(suggestion).toBeInTheDocument();
    expect(onCwdInput).not.toHaveBeenCalled();
    await fireEvent.pointerUp(suggestion, { pointerType, button: 0 });
    await fireEvent.click(suggestion);
    expect(onCwdInput).toHaveBeenCalledExactlyOnceWith('/tmp/other-project');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: /other-project/ })).not.toBeInTheDocument();
  });

  it('keeps suggestion buttons available while focus moves within the widget', async () => {
    const onCwdInput = vi.fn();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/workspace'], onCwdInput });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    await tick();
    const suggestion = screen.getByRole('button', { name: /workspace/ });
    suggestion.focus();
    await tick();
    expect(suggestion).toBeInTheDocument();
    await fireEvent.click(suggestion);
    expect(onCwdInput).toHaveBeenCalledWith('/tmp/workspace');
    expect(input).toHaveFocus();
  });

  it('does not apply a pressed suggestion when the interaction is cancelled outside the widget', async () => {
    const onCwdInput = vi.fn();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/workspace'], onCwdInput });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    await tick();
    const suggestion = screen.getByRole('button', { name: /workspace/ });
    await fireEvent.pointerDown(suggestion, { button: 0, pointerType: 'touch' });
    input.blur();
    await fireEvent.pointerCancel(suggestion, { pointerType: 'touch' });
    await fireEvent.pointerDown(screen.getByPlaceholderText(/Ask QueryMT/i), { button: 0 });
    expect(onCwdInput).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /workspace/ })).not.toBeInTheDocument();
  });

  it.each(['blur', 'Escape', 'selection'] as const)('ignores an async response after suggestion dismissal by %s', async (action) => {
    vi.useFakeTimers();
    let release!: (value: Array<{ path: string; name: string }>) => void;
    mockSuggestWorkspacePaths.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const onCwdInput = vi.fn();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/recent'], onCwdInput });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    await tick();
    await fireEvent.input(input, { target: { value: '/tmp/w' } });
    if (action === 'blur') screen.getByPlaceholderText(/Ask QueryMT/i).focus();
    else if (action === 'Escape') await fireEvent.keyDown(input, { key: 'Escape' });
    else await fireEvent.click(screen.getByRole('button', { name: /recent/ }));
    await vi.advanceTimersByTimeAsync(150);
    release([{ path: '/tmp/late-result', name: 'late-result' }]);
    await tick();
    await tick();
    expect(screen.queryByRole('button', { name: /late-result/ })).not.toBeInTheDocument();
    expect(document.querySelector('.workspace-input-loading')).toBeNull();
    if (action === 'blur') expect(input).not.toHaveFocus();
    else expect(input).toHaveFocus();
  });

  it('keeps keyboard completion and Escape from submitting a session', async () => {
    const onCwdInput = vi.fn();
    const onSendPrompt = vi.fn();
    renderComposer({ launch: true, recentWorkspaces: ['/tmp/workspace', '/tmp/other-project'], onCwdInput, onSendPrompt });
    await tick();
    const input = screen.getByPlaceholderText('/absolute/path/to/workspace');
    input.focus();
    await tick();
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCwdInput).toHaveBeenLastCalledWith('/tmp/other-project');
    expect(input).toHaveFocus();
    expect(onSendPrompt).not.toHaveBeenCalled();
    screen.getByPlaceholderText(/Ask QueryMT/i).focus();
    input.focus();
    await tick();
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /other-project/ })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});

describe('SessionComposer model picker focus and mode cycling', () => {
  const sessionModeOptions = [
    {
      id: 'mode',
      name: 'Mode',
      type: 'select',
      currentValue: 'build',
      options: [
        { value: 'build', name: 'Build' },
        { value: 'plan', name: 'Plan' }
      ]
    }
  ];
  const singleModeOptions = [
    {
      id: 'mode',
      name: 'Mode',
      type: 'select',
      currentValue: 'build',
      options: [{ value: 'build', name: 'Build' }]
    }
  ];

  function pickerRow() {
    return screen
      .getAllByRole('button', { name: /Claude Sonnet 4/i })
      .find((button) => button.classList.contains('delegate-model-choice'))!;
  }

  async function closeAndWait() {
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Switch model' })).not.toBeInTheDocument());
  }

  /** Dispatches a cancelable Tab keydown; returns true when traversal may continue. */
  function pressTab(target: Element, modifiers: { shiftKey?: boolean } = {}): boolean {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event);
    return !event.defaultPrevented;
  }

  it('returns focus to the prompt after selecting a model from a keyboard-opened picker', async () => {
    const onModelChange = vi.fn();
    renderComposer({ onModelChange });
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    await fireEvent.keyDown(prompt, { key: 'm', metaKey: true });
    await fireEvent.click(pickerRow());
    await closeAndWait();

    expect(onModelChange).toHaveBeenCalled();
    expect(prompt).toHaveFocus();
  });

  it('returns focus to the prompt when a keyboard-opened picker is cancelled', async () => {
    renderComposer();
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    await fireEvent.keyDown(prompt, { key: 'm', metaKey: true });
    await fireEvent.keyDown(screen.getByPlaceholderText('Search models, providers, nodes…'), { key: 'Escape' });
    await closeAndWait();

    expect(prompt).toHaveFocus();
  });

  it('returns focus to the prompt after selecting a model from a trigger-opened picker', async () => {
    renderComposer();

    await fireEvent.click(screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0]);
    await fireEvent.click(pickerRow());
    await closeAndWait();

    expect(screen.getByPlaceholderText(/Ask QueryMT/i)).toHaveFocus();
  });

  it('does not force prompt focus when programmatic prompt focus is disabled', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false)
    })));
    renderComposer();
    const trigger = screen.getAllByRole('button', { name: /Claude Sonnet 4/i })[0];
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    await fireEvent.keyDown(prompt, { key: 'm', metaKey: true });
    await fireEvent.keyDown(screen.getByPlaceholderText('Search models, providers, nodes…'), { key: 'Escape' });
    await closeAndWait();

    // The small-screen/coarse-pointer guard declines prompt focus; the dialog
    // falls back to its default (trigger) instead of forcing the keyboard open.
    expect(prompt).not.toHaveFocus();
    expect(trigger).toHaveFocus();
  });

  it('cycles the active session mode on Tab and consumes the keypress', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: sessionModeOptions,
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(false);
    expect(onSessionConfigChange).toHaveBeenCalledWith('mode', 'plan');
  });

  it('does not consume Tab while a mode update is pending', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: sessionModeOptions,
      sessionConfigPending: { mode: true },
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
    expect(onSessionConfigChange).not.toHaveBeenCalled();
  });

  it('does not consume Tab when fewer than two modes are available', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: singleModeOptions,
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
    expect(onSessionConfigChange).not.toHaveBeenCalled();
  });

  it('does not consume Tab when the session has no mode option', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: [],
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
    expect(onSessionConfigChange).not.toHaveBeenCalled();
  });

  it('cycles launch modes on Tab in the new-session composer', async () => {
    const onLaunchModeChange = vi.fn();
    renderComposer({
      launch: true,
      launchModeOptions: [
        { id: 'build', label: 'Build' },
        { id: 'plan', label: 'Plan' }
      ],
      selectedLaunchModeId: 'build',
      onLaunchModeChange
    });
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(false);
    expect(onLaunchModeChange).toHaveBeenCalledWith('plan');
  });

  it('does not consume Tab when only one launch mode is available', async () => {
    const onLaunchModeChange = vi.fn();
    renderComposer({
      launch: true,
      launchModeOptions: [{ id: 'build', label: 'Build' }],
      selectedLaunchModeId: 'build',
      onLaunchModeChange
    });
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
    expect(onLaunchModeChange).not.toHaveBeenCalled();
  });

  it('keeps Shift+Tab for backward focus traversal in the session composer', async () => {
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: sessionModeOptions,
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt, { shiftKey: true });

    expect(notConsumed).toBe(true);
    expect(onSessionConfigChange).not.toHaveBeenCalled();
  });

  it('keeps Shift+Tab for backward focus traversal in the new-session composer', async () => {
    const onLaunchModeChange = vi.fn();
    renderComposer({
      launch: true,
      launchModeOptions: [
        { id: 'build', label: 'Build' },
        { id: 'plan', label: 'Plan' }
      ],
      selectedLaunchModeId: 'build',
      onLaunchModeChange
    });
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    const notConsumed = pressTab(prompt, { shiftKey: true });

    expect(notConsumed).toBe(true);
    expect(onLaunchModeChange).not.toHaveBeenCalled();
  });

  it('does not consume Tab when no session config callback is provided', async () => {
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: sessionModeOptions
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
  });

  it('does not consume Tab when no launch mode callback is provided', async () => {
    renderComposer({
      launch: true,
      launchModeOptions: [
        { id: 'build', label: 'Build' },
        { id: 'plan', label: 'Plan' }
      ],
      selectedLaunchModeId: 'build'
    });
    const prompt = screen.getByPlaceholderText(/Ask QueryMT/i);

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(true);
  });

  it('supports Ctrl+M model selection then Tab mode cycling end to end', async () => {
    const onModelChange = vi.fn();
    const onSessionConfigChange = vi.fn();
    renderComposer({
      activeSessionId: 'session-1',
      sessionOnly: true,
      sessionConfigOptions: sessionModeOptions,
      onModelChange,
      onSessionConfigChange
    });
    const prompt = screen.getByPlaceholderText('Write a reply for this session...');

    await fireEvent.keyDown(prompt, { key: 'm', ctrlKey: true });
    await fireEvent.click(pickerRow());
    await closeAndWait();

    expect(onModelChange).toHaveBeenCalled();
    expect(prompt).toHaveFocus();

    const notConsumed = pressTab(prompt);

    expect(notConsumed).toBe(false);
    expect(onSessionConfigChange).toHaveBeenCalledWith('mode', 'plan');
  });
});
