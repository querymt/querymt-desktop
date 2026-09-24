<script lang="ts">
  import type { ReadFileOutputView } from '$lib/domain/session-tool-read-output';

  let { view }: { view: ReadFileOutputView } = $props();

  const lineCount = $derived(view.sections.reduce((total, section) => total + section.lines.length, 0));
</script>

<div class="session-tool-read-output" data-testid="session-tool-read-output">{view.path} ({lineCount} lines)</div>
