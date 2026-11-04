<script lang="ts">
  import { ChevronDown, FileCog, FilePlus2, GitBranch, Maximize2, Minimize2, Monitor, Navigation, Paperclip, Plus, RefreshCw, SendHorizontal, Settings2, SlidersHorizontal, Square, Waypoints, X } from '@lucide/svelte';
  import { tick, type Component } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import ComposerSplitPillSelect from '$lib/components/primitives/ComposerSplitPillSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import ModelQuickPicker from '$lib/components/primitives/ModelQuickPicker.svelte';
  import type { ModelPickerReasoningControl } from '$lib/components/primitives/ModelPickerPanel.svelte';
  import WorkspacePathInput from '$lib/components/primitives/WorkspacePathInput.svelte';
  import { autoCollapsePopover } from '$lib/design/details-popover';
  import SessionAttachmentPreview from '$lib/components/session/SessionAttachmentPreview.svelte';
  import {
    findModeConfigOption,
    findReasoningConfigOption,
    getConfigOptionChoices,
    type ModelLocationContext
  } from '$lib/querymt/config-options';
  import ComposerAddMenu, { type ComposerAddMenuAction } from './ComposerAddMenu.svelte';
  import { getModeToneIndex } from '$lib/domain/session-mode-tone';
  import type { ComposerOption, ModelEntry, ModelInfo, PromptAttachment, SessionContentBlock, SessionInputDeliveryMode } from '$lib/domain/types';
  import type { SendShortcut } from '$lib/stores/chat-preferences.svelte';
  import type { SessionConfigOption } from '@agentclientprotocol/sdk';

  let modelPickerRef: { openPicker: () => Promise<void> } | null = null;
  let fileInputElement = $state<HTMLInputElement | null>(null);
  let isDragging = $state(false);
  let attachmentErrors = $state<string[]>([]);

  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
  const MAX_IMAGES = 8;

  let {
    cwd = '',
    prompt = '',
    loading = false,
    error = null,
    compact = false,
    minimal = false,
    launch = false,
    starting = false,
    activeSessionId = null,
    promptFocusToken = 0,
    sessionOnly = false,
    docked = false,
    collapsed = false,
    dockAlignLeft = null,
    dockAlignWidth = null,
    chatView = false,
    sendShortcut = 'enter',
    modelOptions = [],
    selectedModelId = '',
    modelInfo = {},
    modelLocation = undefined,
    recentModels = [],
    modelLoading = false,
    agentLabel = null,
    recentWorkspaces = [],
    attachments = [],
    profileOptions = [],
    selectedProfileId = 'default',
    sessionProfileLabel = null,
    launchModeOptions = [],
    selectedLaunchModeId = 'build',
    launchReasoningOptions = [],
    selectedLaunchReasoningId = 'auto',
    targetOptions = [],
    selectedTargetId = 'local',
    workspaceModeOptions = [],
    selectedWorkspaceMode = 'local',
    sessionConfigOptions = [],
    sessionConfigPending = {},
    delegateModelCount = 0,
    delegateModelsLoading = false,
    delegateModelsError = null,
    onCwdInput = null,
    onPromptInput,
    onModelChange = null,
    onRefreshModels = null,
    onAddAttachments = null,
    onRemoveAttachment = null,
    onProfileChange = null,
    onLaunchModeChange = null,
    onLaunchReasoningChange = null,
    onTargetChange = null,
    onWorkspaceModeChange = null,
    onSessionConfigChange = null,
    onOpenDelegateModels = null,
    onCreateSession = null,
    onDismissError = null,
    agentRunning = false,
    turnControlSupported = false,
    inputDelivery = 'steer',
    inputDeliveryPreference = null,
    onInputDeliveryChange = null,
    onStopPrompt = null,
    onPromptExpandedChange = null,
    onSendPrompt
  }: {
    cwd?: string;
    prompt?: string;
    loading?: boolean;
    error?: string | null;
    compact?: boolean;
    minimal?: boolean;
    launch?: boolean;
    /** Launcher only: a session is being created, so the start button shows progress. */
    starting?: boolean;
    activeSessionId?: string | null;
    promptFocusToken?: number;
    sessionOnly?: boolean;
    docked?: boolean;
    collapsed?: boolean;
    dockAlignLeft?: number | null;
    dockAlignWidth?: number | null;
    chatView?: boolean;
    sendShortcut?: SendShortcut;
    modelOptions?: ModelEntry[];
    selectedModelId?: string;
    modelInfo?: Record<string, ModelInfo | null>;
    modelLocation?: ModelLocationContext;
    recentModels?: ModelEntry[];
    modelLoading?: boolean;
    agentLabel?: string | null;
    recentWorkspaces?: string[];
    attachments?: PromptAttachment[];
    profileOptions?: ComposerOption[];
    selectedProfileId?: string;
    /** Resolved label of the profile this session was started with; shown read-only in-session. */
    sessionProfileLabel?: string | null;
    launchModeOptions?: ComposerOption[];
    selectedLaunchModeId?: string;
    launchReasoningOptions?: ComposerOption[];
    selectedLaunchReasoningId?: string;
    targetOptions?: ComposerOption[];
    selectedTargetId?: string;
    /** Workspace choices (Local checkout / New worktree ...); fewer than two hides the option. */
    workspaceModeOptions?: ComposerOption[];
    selectedWorkspaceMode?: string;
    sessionConfigOptions?: SessionConfigOption[];
    sessionConfigPending?: Record<string, boolean>;
    delegateModelCount?: number;
    delegateModelsLoading?: boolean;
    delegateModelsError?: string | null;
    onCwdInput?: ((value: string) => void) | null;
    onPromptInput: (value: string) => void;
    onModelChange?: ((value: string) => void | Promise<void>) | null;
    onRefreshModels?: (() => void) | null;
    onAddAttachments?: ((attachments: PromptAttachment[]) => void) | null;
    onRemoveAttachment?: ((attachmentId: string) => void) | null;
    onProfileChange?: ((profileId: string) => void) | null;
    onLaunchModeChange?: ((modeId: string) => void) | null;
    onLaunchReasoningChange?: ((reasoningId: string) => void) | null;
    onTargetChange?: ((targetId: string) => void) | null;
    onWorkspaceModeChange?: ((mode: string) => void) | null;
    onSessionConfigChange?: ((configId: string, value: string) => void | Promise<void>) | null;
    onOpenDelegateModels?: (() => void) | null;
    onCreateSession?: (() => void) | null;
    onDismissError?: (() => void) | null;
    agentRunning?: boolean;
    turnControlSupported?: boolean;
    inputDelivery?: SessionInputDeliveryMode;
    /** The user's saved choice. `inputDelivery` is the effective mode and can be forced to queue (idle, non-steerable run, slash command). */
    inputDeliveryPreference?: SessionInputDeliveryMode | null;
    onInputDeliveryChange?: ((delivery: SessionInputDeliveryMode) => void) | null;
    onStopPrompt?: (() => void) | null;
    onPromptExpandedChange?: ((expanded: boolean) => void) | null;
    onSendPrompt: () => void;
  } = $props();

  let promptElement: HTMLTextAreaElement | null = null;
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;
  let dockElement = $state<HTMLElement | null>(null);

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function composerMorph(node: Element, { compact }: { compact: boolean }): TransitionConfig {
    const style = getComputedStyle(node);
    const opacity = Number(style.opacity) || 1;
    // Clip with the shell's real corner radius so the morph never shows a
    // different shape than the resting card (it follows the CSS, including
    // the larger radius on narrow windows).
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 12;

    return {
      duration: prefersReducedMotion() ? 0 : 220,
      easing: cubicOut,
      css: (t) => {
        const hidden = 1 - t;
        const translateY = hidden * (compact ? 8 : 4);
        const clipTop = hidden * (compact ? 35 : 72);

        return `opacity:${t * opacity};transform:translateY(${translateY}px);clip-path:inset(${clipTop}% 0 0 0 round ${radius}px);overflow:clip;`;
      }
    };
  }

  function composerOut(node: HTMLElement, params: { compact: boolean }): TransitionConfig {
    // Pull the leaving shell out of flow so the dock adopts the incoming
    // shell's height immediately — the measured clearance and the activity
    // bar (anchored to --session-composer-live-top) then move in sync with
    // the morph instead of lagging until the transition ends.
    node.style.position = 'absolute';
    node.style.left = '0';
    node.style.right = '0';
    node.style.bottom = '0';
    return composerMorph(node, params);
  }

  const unifiedShell = $derived(launch || sessionOnly);
  const creatingBlankSession = $derived(!activeSessionId && prompt.trim().length === 0 && attachments.length === 0);
  const attachmentBlocks = $derived(attachments.map((attachment): SessionContentBlock =>
    attachment.mimeType.startsWith('image/')
      ? { type: 'image', data: attachment.data, mimeType: attachment.mimeType, id: attachment.id, name: attachment.name, size: attachment.size }
      : { type: 'resource', uri: `attachment:///${encodeURIComponent(attachment.id)}/${encodeURIComponent(attachment.name)}`, data: attachment.data, mimeType: attachment.mimeType, id: attachment.id, name: attachment.name, size: attachment.size }
  ));
  const sessionPlaceholder = 'Write a reply for this session...';
  const hasDraft = $derived(prompt.trim().length > 0 || attachments.length > 0);
  const hasPromptText = $derived(prompt.trim().length > 0);
  let promptExpanded = $state(false);

  $effect(() => {
    if (!hasPromptText) promptExpanded = false;
  });

  $effect(() => {
    onPromptExpandedChange?.(promptExpanded);
  });
  const primaryActionLabel = $derived(
    agentRunning && turnControlSupported
      ? inputDelivery === 'queue' ? 'Queue' : 'Steer'
      : 'Send reply'
  );
  // The send glyph is only overridden while a steerable run is active; idle
  // composers always render the plain send arrow (never the queue "+").
  const primaryActionIcon = $derived(
    agentRunning && turnControlSupported
      ? inputDelivery === 'queue' ? Plus : Navigation
      : SendHorizontal
  );
  // Shown whenever the session supports turn control, not only mid-run, so the
  // row doesn't appear and vanish as the agent starts and stops. The choice is
  // remembered and applies to the next message sent while a run is active.
  const deliveryChoice = $derived(inputDeliveryPreference ?? inputDelivery);
  const deliveryControlAvailable = $derived(!!activeSessionId && turnControlSupported);
  const promptMinHeightClass = $derived.by(() => {
    if (chatView && sessionOnly) return 'min-h-[76px]';
    if (launch) return 'min-h-[104px]';
    if (sessionOnly) return 'min-h-[116px]';
    if (minimal) return 'min-h-[168px]';
    if (compact) return 'min-h-[116px]';
    return 'min-h-[156px]';
  });

  const dockPositionStyle = $derived.by(() => {
    if (!docked || dockAlignLeft == null || dockAlignWidth == null) return '';
    return `left:${dockAlignLeft}px;width:${dockAlignWidth}px;transform:none;`;
  });

  $effect(() => {
    const dock = docked ? dockElement : null;
    if (!dock || typeof ResizeObserver !== 'function') return;

    const syncClearance = () => {
      const height = dock.getBoundingClientRect().height;
      if (height <= 0) return;
      document.documentElement.style.setProperty(
        '--session-composer-measured-clearance',
        `calc(${Math.ceil(height)}px + var(--session-composer-bottom-offset) + 0.75rem)`
      );
      document.documentElement.style.setProperty(
        '--session-composer-live-top',
        `calc(${Math.ceil(height)}px + var(--session-composer-bottom-offset))`
      );
    };

    syncClearance();
    const observer = new ResizeObserver(syncClearance);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--session-composer-measured-clearance');
      document.documentElement.style.removeProperty('--session-composer-live-top');
    };
  });

  const modeOption = $derived(activeSessionId ? findModeConfigOption(sessionConfigOptions) : undefined);
  const reasoningOption = $derived(activeSessionId ? findReasoningConfigOption(sessionConfigOptions) : undefined);
  // One mode control for both launch and active sessions; it lives in the
  // Options panel and its current value is badged on the Options trigger.
  const modeControl = $derived.by(() => {
    if (!activeSessionId && launch && launchModeOptions.length > 0) {
      const options = launchModeOptions.map((option) => ({ value: option.id, label: option.label }));
      return {
        value: selectedLaunchModeId,
        label: options.find((option) => option.value === selectedLaunchModeId)?.label ?? '',
        tone: selectedLaunchModeId ? getModeToneIndex(options.map((option) => option.value), selectedLaunchModeId) : null,
        options,
        ariaLabel: 'Mode',
        pending: false,
        onChange: (value: string) => onLaunchModeChange?.(value)
      };
    }
    if (!modeOption) return null;
    const options = getConfigOptionChoices(modeOption).map((choice) => ({ value: choice.value, label: choice.name }));
    return {
      value: modeOption.currentValue,
      label: options.find((option) => option.value === modeOption.currentValue)?.label ?? '',
      tone: modeOption.currentValue ? getModeToneIndex(options.map((option) => option.value), modeOption.currentValue) : null,
      options,
      ariaLabel: modeOption.name,
      pending: !!sessionConfigPending[modeOption.id],
      onChange: (value: string) => onSessionConfigChange?.(modeOption.id, value)
    };
  });
  const selectedProfileLabel = $derived(
    profileOptions.find((option) => option.id === selectedProfileId)?.label ?? 'Default'
  );
  const selectedTargetLabel = $derived(
    targetOptions.find((option) => option.id === selectedTargetId)?.label ?? 'Local'
  );
  const secondaryOptionCount = $derived(
    (modeControl ? 1 : 0) +
      (deliveryControlAvailable ? 1 : 0) +
      (!sessionOnly && profileOptions.length > 0 ? 1 : 0) +
      (!sessionOnly && targetOptions.length > 1 ? 1 : 0) +
      (!sessionOnly && workspaceModeOptions.length > 1 ? 1 : 0) +
      (sessionOnly && onOpenDelegateModels ? 1 : 0)
  );
  const optionsSummary = $derived.by(() => {
    const labels: string[] = [];
    if (!sessionOnly && profileOptions.length > 0 && selectedProfileId !== 'default') labels.push(selectedProfileLabel);
    if (!sessionOnly && targetOptions.length > 1 && selectedTargetId !== 'local') labels.push(selectedTargetLabel);
    if (!sessionOnly && workspaceModeOptions.length > 1 && selectedWorkspaceMode !== 'local') {
      labels.push(workspaceModeOptions.find((option) => option.id === selectedWorkspaceMode)?.label ?? 'Worktree');
    }
    return labels.join(' · ');
  });
  const reasoningControl = $derived.by((): ModelPickerReasoningControl | null => {
    if (!activeSessionId && launch && launchReasoningOptions.length > 0) {
      return {
        title: 'Reasoning effort',
        description: 'How deeply the agent should think',
        value: selectedLaunchReasoningId,
        options: launchReasoningOptions.map((option) => ({ value: option.id, label: option.label })),
        ariaLabel: 'Reasoning effort',
        onChange: (value) => onLaunchReasoningChange?.(value)
      };
    }
    if (!reasoningOption) return null;
    return {
      title: reasoningOption.name,
      description: 'Adjust reasoning for the next reply',
      value: reasoningOption.currentValue,
      options: getConfigOptionChoices(reasoningOption).map((choice) => ({ value: choice.value, label: choice.name })),
      ariaLabel: reasoningOption.name,
      disabled: !!sessionConfigPending[reasoningOption.id],
      pending: !!sessionConfigPending[reasoningOption.id],
      onChange: (value) => onSessionConfigChange?.(reasoningOption.id, value)
    };
  });

  function getNextConfigValue(option: (SessionConfigOption & { type: 'select' }) | undefined): string | null {
    if (!option || sessionConfigPending[option.id]) {
      return null;
    }

    const choices = getConfigOptionChoices(option);
    if (choices.length < 2) {
      return null;
    }

    const currentIndex = choices.findIndex((choice) => choice.value === option.currentValue);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % choices.length : 0;
    return choices[nextIndex]?.value ?? null;
  }

  function cycleConfigOption(option: (SessionConfigOption & { type: 'select' }) | undefined) {
    if (!option) {
      return;
    }

    const nextValue = getNextConfigValue(option);
    if (nextValue) {
      void onSessionConfigChange?.(option.id, nextValue);
    }
  }

  function getNextLaunchModeValue(): string | null {
    if (launchModeOptions.length < 2) {
      return null;
    }

    const currentIndex = launchModeOptions.findIndex((option) => option.id === selectedLaunchModeId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % launchModeOptions.length : 0;
    return launchModeOptions[nextIndex]?.id ?? null;
  }

  /**
   * Cycles to the next mode and returns whether a mode was requested. The
   * caller may only consume the Tab keypress when this resolves true, so
   * normal focus traversal continues whenever cycling is unavailable.
   */
  function cycleMode(): boolean {
    if (activeSessionId) {
      const nextValue = getNextConfigValue(modeOption);
      if (!nextValue || !modeOption || !onSessionConfigChange) {
        return false;
      }
      void onSessionConfigChange(modeOption.id, nextValue);
      return true;
    }

    const nextLaunchMode = getNextLaunchModeValue();
    if (!nextLaunchMode || !onLaunchModeChange) {
      return false;
    }
    onLaunchModeChange(nextLaunchMode);
    return true;
  }

  /** Focus callback for the model picker; guards the mobile virtual keyboard. */
  function requestPromptFocusFromPicker(): boolean {
    if (!allowsProgrammaticPromptFocus()) {
      return false;
    }
    void focusPrompt({ force: true });
    return true;
  }

  function dismissError() {
    onDismissError?.();
  }

  function shouldSendFromKeyboard(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter' || event.isComposing || event.altKey) {
      return false;
    }

    switch (sendShortcut) {
      case 'shift-enter':
        return event.shiftKey && !event.ctrlKey && !event.metaKey;
      case 'ctrl-enter':
        return event.ctrlKey && !event.shiftKey && !event.metaKey;
      case 'cmd-enter':
        return event.metaKey && !event.shiftKey && !event.ctrlKey;
      default:
        return !event.shiftKey && !event.ctrlKey && !event.metaKey;
    }
  }

  function handlePrimaryAction() {
    if (agentRunning && !turnControlSupported && onStopPrompt) {
      onStopPrompt();
      return;
    }
    onSendPrompt();
  }

  function handlePromptKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      void modelPickerRef?.openPicker();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') {
      event.preventDefault();
      cycleConfigOption(reasoningOption);
      return;
    }

    if (!loading && shouldSendFromKeyboard(event)) {
      event.preventDefault();
      handlePrimaryAction();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'Tab') {
      // Consume Tab only when a mode can actually be cycled; otherwise let
      // normal focus traversal continue.
      if (cycleMode()) {
        event.preventDefault();
      }
    }
  }

  let normalizeQueue: Promise<void> = Promise.resolve();
  let pendingQuotaAttachments: PromptAttachment[] = [];

  function effectiveQuotaAttachments(): PromptAttachment[] {
    if (pendingQuotaAttachments.length === 0) return attachments;
    const knownIds = new Set(attachments.map((attachment) => attachment.id));
    return [...attachments, ...pendingQuotaAttachments.filter((attachment) => !knownIds.has(attachment.id))];
  }

  function normalizeAndAddFiles(files: FileList | File[]): Promise<void> {
    // Snapshot synchronously: callers reset the picker input right after this
    // call, and browsers empty a live FileList when the input value is cleared.
    const snapshot = Array.from(files);
    const result = normalizeQueue.then(() => normalizeAttachmentBatch(snapshot));
    normalizeQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function normalizeAttachmentBatch(files: FileList | File[]) {
    const next: PromptAttachment[] = [];
    const errors: string[] = [];
    const quotaBaseline = effectiveQuotaAttachments();
    let totalBytes = quotaBaseline.reduce((total, attachment) => total + attachment.size, 0);
    let imageCount = quotaBaseline.filter((attachment) => attachment.mimeType.startsWith('image/')).length;

    for (const file of Array.from(files)) {
      const mimeType = file.type || 'application/octet-stream';
      if (file.size > MAX_ATTACHMENT_BYTES) {
        errors.push(`${file.name}: attachments must be 10 MiB or smaller.`);
        continue;
      }
      if (mimeType.startsWith('image/') && imageCount >= MAX_IMAGES) {
        errors.push(`${file.name}: no more than 8 images can be attached.`);
        continue;
      }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        errors.push(`${file.name}: attachments cannot exceed 20 MiB total.`);
        continue;
      }
      try {
        const data = await fileToBase64(file);
        if (!data && file.size > 0) throw new Error('The file could not be read.');
        next.push({ id: createAttachmentId(file), name: file.name || 'pasted-file', mimeType, size: file.size, data });
        totalBytes += file.size;
        if (mimeType.startsWith('image/')) imageCount += 1;
      } catch (error) {
        errors.push(`${file.name}: ${error instanceof Error ? error.message : 'Failed to read attachment.'}`);
      }
    }
    attachmentErrors = errors;
    if (next.length > 0) {
      onAddAttachments?.(next);
      pendingQuotaAttachments.push(...next);
    }
  }

  $effect(() => {
    if (pendingQuotaAttachments.length === 0) return;
    const knownIds = new Set(attachments.map((attachment) => attachment.id));
    pendingQuotaAttachments = pendingQuotaAttachments.filter((attachment) => !knownIds.has(attachment.id));
  });

  function createAttachmentId(file: File): string {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `${file.name}-${file.size}-${file.lastModified}-${suffix}`;
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment.'));
      reader.readAsDataURL(file);
    });
  }

  // Actions behind the composer's "+" menu. Add new entries here.
  const addMenuActions = $derived<ComposerAddMenuAction[]>([
    { id: 'attach-files', label: 'Attach files', icon: Paperclip, onSelect: handleAttachClick }
  ]);

  function handleAttachClick() {
    fileInputElement?.click();
  }

  $effect(() => {
    promptFocusToken;
    if (!collapsed && allowsProgrammaticPromptFocus()) {
      void focusPrompt();
    }
  });

  $effect(() => {
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }

    if (!error || !onDismissError) {
      return;
    }

    errorTimeout = setTimeout(() => {
      onDismissError?.();
      errorTimeout = null;
    }, 12000);

    return () => {
      if (errorTimeout) {
        clearTimeout(errorTimeout);
        errorTimeout = null;
      }
    };
  });

  function allowsProgrammaticPromptFocus(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return !window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  }

  async function focusPrompt(options: { force?: boolean } = {}) {
    await tick();
    // Deferred autofocus must not override a workspace/control click made while
    // it was waiting. Explicit picker close-restore still returns to the prompt.
    if (!options.force) {
      if (document.querySelector('[data-blocking-overlay="true"]')) return;
      const focused = document.activeElement;
      if (focused && focused !== promptElement && dockElement?.contains(focused)) return;
    }
    promptElement?.focus();
  }
</script>

<!-- One-line option row label: icon and title only. -->
{#snippet optionCopy(Icon: Component<{ size?: number }>, title: string, extraClass: string = '')}
  <div class={`composer-option-copy ${extraClass}`}>
    <Icon size={15} />
    <strong>{title}</strong>
  </div>
{/snippet}

{#snippet composerBody()}
  {#if !unifiedShell}
    <div class="px-2 pt-1">
      <div class={`${minimal ? 'text-base' : 'text-sm'} font-semibold`}>{sessionOnly ? 'Reply' : minimal ? 'Start with a prompt' : 'Ask QueryMT'}</div>
      <p class="muted mt-1 text-sm">
        {#if sessionOnly}
          Continue this session with a quick reply.
        {:else if minimal}
          Describe the task, choose a workspace, and start a focused session.
        {:else}
          Start a new session or continue the selected one.
        {/if}
      </p>
    </div>
  {/if}

  {#if error}
    <div class={`${unifiedShell ? 'mx-1' : 'mx-2'} alert-error flex items-start justify-between gap-3`} role="alert" aria-live="polite">
      <p class="min-w-0 flex-1">{error}</p>
      {#if onDismissError}
        <button class="text-[var(--danger)] transition hover:text-[var(--text)]" type="button" aria-label="Dismiss error" onclick={dismissError}>
          <X size={14} />
        </button>
      {/if}
    </div>
  {/if}

  {#if !sessionOnly}
    <div class={unifiedShell ? 'px-1 pt-2.5' : 'px-2'}>
      <WorkspacePathInput
        value={cwd}
        disabled={false}
        recentPaths={recentWorkspaces}
        onInput={(value) => onCwdInput?.(value)}
      />
    </div>
  {/if}

  <div
    class={`composer-prompt-zone ${promptExpanded ? 'composer-prompt-zone-expanded' : ''} ${unifiedShell ? 'px-1' : 'px-2'} rounded-[18px] bg-inherit transition ${isDragging ? 'bg-[var(--accent-dim)] ring-1 ring-[var(--border-strong)]' : ''}`}
    role="region"
    aria-label="Prompt and attachment drop zone"
    ondragover={(event) => {
      event.preventDefault();
      isDragging = true;
    }}
    ondragleave={() => (isDragging = false)}
    ondrop={(event) => {
      event.preventDefault();
      isDragging = false;
      if (event.dataTransfer?.files.length) {
        void normalizeAndAddFiles(event.dataTransfer.files);
      }
    }}
  >
    {#if hasPromptText && !collapsed}
      <!-- Anchored to the prompt zone (not the card) so it stays at the top of the
           textarea even when the workspace input sits above it. -->
      <div class="composer-prompt-expand">
        <IconTooltipButton
          label={promptExpanded ? 'Collapse composer' : 'Expand composer'}
          icon={promptExpanded ? Minimize2 : Maximize2}
          controlSize="compact"
          size={14}
          onclick={() => {
            promptExpanded = !promptExpanded;
            onPromptExpandedChange?.(promptExpanded);
          }}
        />
      </div>
    {/if}
    <textarea
      bind:this={promptElement}
      class={`block w-full resize-none border-0 bg-inherit px-0.5 pt-3 pb-2 text-sm text-[var(--text)] outline-none ${promptMinHeightClass} ${launch ? 'text-base' : ''}`}
      placeholder={sessionOnly ? sessionPlaceholder : launch ? 'Ask QueryMT to inspect, change, debug, explain, or plan something.' : minimal ? 'What should QueryMT do in this workspace?' : 'Ask QueryMT to inspect, plan, change, or explain something in this workspace.'}
      value={prompt}
      oninput={(event) => onPromptInput((event.currentTarget as HTMLTextAreaElement).value)}
      onkeydown={handlePromptKeydown}
      onpaste={(event) => {
        if (event.clipboardData?.files.length) void normalizeAndAddFiles(event.clipboardData.files);
      }}
    ></textarea>
  </div>

  {#if attachmentErrors.length > 0}
    <div class="composer-attachment-errors" role="alert" aria-live="polite">
      {#each attachmentErrors as message}<p>{message}</p>{/each}
    </div>
  {/if}

  {#if attachments.length > 0}
    <SessionAttachmentPreview blocks={attachmentBlocks} removable={true} {compact} onRemove={onRemoveAttachment} />
  {/if}

  <div class={`composer-toolbar flex flex-wrap items-center justify-between gap-3 ${unifiedShell ? 'border-t border-[color-mix(in_srgb,var(--border)_60%,transparent)] px-1 pt-2' : 'border-t border-[var(--border)] px-2 pt-3'}`}>
    <div class="composer-toolbar-controls flex flex-wrap items-center gap-2">
      <ComposerAddMenu actions={addMenuActions} label="Add" />
      {#if !sessionOnly && onCreateSession && !minimal && !launch}
        <IconTooltipButton label="Blank session" icon={Plus} size={16} disabled={loading} onclick={onCreateSession} />
      {/if}
      <ModelQuickPicker
        bind:this={modelPickerRef}
        modelOptions={modelOptions}
        recentModels={recentModels}
        selectedModelId={selectedModelId}
        modelInfo={modelInfo}
        {modelLocation}
        loading={modelLoading || (sessionOnly && Object.values(sessionConfigPending).some(Boolean))}
        emptyLabel={sessionOnly ? 'Model unknown' : 'Select model'}
        disabled={sessionOnly && (modelLoading || Object.values(sessionConfigPending).some(Boolean))}
        agentLabel={agentLabel}
        class="composer-control-pill"
        onSelect={(value) => onModelChange?.(value)}
        onRefresh={onRefreshModels}
        onRequestPromptFocus={requestPromptFocusFromPicker}
        reasoning={reasoningControl}
      />
       {#if secondaryOptionCount > 0}
         <div
           class="composer-options-host"
           style={modeControl?.tone != null ? `--option-tone: var(--mode-tone-${modeControl.tone})` : undefined}
         >
           <details class="composer-options" use:autoCollapsePopover>
             <summary class="composer-options-trigger" aria-label="Session options">
               <Settings2 size={14} />
                <span>Options</span>
                {#if optionsSummary}<small>{optionsSummary}</small>{/if}
                <ChevronDown class="composer-options-chevron" size={13} />
                {#if modeControl?.label}
                  <span class="composer-badge composer-mode-badge" data-tone={modeControl.tone} aria-hidden="true">{modeControl.label}</span>
                {/if}
             </summary>
           </details>
           <div class="composer-options-panel">
             <div class="composer-options-heading">
               <strong>Session options</strong>
             </div>
              <div class="composer-options-list">
                {#if modeControl}
                  <div class="composer-option-row">
                    {@render optionCopy(SlidersHorizontal, 'Mode', 'composer-option-copy-mode')}
                    <ComposerSplitPillSelect
                      value={modeControl.value}
                      options={modeControl.options}
                      icon={SlidersHorizontal}
                      pending={modeControl.pending}
                      disabled={modeControl.pending}
                      ariaLabel={modeControl.ariaLabel}
                      showLabelTitle={false}
                      class="composer-control-pill"
                      onValueChange={modeControl.onChange}
                    />
                  </div>
                {/if}
                {#if deliveryControlAvailable}
                  <div class="composer-option-row">
                    {@render optionCopy(deliveryChoice === 'queue' ? Plus : Navigation, 'Message delivery')}
                    <div class="composer-delivery-switch" role="group" aria-label="Input delivery">
                      <button
                        type="button"
                        class:active={deliveryChoice === 'steer'}
                        aria-pressed={deliveryChoice === 'steer'}
                        onclick={() => onInputDeliveryChange?.('steer')}
                      >
                        <Navigation size={12} />
                        Steer
                      </button>
                      <button
                        type="button"
                        class:active={deliveryChoice === 'queue'}
                        aria-pressed={deliveryChoice === 'queue'}
                        onclick={() => onInputDeliveryChange?.('queue')}
                      >
                        <Plus size={12} />
                        Queue
                      </button>
                    </div>
                  </div>
                {/if}
                {#if !sessionOnly && profileOptions.length > 0}
                  <div class="composer-option-row">
                    {@render optionCopy(FileCog, 'Profile')}
                    <ComposerSplitPillSelect
                      value={selectedProfileId}
                      options={profileOptions.map((profile) => ({ value: profile.id, label: profile.label }))}
                      icon={FileCog}
                      ariaLabel="Profile"
                      showLabelTitle={false}
                      class="composer-control-pill"
                      onValueChange={(value) => onProfileChange?.(value)}
                    />
                  </div>
                {/if}
                {#if sessionOnly && onOpenDelegateModels}
                  <div class="composer-option-row composer-option-row-action">
                    {@render optionCopy(Waypoints, 'Delegate routing')}
                    <button
                      class="action-btn composer-option-action"
                      type="button"
                      disabled={delegateModelsLoading}
                      onclick={onOpenDelegateModels}
                    >
                      {#if delegateModelsLoading}<RefreshCw size={13} class="animate-spin" />{:else}<Waypoints size={13} />{/if}
                      {delegateModelsError ? 'Retry' : `Configure${delegateModelCount > 0 ? ` · ${delegateModelCount}` : ''}`}
                    </button>
                  </div>
                {/if}
                {#if !sessionOnly && targetOptions.length > 1}

                 <div class="composer-option-row">
                   {@render optionCopy(Monitor, 'Target')}
                   <ComposerSplitPillSelect
                     value={selectedTargetId}
                     options={targetOptions.map((target) => ({ value: target.id, label: target.label }))}
                     icon={Monitor}
                     ariaLabel="Session target"
                     showLabelTitle={false}
                     class="composer-control-pill"
                     onValueChange={(value) => onTargetChange?.(value)}
                   />
                 </div>
               {/if}
               {#if !sessionOnly && workspaceModeOptions.length > 1}
                 <div class="composer-option-row">
                   {@render optionCopy(GitBranch, 'Workspace')}
                   <ComposerSplitPillSelect
                     value={selectedWorkspaceMode}
                     options={workspaceModeOptions.map((option) => ({ value: option.id, label: option.label }))}
                     icon={GitBranch}
                     ariaLabel="Session workspace"
                     showLabelTitle={false}
                     class="composer-control-pill"
                     onValueChange={(value) => onWorkspaceModeChange?.(value)}
                   />
                 </div>
               {/if}
             </div>
           </div>
         </div>
       {/if}
    </div>

    <div class="composer-toolbar-actions flex items-center gap-2">
      <input
        bind:this={fileInputElement}
        class="hidden"
        type="file"
        multiple
        onchange={(event) => {
          const files = (event.currentTarget as HTMLInputElement).files;
          if (files?.length) {
            void normalizeAndAddFiles(files);
          }
          (event.currentTarget as HTMLInputElement).value = '';
        }}
      />
      {#if !sessionOnly && onCreateSession && !launch}
        <button class={minimal ? 'icon-btn' : 'action-btn'} disabled={loading} type="button" aria-label="Blank session" onclick={onCreateSession}>
          <FilePlus2 size={16} />
          {#if !minimal}
            <span>Blank session</span>
          {/if}
        </button>
      {/if}
      {#if agentRunning && onStopPrompt && (!turnControlSupported || !hasDraft)}
        <button
          class="icon-btn icon-btn-primary"
          type="button"
          aria-label="Stop agent"
          title="Stop agent"
          onclick={onStopPrompt}
        >
          <Square size={16} />
        </button>
      {:else}
        {#if agentRunning && turnControlSupported && onStopPrompt}
          <IconTooltipButton label="Stop agent" icon={Square} size={15} onclick={onStopPrompt} />
        {/if}
        <button
          class={`composer-send ${hasDraft ? 'composer-send-ready' : 'composer-send-idle'} ${launch ? 'action-btn action-btn-primary justify-center' : minimal || (activeSessionId && agentRunning && turnControlSupported) ? 'action-btn action-btn-primary px-4' : 'icon-btn icon-btn-primary'}`}
          disabled={loading}
          type="button"
          aria-label={activeSessionId ? primaryActionLabel : creatingBlankSession ? 'Start blank session' : 'Start session'}
          onclick={handlePrimaryAction}
        >
        {#if activeSessionId}
          <span class="inline-flex items-center gap-2">
            {#if agentRunning && turnControlSupported && inputDelivery === 'queue'}
              <Plus size={16} />
            {:else if agentRunning && turnControlSupported}
              <Navigation size={16} />
            {:else}
              <SendHorizontal size={16} />
            {/if}
            {#if minimal || launch || (agentRunning && turnControlSupported)}
              <span>{primaryActionLabel}</span>
            {/if}
          </span>
        {:else}
          <!-- One static state: blank and send share the same icon and label, so
               crossfading two copies only made the text flicker on the first keystroke. -->
          <span class="composer-action-morph">
            <span class="composer-action-morph-state">
              <SendHorizontal size={16} />
              {#if minimal || launch}
                <span>{starting ? 'Starting\u2026' : 'Start'}</span>
              {/if}
            </span>
          </span>
        {/if}
      </button>
      {/if}
    </div>
  </div>
 {/snippet}

<div
  bind:this={dockElement}
  class={docked ? 'session-composer-dock' : 'session-composer-morph-host'}
  style={dockPositionStyle}
>
{#if collapsed}
    <div
      class="session-composer-morph-shell session-composer-dock-compact session-composer-dock-collapsed"
      in:composerMorph={{ compact: true }}
      out:composerOut={{ compact: true }}
    >
      <input
        bind:this={fileInputElement}
        class="hidden"
        type="file"
        multiple
        onchange={(event) => {
          const files = (event.currentTarget as HTMLInputElement).files;
          if (files?.length) {
            void normalizeAndAddFiles(files);
          }
          (event.currentTarget as HTMLInputElement).value = '';
        }}
      />

      <ComposerAddMenu actions={addMenuActions} label="Add" />
      {#if attachments.length > 0}<span class="session-composer-attachment-count" aria-label={`${attachments.length} pending attachments`}>{attachments.length}</span>{/if}
      <input
        class="session-composer-dock-input"
        type="text"
        value={prompt}
        placeholder={sessionPlaceholder}
        oninput={(event) => onPromptInput((event.currentTarget as HTMLInputElement).value)}
        onkeydown={handlePromptKeydown}
        onpaste={(event) => {
          if (event.clipboardData?.files.length) void normalizeAndAddFiles(event.clipboardData.files);
        }}
      />
      {#if agentRunning && onStopPrompt && (!turnControlSupported || !hasDraft)}
        <IconTooltipButton label="Stop agent" icon={Square} tone="primary" controlSize="compact" size={16} onclick={onStopPrompt} />
      {:else}
        {#if agentRunning && turnControlSupported && onStopPrompt}
          <IconTooltipButton label="Stop agent" icon={Square} controlSize="compact" size={15} onclick={onStopPrompt} />
        {/if}
        <IconTooltipButton
          label={primaryActionLabel}
          icon={primaryActionIcon}
          tone="primary"
          controlSize="compact"
          size={16}
          class={`composer-send ${hasDraft ? 'composer-send-ready' : 'composer-send-idle'}`}
          disabled={loading}
          onclick={handlePrimaryAction}
        />
      {/if}

      {#if attachmentErrors.length > 0}
        <div class="composer-attachment-errors session-composer-dock-errors" role="alert" aria-live="polite">
          {#each attachmentErrors as message}<p>{message}</p>{/each}
        </div>
      {/if}
    </div>
  {:else}
    <div
      class={`session-composer-morph-shell session-composer-dock-expanded panel-strong ${unifiedShell ? 'pl-2 pr-3 pt-1 pb-2.5' : minimal ? 'p-4 md:p-5' : 'p-3 md:p-4'}`}
      in:composerMorph={{ compact: false }}
      out:composerOut={{ compact: false }}
    >
      <div
        class={`flex flex-col ${unifiedShell ? 'session-composer-inner-well gap-2.5 rounded-[24px] bg-inherit px-0.5 pt-0 pb-0.5' : 'gap-3 rounded-[18px] border border-[var(--border)] bg-inherit'} ${unifiedShell ? '' : minimal ? 'p-3 md:p-4' : 'p-2'}`}
      >
        {@render composerBody()}
      </div>
    </div>
  {/if}
</div>