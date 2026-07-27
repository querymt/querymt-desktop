<script lang="ts">
  import { formatShortcut, getPrimaryModifierLabel } from '$lib/design/platform';

  const modifier = getPrimaryModifierLabel();
</script>

<div class="panel flex items-center justify-between gap-4 px-4 py-3">
  <div>
    <div class="text-sm font-medium">Commands and search</div>
    <div class="muted text-xs">{formatShortcut('P')} opens commands. {formatShortcut('N')} focuses a new prompt.</div>
  </div>

  <div class="flex items-center gap-2 text-xs text-[var(--muted)]">
    <div class="kbd">
      <span class="font-semibold">{modifier}</span> + <span class="font-semibold">P</span>
    </div>
    <div class="kbd">
      <span class="font-semibold">{modifier}</span> + <span class="font-semibold">N</span>
    </div>
  </div>
</div>
