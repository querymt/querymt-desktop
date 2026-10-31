<script lang="ts">
  import { ArrowUpRight, PlugZap } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import AppCheckbox from '$lib/components/primitives/AppCheckbox.svelte';
  import type { InboxFormField, InboxItem } from '$lib/domain/types';

  let {
    item,
    compact = false,
    showAgentNames = false,
    onAction = null,
    onFieldChange = null,
    onCustomFieldToggle = null,
    onCustomFieldChange = null,
    onOpenSession = null
  }: {
    item: InboxItem;
    compact?: boolean;
    showAgentNames?: boolean;
    onAction?: ((itemId: string, actionId: string) => void | Promise<void>) | null;
    onFieldChange?: ((itemId: string, fieldKey: string, value: InboxFormField['value']) => void) | null;
    onCustomFieldToggle?: ((itemId: string, fieldKey: string, active: boolean) => void) | null;
    onCustomFieldChange?: ((itemId: string, fieldKey: string, value: string) => void) | null;
    onOpenSession?: ((item: InboxItem) => void | Promise<void>) | null;
  } = $props();

  /** A pending card whose transport dropped: retained but not answerable until recovery. */
  const offline = $derived(item.offline === true && item.status !== 'resolved');
  const showSeverity = $derived(item.type === 'permission' ? item.severity !== 'high' : item.severity !== 'medium');
  const severityClass = $derived(
    item.severity === 'high' ? 'badge-high' : item.severity === 'low' ? 'badge-low' : 'badge-medium'
  );
  const showOpenSession = $derived(
    !compact && Boolean(item.sessionId && item.agentId && onOpenSession)
  );
  const showActions = $derived(
    Boolean(item.actions && item.actions.length > 0 && item.status !== 'resolved')
  );
  const formLocked = $derived(item.status === 'resolved' || offline);
  const showForm = $derived(
    Boolean(
      item.formFields &&
        item.formFields.length > 0 &&
        (item.status !== 'resolved' || item.resolution === 'Submitted')
    )
  );

  function visibleOptions(field: InboxFormField) {
    const options = field.options ?? [];
    if (item.status !== 'resolved' || item.resolution !== 'Submitted') return options;
    if (field.customActive) return [];
    if (field.kind === 'array' && Array.isArray(field.value)) {
      return options.filter((option) => field.value.includes(option.value));
    }
    return options.filter((option) => option.value === field.value);
  }

  function showCustomOption(field: InboxFormField) {
    return Boolean(field.allowCustom && (!formLocked || field.customActive));
  }

  const primaryActionId = $derived.by(() => {
    const actions = item.actions ?? [];
    return actions.find((action) => action.kind === 'accept')?.id
      ?? actions.find((action) => action.kind === 'allow_once')?.id
      ?? actions.find((action) => action.kind.startsWith('allow'))?.id
      ?? null;
  });

  function handleCustomAnswerKeydown(event: KeyboardEvent) {
    if (
      event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.repeat || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
    ) return;
    if (offline || item.status === 'resolved' || item.type !== 'elicitation' || !primaryActionId) return;

    event.preventDefault();
    event.stopPropagation();
    void onAction?.(item.id, primaryActionId);
  }
</script>

<article class={`surface-muted ${compact ? 'p-3' : 'p-4'}`}>
  <div class="flex items-start justify-between gap-4">
    <div>
      <h3 class="text-sm font-semibold">{item.title}</h3>
      <p class="muted mt-1 text-sm">{item.detail}</p>
    </div>
    <div class="flex flex-wrap items-center justify-end gap-2">
      {#if showAgentNames && item.agentName}
        <span class="badge">{item.agentName}</span>
      {/if}
      {#if showSeverity}
        <span class={`badge ${severityClass}`}>{item.severity}</span>
      {/if}
      {#if item.status === 'resolved' && item.resolution}
        <span class="badge">{item.resolution}</span>
      {:else if offline}
        <span class="badge">Temporarily unavailable</span>
      {/if}
      <span class="badge">{item.type}</span>
    </div>
  </div>

  {#if showForm}
    <div class="mt-4 grid gap-3">
      {#each item.formFields ?? [] as field}
        <div class="grid gap-2">
          <span id={`${item.id}-${field.key}-label`} class="muted text-xs uppercase tracking-[0.18em]">
            {field.label}{#if field.required} *{/if}
          </span>
          {#if field.kind === 'boolean'}
            <AppCheckbox
              checked={Boolean(field.value)}
              ariaLabel={field.label}
              disabled={formLocked}
              onCheckedChange={(checked) => {
                if (!formLocked) onFieldChange?.(item.id, field.key, checked);
              }}
            />
          {:else if field.kind === 'array' && field.options}
            <div class="elicitation-option-list" role="group" aria-labelledby={`${item.id}-${field.key}-label`}>
              {#each visibleOptions(field) as option}
                <AppCheckbox
                  class="elicitation-option-row"
                  checked={!field.customActive && Array.isArray(field.value) && field.value.includes(option.value)}
                  label={option.label}
                  description={option.description ?? undefined}
                  disabled={formLocked}
                  onCheckedChange={(checked) => {
                    if (formLocked) return;
                    const current = field.customActive || !Array.isArray(field.value) ? [] : field.value;
                    const next = checked
                      ? [...current, option.value]
                      : current.filter((value) => value !== option.value);
                    onFieldChange?.(item.id, field.key, next);
                  }}
                />
              {/each}
              {#if showCustomOption(field)}
                <div class="elicitation-option-custom">
                  {#if !formLocked}
                    <span class="elicitation-option-or">or</span>
                  {/if}
                  <AppCheckbox
                    class="elicitation-option-row elicitation-option-custom-row"
                    checked={Boolean(field.customActive)}
                    label="Custom answer…"
                    description="Type a different response."
                    disabled={formLocked}
                    onCheckedChange={(checked) => {
                      if (!formLocked) onCustomFieldToggle?.(item.id, field.key, checked);
                    }}
                  />
                </div>
              {/if}
            </div>
            {#if field.customActive}
              <input
                class="input-shell px-3 py-2 text-sm"
                type="text"
                aria-label={`${field.label} custom response`}
                placeholder="Custom answer…"
                value={field.customValue ?? ''}
                disabled={formLocked}
                onkeydown={handleCustomAnswerKeydown}
                oninput={(event) => {
                  if (!formLocked)
                    onCustomFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value);
                }}
              />
            {/if}
          {:else if field.options}
            <div class="elicitation-option-list" role="radiogroup" aria-labelledby={`${item.id}-${field.key}-label`}>
              {#each visibleOptions(field) as option, optionIndex}
                {@const descriptionId = option.description ? `${item.id}-${field.key}-option-${optionIndex}-desc` : undefined}
                <label class="elicitation-option-row">
                  <input
                    class="elicitation-radio-input"
                    type="radio"
                    name={`${item.id}-${field.key}`}
                    value={option.value}
                    checked={!field.customActive && field.value === option.value}
                    disabled={formLocked}
                    aria-label={option.label}
                    aria-describedby={descriptionId}
                    onchange={() => {
                      if (!formLocked) onFieldChange?.(item.id, field.key, option.value);
                    }}
                  />
                  <span class="elicitation-option-copy">
                    <span class="elicitation-option-label">{option.label}</span>
                    {#if option.description}
                      <span id={descriptionId} class="elicitation-option-description">{option.description}</span>
                    {/if}
                  </span>
                </label>
              {/each}
              {#if showCustomOption(field)}
                <div class="elicitation-option-custom">
                  {#if !formLocked}
                    <span class="elicitation-option-or">or</span>
                  {/if}
                  <label class="elicitation-option-row elicitation-option-custom-row">
                    <input
                      class="elicitation-radio-input"
                      type="radio"
                      name={`${item.id}-${field.key}`}
                      value="__querymt_custom__"
                      checked={Boolean(field.customActive)}
                      disabled={formLocked}
                      aria-label="Custom answer…"
                      onchange={() => {
                        if (!formLocked) onCustomFieldToggle?.(item.id, field.key, true);
                      }}
                    />
                    <span class="elicitation-option-copy">
                      <span class="elicitation-option-label">Custom answer…</span>
                      <span class="elicitation-option-description">Type a different response.</span>
                    </span>
                  </label>
                </div>
              {/if}
            </div>
            {#if field.customActive}
              <input
                class="input-shell px-3 py-2 text-sm"
                type="text"
                aria-label={`${field.label} custom response`}
                placeholder="Custom answer…"
                value={field.customValue ?? ''}
                disabled={formLocked}
                onkeydown={handleCustomAnswerKeydown}
                oninput={(event) => {
                  if (!formLocked)
                    onCustomFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value);
                }}
              />
            {/if}
          {:else if field.kind === 'number' || field.kind === 'integer'}
            <input
              class="input-shell px-3 py-2 text-sm"
              type="number"
              aria-label={field.label}
              value={String(field.value)}
              disabled={formLocked}
              onchange={(event) => {
                if (!formLocked)
                  onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value);
              }}
            />
          {:else}
            <input
              class="input-shell px-3 py-2 text-sm"
              type="text"
              aria-label={field.label}
              value={String(field.value)}
              disabled={formLocked}
              onchange={(event) => {
                if (!formLocked)
                  onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value);
              }}
            />
          {/if}
          {#if field.description && field.description.trim() !== item.detail.trim()}
            <span class="muted text-xs">{field.description}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if offline}
    <div class="state-inline-progress mt-4" role="status">
      <PlugZap size={14} />
      <span>
        Waiting to reconnect. This question is temporarily unavailable, not cancelled; your draft is
        kept and you can answer once the connection recovers.
      </span>
    </div>
  {/if}

  {#if item.error}
    <div class="alert-error mt-4">{item.error}</div>
  {/if}

  {#if showActions || showOpenSession}
    <div class="mt-4 flex flex-wrap items-center gap-2">
      {#if showActions}
        {#each item.actions ?? [] as action}
          <button
            class={`action-btn ${action.id === primaryActionId ? 'action-btn-primary' : ''}`}
            type="button"
            disabled={offline}
            onclick={() => {
              if (!offline) onAction?.(item.id, action.id);
            }}
          >
            {action.label}
          </button>
        {/each}
      {/if}
      {#if showOpenSession}
        <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
          <Tooltip.Root disableHoverableContent>
            <Tooltip.Trigger
              type="button"
              class="action-btn action-btn-compact ml-auto"
              aria-label="Open session"
              onclick={() => onOpenSession?.(item)}
            >
              Open session
              <ArrowUpRight size={12} aria-hidden="true" />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content class="app-tooltip-content" sideOffset={6}>{item.sessionId}</Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/if}
    </div>
  {/if}
</article>
