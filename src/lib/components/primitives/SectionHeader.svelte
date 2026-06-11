<script lang="ts">
  export let title: string;
  export let description: string;
  export let eyebrow = '';
</script>

<div class="section-copy-tight">
  {#if eyebrow}
    <div class="section-eyebrow">{eyebrow}</div>
  {/if}
  <h1 class="text-2xl font-semibold tracking-tight text-[var(--text)] text-balance">{title}</h1>
  <p class="muted mt-1 text-sm text-pretty">{description}</p>
</div>
