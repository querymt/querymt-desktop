<script lang="ts">
  let {
    command = null,
    stdout = '',
    stderr = ''
  }: {
    command?: string | null;
    stdout?: string;
    stderr?: string;
  } = $props();

  const text = $derived(
    [
      command ? `$ ${command}` : null,
      stdout,
      stderr
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n')
  );
</script>

<pre class="session-tool-terminal" data-testid="session-tool-terminal-output">{text}</pre>
