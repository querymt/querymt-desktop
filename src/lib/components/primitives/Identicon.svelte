<script lang="ts">
  import { createHexIdenticon } from '$lib/vendor/hex-identicon';

  let { seed, size = 32 }: { seed: string; size?: number } = $props();
  const svg = $derived(createHexIdenticon(seed, { size }));
</script>

<span class="session-identicon-svg hex-identicon" aria-hidden="true">{@html svg}</span>

<style>
  .hex-identicon {
    display: inline-flex;
    width: 100%;
    height: 100%;
  }

  .hex-identicon :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
