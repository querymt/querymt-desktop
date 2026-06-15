<script lang="ts">
  import { Settings2 } from '@lucide/svelte';
  import {
    findModeConfigOption,
    findReasoningConfigOption,
    getConfigOptionChoices,
    getSelectConfigOptions
  } from '$lib/querymt/config-options';
  import type { ActiveSessionViewModel } from '$lib/domain/types';
  import type { SessionConfigOption } from '@agentclientprotocol/sdk';

  let {
    session,
    pending = {},
    onConfigChange
  }: {
    session: ActiveSessionViewModel;
    pending?: Record<string, boolean>;
    onConfigChange: (configId: string, value: string) => void | Promise<void>;
  } = $props();

  const prioritizedOptions = $derived.by(() => {
    const mode = findModeConfigOption(session.configOptions);
    const reasoning = findReasoningConfigOption(session.configOptions);
    const all = getSelectConfigOptions(session.configOptions);
    const pinned = new Set([mode?.id, reasoning?.id].filter((value): value is string => Boolean(value)));
    const remaining = all.filter((option) => !pinned.has(option.id));
    return [mode, reasoning, ...remaining].filter(
      (option, index, array): option is SessionConfigOption & { type: 'select' } =>
        Boolean(option) && array.findIndex((entry) => entry?.id === option?.id) === index
    );
  });
</script>

<section class="surface-muted p-4">
  <div class="mb-3 row-tight text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
    <Settings2 size={14} />
    <span>Session config</span>
  </div>

  {#if prioritizedOptions.length > 0}
    <div class="space-y-3">
      {#each prioritizedOptions as option}
        <label class="block space-y-2">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-medium">{option.name}</div>
              {#if option.description}
                <div class="muted mt-1 text-xs">{option.description}</div>
              {/if}
            </div>
            <span class={`badge min-w-[5.75rem] justify-center transition-opacity ${pending[option.id] ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!pending[option.id]}>
              Updating…
            </span>
          </div>
          <select
            class="composer-select-pill w-full"
            value={option.currentValue}
            disabled={!!pending[option.id]}
            aria-label={option.name}
            onchange={(event) => onConfigChange(option.id, (event.currentTarget as HTMLSelectElement).value)}
          >
            {#each getConfigOptionChoices(option) as choice}
              <option value={choice.value}>{choice.name}</option>
            {/each}
          </select>
        </label>
      {/each}
    </div>
  {:else}
    <div class="muted text-sm">No configurable session options yet.</div>
  {/if}
</section>
