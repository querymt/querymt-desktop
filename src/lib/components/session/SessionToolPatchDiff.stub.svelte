<script lang="ts">
  let { patch, hideFileHeader = false, scrollRoot }: { patch: string; hideFileHeader?: boolean; scrollRoot?: HTMLElement } = $props();
</script>

<div class="session-tool-diff" data-testid="session-tool-diff" data-hide-file-header={hideFileHeader ? 'true' : 'false'} data-virtualized={Boolean(scrollRoot)}>{patch}</div>
