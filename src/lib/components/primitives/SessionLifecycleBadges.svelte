<script lang="ts">
  import { Archive, Check } from '@lucide/svelte';
  import type { SessionLifecycle } from '$lib/domain/types';
  let { lifecycle, showUnavailable = false }: { lifecycle?: SessionLifecycle | null; showUnavailable?: boolean } = $props();
</script>

{#if lifecycle?.resolved}<span class="session-lifecycle-badge" title="This session's purpose is resolved. This does not indicate execution success."><Check size={11} />Resolved</span>{/if}
{#if lifecycle?.archived}<span class="session-lifecycle-badge" title="Hidden from the working list. Execution and schedules are unchanged."><Archive size={11} />Archived</span>{/if}
{#if !lifecycle && showUnavailable}<span class="session-lifecycle-badge session-lifecycle-unknown">Lifecycle unavailable</span>{/if}
