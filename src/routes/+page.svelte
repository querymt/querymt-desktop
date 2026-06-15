<script lang="ts">
  import { goto } from '$app/navigation';
  import SessionComposer from '$lib/components/primitives/SessionComposer.svelte';
  import { agentsStore } from '$lib/stores/agents.svelte';
  import { inboxStore } from '$lib/stores/inbox.svelte';

  const onlineAgents = $derived(
    agentsStore.configs.filter((config) => agentsStore.statuses[config.id]?.state === 'running')
  );

  const primaryAgentId = $derived(onlineAgents[0]?.id ?? agentsStore.configs[0]?.id ?? null);
  const showAgentBadges = $derived(agentsStore.configs.length > 1);

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

  async function startSessionFromToday() {
    if (!primaryAgentId) {
      return;
    }

    const sessionId = await agentsStore.startSessionWithPrompt(primaryAgentId);
    if (sessionId) {
      await goto(`/sessions/${encodeURIComponent(primaryAgentId)}/${encodeURIComponent(sessionId)}`);
    }
  }

  async function startBlankSessionFromToday() {
    if (!primaryAgentId) {
      return;
    }

    await agentsStore.createSession(primaryAgentId);
    if (agentsStore.activeAgentId && agentsStore.activeSessionId) {
      await goto(
        `/sessions/${encodeURIComponent(agentsStore.activeAgentId)}/${encodeURIComponent(agentsStore.activeSessionId)}`
      );
    }
  }
</script>

<div class="flex min-h-[calc(100vh-7rem)] w-full items-center justify-center px-4">
  <section class="mx-auto w-full max-w-4xl space-y-5">
    <div class="space-y-2 text-center">
      <h1 class="text-3xl font-semibold tracking-tight md:text-4xl">What should QueryMT do?</h1>
      <p class="mx-auto max-w-2xl text-sm text-[var(--muted)] md:text-base">
        Start with a prompt. Everything else can wait.
      </p>
    </div>

    <SessionComposer
      compact={true}
      minimal={true}
      launch={true}
      cwd={agentsStore.composerCwd}
      prompt={agentsStore.composerPrompt}
      loading={agentsStore.loading}
      error={agentsStore.error}
      activeSessionId={null}
      promptFocusToken={agentsStore.promptFocusToken}
      modelOptions={primaryAgentId ? (agentsStore.modelsByAgent[primaryAgentId] ?? []) : []}
      selectedModelId={agentsStore.composerModelId}
      modelInfo={primaryAgentId ? (agentsStore.modelInfoByAgent[primaryAgentId] ?? {}) : {}}
      recentModels={primaryAgentId ? agentsStore.getRecentModels(primaryAgentId) : []}
      modelLoading={primaryAgentId ? !!agentsStore.modelLoadingByAgent[primaryAgentId] : false}
      agentLabel={showAgentBadges && primaryAgentId ? (agentsStore.configs.find((config) => config.id === primaryAgentId)?.name ?? primaryAgentId) : null}
      recentWorkspaces={agentsStore.getRecentWorkspaces()}
      attachments={agentsStore.promptAttachments}
      profileOptions={agentsStore.getProfileOptions()}
      selectedProfileId={agentsStore.composerProfileId}
      targetOptions={agentsStore.getTargetOptions(primaryAgentId)}
      selectedTargetId={agentsStore.composerTargetId}
      sessionConfigOptions={agentsStore.activeSession.configOptions}
      sessionConfigPending={agentsStore.sessionConfigPending}
      onCwdInput={(value) => agentsStore.setComposerCwd(value)}
      onPromptInput={(value) => agentsStore.setComposerPrompt(value)}
      onModelChange={(value) => agentsStore.setComposerModel(value)}
      onRefreshModels={() => primaryAgentId && agentsStore.refreshModelsForAgent(primaryAgentId)}
      onAddAttachments={(attachments) => agentsStore.addPromptAttachments(attachments)}
      onRemoveAttachment={(attachmentId) => agentsStore.removePromptAttachment(attachmentId)}
      onProfileChange={(profileId) => agentsStore.setComposerProfile(profileId)}
      onTargetChange={(targetId) => agentsStore.setComposerTarget(targetId)}
      onSessionConfigChange={(configId, value) => agentsStore.setActiveSessionConfigOption(configId, value)}
      onCreateSession={() => startBlankSessionFromToday()}
      onDismissError={() => agentsStore.clearError()}
      onSendPrompt={() => startSessionFromToday()}
    />

    <div class="flex flex-wrap items-center justify-center gap-3 text-sm text-[var(--muted)]">
      <span class="status-item"><strong>{activeNowCount}</strong> active</span>
      <span class="status-item"><strong>{onlineAgents.length}</strong> online</span>
      <span class="status-item"><strong>{inboxStore.pendingCount}</strong> inbox</span>
    </div>
  </section>
</div>
