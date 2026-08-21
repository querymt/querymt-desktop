<script lang="ts">
  import { Check, Copy, ListRestart, RefreshCw, X } from '@lucide/svelte';
  import { formatPromptErrorForClipboard, formatPromptErrorMessage, type PromptFailure } from '$lib/domain/prompt-errors';

  let {
    failure,
    retryPending = false,
    onRetry,
    onDismiss
  }: {
    failure: PromptFailure;
    retryPending?: boolean;
    onRetry?: (() => void | Promise<void>) | null;
    onDismiss: () => void;
  } = $props();

  let copied = $state<'message' | 'details' | null>(null);

  async function copyError(includeDetails: boolean) {
    const target = includeDetails ? 'details' : 'message';
    try {
      await navigator.clipboard.writeText(formatPromptErrorForClipboard(failure, includeDetails));
      copied = target;
      window.setTimeout(() => {
        if (copied === target) copied = null;
      }, 1200);
    } catch (error) {
      console.error('Failed to copy prompt error', error);
    }
  }
</script>

<section class="session-prompt-error" role="alert" aria-live="polite">
  <div class="session-prompt-error-mark" aria-hidden="true">!</div>
  <div class="session-prompt-error-body">
    <header class="session-prompt-error-heading">
      <strong>{failure.title}</strong>
    </header>

    <p>{formatPromptErrorMessage(failure)}</p>
    {#if failure.kind === 'quota_exceeded'}
      <p class="session-prompt-error-guidance">choose another model or provider, or wait until the usage limit resets.</p>
    {/if}

    <div class="session-prompt-error-actions">
      {#if failure.retryable && onRetry}
        <button class="action-btn" type="button" disabled={retryPending} onclick={() => onRetry?.()}>
          {#if retryPending}<RefreshCw size={14} class="animate-spin" />{:else}<ListRestart size={14} />{/if}
          {retryPending ? 'Retrying' : 'Retry'}
        </button>
      {/if}
      <button class="action-btn" type="button" onclick={onDismiss}>
        <X size={14} />
        Dismiss
      </button>
      <button class="action-btn" type="button" onclick={() => copyError(false)}>
        {#if copied === 'message'}<Check size={14} />{:else}<Copy size={14} />{/if}
        {copied === 'message' ? 'Copied' : 'Copy message'}
      </button>
      <button class="action-btn" type="button" onclick={() => copyError(true)}>
        {#if copied === 'details'}<Check size={14} />{:else}<Copy size={14} />{/if}
        {copied === 'details' ? 'Copied' : 'Copy with details'}
      </button>
    </div>
  </div>
</section>
