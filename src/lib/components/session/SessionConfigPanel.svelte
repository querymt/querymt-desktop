<script lang="ts">
  import { Settings2 } from '@lucide/svelte';
  import { getCurrentModelId, getModelChoices } from '$lib/querymt/config-options';
  import type { ActiveSessionViewModel } from '$lib/domain/types';

  let { session }: { session: ActiveSessionViewModel } = $props();

  const currentModelId = $derived(getCurrentModelId(session.configOptions));
  const currentModelChoice = $derived(
    getModelChoices(session.configOptions).find((choice) => choice.value === currentModelId) ?? null
  );
</script>

<section class="surface-muted p-4">
  <div class="mb-3 row-tight text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
    <Settings2 size={14} />
    <span>Session config</span>
  </div>
  {#if currentModelChoice}
    <div class="session-plan-card">
      <div class="text-sm font-medium">{currentModelChoice.name}</div>
      <div class="muted mt-2 text-xs">{currentModelId}</div>
    </div>
  {:else}
    <div class="muted text-sm">No model selected yet.</div>
  {/if}
</section>
