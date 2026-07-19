<script lang="ts">
  import { Brain, FilePlus2, Paperclip, Plus, SendHorizontal, SlidersHorizontal, UserRound, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { TransitionConfig } from 'svelte/transition';
  import ComposerSplitPillSelect from '$lib/components/primitives/ComposerSplitPillSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import ModelQuickPicker from '$lib/components/primitives/ModelQuickPicker.svelte';
  import WorkspacePathInput from '$lib/components/primitives/WorkspacePathInput.svelte';
  import {
    findModeConfigOption,
    findReasoningConfigOption,
    getConfigOptionChoices
  } from '$lib/querymt/config-options';
  import type { ComposerOption, ModelEntry, ModelInfo, PromptAttachment } from '$lib/domain/types';
  import type { SessionConfigOption } from '@agentclientprotocol/sdk';

  let modelPickerRef: { openPicker: () => Promise<void> } | null = null;
  let fileInputElement: HTMLInputElement | null = null;
  let isDragging = $state(false);
  const isMacPlatform =
    typeof navigator !== 'undefined' &&
    /mac/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`);

  let {
    cwd = '',
    prompt = '',
    loading = false,
    error = null,
    compact = false,
    minimal = false,
    launch = false,
    activeSessionId = null,
    promptFocusToken = 0,
    sessionOnly = false,
    docked = false,
    collapsed = false,
    dockAlignLeft = null,
    dockAlignWidth = null,
    chatView = false,
    modelOptions = [],
    selectedModelId = '',
    modelInfo = {},
    recentModels = [],
    modelLoading = false,
    agentLabel = null,
    recentWorkspaces = [],
    attachments = [],
    profileOptions = [],
    selectedProfileId = 'default',
    targetOptions = [],
    selectedTargetId = 'local',
    sessionConfigOptions = [],
    sessionConfigPending = {},
    onCwdInput = null,
    onPromptInput,
    onModelChange = null,
    onRefreshModels = null,
    onAddAttachments = null,
    onRemoveAttachment = null,
    onProfileChange = null,
    onTargetChange = null,
    onSessionConfigChange = null,
    onCreateSession = null,
    onDismissError = null,
    onSendPrompt
  }: {
    cwd?: string;
    prompt?: string;
    loading?: boolean;
    error?: string | null;
    compact?: boolean;
    minimal?: boolean;
    launch?: boolean;
    activeSessionId?: string | null;
    promptFocusToken?: number;
    sessionOnly?: boolean;
    docked?: boolean;
    collapsed?: boolean;
    dockAlignLeft?: number | null;
    dockAlignWidth?: number | null;
    chatView?: boolean;
    modelOptions?: ModelEntry[];
    selectedModelId?: string;
    modelInfo?: Record<string, ModelInfo | null>;
    recentModels?: ModelEntry[];
    modelLoading?: boolean;
    agentLabel?: string | null;
    recentWorkspaces?: string[];
    attachments?: PromptAttachment[];
    profileOptions?: ComposerOption[];
    selectedProfileId?: string;
    targetOptions?: ComposerOption[];
    selectedTargetId?: string;
    sessionConfigOptions?: SessionConfigOption[];
    sessionConfigPending?: Record<string, boolean>;
    onCwdInput?: ((value: string) => void) | null;
    onPromptInput: (value: string) => void;
    onModelChange?: ((value: string) => void) | null;
    onRefreshModels?: (() => void) | null;
    onAddAttachments?: ((attachments: PromptAttachment[]) => void) | null;
    onRemoveAttachment?: ((attachmentId: string) => void) | null;
    onProfileChange?: ((profileId: string) => void) | null;
    onTargetChange?: ((targetId: string) => void) | null;
    onSessionConfigChange?: ((configId: string, value: string) => void | Promise<void>) | null;
    onCreateSession?: (() => void) | null;
    onDismissError?: (() => void) | null;
    onSendPrompt: () => void;
  } = $props();

  let promptElement: HTMLTextAreaElement | null = null;
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function composerMorph(node: Element, { compact }: { compact: boolean }): TransitionConfig {
    const opacity = Number(getComputedStyle(node).opacity) || 1;

    return {
      duration: prefersReducedMotion() ? 0 : 220,
      easing: cubicOut,
      css: (t) => {
        const hidden = 1 - t;
        const translateY = hidden * (compact ? 8 : 4);
        const clipTop = hidden * (compact ? 35 : 72);
        const radius = compact ? 999 : 18 + hidden * 20;

        return `opacity:${t * opacity};transform:translateY(${translateY}px);clip-path:inset(${clipTop}% 0 0 0 round ${radius}px);overflow:clip;`;
      }
    };
  }

  const unifiedShell = $derived(launch || sessionOnly);
  const sessionPlaceholder = 'Write a reply for this session...';
  const promptMinHeightClass = $derived.by(() => {
    if (chatView && sessionOnly) return 'min-h-[76px]';
    if (launch) return 'min-h-[132px]';
    if (sessionOnly) return 'min-h-[116px]';
    if (minimal) return 'min-h-[168px]';
    if (compact) return 'min-h-[116px]';
    return 'min-h-[156px]';
  });

  const dockPositionStyle = $derived.by(() => {
    if (!docked || dockAlignLeft == null || dockAlignWidth == null) return '';
    return `left:${dockAlignLeft}px;width:${dockAlignWidth}px;transform:none;`;
  });

  const modeOption = $derived(activeSessionId ? findModeConfigOption(sessionConfigOptions) : undefined);
  const reasoningOption = $derived(activeSessionId ? findReasoningConfigOption(sessionConfigOptions) : undefined);

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

  function dismissError() {
    onDismissError?.();
  }

  function shouldSendFromKeyboard(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) {
      return false;
    }

    return isMacPlatform ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
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
      onSendPrompt();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === 'Tab') {
      event.preventDefault();
      cycleConfigOption(modeOption);
    }
  }

  async function readDroppedFiles(files: FileList | File[]) {
    const next = await Promise.all(
      Array.from(files).map(async (file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data: await fileToBase64(file)
      }))
    );
    onAddAttachments?.(next);
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment.'));
      reader.readAsDataURL(file);
    });
  }

  function formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleAttachClick() {
    fileInputElement?.click();
  }

  $effect(() => {
    if (!collapsed) {
      promptFocusToken;
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

  async function focusPrompt() {
    await tick();
    promptElement?.focus();
  }
</script>

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
    <div class={unifiedShell ? 'px-1' : 'px-2'}>
      <WorkspacePathInput
        value={cwd}
        disabled={false}
        recentPaths={recentWorkspaces}
        targetOptions={targetOptions}
        selectedTargetId={selectedTargetId}
        onInput={(value) => onCwdInput?.(value)}
        onTargetChange={(targetId) => onTargetChange?.(targetId)}
      />
    </div>
  {/if}

  <div
    class={`${unifiedShell ? 'px-1' : 'px-2'} rounded-[18px] transition ${isDragging ? 'bg-[var(--accent-dim)] ring-1 ring-[var(--border-strong)]' : ''}`}
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
        void readDroppedFiles(event.dataTransfer.files);
      }
    }}
  >
    <textarea
      bind:this={promptElement}
      class={`block w-full resize-none border-0 bg-transparent px-1 py-2 text-sm text-[var(--text)] outline-none ${promptMinHeightClass} ${launch ? 'text-base' : ''}`}
      placeholder={sessionOnly ? sessionPlaceholder : launch ? 'Ask QueryMT to inspect, change, debug, explain, or plan something.' : minimal ? 'What should QueryMT do in this workspace?' : 'Ask QueryMT to inspect, plan, change, or explain something in this workspace.'}
      value={prompt}
      oninput={(event) => onPromptInput((event.currentTarget as HTMLTextAreaElement).value)}
      onkeydown={handlePromptKeydown}
    ></textarea>
  </div>

  {#if attachments.length > 0}
    <div class="flex flex-wrap gap-2 px-1">
      {#each attachments as attachment}
        <span class="badge max-w-full gap-2">
          <span class="truncate">{attachment.name}</span>
          <span class="muted">{formatFileSize(attachment.size)}</span>
          <button class="text-[var(--muted)] hover:text-[var(--text)]" type="button" aria-label={`Remove ${attachment.name}`} onclick={() => onRemoveAttachment?.(attachment.id)}>
            <X size={13} />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <div class={`flex flex-wrap items-center justify-between gap-3 ${unifiedShell ? 'border-t border-[var(--border)] px-1 pt-3' : 'border-t border-[var(--border)] px-2 pt-3'}`}>
    <div class="flex flex-wrap items-center gap-2">
      {#if !sessionOnly && onCreateSession && !minimal && !launch}
        <IconTooltipButton label="Blank session" icon={Plus} size={16} disabled={loading} onclick={onCreateSession} />
      {/if}
      {#if !sessionOnly && profileOptions.length > 0}
        <ComposerSplitPillSelect
          value={selectedProfileId}
          options={profileOptions.map((profile) => ({ value: profile.id, label: profile.label }))}
          icon={UserRound}
          ariaLabel="Profile"
          class="composer-control-pill"
          onValueChange={(value) => onProfileChange?.(value)}
        />
      {/if}
      {#if modeOption}
        <ComposerSplitPillSelect
          value={modeOption.currentValue}
          options={getConfigOptionChoices(modeOption).map((choice) => ({ value: choice.value, label: choice.name }))}
          icon={SlidersHorizontal}
          pending={!!sessionConfigPending[modeOption.id]}
          disabled={!!sessionConfigPending[modeOption.id]}
          ariaLabel={modeOption.name}
          class="composer-control-pill"
          onValueChange={(value) => onSessionConfigChange?.(modeOption.id, value)}
        />
      {/if}
      {#if reasoningOption}
        <ComposerSplitPillSelect
          value={reasoningOption.currentValue}
          options={getConfigOptionChoices(reasoningOption).map((choice) => ({ value: choice.value, label: choice.name }))}
          icon={Brain}
          pending={!!sessionConfigPending[reasoningOption.id]}
          disabled={!!sessionConfigPending[reasoningOption.id]}
          ariaLabel={reasoningOption.name}
          class="composer-control-pill"
          onValueChange={(value) => onSessionConfigChange?.(reasoningOption.id, value)}
        />
      {/if}
      <ModelQuickPicker
        bind:this={modelPickerRef}
        modelOptions={modelOptions}
        recentModels={recentModels}
        selectedModelId={selectedModelId}
        modelInfo={modelInfo}
        loading={modelLoading}
        disabled={false}
        agentLabel={agentLabel}
        class="composer-control-pill"
        onSelect={(value) => onModelChange?.(value)}
        onRefresh={onRefreshModels}
      />
    </div>

    <div class="flex items-center gap-2">
      <input
        bind:this={fileInputElement}
        class="hidden"
        type="file"
        multiple
        onchange={(event) => {
          const files = (event.currentTarget as HTMLInputElement).files;
          if (files?.length) {
            void readDroppedFiles(files);
          }
          (event.currentTarget as HTMLInputElement).value = '';
        }}
      />
      <IconTooltipButton label="Attach files" icon={Paperclip} size={16} onclick={handleAttachClick} />
      {#if !sessionOnly && onCreateSession && !launch}
        <button class={minimal ? 'icon-btn' : 'action-btn'} disabled={loading} type="button" aria-label="Blank session" onclick={onCreateSession}>
          <FilePlus2 size={16} />
          {#if !minimal}
            <span>Blank session</span>
          {/if}
        </button>
      {/if}
      <button
        class={`${launch ? 'action-btn action-btn-primary min-w-[9rem] justify-center px-5 py-3' : minimal ? 'action-btn action-btn-primary px-4' : 'icon-btn icon-btn-primary'}`}
        disabled={loading}
        type="button"
        aria-label={activeSessionId ? 'Send reply' : 'Start session'}
        onclick={onSendPrompt}
      >
        <SendHorizontal size={16} />
        {#if minimal || launch}
          <span>{activeSessionId ? 'Send reply' : 'Start session'}</span>
        {/if}
      </button>
    </div>
  </div>
{/snippet}

<div
  class={docked ? 'session-composer-dock' : ''}
  style={dockPositionStyle}
>
  {#if collapsed}
    <div
      class="session-composer-morph-shell session-composer-dock-compact session-composer-dock-collapsed"
      transition:composerMorph={{ compact: true }}
    >
      <input
        bind:this={fileInputElement}
        class="hidden"
        type="file"
        multiple
        onchange={(event) => {
          const files = (event.currentTarget as HTMLInputElement).files;
          if (files?.length) {
            void readDroppedFiles(files);
          }
          (event.currentTarget as HTMLInputElement).value = '';
        }}
      />

      <input
        class="session-composer-dock-input"
        type="text"
        value={prompt}
        placeholder={sessionPlaceholder}
        oninput={(event) => onPromptInput((event.currentTarget as HTMLInputElement).value)}
      />
      <IconTooltipButton label="Attach files" icon={Paperclip} size={16} onclick={handleAttachClick} />
      <IconTooltipButton label="Send reply" icon={SendHorizontal} tone="primary" size={16} disabled={loading} onclick={onSendPrompt} />
    </div>
  {:else}
    <div
      class={`session-composer-morph-shell session-composer-dock-expanded panel-strong ${unifiedShell ? 'p-4 md:p-6' : minimal ? 'p-4 md:p-5' : 'p-3 md:p-4'}`}
      transition:composerMorph={{ compact: false }}
    >
      <div
        class={`flex flex-col ${unifiedShell ? 'gap-4 rounded-[24px] bg-[var(--bg-card)]' : 'gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--bg-card)]'} ${unifiedShell ? 'p-1' : minimal ? 'p-3 md:p-4' : 'p-2'}`}
      >
        {@render composerBody()}
      </div>
    </div>
  {/if}
</div>