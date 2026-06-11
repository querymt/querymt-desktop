<script lang="ts">
  import type { SettingsGroup } from '$lib/domain/types';

  export let groups: SettingsGroup[];
</script>

<div class="space-y-4">
  {#each groups as group}
    <section class="panel-strong p-4">
      <div class="mb-4">
        <h3 class="text-sm font-semibold">{group.title}</h3>
        <p class="muted mt-1 text-sm">{group.description}</p>
      </div>

      <div class="space-y-3">
        {#each group.items as item}
          <div class="rounded-2xl border border-white/8 bg-white/3 p-3">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span>{item.label}</span>
              <span>{item.value}</span>
            </div>
            <div class="muted mt-1 text-xs">{item.hint}</div>
          </div>
        {/each}
      </div>
    </section>
  {/each}
</div>
