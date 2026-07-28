<script lang="ts">
  let {
    connected,
    needsSetup,
    attention,
    models
  }: {
    connected: number;
    needsSetup: number;
    attention: number;
    models: number;
  } = $props();
</script>

<section class="provider-overview" aria-label="Provider overview">
  <div class="provider-overview-stats">
    <div class="provider-overview-stat"><span>Connected</span><strong>{connected}</strong></div>
    <div class="provider-overview-stat"><span>Needs setup</span><strong>{needsSetup}</strong></div>
    <div class="provider-overview-stat"><span>Needs attention</span><strong class:provider-overview-value-danger={attention > 0}>{attention}</strong></div>
    <div class="provider-overview-stat"><span>Models</span><strong>{models}</strong></div>
  </div>
</section>
