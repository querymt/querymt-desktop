<script lang="ts">
  import { Bot, Brain, Check, Cpu, LoaderCircle, Settings2, SlidersHorizontal, UserRound } from '@lucide/svelte';
  import AppSelect from '$lib/components/primitives/AppSelect.svelte';
  import {
    findModelConfigOption,
    findModeConfigOption,
    findProfileConfigOption,
    findReasoningConfigOption,
    getConfigOptionChoices,
    getSelectConfigOptions
  } from '$lib/querymt/config-options';
  import type { ActiveSessionViewModel } from '$lib/domain/types';
  import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk';
  import type { Component } from 'svelte';

  type SelectConfigOption = SessionConfigOption & { type: 'select' };
  type ControlTone = 'mode' | 'reasoning' | 'model' | 'profile' | 'advanced';

  let {
    session,
    pending = {},
    onConfigChange
  }: {
    session: ActiveSessionViewModel;
    pending?: Record<string, boolean>;
    onConfigChange: (configId: string, value: string) => void | Promise<void>;
  } = $props();

  const modeOption = $derived(findModeConfigOption(session.configOptions));
  const reasoningOption = $derived(findReasoningConfigOption(session.configOptions));
  const modelOption = $derived(findModelConfigOption(session.configOptions));
  const profileOption = $derived(findProfileConfigOption(session.configOptions));
  const hasPendingOption = $derived(Object.values(pending).some(Boolean));

  const primaryOptions = $derived.by(() => {
    const seen = new Set<string>();
    return [modeOption, reasoningOption, modelOption, profileOption].filter((option): option is SelectConfigOption => {
      if (!option || seen.has(option.id)) {
        return false;
      }
      seen.add(option.id);
      return true;
    });
  });

  const advancedOptions = $derived.by(() => {
    const pinned = new Set(primaryOptions.map((option) => option.id));
    return getSelectConfigOptions(session.configOptions).filter((option) => !pinned.has(option.id));
  });

  function selectedChoice(option: SelectConfigOption): SessionConfigSelectOption | null {
    return getConfigOptionChoices(option).find((choice) => choice.value === option.currentValue) ?? null;
  }

  function shouldUseSegments(option: SelectConfigOption): boolean {
    const choices = getConfigOptionChoices(option);
    return choices.length > 1 && choices.length <= 4;
  }

  function toneForOption(option: SelectConfigOption): ControlTone {
    if (option.id === modeOption?.id) return 'mode';
    if (option.id === reasoningOption?.id) return 'reasoning';
    if (option.id === modelOption?.id) return 'model';
    if (option.id === profileOption?.id) return 'profile';
    return 'advanced';
  }

  function iconForTone(tone: ControlTone): Component {
    switch (tone) {
      case 'mode':
        return SlidersHorizontal;
      case 'reasoning':
        return Brain;
      case 'model':
        return Cpu;
      case 'profile':
        return UserRound;
      default:
        return Settings2;
    }
  }

  function changeConfig(option: SelectConfigOption, value: string) {
    if (pending[option.id] || value === option.currentValue) {
      return;
    }
    return onConfigChange(option.id, value);
  }
</script>

<details class="details-reset surface-muted session-config-card">
  <summary class="session-config-summary">
    <span>
      <span class="session-config-eyebrow row-tight text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        <Settings2 size={14} />
        <span>Session controls</span>
      </span>
      <span class="session-config-subtitle muted text-xs">{primaryOptions.length + advancedOptions.length} live controls</span>
    </span>
    <span class={`session-config-status-chip ${hasPendingOption ? 'session-config-status-chip-pending' : ''}`}>
      {#if hasPendingOption}
        <LoaderCircle size={12} class="animate-spin" />
        Updating
      {:else}
        Live
      {/if}
    </span>
  </summary>

  {#if primaryOptions.length > 0 || advancedOptions.length > 0}
    {#if primaryOptions.length > 0}
      <div class="session-config-primary">
        {#each primaryOptions as option}
          {@const tone = toneForOption(option)}
          {@const Icon = iconForTone(tone)}
          {@const choice = selectedChoice(option)}
          <div class={`session-config-row session-config-row-${tone}`}>
            <div class="session-config-row-top">
              <span class="session-config-row-icon"><Icon size={15} /></span>
              <div class="session-config-row-body">
                <div class="session-config-row-label">{option.name}</div>
                <div class="session-config-current">{choice?.name ?? option.currentValue}</div>
              </div>
              {#if pending[option.id]}
                <span class="session-config-row-pending"><LoaderCircle size={13} class="animate-spin" /> Updating</span>
              {/if}
            </div>
            {#if option.description}
              <div class="session-config-description">{option.description}</div>
            {/if}

            {#if shouldUseSegments(option)}
              <div class="session-config-segments" aria-label={option.name}>
                {#each getConfigOptionChoices(option) as optionChoice}
                  <button
                    class={`session-config-segment ${optionChoice.value === option.currentValue ? 'session-config-segment-active' : ''}`}
                    type="button"
                    disabled={!!pending[option.id]}
                    aria-pressed={optionChoice.value === option.currentValue}
                    onclick={() => changeConfig(option, optionChoice.value)}
                  >
                    {#if optionChoice.value === option.currentValue}
                      <Check size={12} />
                    {/if}
                    <span>{optionChoice.name}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <AppSelect
                class="w-full"
                value={option.currentValue}
                options={getConfigOptionChoices(option).map((optionChoice) => ({ value: optionChoice.value, label: optionChoice.name }))}
                disabled={!!pending[option.id]}
                ariaLabel={option.name}
                onValueChange={(value) => changeConfig(option, value)}
              />
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if advancedOptions.length > 0}
      <details class="details-reset session-config-advanced">
        <summary class="session-config-advanced-summary">
          <span><Bot size={14} /> More controls</span>
          <span class="badge">{advancedOptions.length}</span>
        </summary>
        <div class="session-config-advanced-list">
          {#each advancedOptions as option}
            {@const choice = selectedChoice(option)}
            <label class="session-config-compact-row">
              <span>
                <span class="session-config-row-label">{option.name}</span>
                {#if option.description}
                  <span class="session-config-description">{option.description}</span>
                {:else}
                  <span class="session-config-current">{choice?.name ?? option.currentValue}</span>
                {/if}
              </span>
              <AppSelect
                class="w-full"
                value={option.currentValue}
                options={getConfigOptionChoices(option).map((optionChoice) => ({ value: optionChoice.value, label: optionChoice.name }))}
                disabled={!!pending[option.id]}
                ariaLabel={option.name}
                onValueChange={(value) => changeConfig(option, value)}
              />
            </label>
          {/each}
        </div>
      </details>
    {/if}
  {:else}
    <div class="session-config-empty">No live controls exposed by this agent yet.</div>
  {/if}
</details>
