<script lang="ts">
  let {
    total,
    active,
    paused,
    attention,
    healthMessage = null
  }: {
    total: number;
    active: number;
    paused: number;
    attention: number;
    healthMessage?: string | null;
  } = $props();
</script>

<section class="automation-overview" aria-label="Automation overview">
  <div class="automation-overview-stats">
    <div class="automation-overview-stat"><span>Total</span><strong>{total}</strong></div>
    <div class="automation-overview-stat"><span>Active</span><strong>{active}</strong></div>
    <div class="automation-overview-stat"><span>Paused</span><strong>{paused}</strong></div>
    <div class="automation-overview-stat"><span>Needs attention</span><strong class:automation-overview-value-danger={attention > 0}>{attention}</strong></div>
  </div>
  {#if healthMessage}<div class="automation-overview-warning">{healthMessage}</div>{/if}
</section>
