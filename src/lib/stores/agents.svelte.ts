import type {
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  SessionInfo,
  SessionNotification
} from '@agentclientprotocol/sdk';
import { tick } from 'svelte';
import { activeSessionFromLoadResponse, normalizeHistoricalSession } from '$lib/domain/session-snapshot';
import { createEmptyActiveSession, applySessionNotification } from '$lib/domain/session-updates';
import { getSessionById, mapAcpSessionsToDesktopSessions } from '$lib/domain/sessions';
import type {
  ActiveSessionViewModel,
  AgentConfig,
  AgentConnectionState,
  AgentControlHealth,
  AgentRuntimeStatus,
  ComposerOption,
  DesktopSessionSummary,
  ModelEntry,
  ModelInfo,
  PromptAttachment
} from '$lib/domain/types';
import type {
  AuthMethod,
  AuthProviderEntry,
  CapabilitiesInfo,
  CreateMeshInviteRequest,
  CreateScheduleControlRequest,
  MeshInviteCreatedInfo,
  MeshInviteListInfo,
  MeshInviteRevokedInfo,
  MeshNodesInfo,
  MeshStatusInfo,
  PluginUpdateResult,
  RemoteSessionAttachInfo,
  RemoteSessionDismissInfo,
  RemoteSessionListInfo,
  ScheduleActionResult,
  ScheduleInfo,
  ScheduleListInfo
} from '$lib/querymt/generated/types';
import { getCurrentModelId, setModelConfigOptionRequest } from '$lib/querymt/config-options';
import { DesktopAcpClient } from '$lib/querymt/acp-client';
import { getAgentLogs, getAgentStatus, restartAgent, startAgent, stopAgent, validateWorkspaceDirectory } from '$lib/querymt/sidecar';
import { inboxStore } from '$lib/stores/inbox.svelte';

const AGENTS_STORAGE_KEY = 'querymt-desktop.agents';
const RECENT_MODELS_STORAGE_KEY = 'querymt-desktop.recent-models';
const RECENT_WORKSPACES_STORAGE_KEY = 'querymt-desktop.recent-workspaces';
const RECENT_MODELS_LIMIT = 5;
const RECENT_WORKSPACES_LIMIT = 8;

interface AgentClientRecord {
  client: DesktopAcpClient;
  connectionState: AgentConnectionState;
  initializeResponse: InitializeResponse | null;
  error: string | null;
  unsubscribeSessionUpdates: (() => void) | null;
  unsubscribeExtensionNotifications: (() => void) | null;
  recentSessionUpdateKeys: string[];
}

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'qmtcode-default',
    name: 'QMTCODE',
    commandLine: 'qmtcode --acp',
    enabled: true,
    autoStart: true
  }
];

export class AgentsStore {
  private clients = new Map<string, AgentClientRecord>();

  configs = $state<AgentConfig[]>(loadInitialAgents());
  statuses = $state<Record<string, AgentRuntimeStatus>>({});
  connectionStates = $state<Record<string, AgentConnectionState>>({});
  agentErrors = $state<Record<string, string | null>>({});
  controlCapabilitiesByAgent = $state<Record<string, CapabilitiesInfo | null>>({});
  controlHealthByAgent = $state<Record<string, AgentControlHealth>>({});
  schedulesByAgent = $state<Record<string, ScheduleListInfo | null>>({});
  meshStatusByAgent = $state<Record<string, MeshStatusInfo | null>>({});
  meshNodesByAgent = $state<Record<string, MeshNodesInfo | null>>({});
  meshInvitesByAgent = $state<Record<string, MeshInviteListInfo | null>>({});
  authProvidersByAgent = $state<Record<string, AuthProviderEntry[]>>({});
  authLoadingByAgent = $state<Record<string, boolean>>({});
  authErrorsByAgent = $state<Record<string, string | null>>({});
  remoteSessionsByAgent = $state<Record<string, Record<string, RemoteSessionListInfo | undefined>>>({});
  lastScheduleActionByAgent = $state<Record<string, ScheduleActionResult | null>>({});
  lastCreatedScheduleByAgent = $state<Record<string, ScheduleInfo | null>>({});
  lastMeshInviteByAgent = $state<Record<string, MeshInviteCreatedInfo | null>>({});
  lastMeshRevokeByAgent = $state<Record<string, MeshInviteRevokedInfo | null>>({});
  pluginUpdateStatusByAgent = $state<
    Record<
      string,
      | {
          plugin_name: string;
          image_reference: string;
          phase: string;
          bytes_downloaded: number;
          bytes_total?: number;
          percent?: number;
          message?: string;
        }
      | null
    >
  >({});
  lastPluginUpdateByAgent = $state<Record<string, PluginUpdateResult[] | null>>({});
  lastRemoteAttachByAgent = $state<Record<string, RemoteSessionAttachInfo | null>>({});
  lastRemoteDismissByAgent = $state<Record<string, RemoteSessionDismissInfo | null>>({});
  sessionsByAgent = $state<Record<string, DesktopSessionSummary[]>>({});
  logsByAgent = $state<Record<string, Awaited<ReturnType<typeof getAgentLogs>>>>({});
  activeAgentId = $state<string | null>(null);
  activeSessionId = $state<string | null>(null);
  activeSession = $state<ActiveSessionViewModel>(createEmptyActiveSession());
  lastCreatedSession = $state<NewSessionResponse | null>(null);
  lastLoadedSession = $state<LoadSessionResponse | null>(null);
  lastPromptResponse = $state<PromptResponse | null>(null);
  composerCwd = $state('');
  composerPrompt = $state('');
  composerModelId = $state<string>('');
  composerProfileId = $state<string>('default');
  composerTargetId = $state<string>('local');
  promptAttachments = $state<PromptAttachment[]>([]);
  promptFocusToken = $state(0);
  loading = $state(false);
  error = $state<string | null>(null);
  modelsByAgent = $state<Record<string, ModelEntry[]>>({});
  modelInfoByAgent = $state<Record<string, Record<string, ModelInfo | null>>>({});
  modelLoadingByAgent = $state<Record<string, boolean>>({});
  recentModelsByAgent = $state<Record<string, string[]>>(loadRecentModels());
  recentWorkspaces = $state<string[]>(loadRecentWorkspaces());

  get sessions(): DesktopSessionSummary[] {
    return Object.values(this.sessionsByAgent).flat().sort((a, b) => {
      const aValue = a.updatedAt ?? '';
      const bValue = b.updatedAt ?? '';
      return bValue.localeCompare(aValue);
    });
  }

  get connectedAgents(): AgentConfig[] {
    return this.configs.filter((config) => this.statuses[config.id]?.state === 'running');
  }

  async initialize() {
    this.loading = true;
    this.error = null;

    try {
      await Promise.all(this.configs.map((config) => this.refreshAgent(config)));
      await Promise.all(
        this.configs
          .filter((config) => config.enabled && config.autoStart)
          .map((config) => this.startConfiguredAgent(config.id))
      );
      await this.refreshAllSessions();
      await this.preloadModelsForRunningAgents();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to initialize configured agents.';
    } finally {
      this.loading = false;
    }
  }

  setComposerCwd(value: string) {
    this.composerCwd = value;
  }

  getRecentWorkspaces(): string[] {
    return this.recentWorkspaces;
  }

  setComposerPrompt(value: string) {
    this.composerPrompt = value;
  }

  setComposerProfile(profileId: string) {
    this.composerProfileId = profileId;
  }

  setComposerTarget(targetId: string) {
    this.composerTargetId = targetId;
  }

  addPromptAttachments(attachments: PromptAttachment[]) {
    const existingIds = new Set(this.promptAttachments.map((attachment) => attachment.id));
    this.promptAttachments = [...this.promptAttachments, ...attachments.filter((attachment) => !existingIds.has(attachment.id))];
  }

  removePromptAttachment(attachmentId: string) {
    this.promptAttachments = this.promptAttachments.filter((attachment) => attachment.id !== attachmentId);
  }

  clearPromptAttachments() {
    this.promptAttachments = [];
  }

  getProfileOptions(): ComposerOption[] {
    return [{ id: 'default', label: 'Default profile', description: 'Use the agent default.' }];
  }

  getTargetOptions(agentId: string | null): ComposerOption[] {
    const targets: ComposerOption[] = [{ id: 'local', label: 'Local', description: 'Create the session on this machine.' }];
    if (!agentId) {
      return targets;
    }

    for (const node of this.meshNodesByAgent[agentId]?.nodes ?? []) {
      targets.push({
        id: node.id,
        label: node.label || node.id,
        description: `${node.transport}${node.active_sessions ? ` · ${node.active_sessions} active` : ''}`
      });
    }

    return targets;
  }

  async setComposerModel(modelId: string) {
    this.composerModelId = modelId;

    if (this.activeAgentId && this.activeSessionId) {
      await this.applySelectedModelToSession(this.activeAgentId, this.activeSessionId, modelId);
    }
  }

  requestPromptFocus() {
    this.promptFocusToken += 1;
  }

  saveConfig(input: AgentConfig) {
    const existingIndex = this.configs.findIndex((config) => config.id === input.id);
    if (existingIndex === -1) {
      this.configs = [input, ...this.configs];
    } else {
      this.configs = this.configs.map((config) => (config.id === input.id ? input : config));
    }

    persistAgents(this.configs);
  }

  updateConfig(agentId: string, updates: Partial<Omit<AgentConfig, 'id'>>) {
    this.configs = this.configs.map((config) =>
      config.id === agentId
        ? {
            ...config,
            ...updates
          }
        : config
    );
    persistAgents(this.configs);
  }

  async deleteConfig(agentId: string) {
    await this.stopConfiguredAgent(agentId);
    this.configs = this.configs.filter((config) => config.id !== agentId);
    delete this.statuses[agentId];
    delete this.connectionStates[agentId];
    delete this.agentErrors[agentId];
    delete this.controlCapabilitiesByAgent[agentId];
    delete this.controlHealthByAgent[agentId];
    delete this.schedulesByAgent[agentId];
    delete this.meshStatusByAgent[agentId];
    delete this.meshNodesByAgent[agentId];
    delete this.meshInvitesByAgent[agentId];
    delete this.authProvidersByAgent[agentId];
    delete this.authLoadingByAgent[agentId];
    delete this.authErrorsByAgent[agentId];
    delete this.remoteSessionsByAgent[agentId];
    delete this.lastScheduleActionByAgent[agentId];
    delete this.lastCreatedScheduleByAgent[agentId];
    delete this.lastMeshInviteByAgent[agentId];
    delete this.lastMeshRevokeByAgent[agentId];
    delete this.pluginUpdateStatusByAgent[agentId];
    delete this.lastPluginUpdateByAgent[agentId];
    delete this.lastRemoteAttachByAgent[agentId];
    delete this.lastRemoteDismissByAgent[agentId];
    delete this.sessionsByAgent[agentId];
    delete this.logsByAgent[agentId];
    this.clients.delete(agentId);
    persistAgents(this.configs);
  }

  createConfig(name: string, commandLine: string): AgentConfig {
    return {
      id: slugify(`${name}-${Date.now()}`),
      name,
      commandLine,
      enabled: true,
      autoStart: true
    };
  }

  async refreshAgent(config: AgentConfig) {
    const [status, logs] = await Promise.all([getAgentStatus(config), getAgentLogs(config.id)]);
    this.statuses = {
      ...this.statuses,
      [config.id]: status
    };
      this.logsByAgent = {
        ...this.logsByAgent,
        [config.id]: await getAgentLogs(config.id)
      };
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: 'initialized'
      };

      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: this.connectionStates[config.id] ?? 'idle'
      };
      this.agentErrors = {
        ...this.agentErrors,
        [config.id]: this.agentErrors[config.id] ?? null
      };

  }

  async startConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    this.error = null;

    try {
      const status = await startAgent(config);
      this.statuses = {
        ...this.statuses,
        [config.id]: status
      };
      await this.connectAgent(config.id);
      await Promise.allSettled([
        this.refreshSessionsForAgent(config.id),
        this.refreshMeshForAgent(config.id),
        this.refreshAuthProviders(config.id)
      ]);
      this.logsByAgent = {
        ...this.logsByAgent,
        [config.id]: await getAgentLogs(config.id)
      };
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to start ${config.name}.`;
    }
  }

  async stopConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    try {
      const status = await stopAgent(agentId);
      this.statuses = {
        ...this.statuses,
        [config.id]: status
      };
      this.sessionsByAgent = {
        ...this.sessionsByAgent,
        [config.id]: []
      };
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: 'idle'
      };
      if (this.activeAgentId === config.id) {
        this.activeAgentId = null;
        this.activeSessionId = null;
        this.activeSession = createEmptyActiveSession();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to stop ${config.name}.`;
    }
  }

  async restartConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    try {
      const status = await restartAgent(config);
      this.statuses = {
        ...this.statuses,
        [config.id]: status
      };
      await this.connectAgent(config.id, true);
      await Promise.allSettled([
        this.refreshSessionsForAgent(config.id),
        this.refreshMeshForAgent(config.id),
        this.refreshAuthProviders(config.id)
      ]);
      this.logsByAgent = {
        ...this.logsByAgent,
        [config.id]: await getAgentLogs(config.id)
      };
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to restart ${config.name}.`;
    }
  }

  async connectAgent(agentId: string, force = false) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    const record = this.ensureClientRecord(agentId, force);
    record.connectionState = 'connecting';
    record.error = null;

    try {
      inboxStore.bindClient(record.client, config.id, config.name);
      record.initializeResponse = await record.client.connect();
      record.connectionState = 'initialized';
      this.controlCapabilitiesByAgent = {
        ...this.controlCapabilitiesByAgent,
        [config.id]: record.client.getControlCapabilities()
      };
      this.controlHealthByAgent = {
        ...this.controlHealthByAgent,
        [config.id]: record.client.getControlHealth()
      };
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: record.connectionState
      };
      this.agentErrors = {
        ...this.agentErrors,
        [config.id]: null
      };
      void this.loadInitialModelsForAgent(config.id, 6);
    } catch (error) {
      record.error = error instanceof Error ? error.message : `Failed to initialize ${config.name}.`;
      record.connectionState = 'failed';
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: record.connectionState
      };
      this.controlCapabilitiesByAgent = {
        ...this.controlCapabilitiesByAgent,
        [config.id]: null
      };
      this.controlHealthByAgent = {
        ...this.controlHealthByAgent,
        [config.id]: record.client.getControlHealth()
      };
      this.agentErrors = {
        ...this.agentErrors,
        [config.id]: record.error
      };
      this.error = record.error;
    }
  }

  async refreshAllSessions() {
    await Promise.all(
      this.configs
        .filter((config) => this.statuses[config.id]?.state === 'running')
        .map((config) => this.refreshSessionsForAgent(config.id))
    );
  }

  async preloadModelsForRunningAgents() {
    await Promise.all(
      this.configs
        .filter((config) => this.statuses[config.id]?.state === 'running')
        .map((config) => this.loadInitialModelsForAgent(config.id, 6).catch(() => undefined))
    );
  }

  async loadInitialModelsForAgent(agentId: string, attempts = 1) {
    const record = this.ensureClientRecord(agentId);
    if (record.connectionState !== 'initialized') {
      await this.connectAgent(agentId);
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const loaded = await this.loadModelsForAgent(agentId, () => record.client.listModels(), 'Failed to load models.', {
        keepExistingOnEmpty: true,
        suppressEmptyError: attempt < attempts - 1
      });
      if (loaded > 0 || attempt === attempts - 1) {
        return;
      }
      await delay(250 * (attempt + 1));
    }
  }

  async refreshSessionsForAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    const record = this.ensureClientRecord(agentId);
    if (record.connectionState === 'idle' || record.connectionState === 'failed') {
      await this.connectAgent(agentId);
    }

    record.connectionState = 'loading-sessions';
    record.error = null;

    try {
      const [sessions, models] = await Promise.all([
        record.client.listSessions(),
        record.client.listModels().catch(() => this.modelsByAgent[agentId] ?? [])
      ]);
      this.sessionsByAgent = {
        ...this.sessionsByAgent,
        [agentId]: mapAcpSessionsToDesktopSessions(sessions, {
          agentId: config.id,
          agentName: config.name
        })
      };
      if (models.length > 0) {
        this.modelsByAgent = {
          ...this.modelsByAgent,
          [agentId]: models
        };
        this.selectComposerModelForAgent(agentId, models);
      }
      record.connectionState = 'initialized';
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: record.connectionState
      };
      this.agentErrors = {
        ...this.agentErrors,
        [config.id]: null
      };
    } catch (error) {
      record.error = error instanceof Error ? error.message : `Failed to load sessions for ${config.name}.`;
      record.connectionState = 'failed';
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: record.connectionState
      };
      this.agentErrors = {
        ...this.agentErrors,
        [config.id]: record.error
      };
      this.error = record.error;
    }
  }

  async createBackgroundSession(agentId: string, cwd: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const normalizedCwd = cwd.trim();
    if (!config || !normalizedCwd) {
      throw new Error('Working directory is required to create a session.');
    }

    const isDirectory = await validateWorkspaceDirectory(normalizedCwd).catch(() => false);
    if (!isDirectory) {
      throw new Error('Workspace must point to an existing directory.');
    }

    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);

    const response = await record.client.createSession(normalizedCwd);
    this.lastCreatedSession = response;
    this.rememberRecentWorkspace(normalizedCwd);
    await this.refreshSessionsForAgent(agentId);
    return response;
  }

  async createSession(agentId: string): Promise<string | null> {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const cwd = this.composerCwd.trim();
    if (!config || !cwd) {
      this.error = 'Working directory is required to create a session.';
      return null;
    }

    try {
      if (this.composerTargetId !== 'local') {
        return await this.createAttachedRemoteSession(agentId, this.composerTargetId, cwd);
      }

      const response = await this.createBackgroundSession(agentId, cwd);
      const sessionId = response.sessionId;
      this.resetActiveSession(agentId, sessionId);
      this.activeSession.configOptions = response.configOptions ?? [];
      await this.applySelectedModelToSession(agentId, sessionId, this.composerModelId || getDefaultModelId(this.modelsByAgent[agentId] ?? []));
      this.composerModelId = getCurrentModelId(this.activeSession.configOptions) ?? this.composerModelId;
      await this.drainQueuedSessionUpdates(agentId, sessionId);
      await this.hydrateModelInfo(agentId, this.modelsByAgent[agentId] ?? []);
      return sessionId;
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to create session for ${config.name}.`;
      return null;
    }
  }

  async startSessionWithPrompt(agentId: string): Promise<string | null> {
    const sessionId = await this.createSession(agentId);
    if (sessionId) {
      void this.sendPromptToActiveSession();
    }
    return sessionId;
  }

  async sendPromptToActiveSession() {
    const prompt = this.composerPrompt.trim();
    if (!prompt) {
      this.error = 'Prompt text is required to send a session prompt.';
      return;
    }

    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return;
    }

    const record = this.ensureClientRecord(this.activeAgentId);

    try {
      const attachments = this.promptAttachments;
      const sessionId = this.activeSessionId;
      this.addOptimisticUserPrompt(sessionId, prompt);
      this.activeSession.runState = 'thinking';
      this.activeSession.activityLabel = 'Waiting for the agent to respond…';
      this.activeSession.lastError = null;
      this.composerPrompt = '';
      this.clearPromptAttachments();
      await this.connectAgent(this.activeAgentId);
      this.lastPromptResponse = await record.client.sendPrompt(sessionId, prompt, attachments);
      this.activeSession.lastStopReason = this.lastPromptResponse.stopReason ?? null;
      await this.drainQueuedSessionUpdates(this.activeAgentId, sessionId);
      if (this.activeSession.runState === 'thinking') {
        this.activeSession.runState = 'completed';
        this.activeSession.activityLabel = 'Turn completed.';
      }
      await this.refreshSessionsForAgent(this.activeAgentId);
    } catch (error) {
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = error instanceof Error ? error.message : 'Failed to send ACP prompt.';
      this.activeSession.activityLabel = this.activeSession.lastError;
      this.error = this.activeSession.lastError;
    }
  }

  async loadSession(agentId: string, sessionId: string) {
    const summary = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    if (!summary) {
      await this.refreshSessionsForAgent(agentId);
    }

    const target = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    if (!target) {
      this.error = `Unable to locate session ${sessionId}.`;
      return;
    }

    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);

    try {
      this.resetActiveSession(agentId, sessionId);
      await tick();
      this.lastLoadedSession = await record.client.loadSession(target.sessionId, target.cwd);
      this.activeSession.configOptions = this.lastLoadedSession.configOptions ?? [];
      this.composerModelId = getCurrentModelId(this.activeSession.configOptions) ?? this.composerModelId;
      await this.drainQueuedSessionUpdates(agentId, sessionId);
      this.activeSession = normalizeHistoricalSession(this.activeSession, { loadCompleted: true });
      await this.hydrateModelInfo(agentId, this.modelsByAgent[agentId] ?? []);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to load ACP session.';
    }
  }

  private ensureClientRecord(agentId: string, force = false): AgentClientRecord {
    const existing = this.clients.get(agentId);
    if (existing && !force) {
      return existing;
    }

    const record: AgentClientRecord = {
      client: new DesktopAcpClient(agentId),
      connectionState: 'idle',
      initializeResponse: null,
      error: null,
      unsubscribeSessionUpdates: null,
      unsubscribeExtensionNotifications: null,
      recentSessionUpdateKeys: []
    };

    this.clients.set(agentId, record);
    this.ensureSessionUpdateSubscription(agentId, record);
    this.ensureExtensionNotificationSubscription(agentId, record);
    return record;
  }

  private ensureSessionUpdateSubscription(agentId: string, record: AgentClientRecord) {
    if (!record.unsubscribeSessionUpdates) {
      record.unsubscribeSessionUpdates = record.client.onSessionUpdate((notification) => {
        this.handleSessionNotification(agentId, notification, record);
      });
    }
  }

  private ensureExtensionNotificationSubscription(agentId: string, record: AgentClientRecord) {
    if (!record.unsubscribeExtensionNotifications) {
      record.unsubscribeExtensionNotifications = record.client.onExtensionNotification((notification) => {
        if (notification.method === 'querymt/models/changed') {
          void this.loadInitialModelsForAgent(agentId, 1);
        }
        if (notification.method === 'querymt/schedules/changed') {
          const params = notification.params as { node_id?: string };
          void this.refreshSchedulesForAgent(agentId, params.node_id);
        }
        if (
          notification.method === 'querymt/mesh/nodesChanged' ||
          notification.method === 'querymt/mesh/joined' ||
          notification.method === 'querymt/mesh/peerExpired'
        ) {
          void this.refreshMeshForAgent(agentId);
        }
        if (notification.method.startsWith('querymt/auth/')) {
          void this.refreshAuthProviders(agentId);
        }
        if (notification.method === 'querymt/pluginUpdateStatus') {
          this.pluginUpdateStatusByAgent = {
            ...this.pluginUpdateStatusByAgent,
            [agentId]: notification.params as NonNullable<typeof this.pluginUpdateStatusByAgent[string]>
          };
        }
        if (notification.method === 'querymt/pluginUpdateComplete') {
          const params = notification.params as { results?: PluginUpdateResult[] };
          this.pluginUpdateStatusByAgent = {
            ...this.pluginUpdateStatusByAgent,
            [agentId]: null
          };
          this.lastPluginUpdateByAgent = {
            ...this.lastPluginUpdateByAgent,
            [agentId]: params.results ?? []
          };
        }
      });
    }
  }

  async refreshCapabilities(agentId: string) {
    await this.connectAgent(agentId, true);
  }

  async refreshAuthProviders(agentId: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);

    if (!record.client.supportsQuerymtFeature('auth')) {
      this.authProvidersByAgent = {
        ...this.authProvidersByAgent,
        [agentId]: []
      };
      this.authErrorsByAgent = {
        ...this.authErrorsByAgent,
        [agentId]: null
      };
      this.authLoadingByAgent = {
        ...this.authLoadingByAgent,
        [agentId]: false
      };
      return [];
    }

    this.authLoadingByAgent = {
      ...this.authLoadingByAgent,
      [agentId]: true
    };

    try {
      const providers = await record.client.listAuthProviders();
      this.authProvidersByAgent = {
        ...this.authProvidersByAgent,
        [agentId]: providers
      };
      this.authErrorsByAgent = {
        ...this.authErrorsByAgent,
        [agentId]: null
      };
      return providers;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load provider auth status.';
      this.authErrorsByAgent = {
        ...this.authErrorsByAgent,
        [agentId]: message
      };
      throw error;
    } finally {
      this.authLoadingByAgent = {
        ...this.authLoadingByAgent,
        [agentId]: false
      };
    }
  }

  async startProviderSignIn(agentId: string, provider: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    return record.client.startProviderOAuth(provider);
  }

  async completeProviderSignIn(agentId: string, flow_id: string, response: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.completeProviderOAuth(flow_id, response);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async disconnectProvider(agentId: string, provider: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.disconnectProviderOAuth(provider);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async setProviderApiToken(agentId: string, provider: string, api_key: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.setProviderApiToken(provider, api_key);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async clearProviderApiToken(agentId: string, provider: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.clearProviderApiToken(provider);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async setProviderAuthMethod(agentId: string, provider: string, method: AuthMethod) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.setProviderAuthMethod(provider, method);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async pollProviderSignIn(agentId: string, provider: string, attempts = 60, delayMs = 2000): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const providers = await this.refreshAuthProviders(agentId);
      const match = providers.find((entry) => entry.provider === provider);
      if (match?.oauth_status === 'connected') {
        await this.refreshModelsForAgent(agentId).catch(() => undefined);
        return true;
      }
      await delay(delayMs);
    }
    return false;
  }

  async updatePluginsForAgent(agentId: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    this.pluginUpdateStatusByAgent = {
      ...this.pluginUpdateStatusByAgent,
      [agentId]: {
        plugin_name: 'Preparing update',
        image_reference: '',
        phase: 'starting',
        bytes_downloaded: 0,
        message: 'Starting plugin update...'
      }
    };
    const results = await record.client.updatePlugins();
    this.pluginUpdateStatusByAgent = {
      ...this.pluginUpdateStatusByAgent,
      [agentId]: null
    };
    this.lastPluginUpdateByAgent = {
      ...this.lastPluginUpdateByAgent,
      [agentId]: results
    };
    await Promise.allSettled([this.refreshModelsForAgent(agentId), this.refreshAuthProviders(agentId)]);
    return results;
  }

  async refreshSchedulesForAgent(agentId: string, node_id?: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const schedules = await record.client.listSchedules(node_id ? { node_id } : {});
    this.schedulesByAgent = {
      ...this.schedulesByAgent,
      [agentId]: schedules
    };
    return schedules;
  }

  async createSchedule(agentId: string, request: CreateScheduleControlRequest) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const schedule = await record.client.createSchedule(request);
    this.lastCreatedScheduleByAgent = {
      ...this.lastCreatedScheduleByAgent,
      [agentId]: schedule
    };
    await this.refreshSchedulesForAgent(agentId, request.node_id);
    return schedule;
  }

  async runScheduleAction(
    agentId: string,
    action: 'pause' | 'resume' | 'trigger' | 'delete',
    schedule_public_id: string,
    node_id?: string
  ) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const request = node_id ? { node_id, schedule_public_id } : { schedule_public_id };
    const result =
      action === 'pause'
        ? await record.client.pauseSchedule(request)
        : action === 'resume'
          ? await record.client.resumeSchedule(request)
          : action === 'trigger'
            ? await record.client.triggerSchedule(request)
            : await record.client.deleteSchedule(request);
    this.lastScheduleActionByAgent = {
      ...this.lastScheduleActionByAgent,
      [agentId]: result
    };
    await this.refreshSchedulesForAgent(agentId, node_id);
    return result;
  }

  async refreshMeshForAgent(agentId: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const [meshStatus, meshNodes, meshInvites] = await Promise.all([
      record.client.listMeshStatus(),
      record.client.listMeshNodes(),
      record.client.listMeshInvites().catch(() => null)
    ]);
    this.meshStatusByAgent = {
      ...this.meshStatusByAgent,
      [agentId]: meshStatus
    };
    this.meshNodesByAgent = {
      ...this.meshNodesByAgent,
      [agentId]: meshNodes
    };
    this.meshInvitesByAgent = {
      ...this.meshInvitesByAgent,
      [agentId]: meshInvites
    };
    return { meshStatus, meshNodes, meshInvites };
  }

  async createMeshInvite(agentId: string, request: CreateMeshInviteRequest = {}) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.createMeshInvite(request);
    this.lastMeshInviteByAgent = {
      ...this.lastMeshInviteByAgent,
      [agentId]: result
    };
    await this.refreshMeshForAgent(agentId);
    return result;
  }

  async revokeMeshInvite(agentId: string, invite_id: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.revokeMeshInvite({ invite_id });
    this.lastMeshRevokeByAgent = {
      ...this.lastMeshRevokeByAgent,
      [agentId]: result
    };
    await this.refreshMeshForAgent(agentId);
    return result;
  }

  async refreshRemoteSessionsForAgent(agentId: string, node_id: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.listRemoteSessions({ node_id });
    this.remoteSessionsByAgent = {
      ...this.remoteSessionsByAgent,
      [agentId]: {
        ...(this.remoteSessionsByAgent[agentId] ?? {}),
        [node_id]: result
      }
    };
    return result;
  }

  async createRemoteSession(agentId: string, node_id: string, cwd?: string) {
    const result = await this.createRemoteSessionAttach(agentId, node_id, cwd);
    await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return result;
  }

  private async createAttachedRemoteSession(agentId: string, node_id: string, cwd: string): Promise<string> {
    const result = await this.createRemoteSessionAttach(agentId, node_id, cwd);
    const sessionId = result.session_id;
    this.resetActiveSession(agentId, sessionId);
    this.activeSession.configOptions = result.config_options ?? [];
    const snapshot = activeSessionFromLoadResponse(sessionId, { _meta: { 'querymt/sessionLoadSnapshot.v1': result.snapshot } });
    snapshot.configOptions = this.activeSession.configOptions;
    this.activeSession = normalizeHistoricalSession(snapshot);
    await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return sessionId;
  }

  private async createRemoteSessionAttach(agentId: string, node_id: string, cwd?: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.createRemoteSession({ node_id, cwd, attach: true });
    this.lastRemoteAttachByAgent = {
      ...this.lastRemoteAttachByAgent,
      [agentId]: result
    };
    return result;
  }

  async attachRemoteSession(agentId: string, node_id: string, session_id: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.attachRemoteSession({ node_id, session_id });
    this.lastRemoteAttachByAgent = {
      ...this.lastRemoteAttachByAgent,
      [agentId]: result
    };
    await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return result;
  }

  async dismissRemoteSession(agentId: string, node_id: string, session_id: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const result = await record.client.dismissRemoteSession(session_id);
    this.lastRemoteDismissByAgent = {
      ...this.lastRemoteDismissByAgent,
      [agentId]: result
    };
    await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return result;
  }

  private async drainQueuedSessionUpdates(agentId: string, sessionId: string) {
    const { drainAgentSessionUpdates } = await import('$lib/querymt/sidecar');
    try {
      const queued = await drainAgentSessionUpdates(agentId, sessionId);
      for (const notification of queued as SessionNotification[]) {
        const record = this.ensureClientRecord(agentId);
        this.handleSessionNotification(agentId, notification, record);
      }
    } catch {
      // Ignore drain failures and continue with live session streaming.
    }
  }

  async refreshModelsForAgent(agentId: string) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    await this.loadModelsForAgent(agentId, () => record.client.refreshAndListModels(), 'Failed to refresh models.');
  }

  private async loadModelsForAgent(
    agentId: string,
    load: () => Promise<ModelEntry[]>,
    errorMessage: string,
    options: { keepExistingOnEmpty?: boolean; suppressEmptyError?: boolean } = {}
  ): Promise<number> {
    this.modelLoadingByAgent = {
      ...this.modelLoadingByAgent,
      [agentId]: true
    };

    try {
      const models = await load();
      if (models.length === 0 && options.keepExistingOnEmpty) {
        if (!options.suppressEmptyError) {
          this.error = errorMessage;
        }
        return 0;
      }

      this.modelsByAgent = {
        ...this.modelsByAgent,
        [agentId]: models
      };
      await this.hydrateModelInfo(agentId, models);
      this.selectComposerModelForAgent(agentId, models);
      return models.length;
    } catch (error) {
      this.error = error instanceof Error ? error.message : errorMessage;
      return 0;
    } finally {
      this.modelLoadingByAgent = {
        ...this.modelLoadingByAgent,
        [agentId]: false
      };
    }
  }

  getRecentModels(agentId: string): ModelEntry[] {
    const allModels = this.modelsByAgent[agentId] ?? [];
    const recentIds = this.recentModelsByAgent[agentId] ?? [];
    return recentIds
      .map((modelId) => allModels.find((entry) => entry.id === modelId) ?? null)
      .filter((entry): entry is ModelEntry => entry !== null);
  }

  private selectComposerModelForAgent(agentId: string, models: ModelEntry[]) {
    if (models.length === 0) {
      return;
    }

    const currentStillAvailable = models.some((entry) => entry.id === this.composerModelId);
    if (currentStillAvailable) {
      return;
    }

    const recentModelId = (this.recentModelsByAgent[agentId] ?? []).find((modelId) =>
      models.some((entry) => entry.id === modelId)
    );
    this.composerModelId = recentModelId ?? getDefaultModelId(models);
  }

  private rememberRecentModel(agentId: string, modelId: string) {
    const current = this.recentModelsByAgent[agentId] ?? [];
    const next = [modelId, ...current.filter((entry) => entry !== modelId)].slice(0, RECENT_MODELS_LIMIT);
    this.recentModelsByAgent = {
      ...this.recentModelsByAgent,
      [agentId]: next
    };
    persistRecentModels(this.recentModelsByAgent);
  }

  private rememberRecentWorkspace(path: string) {
    const normalized = path.trim();
    if (!normalized) {
      return;
    }

    this.recentWorkspaces = [normalized, ...this.recentWorkspaces.filter((entry) => entry !== normalized)].slice(
      0,
      RECENT_WORKSPACES_LIMIT
    );
    persistRecentWorkspaces(this.recentWorkspaces);
  }

  async applySelectedModelToSession(agentId: string, sessionId: string, modelId: string | null | undefined) {
    if (!modelId) {
      return;
    }

    const model = (this.modelsByAgent[agentId] ?? []).find((entry) => entry.id === modelId);
    if (!model) {
      return;
    }

    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    const configOptions = await record.client.setSessionConfigOption(setModelConfigOptionRequest(sessionId, model));
    this.activeSession.configOptions = configOptions;
    this.composerModelId = getCurrentModelId(configOptions) ?? model.id;
    this.rememberRecentModel(agentId, model.id);
  }

  private async hydrateModelInfo(agentId: string, models: ModelEntry[]) {
    if (models.length === 0) {
      return;
    }

    const pending = models.filter((entry) => !this.modelInfoByAgent[agentId]?.[entry.id]);
    if (pending.length === 0) {
      return;
    }

    const record = this.ensureClientRecord(agentId);
    const infoByKey = await record.client.getModelInfo(
      pending.map((entry) => ({ provider: entry.provider, model: entry.model }))
    );

    const mapped = pending.reduce<Record<string, ModelInfo | null>>((acc, entry) => {
      acc[entry.id] = infoByKey[`${entry.provider}/${entry.model}`] ?? null;
      return acc;
    }, {});

    this.modelInfoByAgent = {
      ...this.modelInfoByAgent,
      [agentId]: {
        ...(this.modelInfoByAgent[agentId] ?? {}),
        ...mapped
      }
    };
  }

  private resetActiveSession(agentId: string, sessionId: string) {
    this.activeAgentId = agentId;
    this.activeSessionId = sessionId;
    this.activeSession = createEmptyActiveSession();
    this.activeSession.sessionId = sessionId;

    const record = this.ensureClientRecord(agentId);
    record.recentSessionUpdateKeys = [];
  }

  private addOptimisticUserPrompt(sessionId: string, prompt: string) {
    const eventIndex = this.activeSession.events.length;
    const id = `${sessionId}-optimistic-user-${eventIndex + 1}`;
    this.activeSession.transcript.push({
      id,
      kind: 'user_message_chunk',
      text: prompt,
      messageId: id,
      eventIndex
    });
    this.activeSession.events.push({
      id: `${id}-event`,
      kind: 'user_message_chunk',
      text: prompt,
      messageId: id
    });
  }

  private removeMatchingOptimisticUserPrompt(notification: SessionNotification) {
    const update = notification.update;
    if (update.sessionUpdate !== 'user_message_chunk' || update.content.type !== 'text') {
      return;
    }

    const optimistic = this.activeSession.transcript.find(
      (item) => item.kind === 'user_message_chunk' && item.id.includes('-optimistic-user-') && item.text === update.content.text
    );
    if (!optimistic) {
      return;
    }

    this.activeSession.transcript = this.activeSession.transcript.filter((item) => item.id !== optimistic.id);
    this.activeSession.events = this.activeSession.events.filter((event) => event.messageId !== optimistic.messageId);
  }

  private applySessionSummaryUpdate(agentId: string, notification: SessionNotification) {
    if (notification.update.sessionUpdate !== 'session_info_update') {
      return;
    }

    const sessions = this.sessionsByAgent[agentId] ?? [];
    const nextSessions = sessions.map((session) => {
      if (session.sessionId !== notification.sessionId) {
        return session;
      }

      return {
        ...session,
        title: notification.update.title ?? 'Untitled session',
        updatedAt: notification.update.updatedAt ?? null
      };
    });

    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: nextSessions
    };
  }

  private handleSessionNotification(
    agentId: string,
    notification: SessionNotification,
    record: AgentClientRecord
  ) {
    this.applySessionSummaryUpdate(agentId, notification);

    if (this.activeAgentId !== agentId || (this.activeSessionId && notification.sessionId !== this.activeSessionId)) {
      return;
    }

    const notificationKey = `${notification.sessionId}:${JSON.stringify(notification.update)}`;
    if (record.recentSessionUpdateKeys.includes(notificationKey)) {
      return;
    }

    if (!this.activeSession.sessionId) {
      this.activeSession.sessionId = notification.sessionId;
    }

    this.removeMatchingOptimisticUserPrompt(notification);
    this.activeSession = applySessionNotification(this.activeSession, notification);
    record.recentSessionUpdateKeys.push(notificationKey);
    if (record.recentSessionUpdateKeys.length > 200) {
      record.recentSessionUpdateKeys.shift();
    }
  }
}

function loadInitialAgents(): AgentConfig[] {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_AGENTS;
  }

  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AGENTS;
    }

    const parsed = JSON.parse(raw) as AgentConfig[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_AGENTS;
  } catch {
    return DEFAULT_AGENTS;
  }
}

function persistAgents(agents: AgentConfig[]) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
}

function loadRecentModels(): Record<string, string[]> {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistRecentModels(value: Record<string, string[]>) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(value));
}

function loadRecentWorkspaces(): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function persistRecentWorkspaces(value: string[]) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(RECENT_WORKSPACES_STORAGE_KEY, JSON.stringify(value));
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function getDefaultModelId(models: ModelEntry[]): string {
  return models[0]?.id ?? '';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const agentsStore = new AgentsStore();
