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
import {
  buildSessionKey,
  getSessionById,
  getSessionKey,
  isActiveSessionStatus,
  mapAcpSessionsToDesktopSessions
} from '$lib/domain/sessions';
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
  PromptAttachment,
  SessionRunState,
  SessionStatus
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
import {
  findModelConfigOption,
  getCurrentModelId,
  getCurrentProfileId,
  getProfileChoices,
  setModelConfigOptionRequest,
  setSessionConfigOptionRequest
} from '$lib/querymt/config-options';
import { DesktopAcpClient } from '$lib/querymt/acp-client';
import { sendDesktopNotification } from '$lib/querymt/notifications';
import { listManagedProfiles } from '$lib/querymt/profile-templates';
import { getAgentLogs, getAgentStatus, restartAgent, startAgent, stopAgent, validateWorkspaceDirectory } from '$lib/querymt/sidecar';
import { inboxStore } from '$lib/stores/inbox.svelte';

const AGENTS_STORAGE_KEY = 'querymt-desktop.agents';
const RECENT_MODELS_STORAGE_KEY = 'querymt-desktop.recent-models';
const RECENT_WORKSPACES_STORAGE_KEY = 'querymt-desktop.recent-workspaces';
const RECENT_MODELS_LIMIT = 5;
const RECENT_WORKSPACES_LIMIT = 8;
const WEBSOCKET_RECONNECT_MAX_DELAY_MS = 8_000;
const PROMPT_ACTIVE_RUN_STATES = new Set<SessionRunState>(['thinking', 'streaming', 'tool-running']);

interface AgentClientRecord {
  client: DesktopAcpClient;
  connectionState: AgentConnectionState;
  initializeResponse: InitializeResponse | null;
  error: string | null;
  unsubscribeSessionUpdates: (() => void) | null;
  unsubscribeExtensionNotifications: (() => void) | null;
  unsubscribeConnectionLoss: (() => void) | null;
  unsubscribeInbox: (() => void) | null;
  recentSessionUpdateKeys: string[];
}

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'qmtcode-default',
    name: 'QMTCODE',
    transport: 'stdio',
    commandLine: 'qmtcode --acp',
    enabled: true,
    autoStart: true
  }
];

export class AgentsStore {
  private clients = new Map<string, AgentClientRecord>();
  private sessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();

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
  attentionSessionKeys = $state<string[]>([]);
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
  sessionConfigPending = $state<Record<string, boolean>>({});
  promptAttachments = $state<PromptAttachment[]>([]);
  managedProfileOptions = $state<ComposerOption[]>([]);
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
    return this.configs.filter(
      (config) =>
        config.enabled &&
        this.statuses[config.id]?.state === 'running' &&
        this.connectionStates[config.id] !== 'failed'
    );
  }

  get agentsNeedingAttention(): AgentConfig[] {
    return this.configs.filter((config) => {
      const status = this.statuses[config.id];
      const controlState = this.controlHealthByAgent[config.id]?.state;
      return (
        status?.state === 'failed' ||
        Boolean(status?.lastError) ||
        Boolean(this.agentErrors[config.id]) ||
        this.connectionStates[config.id] === 'failed' ||
        controlState === 'failed' ||
        controlState === 'degraded'
      );
    });
  }

  acknowledgeSession(agentId: string, sessionId: string) {
    const key = buildSessionKey(agentId, sessionId);
    this.attentionSessionKeys = this.attentionSessionKeys.filter((candidate) => candidate !== key);
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
      await this.refreshManagedProfiles();
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
    this.error = null;
  }

  getRecentWorkspaces(): string[] {
    return this.recentWorkspaces;
  }

  setComposerPrompt(value: string) {
    this.composerPrompt = value;
    this.error = null;
  }

  clearError() {
    this.error = null;
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

  async refreshManagedProfiles() {
    const profiles = await listManagedProfiles();
    this.managedProfileOptions = profiles.map((profile) => ({
      id: profile.id,
      label: profile.name,
      description: profile.description ?? null
    }));
  }

  getProfileOptions(): ComposerOption[] {
    const options = [
      { id: 'default', label: 'Default profile', description: 'Use the agent default.' },
      ...this.managedProfileOptions,
      ...getProfileChoices(this.activeSession.configOptions)
    ];

    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    });
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
    const current = this.configs.find((config) => config.id === agentId);
    if (current?.transport === 'websocket' && (updates.transport || updates.websocketUrl !== undefined || updates.enabled === false)) {
      this.cancelReconnect(agentId);
      this.disposeClient(agentId);
    }
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
    this.disposeClient(agentId);
    persistAgents(this.configs);
  }

  createConfig(name: string, transport: AgentConfig['transport'], endpoint: string): AgentConfig {
    return {
      id: slugify(`${name}-${Date.now()}`),
      name,
      transport,
      commandLine: transport === 'stdio' ? endpoint : '',
      websocketUrl: transport === 'websocket' ? normalizeAcpWebSocketEndpoint(endpoint) : undefined,
      enabled: true,
      autoStart: true
    };
  }

  async refreshAgent(config: AgentConfig) {
    if (config.transport === 'websocket') {
      this.statuses = {
        ...this.statuses,
        [config.id]: websocketStatus(config, this.connectionStates[config.id] ?? 'idle')
      };
      this.logsByAgent = { ...this.logsByAgent, [config.id]: [] };
      this.connectionStates = {
        ...this.connectionStates,
        [config.id]: this.connectionStates[config.id] ?? 'idle'
      };
      this.agentErrors = { ...this.agentErrors, [config.id]: this.agentErrors[config.id] ?? null };
      return;
    }

    const [status, logs] = await Promise.all([getAgentStatus(config), getAgentLogs(config.id)]);
    this.statuses = { ...this.statuses, [config.id]: status };
    this.logsByAgent = { ...this.logsByAgent, [config.id]: logs };
    this.connectionStates = {
      ...this.connectionStates,
      [config.id]: this.connectionStates[config.id] ?? 'idle'
    };
    this.agentErrors = { ...this.agentErrors, [config.id]: this.agentErrors[config.id] ?? null };
  }

    async startConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;

    this.error = null;
    try {
      if (config.transport === 'websocket') {
        await this.connectAgent(config.id, true);
        await this.refreshAgent(config);
      } else {
        const status = await startAgent(config);
        this.statuses = { ...this.statuses, [config.id]: status };
        await this.connectAgent(config.id);
      }
      await Promise.allSettled([
        this.refreshSessionsForAgent(config.id),
        this.refreshMeshForAgent(config.id),
        this.refreshAuthProviders(config.id)
      ]);
      if (config.transport === 'stdio') {
        this.logsByAgent = { ...this.logsByAgent, [config.id]: await getAgentLogs(config.id) };
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to connect ${config.name}.`;
    }
  }

    async stopConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;

    this.cancelReconnect(agentId);
    this.reconnectAttempts.delete(agentId);
    try {
      if (config.transport === 'websocket') {
        this.disposeClient(agentId);
        this.statuses = { ...this.statuses, [config.id]: websocketStatus(config, 'idle') };
      } else {
        const status = await stopAgent(agentId);
        this.statuses = { ...this.statuses, [config.id]: status };
      }
      this.sessionsByAgent = { ...this.sessionsByAgent, [config.id]: [] };
      this.connectionStates = { ...this.connectionStates, [config.id]: 'idle' };
      if (this.activeAgentId === config.id) {
        this.activeAgentId = null;
        this.activeSessionId = null;
        this.activeSession = createEmptyActiveSession();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to disconnect ${config.name}.`;
    }
  }

    async restartConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;

    this.cancelReconnect(agentId);
    this.reconnectAttempts.delete(agentId);
    try {
      if (config.transport === 'websocket') {
        this.disposeClient(agentId);
        await this.connectAgent(config.id, true);
        await this.refreshAgent(config);
      } else {
        const status = await restartAgent(config);
        this.statuses = { ...this.statuses, [config.id]: status };
        await this.connectAgent(config.id, true);
      }
      await Promise.allSettled([
        this.refreshSessionsForAgent(config.id),
        this.refreshMeshForAgent(config.id),
        this.refreshAuthProviders(config.id)
      ]);
      if (config.transport === 'stdio') {
        this.logsByAgent = { ...this.logsByAgent, [config.id]: await getAgentLogs(config.id) };
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to reconnect ${config.name}.`;
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
      record.unsubscribeInbox?.();
      record.unsubscribeInbox = inboxStore.bindClient(record.client, config.id, config.name);
      record.initializeResponse = await record.client.connect();
      record.connectionState = 'initialized';
      this.cancelReconnect(agentId);
      this.reconnectAttempts.delete(agentId);
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
      if (config.transport === 'websocket') {
        this.scheduleReconnect(agentId);
      }
    }
  }

  async refreshAllSessions() {
    await Promise.allSettled(
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
      const sessions = await record.client.listSessions();
      const previousSessions = this.sessionsByAgent[agentId] ?? [];
      const nextSessions = mapAcpSessionsToDesktopSessions(sessions, {
        agentId: config.id,
        agentName: config.name
      });
      this.updateSessionAttention(agentId, previousSessions, nextSessions);
      this.sessionsByAgent = {
        ...this.sessionsByAgent,
        [agentId]: nextSessions
      };
      if (nextSessions.some((session) => isActiveSessionStatus(session.status))) {
        this.scheduleSessionRefresh(agentId, 2500);
      } else {
        this.clearScheduledSessionRefresh(agentId);
      }
      const models = await record.client.listModels().catch(() => this.modelsByAgent[agentId] ?? []);
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

    if (config.transport === 'stdio') {
      const isDirectory = await validateWorkspaceDirectory(normalizedCwd).catch(() => false);
      if (!isDirectory) {
        throw new Error('Workspace must point to an existing directory.');
      }
    }

    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);

    const response = await record.client.createSession(
      normalizedCwd,
      this.composerProfileId === 'default' ? null : this.composerProfileId
    );
    this.lastCreatedSession = response;
    this.rememberRecentWorkspace(normalizedCwd);
    await this.refreshSessionsForAgent(agentId);
    return response;
  }

  async createSession(agentId: string): Promise<string | null> {
    this.error = null;
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
      this.composerProfileId = getCurrentProfileId(this.activeSession.configOptions) ?? this.composerProfileId;
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
    this.error = null;
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
      if (PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState)) {
        this.activeSession.runState = 'completed';
        this.activeSession.activeToolCallId = null;
        this.activeSession.activityLabel =
          this.lastPromptResponse.stopReason === 'cancelled' ? 'Turn cancelled.' : 'Turn completed.';
      }
      await this.refreshSessionsForAgent(this.activeAgentId);
    } catch (error) {
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = error instanceof Error ? error.message : 'Failed to send ACP prompt.';
      this.activeSession.activityLabel = this.activeSession.lastError;
      this.error = this.activeSession.lastError;
    }
  }

  async cancelActiveSession() {
    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return;
    }

    if (!PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState) && this.activeSession.runState !== 'submitting') {
      return;
    }

    const record = this.ensureClientRecord(this.activeAgentId);

    try {
      this.error = null;
      this.activeSession.activityLabel = 'Cancelling turn…';
      this.activeSession.lastError = null;
      await this.connectAgent(this.activeAgentId);
      await record.client.cancelSession(this.activeSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel ACP prompt.';
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = message;
      this.activeSession.activityLabel = message;
      this.error = message;
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

    this.acknowledgeSession(agentId, sessionId);

    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);

    if (!record.initializeResponse?.agentCapabilities?.loadSession) {
      this.error = 'This agent does not support session/load.';
      return;
    }

    try {
      this.resetActiveSession(agentId, sessionId);
      this.activeSession.runState = 'thinking';
      this.activeSession.activityLabel = 'Loading session history...';
      this.activeSession.lastError = null;
      await tick();
      const loadedSession = await record.client.loadSession(target.sessionId, target.cwd);
      if (!this.isSelectedSession(agentId, sessionId)) {
        return;
      }
      this.lastLoadedSession = loadedSession;
      await Promise.resolve();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!this.isSelectedSession(agentId, sessionId)) {
        return;
      }
      const liveReplayCount = this.activeSession.events.length;
      const drainedCount = await this.drainQueuedSessionUpdates(agentId, sessionId);
      if (!this.isSelectedSession(agentId, sessionId)) {
        return;
      }

      console.debug('querymt session/load replay', {
        agentId,
        sessionId,
        liveReplayCount,
        drainedCount,
        totalEvents: this.activeSession.events.length
      });

      const snapshotSession = activeSessionFromLoadResponse(sessionId, loadedSession);
      const hasReplayHistory =
        this.activeSession.transcript.length > 0 || this.activeSession.toolCalls.length > 0 || this.activeSession.events.length > 0;
      const hasSnapshotHistory =
        snapshotSession.transcript.length > 0 || snapshotSession.toolCalls.length > 0 || snapshotSession.events.length > 0;
      if (!hasReplayHistory && hasSnapshotHistory) {
        this.activeSession = snapshotSession;
      }

      this.activeSession.configOptions = loadedSession.configOptions ?? [];
      this.composerProfileId = getCurrentProfileId(this.activeSession.configOptions) ?? this.composerProfileId;
      this.composerModelId = getCurrentModelId(this.activeSession.configOptions) ?? this.composerModelId;
      this.activeSession = normalizeHistoricalSession(this.activeSession, { loadCompleted: true });
      if (!hasReplayHistory && !hasSnapshotHistory && drainedCount === 0) {
        this.activeSession.activityLabel = 'Session loaded, but the agent returned no replayable history.';
      }
      await this.hydrateModelInfo(agentId, this.modelsByAgent[agentId] ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load ACP session.';
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = message;
      this.activeSession.activityLabel = message;
      this.error = message;
    }
  }

  private ensureClientRecord(agentId: string, force = false): AgentClientRecord {
    const existing = this.clients.get(agentId);
    if (existing && !force) {
      return existing;
    }
    if (existing) {
      this.disposeClient(agentId);
    }

    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      throw new Error(`Agent ${agentId} is not configured.`);
    }

    const record: AgentClientRecord = {
      client: new DesktopAcpClient(config),
      connectionState: 'idle',
      initializeResponse: null,
      error: null,
      unsubscribeSessionUpdates: null,
      unsubscribeExtensionNotifications: null,
      unsubscribeConnectionLoss: null,
      unsubscribeInbox: null,
      recentSessionUpdateKeys: []
    };

    this.clients.set(agentId, record);
    this.ensureSessionUpdateSubscription(agentId, record);
    this.ensureExtensionNotificationSubscription(agentId, record);
    this.ensureConnectionLossSubscription(agentId, record);
    return record;
  }

  private disposeClient(agentId: string) {
    const record = this.clients.get(agentId);
    if (!record) return;
    record.unsubscribeSessionUpdates?.();
    record.unsubscribeExtensionNotifications?.();
    record.unsubscribeConnectionLoss?.();
    record.unsubscribeInbox?.();
    void record.client.disconnect();
    this.clients.delete(agentId);
  }

  private ensureConnectionLossSubscription(agentId: string, record: AgentClientRecord) {
    if (!record.unsubscribeConnectionLoss) {
      record.unsubscribeConnectionLoss = record.client.onConnectionLost((reason) => {
        this.handleUnexpectedConnectionLoss(agentId, record, reason);
      });
    }
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

  private async drainQueuedSessionUpdates(agentId: string, sessionId: string): Promise<number> {
    const { drainAgentSessionUpdates } = await import('$lib/querymt/sidecar');
    try {
      const queued = await drainAgentSessionUpdates(agentId, sessionId);
      let applied = 0;
      for (const notification of queued as SessionNotification[]) {
        const record = this.ensureClientRecord(agentId);
        const before = this.activeSession.events.length;
        this.handleSessionNotification(agentId, notification, record);
        if (this.activeSession.events.length > before) {
          applied += 1;
        }
      }
      return applied;
    } catch {
      // Ignore drain failures and continue with live session streaming.
      return 0;
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

    const configId = findModelConfigOption(this.activeSession.configOptions)?.id ?? 'model';
    await this.updateSessionConfigOption(agentId, sessionId, configId, model.id, { model });
  }

  async setActiveSessionConfigOption(configId: string, value: string) {
    if (!this.activeAgentId || !this.activeSessionId) {
      throw new Error('No active session selected.');
    }

    await this.updateSessionConfigOption(this.activeAgentId, this.activeSessionId, configId, value);
  }

  private async updateSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string,
    options: { model?: ModelEntry } = {}
  ) {
    const record = this.ensureClientRecord(agentId);
    await this.connectAgent(agentId);
    this.sessionConfigPending = {
      ...this.sessionConfigPending,
      [configId]: true
    };

    try {
      const request = options.model
        ? setModelConfigOptionRequest(sessionId, options.model, configId)
        : setSessionConfigOptionRequest(sessionId, configId, value);
      const configOptions = await record.client.setSessionConfigOption(request);
      this.activeSession.configOptions = configOptions;
      this.composerProfileId = getCurrentProfileId(configOptions) ?? this.composerProfileId;
      this.composerModelId = getCurrentModelId(configOptions) ?? this.composerModelId;
      const activeModelId = getCurrentModelId(configOptions);
      if (activeModelId) {
        this.rememberRecentModel(agentId, activeModelId);
      }
    } finally {
      this.sessionConfigPending = {
        ...this.sessionConfigPending,
        [configId]: false
      };
    }
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

  private updateSessionAttention(
    agentId: string,
    previousSessions: DesktopSessionSummary[],
    nextSessions: DesktopSessionSummary[]
  ) {
    const previousStatusByKey = new Map(previousSessions.map((session) => [getSessionKey(session), session.status]));
    const nextKeys = new Set(nextSessions.map(getSessionKey));
    const agentKeyPrefix = `${agentId}:`;
    const attentionKeys = new Set(
      this.attentionSessionKeys.filter((key) => !key.startsWith(agentKeyPrefix) || nextKeys.has(key))
    );

    for (const session of nextSessions) {
      const key = getSessionKey(session);
      if (isActiveSessionStatus(session.status)) {
        attentionKeys.delete(key);
        continue;
      }

      const previousStatus = previousStatusByKey.get(key);
      if (
        previousStatus &&
        isActiveSessionStatus(previousStatus) &&
        session.status === 'completed' &&
        !this.isSelectedSession(session.agentId, session.sessionId)
      ) {
        attentionKeys.add(key);
      }
    }

    this.attentionSessionKeys = [...attentionKeys];
  }

  private isSelectedSession(agentId: string, sessionId: string): boolean {
    return this.activeAgentId === agentId && this.activeSessionId === sessionId;
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

    const contentText = update.content.text;
    const optimistic = this.activeSession.transcript.find(
      (item) =>
        item.kind === 'user_message_chunk' &&
        item.id.includes('-optimistic-user-') &&
        'text' in item &&
        item.text === contentText
    );
    if (!optimistic) {
      return;
    }

    this.activeSession.transcript = this.activeSession.transcript.filter((item) => item.id !== optimistic.id);
    this.activeSession.events = this.activeSession.events.filter((event) => event.messageId !== optimistic.messageId);
  }

  private applySessionSummaryUpdate(agentId: string, notification: SessionNotification) {
    const sessions = this.sessionsByAgent[agentId] ?? [];
    if (sessions.length === 0) {
      return;
    }

    const update = notification.update;
    const inferredStatus = inferSessionStatusFromNotification(update);
    const activityUpdatedAt = inferredStatus ? new Date().toISOString() : undefined;
    const infoTitle = update.sessionUpdate === 'session_info_update' ? (update.title ?? 'Untitled session') : undefined;
    const infoUpdatedAt = update.sessionUpdate === 'session_info_update' ? (update.updatedAt ?? null) : undefined;
    if (!inferredStatus && infoTitle === undefined && infoUpdatedAt === undefined) {
      return;
    }

    const nextSessions = sessions.map((session) => {
      if (session.sessionId !== notification.sessionId) {
        return session;
      }

      return {
        ...session,
        title: infoTitle ?? session.title,
        status: inferredStatus ?? session.status,
        updatedAt: infoUpdatedAt !== undefined ? infoUpdatedAt : (activityUpdatedAt ?? session.updatedAt)
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
    if (inferSessionStatusFromNotification(notification.update)) {
      this.scheduleSessionRefresh(agentId);
    }

    if (this.activeAgentId !== agentId || (this.activeSessionId && notification.sessionId !== this.activeSessionId)) {
      console.debug('querymt session/update dropped', {
        agentId,
        activeAgentId: this.activeAgentId,
        activeSessionId: this.activeSessionId,
        notificationSessionId: notification.sessionId,
        update: notification.update.sessionUpdate
      });
      return;
    }

    const notificationKey = `${notification.sessionId}:${JSON.stringify(notification.update)}`;
    if (record.recentSessionUpdateKeys.includes(notificationKey)) {
      console.debug('querymt session/update duplicate', {
        agentId,
        sessionId: notification.sessionId,
        update: notification.update.sessionUpdate
      });
      return;
    }

    if (!this.activeSession.sessionId) {
      this.activeSession.sessionId = notification.sessionId;
    }

    this.removeMatchingOptimisticUserPrompt(notification);
    const beforeEvents = this.activeSession.events.length;
    this.activeSession = applySessionNotification(this.activeSession, notification);
    console.debug('querymt session/update applied', {
      agentId,
      sessionId: notification.sessionId,
      update: notification.update.sessionUpdate,
      beforeEvents,
      afterEvents: this.activeSession.events.length
    });
    void this.maybeNotifyForSessionUpdate(agentId, notification);
    record.recentSessionUpdateKeys.push(notificationKey);
    if (record.recentSessionUpdateKeys.length > 200) {
      record.recentSessionUpdateKeys.shift();
    }
  }

  private handleUnexpectedConnectionLoss(agentId: string, record: AgentClientRecord, reason: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config || config.transport !== 'websocket' || this.clients.get(agentId) !== record) return;

    this.clearScheduledSessionRefresh(agentId);
    record.connectionState = 'failed';
    record.error = reason;
    this.connectionStates = { ...this.connectionStates, [agentId]: 'failed' };
    this.agentErrors = { ...this.agentErrors, [agentId]: reason };
    this.statuses = { ...this.statuses, [agentId]: websocketStatus(config, 'failed') };
    this.disposeClient(agentId);
    this.scheduleReconnect(agentId);
  }

  private scheduleReconnect(agentId: string) {
    this.cancelReconnect(agentId);
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config || config.transport !== 'websocket' || !config.enabled || !config.autoStart) return;

    const attempt = (this.reconnectAttempts.get(agentId) ?? 0) + 1;
    const delayMs = reconnectDelayMs(attempt - 1);
    this.reconnectAttempts.set(agentId, attempt);
    this.connectionStates = { ...this.connectionStates, [agentId]: 'reconnecting' };
    this.statuses = { ...this.statuses, [agentId]: websocketStatus(config, 'reconnecting', attempt, delayMs) };
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(agentId);
      void this.reconnectAgent(agentId);
    }, delayMs);
    this.reconnectTimers.set(agentId, timer);
  }

  private async reconnectAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config || config.transport !== 'websocket' || !config.enabled || !config.autoStart) return;

    await this.connectAgent(agentId, true);
    const record = this.clients.get(agentId);
    if (record?.connectionState === 'initialized') {
      await Promise.allSettled([
        this.refreshSessionsForAgent(agentId),
        this.refreshMeshForAgent(agentId),
        this.refreshAuthProviders(agentId)
      ]);
      await this.refreshAgent(config);
    } else {
      this.scheduleReconnect(agentId);
    }
  }

  private cancelReconnect(agentId: string) {
    const timer = this.reconnectTimers.get(agentId);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(agentId);
  }

  private scheduleSessionRefresh(agentId: string, delayMs = 800) {
    this.clearScheduledSessionRefresh(agentId);

    const timer = setTimeout(() => {
      this.sessionRefreshTimers.delete(agentId);
      void this.refreshSessionsForAgent(agentId);
    }, delayMs);
    this.sessionRefreshTimers.set(agentId, timer);
  }

  private clearScheduledSessionRefresh(agentId: string) {
    const existing = this.sessionRefreshTimers.get(agentId);
    if (!existing) {
      return;
    }

    clearTimeout(existing);
    this.sessionRefreshTimers.delete(agentId);
  }

  private async maybeNotifyForSessionUpdate(agentId: string, notification: SessionNotification) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const update = notification.update;
    if (!config) {
      return;
    }

    if (update.sessionUpdate === 'tool_call_update' && update.status === 'failed') {
      await sendDesktopNotification(`${config.name}: tool failed`, update.title ? `${update.title} failed.` : 'A tool call failed.');
      return;
    }

    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = update.content.type === 'text' ? update.content.text.trim() : '';
      if (text.length > 0) {
        await sendDesktopNotification(`${config.name}: reply`, text.slice(0, 180));
      }
    }
  }
}

function inferSessionStatusFromNotification(update: SessionNotification['update']): SessionStatus | null {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
    case 'tool_call':
    case 'tool_call_update':
    case 'plan':
    case 'plan_update':
      return 'thinking';
    default:
      return null;
  }
}

function reconnectDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** Math.min(attempt, 5), WEBSOCKET_RECONNECT_MAX_DELAY_MS);
}

function websocketStatus(
  config: AgentConfig,
  connectionState: AgentConnectionState,
  reconnectAttempt?: number,
  reconnectDelayMs?: number
): AgentRuntimeStatus {
  const connected = connectionState === 'initialized' || connectionState === 'loading-sessions';
  const reconnecting = connectionState === 'reconnecting';
  const failed = connectionState === 'failed';
  return {
    agentId: config.id,
    state: connected ? 'running' : failed ? 'failed' : 'stopped',
    commandLine: config.websocketUrl ?? '',
    pid: null,
    version: null,
    message: connected
      ? 'Connected over WebSocket.'
      : reconnecting
        ? `Reconnecting (attempt ${reconnectAttempt ?? 1} in ${Math.ceil((reconnectDelayMs ?? 0) / 1000)}s).`
        : failed
          ? 'WebSocket connection failed.'
          : 'Disconnected WebSocket agent.',
    lastError: failed ? 'WebSocket connection failed.' : null
  };
}

export function normalizeAcpWebSocketEndpoint(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const url = new URL(/^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Enter an ACP host and port.');
  }
  if (url.pathname !== '/' && url.pathname !== '/ws') {
    throw new Error('The ACP WebSocket path is fixed and must not be configured.');
  }
  if (url.search || url.hash) {
    throw new Error('WebSocket query parameters and fragments are not supported.');
  }
  return url.host;
}

function normalizeAgentConfig(config: AgentConfig): AgentConfig {
  const transport = config.transport === 'websocket' ? 'websocket' : 'stdio';
  return {
    ...config,
    transport,
    commandLine: config.commandLine ?? '',
    websocketUrl: transport === 'websocket' ? normalizeAcpWebSocketEndpoint(config.websocketUrl ?? '') : undefined
  };
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
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(normalizeAgentConfig) : DEFAULT_AGENTS;
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
