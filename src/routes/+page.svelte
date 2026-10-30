<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { FolderOpen } from '@lucide/svelte';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import { agentsStore, LAUNCH_MODE_OPTIONS, LAUNCH_REASONING_OPTIONS } from '$lib/stores/agents.svelte';
  import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
  import { WORKSPACE_MODE_OPTIONS, type ComposerWorkspaceMode } from '$lib/domain/session-workspace';
  import { inboxStore } from '$lib/stores/inbox.svelte';

  const onlineAgents = $derived(agentsStore.connectedAgents);

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

<div class="start-launch-page flex min-h-[calc(100vh-7rem)] w-full items-center justify-center px-4">
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

    <div class="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--muted)]">
      <span class="status-item"><strong>{activeNowCount}</strong> active</span>
      <span class="status-item"><strong>{onlineAgents.length}</strong> online</span>
      <span class="status-item"><strong>{inboxStore.pendingCount}</strong> inbox</span>
    </div>
  </section>
</div>
