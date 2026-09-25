<script lang="ts">
  import { parseAnsiLines, type AnsiSegment } from '$lib/domain/ansi';

  let {
    command = null,
    stdout = '',
    stderr = ''
  }: {
    command?: string | null;
    stdout?: string;
    stderr?: string;
  } = $props();

  // parseAnsiLines renders a single blank line for empty input; treat empty
  // streams as "no lines" so placeholders and line counts stay accurate.
  const stdoutLines = $derived(stdout ? parseAnsiLines(stdout) : []);
  const stderrLines = $derived(stderr ? parseAnsiLines(stderr) : []);
  const hasOutput = $derived(stdoutLines.length > 0 || stderrLines.length > 0);

  function segmentClass(segment: AnsiSegment): string {
    let value = 'session-tool-terminal-segment';
    if (segment.bold) value += ' session-tool-terminal-bold';
    if (segment.dim) value += ' session-tool-terminal-dim';
    if (segment.italic) value += ' session-tool-terminal-italic';
    if (segment.underline) value += ' session-tool-terminal-underline';
    return value;
  }
</script>

<div class="session-tool-terminal-widget" data-testid="session-tool-terminal-output">
  <pre class="session-tool-terminal">{#if command}<span class="session-tool-terminal-line session-tool-terminal-command-line"><span class="session-tool-terminal-prompt">{'$'} </span><span class="session-tool-terminal-command">{command}</span></span>{/if}{#each stdoutLines as line, index (index)}<span class="session-tool-terminal-line">{#if line.segments.length === 0}{'\u00A0'}{:else}{#each line.segments as segment, segmentIndex (segmentIndex)}<span class={segmentClass(segment)} style:color={segment.fg} style:background-color={segment.bg}>{segment.text}</span>{/each}{/if}</span>{/each}{#each stderrLines as line, index (index)}<span class="session-tool-terminal-line">{#if line.segments.length === 0}{'\u00A0'}{:else}{#each line.segments as segment, segmentIndex (segmentIndex)}<span class={segmentClass(segment)} style:color={segment.fg} style:background-color={segment.bg}>{segment.text}</span>{/each}{/if}</span>{/each}{#if !hasOutput && command}<span class="session-tool-terminal-line session-tool-terminal-empty">(no output)</span>{/if}</pre>
</div>
