<script lang="ts">
  import { CircleStop, LoaderCircle, LogIn, LogOut } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import { mcpServerOfAuthId } from '$lib/domain/mcp-auth';
  import { OAuthStatus, type AuthProviderStatus } from '$lib/querymt/generated/types';

  let {
    servers,
    pendingAction = null,
    messages = {},
    errors = {},
    onSignIn,
    onCancelSignIn,
    onDisconnect,
    onDialogTrigger
  }: {
    /** `mcp:<server>` entries of `_querymt/auth/status`. */
    servers: AuthProviderStatus[];
    pendingAction?: { provider: string; action: string } | null;
    messages?: Record<string, string | undefined>;
    errors?: Record<string, string | undefined>;
    onSignIn: (server: AuthProviderStatus) => void;
    onCancelSignIn: (server: AuthProviderStatus) => void;
    onDisconnect: (server: AuthProviderStatus) => void;
    onDialogTrigger: (event: MouseEvent) => void;
  } = $props();

  const sorted = $derived(
    [...servers].sort((a, b) => {
      const rank = (s: AuthProviderStatus) => (s.oauth_status === OAuthStatus.Connected ? 1 : 0);
      return rank(a) - rank(b) || a.provider.localeCompare(b.provider);
    })
  );

  function pendingFor(server: AuthProviderStatus) {
    return pendingAction?.provider === server.provider ? pendingAction.action : null;
  }
</script>

<div class="provider-connection-list" aria-label="MCP servers">
  {#each sorted as server (server.provider)}
    {@const connected = server.oauth_status === OAuthStatus.Connected}
    {@const pending = pendingFor(server)}
    <article class={`provider-connection-row provider-connection-row-${connected ? 'connected' : 'setup'}`}>
      <div class="provider-connection-main">
        <h3>{mcpServerOfAuthId(server.provider)}</h3>
        <p>{connected ? 'Signed in' : 'Sign-in required'}</p>
      </div>

      <div class="provider-connection-primary">
        {#if pending === 'oauth'}
          <button class="action-btn action-btn-compact provider-connection-action" type="button" disabled>
            <LoaderCircle size={14} class="animate-spin" />Signing in…
          </button>
          <IconTooltipButton label="Cancel sign-in" icon={CircleStop} controlSize="compact" onclick={() => onCancelSignIn(server)} />
        {:else if connected}
          <button
            class="action-btn action-btn-compact provider-connection-action"
            type="button"
            disabled={Boolean(pending)}
            onclick={(event) => { onDialogTrigger(event); onDisconnect(server); }}
          ><LogOut size={14} />Sign out</button>
        {:else}
          <button
            class="action-btn action-btn-compact provider-connection-action"
            type="button"
            disabled={Boolean(pending)}
            onclick={(event) => { onDialogTrigger(event); onSignIn(server); }}
          ><LogIn size={14} />Sign in</button>
        {/if}
      </div>

      {#if messages[server.provider]}<div class="provider-connection-feedback provider-connection-feedback-success" role="status">{messages[server.provider]}</div>{/if}
      {#if errors[server.provider]}<div class="provider-connection-feedback provider-connection-feedback-error" role="alert">{errors[server.provider]}</div>{/if}
    </article>
  {/each}
</div>
