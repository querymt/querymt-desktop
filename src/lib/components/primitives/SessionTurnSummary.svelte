<script lang="ts">
  import type { PromptResponse } from '@agentclientprotocol/sdk';

  export let sessionId: string | null;
  export let response: PromptResponse | null;
</script>

<div class="panel-strong p-5">
  <div class="mb-4">
    <div class="text-sm font-semibold">Latest turn</div>
    <p class="muted mt-1 text-sm">Current session creation and prompt submission result.</p>
  </div>

  <div class="grid gap-3 md:grid-cols-2">
    <div class="rounded-2xl border border-white/8 bg-black/10 p-3">
      <div class="muted text-xs uppercase tracking-[0.18em]">Session id</div>
      <div class="mt-2 text-sm">{sessionId ?? 'No active session yet'}</div>
    </div>
    <div class="rounded-2xl border border-white/8 bg-black/10 p-3">
      <div class="muted text-xs uppercase tracking-[0.18em]">Stop reason</div>
      <div class="mt-2 text-sm">{response?.stopReason ?? 'No turn sent yet'}</div>
    </div>
  </div>
</div>
