<script lang="ts">
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

<div class="space-y-3">
  {#if items.length === 0}
    <div class="panel-strong p-5">
      <div class="text-sm font-semibold">No requests need attention</div>
      <div class="muted mt-2 text-sm">Permission and elicitation requests will appear here while an active agent needs your input.</div>
    </div>
  {/if}

  {#each items as item}
    <article class="panel-strong p-4">
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
                <input
                  class="h-4 w-4"
                  type="checkbox"
                  checked={Boolean(field.value)}
                  onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).checked)}
                />
              {:else if field.kind === 'array' && field.options}
                <div class="flex flex-wrap gap-2">
                  {#each field.options as option}
                    <label class="badge cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        checked={Array.isArray(field.value) && field.value.includes(option.value)}
                        onchange={(event) => {
                          const checked = (event.currentTarget as HTMLInputElement).checked;
                          const current = Array.isArray(field.value) ? field.value : [];
                          const next = checked
                            ? [...current, option.value]
                            : current.filter((value) => value !== option.value);
                          onFieldChange?.(item.id, field.key, next);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  {/each}
                </div>
              {:else if field.options}
                <select
                  class="rounded-2xl border border-white/8 bg-black/10 px-3 py-2 text-sm outline-none"
                  value={String(field.value)}
                  onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">Select…</option>
                  {#each field.options as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              {:else if field.kind === 'number' || field.kind === 'integer'}
                <input
                  class="rounded-2xl border border-white/8 bg-black/10 px-3 py-2 text-sm outline-none"
                  type="number"
                  value={String(field.value)}
                  onchange={(event) => onFieldChange?.(item.id, field.key, (event.currentTarget as HTMLInputElement).value)}
                />
              {:else}
                <input
                  class="rounded-2xl border border-white/8 bg-black/10 px-3 py-2 text-sm outline-none"
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
        <div class="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{item.error}</div>
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
