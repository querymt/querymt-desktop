<script lang="ts">
  import { FilePlus2, Paperclip, Plus, SendHorizontal, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import ModelQuickPicker from '$lib/components/primitives/ModelQuickPicker.svelte';
  import WorkspacePathInput from '$lib/components/primitives/WorkspacePathInput.svelte';
  import type { ComposerOption, ModelEntry, ModelInfo, PromptAttachment } from '$lib/domain/types';

  let modelPickerRef: { openPicker: () => Promise<void> } | null = null;
  let fileInputElement: HTMLInputElement | null = null;
  let isDragging = $state(false);

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
    onCwdInput = null,
    onPromptInput,
    onModelChange = null,
    onRefreshModels = null,
    onAddAttachments = null,
    onRemoveAttachment = null,
    onProfileChange = null,
    onTargetChange = null,
    onCreateSession = null,
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
    onCwdInput?: ((value: string) => void) | null;
    onPromptInput: (value: string) => void;
    onModelChange?: ((value: string) => void) | null;
    onRefreshModels?: (() => void) | null;
    onAddAttachments?: ((attachments: PromptAttachment[]) => void) | null;
    onRemoveAttachment?: ((attachmentId: string) => void) | null;
    onProfileChange?: ((profileId: string) => void) | null;
    onTargetChange?: ((targetId: string) => void) | null;
    onCreateSession?: (() => void) | null;
    onSendPrompt: () => void;
  } = $props();

  let promptElement: HTMLTextAreaElement | null = null;

  function handlePromptKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      void modelPickerRef?.openPicker();
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

  $effect(() => {
    promptFocusToken;
    void focusPrompt();
  });

  async function focusPrompt() {
    await tick();
    promptElement?.focus();
  }
</script>

<div class={`panel-strong ${launch ? 'p-4 md:p-6' : minimal ? 'p-4 md:p-5' : 'p-3 md:p-4'}`}>
  <div class={`flex flex-col ${launch ? 'gap-4 rounded-[24px] bg-[var(--bg-card)]' : 'gap-3 rounded-[18px] border border-[var(--border)] bg-[var(--bg-card)]'} ${launch ? 'p-1' : minimal ? 'p-3 md:p-4' : 'p-2'}`}>
    {#if !launch}
      <div class="flex items-start justify-between gap-4 px-2 pt-1">
        <div>
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
        <div class="flex items-center gap-2">
          {#if !sessionOnly && !minimal}
            <div class="kbd">Cmd+N</div>
          {/if}
          <div class="kbd">Cmd+M</div>
        </div>
      </div>
    {/if}

    {#if !sessionOnly}
      <div class={launch ? 'px-1' : 'px-2'}>
        <WorkspacePathInput
          value={cwd}
          disabled={false}
          recentPaths={recentWorkspaces}
          onInput={(value) => onCwdInput?.(value)}
        />
      </div>
    {/if}

    <div
      class={`${launch ? 'px-1' : 'px-2'} rounded-[18px] transition ${isDragging ? 'bg-[var(--accent-dim)] ring-1 ring-[var(--border-strong)]' : ''}`}
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
        class={`block w-full resize-none border-0 bg-transparent px-1 py-2 text-sm text-[var(--text)] outline-none ${launch ? 'min-h-[132px] text-base' : minimal ? 'min-h-[168px]' : compact ? 'min-h-[116px]' : 'min-h-[156px]'}`}
        placeholder={sessionOnly ? 'Write a reply for this session...' : launch ? 'Ask QueryMT to inspect, change, debug, explain, or plan something.' : minimal ? 'What should QueryMT do in this workspace?' : 'Ask QueryMT to inspect, plan, change, or explain something in this workspace.'}
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

    <div class={`flex flex-wrap items-center justify-between gap-3 ${launch ? 'border-t border-[var(--border)] px-1 pt-3' : 'border-t border-[var(--border)] px-2 pt-3'}`}>
      <div class="flex flex-wrap items-center gap-2">
        {#if !sessionOnly && onCreateSession && !minimal && !launch}
          <IconTooltipButton label="Blank session" icon={Plus} size={16} disabled={loading} onclick={onCreateSession} />
        {/if}
        {#if !sessionOnly && profileOptions.length > 0}
          <AppSelect value={selectedProfileId} options={profileOptions.map((profile) => ({ value: profile.id, label: profile.label }))} pill ariaLabel="Profile" onValueChange={(value) => onProfileChange?.(value)} />
        {/if}
        {#if !sessionOnly && targetOptions.length > 1}
          <AppSelect value={selectedTargetId} options={targetOptions.map((target) => ({ value: target.id, label: target.label }))} pill ariaLabel="Session target" onValueChange={(value) => onTargetChange?.(value)} />
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
        <IconTooltipButton label="Attach files" icon={Paperclip} size={16} onclick={() => fileInputElement?.click()} />
        {#if !sessionOnly && onCreateSession && !launch}
          <button class={minimal ? 'icon-btn' : 'action-btn'} disabled={loading} type="button" aria-label="Blank session" onclick={onCreateSession}>
            <FilePlus2 size={16} />
            {#if !minimal}
              <span>Blank session</span>
            {/if}
          </button>
        {/if}
        <button class={`${launch ? 'action-btn action-btn-primary min-w-[9rem] justify-center px-5 py-3' : minimal ? 'action-btn action-btn-primary px-4' : 'icon-btn icon-btn-primary'}`} disabled={loading} type="button" aria-label={activeSessionId ? 'Send reply' : 'Start session'} onclick={onSendPrompt}>
          <SendHorizontal size={16} />
          {#if minimal || launch}
            <span>{activeSessionId ? 'Send reply' : 'Start session'}</span>
          {/if}
        </button>
      </div>
    </div>
  </div>

  {#if error}
    <div class="alert-error mt-3">{error}</div>
  {/if}
</div>
