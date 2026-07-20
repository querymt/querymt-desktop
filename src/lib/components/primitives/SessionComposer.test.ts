import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionComposer from './SessionComposer.svelte';

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
