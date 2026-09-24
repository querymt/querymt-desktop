<script lang="ts">
  let {
    command = null,
    stdout = '',
    stderr = '',
    exitCode = null
  }: {
    command?: string | null;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
  } = $props();

  const text = $derived(
    [
      command ? `$ ${command}` : null,
      stdout,
      stderr,
      exitCode !== null ? `exit ${exitCode}` : null
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n')
  );
</script>

<pre class="session-tool-terminal" data-testid="session-tool-terminal-output">{text}</pre>
