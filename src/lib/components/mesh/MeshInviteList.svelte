<script lang="ts">
  import { Clipboard, LoaderCircle, Trash2 } from '@lucide/svelte';
  import IconTooltipButton from '$lib/components/primitives/IconTooltipButton.svelte';
  import type { MeshInviteInfo } from '$lib/querymt/generated/types';

  let {
    invites,
    copiedInviteId = null,
    revokingInviteId = null,
    canRevoke = false,
    onCopy,
    onRevoke
  }: {
    invites: MeshInviteInfo[];
    copiedInviteId?: string | null;
    revokingInviteId?: string | null;
    canRevoke?: boolean;
    onCopy: (invite: MeshInviteInfo) => void;
    onRevoke: (invite: MeshInviteInfo) => void;
  } = $props();

  function expiryLabel(timestamp: number) {
    const remainingMs = timestamp * 1000 - Date.now();
    if (remainingMs <= 0) return 'expired';
    const hours = Math.ceil(remainingMs / 3_600_000);
    if (hours < 24) return `expires in ${hours}h`;
    const days = Math.ceil(hours / 24);
    return `expires in ${days}d`;
  }
</script>

{#if invites.length === 0}
  <div class="mesh-empty-row">No active invites. Create one when another peer needs access.</div>
{:else}
  <div class="mesh-item-list">
    {#each invites as invite}
      {@const pendingRevoke = revokingInviteId === invite.invite_id}
      <article class="mesh-item-row">
        <div class="mesh-item-main">
          <div class="mesh-item-title">{invite.invite_id}</div>
          <div class="mesh-item-description">{invite.mesh_name ?? 'Default mesh'}</div>
          <div class="mesh-item-meta">{invite.status} · {invite.uses_remaining} of {invite.max_uses} uses left · {expiryLabel(invite.expires_at)}</div>
        </div>
        <div class="mesh-item-actions">
          <IconTooltipButton label={copiedInviteId === invite.invite_id ? 'Copied invite details' : 'Copy invite details'} icon={Clipboard} disabled={pendingRevoke} onclick={() => onCopy(invite)} />
          <IconTooltipButton
            label={pendingRevoke ? `Revoking ${invite.invite_id}` : `Revoke ${invite.invite_id}`}
            icon={pendingRevoke ? LoaderCircle : Trash2}
            iconClass={pendingRevoke ? 'animate-spin' : ''}
            tone="danger"
            disabled={!canRevoke || pendingRevoke}
            onclick={() => onRevoke(invite)}
          />
        </div>
      </article>
    {/each}
  </div>
{/if}
