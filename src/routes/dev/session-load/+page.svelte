<script lang="ts">
  import { tick } from 'svelte';
  import ActiveSessionView from '$lib/components/primitives/ActiveSessionView.svelte';
  import { activeSessionFromLoadResponse } from '$lib/domain/session-snapshot';
  import { createEmptyActiveSession } from '$lib/domain/session-updates';
  import type { ActiveSessionViewModel } from '$lib/domain/types';
  import { createSyntheticSessionLoadFixture } from '$lib/perf/session-load-fixture';
  import { runObservedSessionLoadPipeline } from '$lib/perf/session-load-pipeline';

  let scale = $state(1);
  let mode = $state<'snapshot' | 'observed'>('observed');
  let session = $state<ActiveSessionViewModel>(createEmptyActiveSession());
  let result = $state<{ durationMs: number; events: number; transcript: number; tools: number; domNodes: number } | null>(null);

  async function run() {
    const fixture = createSyntheticSessionLoadFixture({ scale });
    const started = performance.now();
    session =
      mode === 'snapshot'
        ? activeSessionFromLoadResponse(fixture.sessionId, fixture.response)
        : runObservedSessionLoadPipeline(
            fixture.sessionId,
            fixture.response,
            fixture.notificationsBeforeResponse,
            fixture.notificationsAfterResponse,
            fixture.notifications
          ).session;
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    result = {
      durationMs: performance.now() - started,
      events: session.events.length,
      transcript: session.transcript.length,
      tools: session.toolCalls.length,
      domNodes: document.querySelectorAll('*').length
    };
  }
</script>

<svelte:head><title>Session Load Lab</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 p-6">
  <header>
    <h1 class="text-2xl font-semibold">Session Load Lab</h1>
    <p>Deterministic replay, hydration, and render diagnostics based on the observed slow-session trace.</p>
  </header>
  <div class="flex gap-3">
    <label>Scale
      <select bind:value={scale}>
        <option value={0.125}>0.125x</option>
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
      </select>
    </label>
    <label>Mode
      <select bind:value={mode}>
        <option value="observed">Observed replay + drain</option>
        <option value="snapshot">Snapshot only</option>
      </select>
    </label>
    <button type="button" onclick={run}>Run load</button>
  </div>
  {#if result}
    <pre>{JSON.stringify(result, null, 2)}</pre>
  {/if}
  <ActiveSessionView {session} />
</div>
