<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { FolderOpen } from '@lucide/svelte';
  import { Tooltip } from 'bits-ui';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import { agentsStore, LAUNCH_MODE_OPTIONS, LAUNCH_REASONING_OPTIONS } from '$lib/stores/agents.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { WORKSPACE_MODE_OPTIONS, type ComposerWorkspaceMode } from '$lib/domain/session-workspace';
  import { inboxStore } from '$lib/stores/inbox.svelte';
  import { formatSessionTimestampShort, getSessionWorkspaceName, isActiveSessionStatus, isRootSession, sessionMatchesLifecycle } from '$lib/domain/sessions';
  import type { DesktopSessionSummary, InboxItem } from '$lib/domain/types';

  const NEEDS_YOU_LIMIT = 3;

  type NeedsYouEntry = {
    key: string;
    title: string;
    detail: string;
    workspace: string | null;
    updatedAt: string | null;
    href: string;
    action: 'Reply' | 'Open';
    running?: boolean;
  };

  // Ticking reference so the relative times advance on their own.
  let relativeTimeNow = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (relativeTimeNow = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  // One entry per session that is waiting on the user; requests without a
  // session (e.g. auth) link to the Inbox instead.
  const needsYou = $derived.by((): NeedsYouEntry[] => {
    const items: InboxItem[] = inboxStore.actionableItems ?? [];
    const sessions: DesktopSessionSummary[] = agentsStore.sessions ?? [];
    const seen = new Set<string>();
    const entries: NeedsYouEntry[] = [];
    for (const item of items) {
      if (item.offline) continue;
      const key = item.agentId && item.sessionId ? `${item.agentId}:${item.sessionId}` : `inbox:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const session = item.agentId && item.sessionId
        ? sessions.find((candidate) => candidate.agentId === item.agentId && candidate.sessionId === item.sessionId)
        : undefined;
      entries.push({
        key,
        title: session?.title ?? item.title,
        detail: item.title,
        workspace: session?.cwd ? getSessionWorkspaceName(session.cwd) : null,
        updatedAt: session?.updatedAt ?? null,
        href: session ? `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}` : '/inbox',
        action: item.type === 'elicitation' ? 'Reply' : 'Open'
      });
    }
    return entries;
  });

  // When nothing is waiting, the same slot offers the most recently active open
  // sessions so the page always has something to act on.
  const recentEntries = $derived.by((): NeedsYouEntry[] => {
    const sessions: DesktopSessionSummary[] = agentsStore.sessions ?? [];
    return sessions
      .filter((session) => isRootSession(session) && sessionMatchesLifecycle(session.lifecycle, { resolution: 'open', archive: 'excluded' }))
      .slice()
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, NEEDS_YOU_LIMIT)
      .map((session) => ({
        key: `${session.agentId}:${session.sessionId}`,
        title: session.title,
        detail: session.title,
        workspace: session.cwd ? getSessionWorkspaceName(session.cwd) : null,
        updatedAt: session.updatedAt ?? null,
        href: `/sessions/${encodeURIComponent(session.agentId)}/${encodeURIComponent(session.sessionId)}`,
        action: 'Open' as const,
        running: isActiveSessionStatus(session.status)
      }));
  });

  const showNeedsYou = $derived(needsYou.length > 0);
  const stripEntries = $derived(showNeedsYou ? needsYou.slice(0, NEEDS_YOU_LIMIT) : recentEntries);

  const onlineAgents = $derived(agentsStore.connectedAgents);
  const configuredAgentCount = $derived(agentsStore.configs.filter((config) => config.enabled).length);

  const primaryAgentId = $derived(
    agentsStore.configs.find((config) => config.enabled && config.id === agentsStore.composerAgentId)?.id ??
    onlineAgents[0]?.id ?? agentsStore.configs.find((config) => config.enabled)?.id ?? null
  );
  const modelLocation = $derived.by(() => {
    if (!primaryAgentId) return undefined;
    const status = agentsStore.meshStatusByAgent[primaryAgentId];
    return {
      servingNodeId: status?.peer_id,
      servingNodeLabel: status?.hostname,
      ownerNodeId: agentsStore.composerTargetId === 'local' ? status?.peer_id : agentsStore.composerTargetId
    };
  });
  const showAgentBadges = $derived(onlineAgents.length > 1);
  const workspaceName = $derived.by(() => {
    const normalized = agentsStore.composerCwd.replace(/[\\/]+$/, '');
    return normalized.split(/[\\/]/).filter(Boolean).pop() ?? 'Choose workspace';
  });

  const activeNowCount = $derived.by(() => {
    const localActive =
      agentsStore.activeSessionId &&
      ['submitting', 'thinking', 'streaming', 'tool-running'].includes(agentsStore.activeSession.runState)
        ? 1
        : 0;

    const remoteActive = Object.values(agentsStore.meshNodesByAgent).reduce((total, info) => {
      return total + (info?.nodes ?? []).reduce((sum, node) => sum + (node.active_sessions ?? 0), 0);
    }, 0);

    return localActive + remoteActive;
  });

  $effect(() => {
    const agentId = primaryAgentId;
    const target = agentsStore.composerTargetId;
    if (agentId && target !== 'local') {
      untrack(() => { void agentsStore.refreshRemoteProfiles(agentId, target); });
    }
  });

  // Both launch buttons open the session view immediately under a temporary id;
  // the store keeps creating the session (and sends the prompt) in the background.
  async function startSessionFromLauncher() {
    if (!primaryAgentId) {
      return;
    }

    const launchId = agentsStore.beginLaunch(primaryAgentId);
    if (launchId) {
      // A launch already running belongs to its own agent, which may not be the one shown now.
      const agentId = agentsStore.pendingLaunches[launchId]?.agentId ?? primaryAgentId;
      await goto(`/sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(launchId)}`);
    }
  }
</script>

{#snippet overviewLink(href: string, hint: string, label: import('svelte').Snippet)}
  <Tooltip.Root disableHoverableContent>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <a {...props} class="status-item status-item-link" {href}>{@render label()}</a>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content class="app-tooltip-content" sideOffset={6}>{hint}</Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
{/snippet}

{#snippet sessionsLabel()}<strong>{activeNowCount}</strong> {activeNowCount === 1 ? 'session' : 'sessions'} running{/snippet}
{#snippet agentsLabel()}<strong>{onlineAgents.length}/{configuredAgentCount}</strong> {configuredAgentCount === 1 ? 'agent' : 'agents'} connected{/snippet}
{#snippet inboxLabel()}<strong>{inboxStore.pendingCount}</strong> {inboxStore.pendingCount === 1 ? 'request needs' : 'requests need'} input{/snippet}

<div class="start-launch-page flex min-h-[calc(100vh-7rem)] w-full items-start justify-center px-4">
  <section class="mx-auto w-full max-w-4xl space-y-6">
    <div class="space-y-3 text-center">
      <div class="section-eyebrow">New session</div>
      <h1 class="text-3xl font-semibold tracking-[-0.02em] text-[var(--text)] md:text-4xl">What should QueryMT do?</h1>
      <p class="mx-auto flex max-w-2xl items-center justify-center gap-2 text-sm text-[var(--muted)] md:text-base">
        <FolderOpen size={15} />
        <span>Working in <strong class="font-semibold text-[var(--text)]">{workspaceName}</strong></span>
      </p>
    </div>

    {#each agentsStore.abandonedLaunches as launch (launch.id)}
      <section class="session-prompt-error" role="alert" data-testid="abandoned-launch">
        <div class="session-prompt-error-mark" aria-hidden="true">!</div>
        <div class="session-prompt-error-body">
          <header class="session-prompt-error-heading"><strong>A session could not be started</strong></header>
          <p>{launch.error ?? 'Failed to create session.'}</p>
          {#if launch.prompt}<p class="truncate text-[var(--muted)]">{launch.prompt}</p>{/if}
          <div class="session-prompt-error-actions">
            <button class="action-btn" type="button" disabled={agentsStore.launching}
              onclick={() => { agentsStore.retryLaunch(launch.id); void goto(`/sessions/${encodeURIComponent(launch.agentId)}/${encodeURIComponent(launch.id)}`); }}>Retry</button>
            <button class="action-btn" type="button" onclick={() => agentsStore.discardLaunch(launch.id)}>Restore prompt</button>
          </div>
        </div>
      </section>
    {/each}

    <SessionComposer
      compact={true}
      minimal={true}
      launch={true}
      sendShortcut={chatPreferencesStore.sendShortcut}
      cwd={agentsStore.composerCwd}
      prompt={agentsStore.composerPrompt}
      loading={agentsStore.loading || agentsStore.launching}
      starting={agentsStore.launching}
      error={agentsStore.error ?? agentsStore.getLaunchProfileError(primaryAgentId)}
      activeSessionId={null}
      promptFocusToken={agentsStore.promptFocusToken}
      modelOptions={primaryAgentId ? (agentsStore.modelsByAgent[primaryAgentId] ?? []) : []}
      selectedModelId={primaryAgentId ? agentsStore.getLaunchModelId(primaryAgentId) : ''}
      modelInfo={primaryAgentId ? (agentsStore.modelInfoByAgent[primaryAgentId] ?? {}) : {}}
      {modelLocation}
      recentModels={primaryAgentId ? agentsStore.getRecentModels(primaryAgentId) : []}
      modelLoading={primaryAgentId ? !!agentsStore.modelLoadingByAgent[primaryAgentId] : false}
      agentLabel={showAgentBadges && primaryAgentId ? (agentsStore.configs.find((config) => config.id === primaryAgentId)?.name ?? primaryAgentId) : null}
      recentWorkspaces={agentsStore.getRecentWorkspaces()}
      attachments={agentsStore.promptAttachments}
      profileOptions={agentsStore.getProfileOptions(primaryAgentId)}
      selectedProfileId={agentsStore.composerProfileId}
      launchModeOptions={LAUNCH_MODE_OPTIONS}
      selectedLaunchModeId={agentsStore.composerModeId}
      launchReasoningOptions={LAUNCH_REASONING_OPTIONS}
      selectedLaunchReasoningId={agentsStore.composerReasoningId}
      targetOptions={agentsStore.getTargetOptions(primaryAgentId)}
      selectedTargetId={agentsStore.composerTargetId}
      workspaceModeOptions={primaryAgentId && agentsStore.composerTargetId === 'local' && agentsStore.canCreateWorktree(primaryAgentId)
        ? WORKSPACE_MODE_OPTIONS : []}
      selectedWorkspaceMode={agentsStore.composerWorkspaceMode}
      onWorkspaceModeChange={(mode) => agentsStore.setComposerWorkspaceMode(mode as ComposerWorkspaceMode, primaryAgentId)}
      onCwdInput={(value) => agentsStore.setComposerCwd(value)}
      onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
      onModelChange={(value) => {
        if (primaryAgentId) agentsStore.setLaunchModel(primaryAgentId, value);
      }}
      onRefreshModels={() => primaryAgentId && agentsStore.refreshModelsForAgent(primaryAgentId)}
      onAddAttachments={(attachments) => agentsStore.addPromptAttachments(attachments)}
      onRemoveAttachment={(attachmentId) => agentsStore.removePromptAttachment(attachmentId)}
      onProfileChange={(profileId) => agentsStore.setComposerProfile(profileId)}
      onLaunchModeChange={(modeId) => agentsStore.setComposerMode(modeId)}
      onLaunchReasoningChange={(reasoningId) => agentsStore.setComposerReasoning(reasoningId)}
      onTargetChange={(targetId) => agentsStore.setComposerTarget(targetId)}
      onCreateSession={() => startSessionFromLauncher()}
      onDismissError={() => {
        agentsStore.clearError();
        agentsStore.clearLaunchProfileError(primaryAgentId);
      }}
      onSendPrompt={() => startSessionFromLauncher()}
    />

    {#if stripEntries.length}
      <section class="start-needs-you" class:start-needs-you-recent={!showNeedsYou} aria-labelledby="start-needs-you-heading">
        <h2 id="start-needs-you-heading" class="start-needs-you-heading">{showNeedsYou ? 'Needs you' : 'Continue where you left off'}</h2>
        <ul class="start-needs-you-list">
          {#each stripEntries as entry (entry.key)}
            <li>
              <a class="start-needs-you-row" href={entry.href}>
                <span class="start-needs-you-dot" class:start-needs-you-dot-running={entry.running} aria-hidden="true"></span>
                <span class="start-needs-you-copy">
                  <strong>{entry.title}</strong>
                  {#if entry.detail !== entry.title}<small>{entry.detail}</small>{/if}
                </span>
                {#if entry.workspace}<span class="start-needs-you-meta">{entry.workspace}</span>{/if}
                {#if entry.updatedAt}<span class="start-needs-you-meta start-needs-you-time">{formatSessionTimestampShort(entry.updatedAt, relativeTimeNow)}</span>{/if}
                <span class="start-needs-you-action">{entry.action}</span>
              </a>
            </li>
          {/each}
        </ul>
        {#if showNeedsYou && needsYou.length > NEEDS_YOU_LIMIT}
          <a class="start-needs-you-more" href="/inbox">{needsYou.length - NEEDS_YOU_LIMIT} more in Inbox</a>
        {/if}
      </section>
    {/if}

    <Tooltip.Provider delayDuration={250} skipDelayDuration={80}>
      <nav class="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--muted)]" aria-label="Overview">
        {@render overviewLink('/sessions', 'Sessions currently running on this machine or the mesh', sessionsLabel)}
        {@render overviewLink('/agents', 'Agents connected and ready to start sessions', agentsLabel)}
        {@render overviewLink('/inbox', 'Requests waiting for your answer', inboxLabel)}
      </nav>
    </Tooltip.Provider>
  </section>
</div>
