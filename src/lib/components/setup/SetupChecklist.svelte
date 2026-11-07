<script lang="ts">
  import { goto } from '$app/navigation';
  import type { ReadinessAction, ReadinessCheck, ReadinessReport } from '$lib/domain/readiness';
  import { agentsStore } from '$lib/stores/agents.svelte';

  let { report }: { report: ReadinessReport } = $props();

  const openChecks = $derived(report.checks.filter((check) => check.status !== 'ok' && check.status !== 'not_applicable'));
  let busy = $state<string | null>(null);

  function actionLabel(action: ReadinessAction): string {
    switch (action.kind) {
      case 'retry-agent': return 'Retry';
      case 'open-agents': return 'Open Agents';
      case 'open-providers': return 'Connect provider';
      case 'refresh-providers': return 'Retry';
      case 'refresh-models': return 'Refresh models';
      case 'choose-model': return 'Choose model';
    }
  }

  async function run(check: ReadinessCheck) {
    const action = check.action;
    if (!action) return;
    busy = check.id;
    try {
      switch (action.kind) {
        case 'retry-agent':
          await agentsStore.restartConfiguredAgent(action.agentId);
          break;
        case 'open-agents':
          await goto('/agents');
          break;
        case 'open-providers':
          await goto('/settings?section=providers');
          break;
        case 'refresh-providers':
          await agentsStore.refreshAuthProviders(action.agentId).catch(() => undefined);
          break;
        case 'refresh-models':
          await agentsStore.refreshModelsForAgent(action.agentId);
          break;
        case 'choose-model':
          await goto('/setup?step=model');
          break;
      }
    } finally {
      busy = null;
    }
  }
</script>

<!-- Same structure and classes as the Start screen "Needs you" strip. -->
{#if openChecks.length > 0}
  <section class="start-needs-you" aria-labelledby="setup-checklist-heading" data-testid="setup-checklist">
    <h2 id="setup-checklist-heading" class="start-needs-you-heading">Finish setup</h2>
    <ul class="start-needs-you-list">
      {#each openChecks as check (check.id)}
        <li class={`start-needs-you-row setup-checklist-row setup-checklist-${check.status}`} data-check={check.id}>
          <span class="start-needs-you-dot" aria-hidden="true"></span>
          <span class="start-needs-you-copy">
            <strong>{check.title}</strong>
            {#if check.reason}<small>{check.reason}</small>{/if}
          </span>
          {#if check.action && check.status !== 'pending'}
            <button class="start-needs-you-action" type="button" disabled={busy === check.id} onclick={() => run(check)}>
              {actionLabel(check.action)}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <a class="start-needs-you-more" href="/setup">Run setup</a>
  </section>
{/if}
