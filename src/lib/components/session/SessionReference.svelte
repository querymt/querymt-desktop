<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { Bot, Monitor, Network } from '@lucide/svelte';
  import type { SessionLinkTarget } from '$lib/domain/sessions';

  let { target, text }: { target: SessionLinkTarget; text: string } = $props();

  const isDelegate = $derived(Boolean(target.parentSessionId && target.forkOrigin === 'delegation'));
  const sessionKind = $derived(isDelegate ? 'delegate' : 'session');
  const sessionType = $derived(target.location === 'local' ? `local ${sessionKind}` : target.location === 'remote' ? `remote ${sessionKind}` : sessionKind);
  const remoteHost = $derived(target.remoteNodeLabel?.trim() || target.remoteNodeId?.trim());
  const description = $derived(`Open ${sessionType}${target.location === 'remote' && remoteHost ? ` on ${remoteHost}` : ''}: ${target.title}`);
</script>

<!-- Adjacent component tags avoid inserting whitespace into the message text. -->
<Tooltip.Provider delayDuration={250} skipDelayDuration={80}><Tooltip.Root disableHoverableContent>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <a {...props} class="session-reference" href={`/sessions/${encodeURIComponent(target.agentId)}/${encodeURIComponent(target.sessionId)}`} aria-label={`${text}: ${description}`}>{#if isDelegate}<Bot size={12} aria-hidden="true" />{:else if target.location === 'local'}<Monitor size={12} aria-hidden="true" />{:else if target.location === 'remote'}<Network size={12} aria-hidden="true" />{/if}{text}</a>
    {/snippet}
  </Tooltip.Trigger><Tooltip.Portal>
    <Tooltip.Content role="tooltip" class="app-tooltip-content" sideOffset={6}>
      {description}
    </Tooltip.Content>
  </Tooltip.Portal></Tooltip.Root></Tooltip.Provider>

<style>
  .session-reference :global(svg) {
    display: inline-block;
    margin-inline-end: 0.25em;
    vertical-align: -0.125em;
  }
</style>
