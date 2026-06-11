<script lang="ts">
  let {
    text = 'Thinking…',
    class: className = ''
  }: {
    text?: string;
    class?: string;
  } = $props();
</script>

<p
  class={`relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--text),#0000_calc(50%+var(--spread)))] animate-ai-shimmer ${className}`}
  style="--spread: {Math.max(text.length * 2, 30)}px; --shimmer-duration: 2s; background-image: var(--bg), linear-gradient(var(--muted), var(--muted)); background-position: 100% center;"
>
  {text}
</p>

<style>
  @keyframes ai-shimmer {
    from {
      background-position: 100% center;
    }
    to {
      background-position: 0% center;
    }
  }

  :global(.animate-ai-shimmer) {
    animation: ai-shimmer var(--shimmer-duration, 2s) linear infinite;
  }
</style>
