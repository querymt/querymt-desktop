<script lang="ts">
  import { Bot, MessageSquareQuote, Sparkles, UserRound } from '@lucide/svelte';
  import SessionToolBlock from '$lib/components/session/SessionToolBlock.svelte';

  let {
    item,
    activeToolCallId = null
  }: {
    item: {
      role: 'user' | 'assistant' | 'thought';
      html: string;
      relatedTools: Array<{
        id: string;
        title: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
        kind: string | null;
        arguments?: string | null;
        result?: string | null;
      }>;
      relatedEvents: Array<{ kind: string; text: string }>;
    };
    activeToolCallId?: string | null;
  } = $props();
</script>

<article class={`session-message ${item.role === 'assistant' ? 'session-message-assistant' : item.role === 'thought' ? 'session-message-thought' : 'session-message-user'}`}>
  <div class="session-message-header">
    <div class="session-message-meta">
      <span class="session-message-avatar">
        {#if item.role === 'assistant'}
          <Bot size={14} />
        {:else if item.role === 'thought'}
          <Sparkles size={14} />
        {:else}
          <UserRound size={14} />
        {/if}
      </span>
      <div>
        <div class="session-message-role">
          {#if item.role === 'assistant'}
            Agent
          {:else if item.role === 'thought'}
            Reasoning
          {:else}
            You
          {/if}
        </div>
        <div class="session-message-role-subtle">
          {#if item.role === 'assistant'}
            Response
          {:else if item.role === 'thought'}
            Internal working
          {:else}
            Prompt
          {/if}
        </div>
      </div>
    </div>

    {#if item.relatedTools.length > 0}
      <span class="badge">{item.relatedTools.length} tool{item.relatedTools.length > 1 ? 's' : ''}</span>
    {/if}
  </div>

  <div class="session-message-body markdown-body">{@html item.html}</div>

  {#if item.relatedTools.length > 0}
    <div class="session-message-tools">
      {#each item.relatedTools as tool}
        <SessionToolBlock tool={tool} open={tool.id === activeToolCallId || tool.status === 'in_progress' || tool.status === 'failed'} />
      {/each}
    </div>
  {/if}

  {#if item.role === 'assistant' && item.relatedEvents.length > 0}
    <details class="details-reset session-turn-details">
      <summary class="session-turn-details-summary">
        <MessageSquareQuote size={13} />
        <span>Turn details</span>
      </summary>
      <div class="session-turn-details-list">
        {#each item.relatedEvents as event}
          <div class="session-turn-detail-row">
            <div class="muted mb-1 text-[11px] uppercase tracking-[0.16em]">{event.kind}</div>
            <div class="whitespace-pre-wrap text-sm">{event.text}</div>
          </div>
        {/each}
      </div>
    </details>
  {/if}
</article>
