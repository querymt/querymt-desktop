<script lang="ts">
  import { Search } from '@lucide/svelte';
  import { compactPath } from '$lib/domain/automations';
  import { filterSessions } from '$lib/domain/schedule-form';

  type PickerSession = { sessionId: string; title: string; cwd: string };

  let {
    sessions,
    value = $bindable(''),
    disabled = false
  }: {
    sessions: PickerSession[];
    value: string;
    disabled?: boolean;
  } = $props();

  const MAX_ROWS = 100;

  let query = $state('');
  let highlighted = $state(0);
  let listElement: HTMLDivElement | null = null;
  let rootElement: HTMLDivElement | null = null;

  // The picker appears below the fold of the dialog body. Bring the whole thing (search and
  // list) into view once, so it is not left half hidden behind the pinned footer.
  $effect(() => {
    rootElement?.scrollIntoView?.({ block: 'nearest' });
  });

  const matches = $derived(filterSessions(sessions, query));
  const visible = $derived(matches.slice(0, MAX_ROWS));

  $effect(() => {
    // Keep the highlight inside the list as the query narrows it.
    if (highlighted >= visible.length) highlighted = Math.max(visible.length - 1, 0);
  });

  $effect(() => {
    const index = highlighted;
    listElement?.querySelectorAll<HTMLElement>('.session-picker-row')[index]?.scrollIntoView?.({ block: 'nearest' });
  });

  function shortId(id: string) {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(highlighted + 1, visible.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
    } else if (event.key === 'Enter') {
      // Enter picks the highlighted row; it must not submit the surrounding form.
      event.preventDefault();
      const match = visible[highlighted];
      if (match) value = match.sessionId;
    }
  }
</script>

<div class="session-picker" bind:this={rootElement}>
  <div class="session-picker-search">
    <Search size={15} aria-hidden="true" />
    <input
      class="session-picker-input"
      type="search"
      bind:value={query}
      {disabled}
      placeholder="Search by title, session ID or workspace"
      aria-label="Search sessions"
      autocomplete="off"
      spellcheck="false"
      onkeydown={handleKeydown}
      oninput={() => (highlighted = 0)}
    />
  </div>

  <div class="session-picker-list" role="listbox" aria-label="Sessions" bind:this={listElement}>
    {#each visible as session, index (session.sessionId)}
      <button
        class="session-picker-row"
        class:session-picker-row-selected={value === session.sessionId}
        class:session-picker-row-highlighted={highlighted === index && value !== session.sessionId}
        type="button"
        role="option"
        aria-selected={value === session.sessionId}
        {disabled}
        onclick={() => (value = session.sessionId)}
        onmousemove={() => (highlighted = index)}
      >
        <span class="session-picker-title">{session.title || 'Untitled session'}</span>
        <span class="session-picker-meta">
          {#if session.cwd}<span>{compactPath(session.cwd)}</span>{/if}
          <span class="session-picker-id">{shortId(session.sessionId)}</span>
        </span>
      </button>
    {:else}
      <p class="session-picker-empty">
        {sessions.length === 0 ? 'No sessions for this agent.' : `No sessions match “${query.trim()}”.`}
      </p>
    {/each}
    {#if matches.length > visible.length}
      <p class="session-picker-empty">Showing the first {MAX_ROWS} of {matches.length}. Refine the search to narrow it down.</p>
    {/if}
  </div>
</div>
