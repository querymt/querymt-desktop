<script lang="ts">
  let { patch }: { patch: string } = $props();
</script>

<div class="session-tool-diff" data-testid="session-tool-diff">{patch}</div>
