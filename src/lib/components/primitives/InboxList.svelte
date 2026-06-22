<script lang="ts">
  import AppCheckbox from '$lib/components/primitives/AppCheckbox.svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import type { InboxFormField, InboxItem } from '$lib/domain/types';

  let {
    items,
    onAction = null,
    onFieldChange = null,
    onOpenSession = null
  }: {
    items: InboxItem[];
    onAction?: ((itemId: string, actionId: string) => void | Promise<void>) | null;
    onFieldChange?: ((itemId: string, fieldKey: string, value: InboxFormField['value']) => void) | null;
    onOpenSession?: ((item: InboxItem) => void | Promise<void>) | null;
  } = $props();

  function isPrimaryAction(kind: string) {
    return kind === 'accept' || kind.startsWith('allow');
  }
</script>

<section class="settings-section">
  <div class="settings-section-header">
    <div>
      <h2>Requests</h2>
      <p>Permission and elicitation requests from active agents.</p>
    </div>
  </div>

  {#if items.length === 0}
    <div class="empty-state">
      <div class="text-sm font-medium">No requests need attention</div>
      <div class="panel-copy mt-1">Permission and elicitation requests will appear here while an active agent needs your input.</div>
    </div>
  {/if}

  <div class="space-y-3">
  {#each items as item}
    <article class="surface-muted p-4">
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

      {#if item.formFields && item.formFields.length > 0 && item.status !== 'resolved'}
        <div class="mt-4 grid gap-3">
          {#each item.formFields as field}
            <label class="grid gap-2">
              <span class="muted text-xs uppercase tracking-[0.18em]">
                {field.label}{#if field.required} *{/if}
              </span>
              {#if field.kind === 'boolean'}
                <AppCheckbox
                  checked={Boolean(field.value)}
                  ariaLabel={field.label}
                  onCheckedChange={(checked) => onFieldChange?.(item.id, field.key, checked)}
                />
              {:else if field.kind === 'array' && field.options}
                <div class="flex flex-wrap gap-2">
                  {#each field.options as option}
                    <AppCheckbox
                      checked={Array.isArray(field.value) && field.value.includes(option.value)}
                      label={option.label}
                      pill
                      onCheckedChange={(checked) => {
                        const current = Array.isArray(field.value) ? field.value : [];
                        const next = checked
                          ? [...current, option.value]
                          : current.filter((value) => value !== option.value);
                        onFieldChange?.(item.id, field.key, next);
                      }}
                    />
                  {/each}
                </div>
              {:else if field.options}
                <AppSelect
                  class="w-full"
                  value={String(field.value)}
                  options={[{ value: '', label: 'Select...' }, ...field.options]}
                  ariaLabel={field.label}
                  onValueChange={(value) => onFieldChange?.(item.id, field.key, value)}
                />
              {:else if field.kind === 'number' || field.kind === 'integer'}
                <input
                  class="input-shell px-3 py-2 text-sm"
                  type="number"
                  value={String(field.value)}
                  onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
                />
              {:else}
                <input
                  class="input-shell px-3 py-2 text-sm"
                  type="text"
                  value={String(field.value)}
                  onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
                />
              {/if}
              {#if field.description}
                <span class="muted text-xs">{field.description}</span>
              {/if}
            </label>
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
  {/each}
  </div>
</section>
