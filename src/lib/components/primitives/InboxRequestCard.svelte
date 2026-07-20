<script lang="ts">
  import AppCheckbox from '$lib/components/primitives/AppCheckbox.svelte';
  import type { InboxFormField, InboxItem } from '$lib/domain/types';

  let {
    item,
    compact = false,
    onAction = null,
    onFieldChange = null,
    onCustomFieldToggle = null,
    onCustomFieldChange = null,
    onOpenSession = null
  }: {
    item: InboxItem;
    compact?: boolean;
    onAction?: ((itemId: string, actionId: string) => void | Promise<void>) | null;
    onFieldChange?: ((itemId: string, fieldKey: string, value: InboxFormField['value']) => void) | null;
    onCustomFieldToggle?: ((itemId: string, fieldKey: string, active: boolean) => void) | null;
    onCustomFieldChange?: ((itemId: string, fieldKey: string, value: string) => void) | null;
    onOpenSession?: ((item: InboxItem) => void | Promise<void>) | null;
  } = $props();

  function isPrimaryAction(kind: string) {
    return kind === 'accept' || kind.startsWith('allow');
  }
</script>

<article class={`surface-muted ${compact ? 'p-3' : 'p-4'}`}>
  <div class="flex items-start justify-between gap-4">
    <div>
      <h3 class="text-sm font-semibold">{item.title}</h3>
      <p class="muted mt-1 text-sm">{item.detail}</p>
    </div>
    <div class="flex items-center gap-2">
      {#if item.status === 'resolved' && item.resolution}
        <span class="badge">{item.resolution}</span>
      {/if}
      <span class="badge">{item.type}</span>
    </div>
  </div>

  {#if !compact}
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <div class="muted text-xs">
        {#if item.agentName}<span>Agent: {item.agentName} / </span>{/if}
        <span>Owner: {item.owner} / Severity: {item.severity}</span>
        {#if item.sessionId}<span> / Session: {item.sessionId}</span>{/if}
      </div>
      {#if item.sessionId && item.agentId && onOpenSession}
        <button class="action-btn !px-3 !py-1.5 text-xs" type="button" onclick={() => onOpenSession?.(item)}>
          Open session
        </button>
      {/if}
    </div>
  {/if}

  {#if item.formFields && item.formFields.length > 0 && item.status !== 'resolved'}
    <div class="mt-4 grid gap-3">
      {#each item.formFields as field}
        <div class="grid gap-2">
          <span id={`${item.id}-${field.key}-label`} class="muted text-xs uppercase tracking-[0.18em]">
            {field.label}{#if field.required} *{/if}
          </span>
          {#if field.kind === 'boolean'}
            <AppCheckbox
              checked={Boolean(field.value)}
              ariaLabel={field.label}
              onCheckedChange={(checked) => onFieldChange?.(item.id, field.key, checked)}
            />
          {:else if field.kind === 'array' && field.options}
            <div class="elicitation-option-list" role="group" aria-labelledby={`${item.id}-${field.key}-label`}>
              {#each field.options as option}
                <AppCheckbox
                  class="elicitation-option-row"
                  checked={!field.customActive && Array.isArray(field.value) && field.value.includes(option.value)}
                  label={option.label}
                  onCheckedChange={(checked) => {
                    const current = field.customActive || !Array.isArray(field.value) ? [] : field.value;
                    const next = checked
                      ? [...current, option.value]
                      : current.filter((value) => value !== option.value);
                    onFieldChange?.(item.id, field.key, next);
                  }}
                />
              {/each}
              {#if field.allowCustom}
                <AppCheckbox
                  class="elicitation-option-row"
                  checked={Boolean(field.customActive)}
                  label="Custom answer…"
                  onCheckedChange={(checked) => onCustomFieldToggle?.(item.id, field.key, checked)}
                />
              {/if}
            </div>
            {#if field.customActive}
              <input
                class="input-shell px-3 py-2 text-sm"
                type="text"
                aria-label={`${field.label} custom response`}
                placeholder="Custom answer…"
                value={field.customValue ?? ''}
                oninput={(event) =>
                  onCustomFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
              />
            {/if}
          {:else if field.options}
            <div class="elicitation-option-list" role="radiogroup" aria-labelledby={`${item.id}-${field.key}-label`}>
              {#each field.options as option}
                <label class="elicitation-option-row">
                  <input
                    class="elicitation-radio-input"
                    type="radio"
                    name={`${item.id}-${field.key}`}
                    value={option.value}
                    checked={!field.customActive && field.value === option.value}
                    onchange={() => onFieldChange?.(item.id, field.key, option.value)}
                  />
                  <span class="elicitation-option-label">{option.label}</span>
                </label>
              {/each}
              {#if field.allowCustom}
                <label class="elicitation-option-row">
                  <input
                    class="elicitation-radio-input"
                    type="radio"
                    name={`${item.id}-${field.key}`}
                    value="__querymt_custom__"
                    checked={Boolean(field.customActive)}
                    onchange={() => onCustomFieldToggle?.(item.id, field.key, true)}
                  />
                  <span class="elicitation-option-label">Custom answer…</span>
                </label>
              {/if}
            </div>
            {#if field.customActive}
              <input
                class="input-shell px-3 py-2 text-sm"
                type="text"
                aria-label={`${field.label} custom response`}
                placeholder="Custom answer…"
                value={field.customValue ?? ''}
                oninput={(event) =>
                  onCustomFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
              />
            {/if}
          {:else if field.kind === 'number' || field.kind === 'integer'}
            <input
              class="input-shell px-3 py-2 text-sm"
              type="number"
              aria-label={field.label}
              value={String(field.value)}
              onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
            />
          {:else}
            <input
              class="input-shell px-3 py-2 text-sm"
              type="text"
              aria-label={field.label}
              value={String(field.value)}
              onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
            />
          {/if}
          {#if field.description && field.description.trim() !== item.detail.trim()}
            <span class="muted text-xs">{field.description}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if item.error}
    <div class="alert-error mt-4">{item.error}</div>
  {/if}

  {#if item.actions && item.actions.length > 0 && item.status !== 'resolved'}
    <div class="mt-4 flex flex-wrap gap-2">
      {#each item.actions as action}
        <button
          class={`action-btn ${isPrimaryAction(action.kind) ? 'action-btn-primary' : ''}`}
          type="button"
          onclick={() => onAction?.(item.id, action.id)}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</article>
