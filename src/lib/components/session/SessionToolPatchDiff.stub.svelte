<script lang="ts">
  let { patch, hideFileHeader = false }: { patch: string; hideFileHeader?: boolean } = $props();
</script>

<div class="session-tool-diff" data-testid="session-tool-diff" data-hide-file-header={hideFileHeader ? 'true' : 'false'}>{patch}</div>
