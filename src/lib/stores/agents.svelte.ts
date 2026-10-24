import { RequestError } from '@agentclientprotocol/sdk';
import type {
  InitializeResponse,
  ListSessionsResponse,
  ListSessionsRequest,
  LoadSessionResponse,
  NewSessionResponse,
  PromptResponse,
  SessionConfigOption,
  SessionInfo,
  SessionNotification
} from '@agentclientprotocol/sdk';
import { tick } from 'svelte';
import { normalizePromptError, type PromptFailure } from '$lib/domain/prompt-errors';
import { activeSessionFromLoadResponse, getSnapshotInputStates, getSnapshotProviderChange, normalizeHistoricalSession } from '$lib/domain/session-snapshot';
import { canUndoToMessage, getCurrentUndoTarget, getUndoableSessionTurns } from '$lib/domain/session-undo';
import {
  createEmptyActiveSession,
  appendSessionReplay,
  applySessionNotification,
  applyDelegationChildSession,
  mergeMissingSessionUsage,
  reduceSessionReplay,
  beginSessionWork,
  endSessionWork,
  getNextConversationEventIndex,
  getTranscriptBlocks,
  normalizeContentBlock,
  readClientPromptId
} from '$lib/domain/session-updates';
import {
  buildListSessionsRequest,
  createSessionBrowserState,
  compareSessionsByPin,
  isRootSession,
  readSessionPin,
  sessionMatchesLifecycle,
  buildSessionKey,
  getSessionById,
  getSessionKey,
  getSessionWorkspaceKey,
  getSessionWorkspaceName,
  getWorkspaceLocation,
  getWorkspaceRemoteMachines,
  isActiveSessionStatus,
  mapAcpSessionsToDesktopSessions,
  readSessionRelationshipMeta,
  newestTimestamp,
  type WorkspaceSessionGroup,
  type WorkspaceSessionSource
} from '$lib/domain/sessions';
import type {
  ActiveSessionViewModel,
  AgentConfig,
  AgentConnectionState,
  AgentControlHealth,
  AgentRuntimeStatus,
  ComposerOption,
  DesktopSessionSummary,
  ExcludedSessionAgent,
  ModelEntry,
  ModelInfo,
  PendingSessionInput,
  PromptAttachment,
  SessionContentBlock,
  SessionInputDeliveryMode,
  SessionRunState,
  SessionStatus,
  SessionLifecycle,
  SessionPin,
  SessionLifecyclePatch,
  SessionLifecycleFilter
} from '$lib/domain/types';
import { DelegateAssignmentSource, SessionInputDelivery, SessionInputState } from '$lib/querymt/generated/types';
import type {
  AuthMethod,
  AuthProviderStatus,
  CapabilitiesInfo,
  CreateMeshInviteRequest,
  CreateScheduleControlRequest,
  DelegateAssignmentsInfo,
  DelegateModelsChangedNotification,
  DelegateModelOverride,
  DelegateReasoningEffort,
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
  ScheduleListInfo,
  SessionInputStateNotification,
  SessionRuntimeStatus,
  SetDelegateModelResponse,
  SubmitInputResult
} from '$lib/querymt/generated/types';
import {
  CONFIG_MODE,
  findModeConfigOption,
  configuredModelIdentity,
  resolveSessionModelKey,
  type ModelLocationContext,
  findModelBySelectionKey,
  findModelConfigOption,
  findReasoningConfigOption,
  getConfigOptionChoices,
  getCurrentModelId,
  getCurrentModeId,
  getCurrentReasoningId,
  getModelSelectionKey,
  getProfileChoices,
  isModeConfigOptionId,
  isModelConfigOptionId,
  isReasoningConfigOptionId,
  setModelConfigOptionRequest,
  setSessionConfigOptionRequest
} from '$lib/querymt/config-options';
import { DesktopAcpClient, clearElicitationResumeAuthoritiesForAgent } from '$lib/querymt/acp-client';
import {
  QMT_METHOD_PROFILES,
  QMT_METHOD_SESSION_DELEGATE_MODELS,
  QMT_METHOD_SESSION_DISCARD_QUEUED_INPUT,
  QMT_METHOD_SESSION_QUEUE,
  QMT_METHOD_SESSION_REDO,
  QMT_METHOD_SESSION_RUNTIME_STATE,
  QMT_METHOD_SESSION_STEER,
  QMT_METHOD_SESSION_SET_DELEGATE_MODEL,
  QMT_METHOD_SESSION_UNDO,
  QMT_METHOD_SESSION_UNDO_STACK,
  QMT_NOTIFICATION_SESSION_INPUT_STATE,
  QMT_NOTIFICATION_SESSION_PINS_CHANGED
} from '$lib/querymt/querymt-extensions';
import { sendDesktopNotification } from '$lib/querymt/notifications';
import {
  SessionLoadMeasurement,
  countSnapshotEvents,
  type SessionLoadMetrics,
  type SessionLoadTelemetryCounters
} from '$lib/perf/session-load-metrics';
import {
  checkpointSessionLoadTelemetry,
  drainAgentSessionUpdates,
  finishSessionLoadTelemetry,
  getAgentLogs,
  getAgentStatus,
  heartbeatSessionLoadTelemetry,
  listManagedProfiles,
  listenAgentLogs,
  restartAgent,
  startAgent,
  startSessionLoadTelemetry,
  stopAgent,
  validateWorkspaceDirectory,
  type AgentLogEntry
} from '$native';
import { inboxStore } from '$lib/stores/inbox.svelte';
import { SessionCatalogCache, isCatalogFresh, sessionCatalogKey, type CachedSessionCatalog } from '$lib/stores/session-catalog-cache';
import { SessionListCoordinator, SupersededSessionListError } from '$lib/stores/session-list-coordination';
import { chatPreferencesStore } from '$lib/stores/chat-preferences.svelte';
import {
  loadSessionModePreferences,
  persistSessionModePreferences,
  readSessionModePreference,
  withSessionModePreference,
  withoutSessionModePreferences,
  type SessionModePreferenceDocument,
  type SessionModePreferencePatch
} from '$lib/stores/session-mode-preferences';
import { createEmbeddedAgentConfig, EMBEDDED_AGENT_ID } from '$lib/platform/embedded-agent';
import { isEmbedded, platformCapabilities } from '$lib/platform/runtime';
import { normalizeAcpWebSocketEndpoint, usesSecureWebSocket } from '$lib/querymt/websocket-url';

const AGENTS_STORAGE_KEY = 'querymt-desktop.agents';
const RECENT_MODELS_STORAGE_KEY = 'querymt-desktop.recent-models';
const RECENT_SESSIONS_STORAGE_KEY = 'querymt-desktop.recent-sessions';
const RECENT_SESSIONS_LIMIT = 50;
const RECENT_DELEGATE_MODELS_STORAGE_KEY = 'querymt-desktop.recent-delegate-models';
const RECENT_WORKSPACES_STORAGE_KEY = 'querymt-desktop.recent-workspaces';
const RECENT_MODELS_LIMIT = 5;
const RECENT_WORKSPACES_LIMIT = 8;
const WEBSOCKET_RECONNECT_MAX_DELAY_MS = 8_000;
const WORKSPACE_SESSION_PAGE_SIZE = 10;
export const SESSION_SUMMARY_POLL_MS = 30_000;
export const SESSION_RUNTIME_POLL_MS = 2_000;
const MAX_AGENT_LOG_ENTRIES = 200;
const PROMPT_ACTIVE_RUN_STATES = new Set<SessionRunState>(['thinking', 'streaming', 'tool-running']);

// TODO: Replace these desktop defaults with agent-provided launch config metadata once the server exposes it before session/new.
export const LAUNCH_MODE_OPTIONS: ComposerOption[] = [
  { id: 'build', label: 'Build', description: 'Full read and write access.' },
  { id: 'plan', label: 'Plan', description: 'Inspect and plan without making changes.' },
  { id: 'review', label: 'Review', description: 'Review code without making changes.' }
];
export const LAUNCH_REASONING_OPTIONS: ComposerOption[] = [
  { id: 'auto', label: 'Auto', description: 'Use model-specific defaults.' },
  { id: 'low', label: 'Low', description: 'Minimal thinking and faster responses.' },
  { id: 'medium', label: 'Medium', description: 'Balanced thinking.' },
  { id: 'high', label: 'High', description: 'Thorough thinking.' },
  { id: 'max', label: 'Max', description: 'Deepest thinking and highest budget.' }
];

interface AgentLogEvent {
  agentId: string;
  entry: AgentLogEntry;
}

type UnlistenFn = () => void;

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

interface RecentSessionEntry {
  agentId: string;
  sessionId: string;
  source: string;
}

interface OpenSessionPage {
  scopeKey: string;
  nextCursor: string | null;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  seenCursors: string[];
}

interface ConnectFlight {
  owner: AgentClientRecord;
  promise: Promise<void>;
  abort: () => void;
}

const CONNECT_ABORTED = Symbol('connect-aborted');

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

/** Result of one serialized session config write. */
type SessionConfigWriteResult = {
  configOptions: SessionConfigOption[];
  /** Selection key the response itself confirmed; absent when it carried no model metadata. */
  confirmedModelKey?: string;
};

export class AgentsStore {
  private clients = new Map<string, AgentClientRecord>();
  private connectFlights = new Map<string, ConnectFlight>();
  private connectGenerations = new Map<string, number>();
  private sessionMutationScopes = new Map<string, symbol>();
  // Monotonic per-agent mesh refresh tokens. The key is kept after
  // deleteConfig (like connectGenerations): deleting it would restart the
  // token at the initial value and let a pre-delete request pass the token
  // check against a post-recreate refresh. One number per agent id is
  // negligible next to the retained connectGenerations entry.
  private meshRefreshGenerations = new Map<string, number>();
  private sessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionPollingStarted = false;
  private pollingDisposed = false;
  private pollingVisible = true;
  private runtimePollingEnabled = false;
  private unlistenPollingVisibility: (() => void) | null = null;
  private routineSessionRefreshes = new Map<string, Promise<void>>();
  private sessionRuntimeRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sessionRuntimeRefreshGenerations = new Map<string, number>();
  private sessionRuntimeRefreshPromises = new Map<string, { record: AgentClientRecord; selection: number; promise: Promise<SessionRuntimeStatus | null> }>();
  private inputSubmissionsBySession = new Map<string, number>();
  private inputNotificationsDuringSubmit = new Map<string, SessionInputStateNotification>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();
  private workspaceSourceVersions = new Map<string, number>();
  private seenWorkspaceCursors = new Map<string, Set<string>>();
  private completedWorkspaceDiscoveries = new Set<string>();
  private workspaceDiscoveryPromises = new Map<string, { scopeKey: string; promise: Promise<void> }>();
  private sessionListRefreshChain = new Map<string, Promise<void>>();
  private hydratedRemoteSessionKeys = new Set<string>();
  private snapshotUserMessageIds = new Set<string>();
  private sessionSelectionGeneration = 0;
  private unlistenAgentLogs: UnlistenFn | null = null;
  private agentLogSubscriptionPending = false;
  private modelInfoCache = new Map<string, ModelInfo | null>();
  private modelInfoRequests = new Map<string, Promise<void>>();
  private sessionConfigRequests = new Map<string, Promise<SessionConfigWriteResult>>();
  private sessionConfigOptions = new Map<string, SessionConfigOption[]>();
  private sessionModelIds = $state<Record<string, string>>({});
  // Confirmed active mode per session, tracked separately so model-only
  // config patches cannot make the current mode unknown.
  private sessionModeIds = $state<Record<string, string>>({});
  // Session keys with a desktop-initiated mode transition in flight; the value
  // is the target mode id. Inner restore writes run under this umbrella.
  private sessionModeTransitions = new Map<string, string>();
  private pendingSessionConfigs = $state<Record<string, Record<string, number>>>({});
  private delegateAssignmentRequests = new Map<string, Promise<boolean>>();
  private delegateAssignmentRoleRequests = new Map<string, Promise<boolean>>();
  private delegateAssignmentRefreshVersions = new Map<string, number>();
  private activeLoadMeasurement: SessionLoadMeasurement | null = null;
  private applyingDrainedUpdates = false;
  private pendingSessionNotifications: Array<{
    agentId: string;
    notification: SessionNotification;
    record: AgentClientRecord;
  }> = [];
  private pendingSessionNotificationFrame: number | null = null;

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
  authProvidersByAgent = $state<Record<string, AuthProviderStatus[]>>({});
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
  private knownSessionParents = $state<Record<string, string>>({});
  private recentSessionEntries = $state<RecentSessionEntry[]>(loadRecentSessions());
  private openSessionPages = $state<Record<string, OpenSessionPage>>({});
  sessionBrowser = $state(createSessionBrowserState());
  sessionCatalog = $state<DesktopSessionSummary[]>([]);
  sessionCatalogLoading = $state(false);
  sessionCatalogLoadedCount = $state(0);
  sessionCatalogError = $state<string | null>(null);
  sessionCatalogHasSessions = $state<boolean | null>(null);
  sessionCatalogExcludedAgents = $state<ExcludedSessionAgent[]>([]);
  sessionCatalogSupportedAgentCount = $state(0);
  sessionLifecyclePending = $state<Record<string, boolean>>({});
  sessionLifecycleErrors = $state<Record<string, string | null>>({});
  sessionLifecycles = $state<Record<string, SessionLifecycle | null>>({});
  sessionLifecycleRevision = $state(0);
  sessionPinPending = $state<Record<string, boolean>>({});
  sessionPinErrors = $state<Record<string, string | null>>({});
  private sessionPins = $state<Record<string, SessionPin>>({});
  private pinnedSessionsByAgent = $state<Record<string, DesktopSessionSummary[]>>({});
  pinnedSessionsLoading = $state<Record<string, boolean>>({});
  pinnedSessionsErrors = $state<Record<string, string | null>>({});
  private pinWrites = new Map<string, symbol>();
  private pinVersions = new Map<string, number>();
  private pinFlights = new Map<string, { version: number; promise: Promise<void> }>();
  private sessionCatalogGeneration = 0;
  private sessionCatalogSignature = '';
  private sessionListSharing: SessionListCoordinator | null = null;
  private sharedListSources = new Map<string, string>();
  private sharedListVersions = new Map<string, number>();
  private supersededListRetries = new Map<string, { agentId: string; record: AgentClientRecord; timer: ReturnType<typeof setTimeout> | null; run: () => Promise<unknown> }>();
  private retryingSessionLists = new Set<string>();
  private sessionCatalogCache = new SessionCatalogCache();
  private sessionCatalogFlight: { key: string; promise: Promise<void> } | null = null;
  private selectedCatalogScope: CachedSessionCatalog['scope'];
  private catalogWriteRevision = 0;
  private catalogWrites = new Map<string, { revision: number; session: DesktopSessionSummary | null }>();
  private lifecycleWriteVersions = new Map<string, number>();
  private lifecycleReads = new Map<string, symbol>();
  workspaceSessionSources = $state<Record<string, Record<string, WorkspaceSessionSource>>>({});
  workspaceVisibleLimits = $state<Record<string, number>>({});
  attentionSessionKeys = $state<string[]>([]);
  logsByAgent = $state<Record<string, Awaited<ReturnType<typeof getAgentLogs>>>>({});
  activeAgentId = $state<string | null>(null);
  activeSessionId = $state<string | null>(null);
  activeSession = $state<ActiveSessionViewModel>(createEmptyActiveSession());
  forkPending = $state(false);
  sessionHistoryLoading = $state(false);
  lastCreatedSession = $state<NewSessionResponse | null>(null);
  lastLoadedSession = $state<LoadSessionResponse | null>(null);
  lastPromptResponse = $state<PromptResponse | null>(null);
  composerCwd = $state('');
  composerPrompt = $state('');
  // Agent-scoped launch model selections, revalidated against each refreshed
  // model catalog so one agent's selection never leaks into another's.
  private launchModelIds = $state<Record<string, string>>({});
  composerProfileId = $state<string>('default');
  composerModeId = $state<string>('build');
  composerReasoningId = $state<string>('auto');
  composerTargetId = $state<string>('local');
  composerAgentId = $state<string | null>(null);
  get sessionConfigPending(): Record<string, boolean> {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return Object.fromEntries(Object.entries(this.pendingSessionConfigs[key] ?? {}).map(([id, count]) => [id, count > 0]));
  }
  promptAttachments = $state<PromptAttachment[]>([]);
  sessionRuntimeBySession = $state<Record<string, SessionRuntimeStatus | null>>({});
  pendingInputsBySession = $state<Record<string, PendingSessionInput[]>>({});
  composerInputDeliveryBySession = $state<Record<string, SessionInputDeliveryMode>>({});
  inputSubmitPending = $state(false);
  private inputSubmitOwner: string | null = null;
  managedProfileOptions = $state<ComposerOption[]>([]);
  remoteProfileOptions = $state<Record<string, ComposerOption[]>>({});
  remoteProfileErrors = $state<Record<string, string | null>>({});
  private remoteProfileVersions = new Map<string, number>();
  promptFocusToken = $state(0);
  loading = $state(false);
  error = $state<string | null>(null);
  promptFailure = $state<PromptFailure | null>(null);
  promptRetryPending = $state(false);
  modelsByAgent = $state<Record<string, ModelEntry[]>>({});
  modelInfoByAgent = $state<Record<string, Record<string, ModelInfo | null>>>({});
  modelLoadingByAgent = $state<Record<string, boolean>>({});
  delegateAssignmentsBySession = $state<Record<string, DelegateAssignmentsInfo | null>>({});
  delegateAssignmentsLoadingBySession = $state<Record<string, boolean>>({});
  delegateAssignmentsErrorBySession = $state<Record<string, string | null>>({});
  delegateAssignmentPendingBySession = $state<Record<string, Record<string, boolean>>>({});
  delegateAssignmentConflictBySession = $state<Record<string, boolean>>({});
  lastSessionLoadMetrics = $state<SessionLoadMetrics | null>(null);
  recentModelsByAgent = $state<Record<string, string[]>>(loadRecentModels());
  private recentModelsByDelegate = $state<Record<string, string[]>>(loadRecentModels(RECENT_DELEGATE_MODELS_STORAGE_KEY));
  recentWorkspaces = $state<string[]>(loadRecentWorkspaces());
  private sessionModePreferences: SessionModePreferenceDocument = loadSessionModePreferences();

  get activeSessionRuntime(): SessionRuntimeStatus | null {
    if (!this.activeAgentId || !this.activeSessionId) return null;
    return this.sessionRuntimeBySession[buildSessionKey(this.activeAgentId, this.activeSessionId)] ?? null;
  }

  get activePendingInputs(): PendingSessionInput[] {
    if (!this.activeAgentId || !this.activeSessionId) return [];
    return this.pendingInputsBySession[buildSessionKey(this.activeAgentId, this.activeSessionId)] ?? [];
  }

  get activeComposerInputDelivery(): SessionInputDeliveryMode {
    if (!this.activeAgentId || !this.activeSessionId) return chatPreferencesStore.inputDelivery;
    return this.composerInputDeliveryBySession[buildSessionKey(this.activeAgentId, this.activeSessionId)] ?? chatPreferencesStore.inputDelivery;
  }

  get canControlActiveRun(): boolean {
    if (!this.activeAgentId) return false;
    const client = this.clients.get(this.activeAgentId)?.client;
    return Boolean(client && this.canControlSessionInput(client));
  }

  get canDiscardQueuedInputs(): boolean {
    if (!this.activeAgentId) return false;
    return Boolean(
      this.clients
        .get(this.activeAgentId)
        ?.client.supportsQuerymtMethod(QMT_METHOD_SESSION_DISCARD_QUEUED_INPUT)
    );
  }

  get activeInputDelivery(): SessionInputDeliveryMode {
    const runtime = this.activeSessionRuntime;
    const draft = this.composerPrompt.trim();
    if (draft.startsWith('/')) return 'queue';
    if (!runtime || (runtime.phase === 'idle' && PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState))) {
      return this.activeComposerInputDelivery;
    }
    if (
      !runtime.steerable ||
      !runtime.active_run_id ||
      runtime.phase === 'closing' ||
      runtime.phase === 'cancel_requested'
    ) return 'queue';
    return this.activeComposerInputDelivery;
  }

  get activeDelegateAssignments(): DelegateAssignmentsInfo | null {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return this.delegateAssignmentsBySession[key] ?? null;
  }

  get activeRecentDelegateModels(): Record<string, ModelEntry[]> {
    const ownerAgentId = this.activeAgentId;
    const assignments = this.activeDelegateAssignments;
    if (!ownerAgentId || !assignments) return {};
    return Object.fromEntries(assignments.assignments.map(({ agent_id }) => [
      agent_id,
      this.getRecentDelegateModels(ownerAgentId, assignments.profile_id, agent_id)
    ]));
  }

  get activeDelegateAssignmentsLoading(): boolean {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return this.delegateAssignmentsLoadingBySession[key] ?? false;
  }

  get activeDelegateAssignmentsError(): string | null {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return this.delegateAssignmentsErrorBySession[key] ?? null;
  }

  get activeDelegateAssignmentPending(): Record<string, boolean> {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return this.delegateAssignmentPendingBySession[key] ?? {};
  }

  get activeDelegateAssignmentConflict(): boolean {
    const key = this.activeAgentId && this.activeSessionId
      ? buildSessionKey(this.activeAgentId, this.activeSessionId)
      : '';
    return this.delegateAssignmentConflictBySession[key] ?? false;
  }

  private sessionVisibleInCatalog(session: DesktopSessionSummary): boolean {
    return session.location !== 'remote' || (chatPreferencesStore.showRemoteSessions &&
      chatPreferencesStore.remoteSessionPeers.includes(session.remoteNodeId ?? ''));
  }

  private mapSessionSummaries(sessions: SessionInfo[], agent: { agentId: string; agentName: string }): DesktopSessionSummary[] {
    const incoming = mapAcpSessionsToDesktopSessions(sessions, agent);
    const incomingKeys = new Set(incoming.map(getSessionKey));
    const summaries = mergeSessions(this.sessionsByAgent[agent.agentId] ?? [], incoming)
      .filter((session) => incomingKeys.has(getSessionKey(session)));
    for (const session of summaries) {
      if (session.parentSessionId) this.rememberSessionChildren(agent.agentId, session.parentSessionId, [session.sessionId]);
    }
    return summaries.map((session) => this.withKnownSessionPin(this.withKnownSessionParent(session)));
  }

  private withKnownSessionParent(session: DesktopSessionSummary): DesktopSessionSummary {
    const parentSessionId = this.knownSessionParents[getSessionKey(session)];
    return parentSessionId ? { ...session, parentSessionId, relationshipKnown: true } : session;
  }

  private rememberSessionChildren(agentId: string, parentSessionId: string, childIds: Array<string | null | undefined>) {
    if (typeof parentSessionId !== 'string' || !parentSessionId.trim()) return;
    parentSessionId = parentSessionId.trim();
    const parents = { ...this.knownSessionParents };
    let changed = false;
    for (const childId of childIds) {
      const childSessionId = typeof childId === 'string' ? childId.trim() : null;
      if (!childSessionId || childSessionId === parentSessionId) continue;
      const key = buildSessionKey(agentId, childSessionId);
      if (parents[key] === parentSessionId) continue;
      parents[key] = parentSessionId;
      changed = true;
    }
    // A child can be announced before its summary arrives, or while another root is selected.
    if (!changed) return;
    this.knownSessionParents = parents;
    const update = (session: DesktopSessionSummary) => this.withKnownSessionParent(session);
    this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: (this.sessionsByAgent[agentId] ?? []).map(update) };
    this.sessionCatalog = this.sessionCatalog.map(update);
    // Old scopes may have cached an incomplete child summary. Do not reset the live paging cursor.
    this.sessionCatalogCache.clear();
  }

  private withKnownSessionPin(session: DesktopSessionSummary): DesktopSessionSummary {
    const pin = this.sessionPins[getSessionKey(session)];
    return pin ? { ...session, pin } : session;
  }

  get pinnedSessions(): DesktopSessionSummary[] {
    const current = new Map(this.sessions.map((session) => [getSessionKey(session), session]));
    const enabled = new Set(this.configs.filter((config) => config.enabled).map((config) => config.id));
    return Object.values(this.pinnedSessionsByAgent).flat()
      .filter((session) => enabled.has(session.agentId))
      .map((session) => this.withKnownSessionPin(this.withKnownSessionParent({ ...session, ...current.get(getSessionKey(session)) })))
      .filter((session) => session.location !== 'remote' && session.pin?.pinned && isRootSession(session))
      .sort(compareSessionsByPin);
  }

  get recentSessionKeys(): string[] {
    const sources = new Map(this.configs.filter((config) => config.enabled)
      .map((config) => [config.id, sessionCatalogKey([config], [], { resolution: 'any', archive: 'any' })]));
    return this.recentSessionEntries.filter((entry) => sources.get(entry.agentId) === entry.source)
      .map((entry) => buildSessionKey(entry.agentId, entry.sessionId));
  }

  private rememberRecentSession(agentId: string, sessionId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;
    const summary = this.sessionsByAgent[agentId]?.find((session) => session.sessionId === sessionId);
    // Unknown deep links may become roots after discovery; explicit children never do.
    if (summary && (summary.parentSessionId || summary.forkOrigin || this.knownSessionParents[buildSessionKey(agentId, sessionId)])) return;
    const entry = { agentId, sessionId, source: sessionCatalogKey([config], [], { resolution: 'any', archive: 'any' }) };
    this.recentSessionEntries = [entry, ...this.recentSessionEntries
      .filter((current) => current.agentId !== agentId || current.sessionId !== sessionId)].slice(0, RECENT_SESSIONS_LIMIT);
    persistRecentSessions(this.recentSessionEntries);
  }

  private forgetRecentSessions(agentId: string, sessionId?: string) {
    this.recentSessionEntries = this.recentSessionEntries.filter((entry) => entry.agentId !== agentId ||
      (sessionId !== undefined && entry.sessionId !== sessionId));
    persistRecentSessions(this.recentSessionEntries);
  }

  get sessions(): DesktopSessionSummary[] {
    return Object.values(this.sessionsByAgent).flat().map((session) => this.withKnownSessionPin(this.withKnownSessionParent(session)))
      .filter((session) => this.sessionVisibleInCatalog(session)).sort((a, b) => {
        const aValue = a.updatedAt ?? '';
        const bValue = b.updatedAt ?? '';
        return bValue.localeCompare(aValue);
      });
  }

  get workspaceSessionGroups(): WorkspaceSessionGroup[] {
    return this.workspaceSessionGroupsForLocation('all');
  }

  workspaceSessionGroupsForLocation(location: 'all' | 'local' | 'remote'): WorkspaceSessionGroup[] {
    const sourceGroups = new Map<string, WorkspaceSessionSource[]>();
    for (const sourcesByWorkspace of Object.values(this.workspaceSessionSources)) {
      for (const source of Object.values(sourcesByWorkspace)) {
        const sources = sourceGroups.get(source.cwd) ?? [];
        sources.push(source);
        sourceGroups.set(source.cwd, sources);
      }
    }

    return [...sourceGroups.entries()]
      .map(([cwd, sources]) => {
        const sessions = deduplicateSessions(sources.flatMap((source) => source.sessions))
          .filter((session) => {
            return this.sessionVisibleInCatalog(session) &&
              (location === 'all' || (location === 'remote' ? session.location === 'remote' : session.location !== 'remote'));
          }).sort(compareSessionsByActivity);
        const visibleLimit = this.workspaceVisibleLimits[cwd] ?? WORKSPACE_SESSION_PAGE_SIZE;
        const latestActivity = maxTimestamp(sessions.map((session) => session.updatedAt));
        return {
          key: getSessionWorkspaceKey(cwd),
          cwd,
          name: cwd ? getSessionWorkspaceName(cwd) : 'No workspace',
          path: cwd || 'No workspace path recorded',
          sessions: sessions.slice(0, visibleLimit),
          location: getWorkspaceLocation(sessions),
          remoteMachines: getWorkspaceRemoteMachines(sessions),
          latestActivity,
          initialized: sources.every((source) => source.initialized),
          loading: sources.some((source) => source.loading),
          hasMore: sessions.length > visibleLimit || sources.some((source) => source.nextCursor !== null),
          error: sources.find((source) => source.error)?.error ?? null,
          catalogGeneration: Math.max(
            0,
            ...sources.map((source) => this.workspaceSourceVersions.get(source.agentId) ?? 0)
          )
        };
      })
      .filter((group) => group.sessions.length > 0)
      .sort((a, b) => (b.latestActivity ?? '').localeCompare(a.latestActivity ?? ''));
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

  get meshNodeCount(): number {
    const distinctNodeIds = new Set<string>();
    for (const config of this.configs) {
      if (!config.enabled || !isOnlineConnectionState(this.connectionStates[config.id])) continue;
      for (const node of this.meshNodesByAgent[config.id]?.nodes ?? []) {
        distinctNodeIds.add(node.id);
      }
    }
    return distinctNodeIds.size;
  }

  canDeleteSession(agentId: string): boolean {
    return Boolean(this.clients.get(agentId)?.initializeResponse?.agentCapabilities?.sessionCapabilities?.delete);
  }

  canForkSession(agentId: string): boolean {
    return Boolean(this.clients.get(agentId)?.initializeResponse?.agentCapabilities?.sessionCapabilities?.fork);
  }

  canUseSessionUndo(agentId: string): boolean {
    const client = this.clients.get(agentId)?.client;
    return Boolean(
      client?.supportsQuerymtMethod(QMT_METHOD_SESSION_UNDO_STACK) &&
        client.supportsQuerymtMethod(QMT_METHOD_SESSION_UNDO) &&
        client.supportsQuerymtMethod(QMT_METHOD_SESSION_REDO)
    );
  }

  canConfigureDelegateModels(agentId: string): boolean {
    if (this.activeAgentId !== agentId) return false;
    const client = this.clients.get(agentId)?.client;
    const assignments = this.activeDelegateAssignments;
    return Boolean(
      client?.supportsQuerymtMethod(QMT_METHOD_SESSION_DELEGATE_MODELS) &&
        client.supportsQuerymtMethod(QMT_METHOD_SESSION_SET_DELEGATE_MODEL) &&
        (
          this.activeDelegateAssignmentsError !== null ||
          (assignments &&
            (assignments.assignments.length > 0 || assignments.orphaned_overrides.length > 0))
        )
    );
  }

  acknowledgeSession(agentId: string, sessionId: string) {
    const key = buildSessionKey(agentId, sessionId);
    this.attentionSessionKeys = this.attentionSessionKeys.filter((candidate) => candidate !== key);
  }

  private sessionListCoordinator(): SessionListCoordinator | null {
    if (!isEmbedded || this.pollingDisposed) return null;
    return this.sessionListSharing ??= new SessionListCoordinator({ onInvalidate: (source) => {
      for (const [agentId, current] of this.sharedListSources) if (current === source) {
        this.sharedListVersions.set(agentId, (this.sharedListVersions.get(agentId) ?? 0) + 1);
        this.pinVersions.set(agentId, (this.pinVersions.get(agentId) ?? 0) + 1);
        this.pinFlights.delete(agentId);
        delete this.pinnedSessionsLoading[agentId];
        this.invalidateSessionCatalogCache(false);
        this.sessionCatalogLoading = false;
        this.scheduleSessionRefresh(agentId);
      }
    } });
  }

  private sessionListSource(config: AgentConfig, record: AgentClientRecord): string {
    return JSON.stringify({ version: 1, origin: window.location.origin, agent: config.id,
      transport: config.transport, endpoint: config.websocketUrl, secure: config.websocketSecure ?? false,
      profile: this.composerProfileId, protocol: record.initializeResponse?.protocolVersion,
      agentInfo: record.initializeResponse?.agentInfo, agentCapabilities: record.initializeResponse?.agentCapabilities,
      capabilities: record.client.getControlCapabilities() });
  }

  private listSessionPage(config: AgentConfig, record: AgentClientRecord, request: ListSessionsRequest, fresh = false, maxAge = SESSION_SUMMARY_POLL_MS, onShared?: () => void): Promise<ListSessionsResponse> {
    const sharing = this.sessionListCoordinator();
    if (!sharing?.available) return record.client.listSessions(request);
    const source = this.sessionListSource(config, record);
    const previous = this.sharedListSources.get(config.id);
    if (previous && previous !== source) sharing.drop(previous);
    this.sharedListSources.set(config.id, source);
    const version = this.sharedListVersions.get(config.id) ?? 0;
    const isCurrent = () => !this.pollingDisposed && this.clients.get(config.id) === record &&
      this.sharedListSources.get(config.id) === source && this.sessionListSource(config, record) === source &&
      (this.sharedListVersions.get(config.id) ?? 0) === version;
    return sharing.read(source, JSON.stringify(request), () => record.client.listSessions(request), { fresh, maxAge, allowHidden: !this.pollingIsVisible() }).then((page) => {
      if (!isCurrent()) throw new SupersededSessionListError();
      if (sharing.isShared(page)) onShared?.();
      return page;
    }, (error) => {
      if (!isCurrent()) throw new SupersededSessionListError();
      throw error;
    });
  }

  private retrySupersededList(key: string, agentId: string, record: AgentClientRecord, run: () => Promise<unknown>) {
    if (this.pollingDisposed || this.clients.get(agentId) !== record || this.retryingSessionLists.has(key) ||
      this.supersededListRetries.has(key) || this.supersededListRetries.size >= 16 ||
      !this.configs.some((config) => config.id === agentId && config.enabled)) return;
    this.supersededListRetries.set(key, { agentId, record, run, timer: null });
    this.resumeSupersededListRetries();
  }

  private resumeSupersededListRetries() {
    if (!this.pollingIsVisible()) return;
    for (const [key, retry] of this.supersededListRetries) {
      if (retry.timer !== null) continue;
      retry.timer = setTimeout(() => {
        this.supersededListRetries.delete(key);
        if (!this.pollingIsVisible() || this.clients.get(retry.agentId) !== retry.record ||
          !this.configs.some((config) => config.id === retry.agentId && config.enabled)) return;
        // A retry canceled again waits for the next external action or routine fallback.
        this.retryingSessionLists.add(key);
        void retry.run().catch(() => null).finally(() => this.retryingSessionLists.delete(key));
      }, 150);
    }
  }

  private invalidateSharedSessionLists(agentId?: string) {
    if (!this.sessionListSharing) return;
    for (const [id, source] of this.sharedListSources) if (!agentId || id === agentId) {
      this.sharedListVersions.set(id, (this.sharedListVersions.get(id) ?? 0) + 1);
      this.sessionListSharing.invalidate(source);
    }
  }

  private pollingIsVisible(): boolean {
    return !this.pollingDisposed && (typeof document === 'undefined' || !document.hidden);
  }

  private sessionPollingAgents(): AgentConfig[] {
    // A list RPC error can mark an otherwise live initialized client as failed.
    return this.configs.filter((config) => config.enabled && this.statuses[config.id]?.state === 'running' &&
      this.initializedClientRecord(config.id));
  }

  startSessionPolling() {
    if (this.sessionPollingStarted || typeof document === 'undefined') return;
    this.pollingDisposed = false;
    this.sessionPollingStarted = true;
    this.pollingVisible = !document.hidden;
    const onVisibility = () => {
      const visible = this.pollingIsVisible();
      if (visible === this.pollingVisible) return;
      this.pollingVisible = visible;
      this.sessionListSharing?.visibilityChanged();
      if (!visible) {
        for (const retry of this.supersededListRetries.values()) {
          if (retry.timer !== null) clearTimeout(retry.timer);
          retry.timer = null;
        }
        for (const agentId of this.sessionRefreshTimers.keys()) this.clearScheduledSessionRefresh(agentId);
        for (const key of this.sessionRuntimeRefreshTimers.keys()) this.cancelSessionRuntimeRefresh(key);
        return;
      }
      this.resumeSupersededListRetries();
      for (const config of this.sessionPollingAgents()) void this.refreshRoutineSessions(config.id);
      this.resumeSelectedRuntime();
      void this.ensurePinnedSessions();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.unlistenPollingVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
    for (const config of this.sessionPollingAgents()) this.scheduleSessionRefresh(config.id);
  }

  setRuntimePollingEnabled(enabled: boolean) {
    if (this.runtimePollingEnabled === enabled) return;
    this.runtimePollingEnabled = enabled;
    if (!enabled) {
      for (const key of this.sessionRuntimeRefreshTimers.keys()) this.cancelSessionRuntimeRefresh(key);
    } else this.resumeSelectedRuntime();
  }

  private selectedRuntimeNeeded(): boolean {
    if (!this.activeAgentId || !this.activeSessionId) return false;
    const runtime = this.sessionRuntimeBySession[buildSessionKey(this.activeAgentId, this.activeSessionId)];
    return (runtime != null && runtime.phase !== 'idle') || PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState) ||
      this.activeSession.runState === 'submitting' || this.activePendingInputs.length > 0;
  }

  private resumeSelectedRuntime() {
    if (!this.runtimePollingEnabled || !this.pollingIsVisible() || !this.selectedRuntimeNeeded()) return;
    const agentId = this.activeAgentId!;
    const record = this.initializedClientRecord(agentId);
    if (record) void this.refreshSessionRuntime(agentId, this.activeSessionId, record.client).catch(() => null);
  }

  private async refreshRoutineSessions(agentId: string) {
    const existing = this.routineSessionRefreshes.get(agentId);
    if (existing) return existing;
    const record = this.initializedClientRecord(agentId);
    if (!this.sessionPollingStarted || !this.pollingIsVisible() || !record) return;
    // Join explicit/discovery work rather than queueing another list behind it.
    const promise = this.sessionListRefreshChain.get(agentId) ?? this.enqueueSessionListRefresh(agentId, async () => {
      if (this.sessionPollingStarted && this.pollingIsVisible() && this.clients.get(agentId) === record) {
        await this.refreshSessionsForAgentRequest(agentId, false, true);
      }
    });
    this.routineSessionRefreshes.set(agentId, promise);
    try { await promise; } catch {
      // List refresh paths expose their error state; routine catch-up must not reject globally.
    } finally {
      if (this.routineSessionRefreshes.get(agentId) === promise) {
        this.routineSessionRefreshes.delete(agentId);
        if (this.clients.get(agentId) === record) this.scheduleSessionRefresh(agentId);
      }
    }
  }

  dispose() {
    this.pollingDisposed = true;
    this.sessionListSharing?.dispose();
    this.sessionListSharing = null;
    for (const retry of this.supersededListRetries.values()) if (retry.timer !== null) clearTimeout(retry.timer);
    this.supersededListRetries.clear();
    this.retryingSessionLists.clear();
    this.sharedListSources.clear();
    this.sharedListVersions.clear();
    this.sessionPollingStarted = false;
    this.runtimePollingEnabled = false;
    this.unlistenPollingVisibility?.();
    this.unlistenPollingVisibility = null;
    this.routineSessionRefreshes.clear();
    this.sessionRuntimeRefreshPromises.clear();
    this.openSessionPages = {};
    this.sessionCatalogGeneration += 1;
    this.sessionCatalogFlight = null;
    this.sessionCatalogCache.flush();
    this.catalogWrites.clear();
    this.lifecycleReads.clear();
    for (const config of this.configs) this.clearSessionPins(config.id);
    this.sessionSelectionGeneration += 1;
    this.cancelPendingSessionNotifications();
    for (const agentId of [...this.sessionRefreshTimers.keys()]) {
      this.clearScheduledSessionRefresh(agentId);
    }
    for (const agentId of [...this.reconnectTimers.keys()]) {
      this.cancelReconnect(agentId);
    }
    for (const key of this.sessionRuntimeRefreshTimers.keys()) {
      this.cancelSessionRuntimeRefresh(key);
    }
  }

  async initialize() {
    this.startSessionPolling();
    if (isEmbedded && typeof window !== 'undefined') {
      this.configs = [createEmbeddedAgentConfig(window.location)];
    }
    this.loading = true;
    this.error = null;

    try {
      await this.ensureAgentLogSubscription();
      await Promise.allSettled(this.configs.map((config) => this.refreshAgent(config)));
      await Promise.allSettled(
        this.configs
          .filter((config) => config.enabled && config.autoStart)
          .map((config) => this.startConfiguredAgent(config.id))
      );

      const undiscoveredAgents = this.configs.filter(
        (config) => this.statuses[config.id]?.state === 'running' && !this.completedWorkspaceDiscoveries.has(config.id)
      );
      await Promise.allSettled([
        this.refreshManagedProfiles(),
        ...undiscoveredAgents.filter(() => this.pollingIsVisible()).map((config) => this.refreshSessionsForAgent(config.id, true, false)),
        this.preloadModelsForRunningAgents()
      ]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Failed to initialize configured agents.';
    } finally {
      this.loading = false;
    }
  }

  private async ensureAgentLogSubscription() {
    if (!platformCapabilities.nativeAgentLogs || this.unlistenAgentLogs || this.agentLogSubscriptionPending || typeof window === 'undefined') return;

    this.agentLogSubscriptionPending = true;
    try {
      this.unlistenAgentLogs = await listenAgentLogs<AgentLogEvent>((payload) => {
        const current = this.logsByAgent[payload.agentId] ?? [];
        const next = [...current, payload.entry].slice(-MAX_AGENT_LOG_ENTRIES);
        this.logsByAgent = { ...this.logsByAgent, [payload.agentId]: next };
      });
    } catch (error) {
      console.error('Failed to subscribe to agent logs', error);
    } finally {
      this.agentLogSubscriptionPending = false;
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
    this.promptFailure = null;
    this.error = null;
  }

  setActiveComposerInputDelivery(delivery: SessionInputDeliveryMode) {
    chatPreferencesStore.setInputDelivery(delivery);
    if (!this.activeAgentId || !this.activeSessionId) return;
    const key = buildSessionKey(this.activeAgentId, this.activeSessionId);
    this.composerInputDeliveryBySession = {
      ...this.composerInputDeliveryBySession,
      [key]: delivery
    };
  }

  clearError() {
    this.error = null;
  }

  dismissPromptFailure() {
    this.promptFailure = null;
    this.activeSession.lastError = null;
    if (this.activeSession.runState === 'failed') {
      this.activeSession.runState = 'idle';
      this.activeSession.activityLabel = null;
    }
  }

  setComposerProfile(profileId: string) {
    this.composerProfileId = profileId;
  }

  setComposerMode(modeId: string) {
    this.composerModeId = modeId;
  }

  setComposerReasoning(reasoningId: string) {
    this.composerReasoningId = reasoningId;
  }

  setComposerTarget(targetId: string) {
    if (this.composerTargetId !== targetId) {
      // A profile ID is scoped to its owner, even when two owners use the same name.
      this.composerProfileId = targetId === 'local' ? 'default' : 'querymt:owner-default';
    }
    this.composerTargetId = targetId;
  }

  setComposerAgent(agentId: string | null) {
    this.composerAgentId = agentId;
  }

    addPromptAttachments(attachments: PromptAttachment[]) {
    const existingIds = new Set(this.promptAttachments.map((attachment) => attachment.id));
    this.promptAttachments = [...this.promptAttachments, ...attachments.filter((attachment) => !existingIds.has(attachment.id))];
    this.error = null;
  }

    removePromptAttachment(attachmentId: string) {
    this.promptAttachments = this.promptAttachments.filter((attachment) => attachment.id !== attachmentId);
    this.error = null;
  }

  clearPromptAttachments() {
    this.promptAttachments = [];
  }

  async refreshManagedProfiles() {
    if (!platformCapabilities.nativeProfileTemplates) {
      const embeddedAgent = this.configs.find((config) => config.id === EMBEDDED_AGENT_ID);
      if (!embeddedAgent) {
        this.managedProfileOptions = [];
        return;
      }
      const record = await this.connectInitializedRecord(embeddedAgent.id);
      if (!record?.client.supportsQuerymtMethod(QMT_METHOD_PROFILES)) {
        this.managedProfileOptions = [];
        return;
      }
      const response = await record.client.listProfiles();
      this.managedProfileOptions = response.profiles.map((profile) => ({
        id: profile.id,
        label: profile.name,
        description: profile.description ?? null
      }));
      return;
    }
    const profiles = await listManagedProfiles();
    this.managedProfileOptions = profiles.map((profile) => ({
      id: profile.id,
      label: profile.name,
      description: profile.description ?? null
    }));
  }

  private clearRemoteProfilesForAgent(agentId: string) {
    this.remoteProfileOptions = Object.fromEntries(Object.entries(this.remoteProfileOptions).filter(([key]) => !key.startsWith(`${agentId}:`)));
    this.remoteProfileErrors = Object.fromEntries(Object.entries(this.remoteProfileErrors).filter(([key]) => !key.startsWith(`${agentId}:`)));
  }

  async refreshRemoteProfiles(agentId: string, nodeId: string) {
    if (nodeId === 'local') return;
    const isCurrentSource = this.sessionMutationScope(agentId);
    const key = buildSessionKey(agentId, nodeId);
    const version = (this.remoteProfileVersions.get(key) ?? 0) + 1;
    this.remoteProfileVersions.set(key, version);
    try {
      const record = await this.connectInitializedRecord(agentId);
      if (!record) throw new Error('Failed to connect to the agent.');
      const response = await record.client.listProfiles(nodeId);
      if (response.node_id !== nodeId) throw new Error('Agent did not confirm the requested profile owner. Update both agents.');
      if (!isCurrentSource() || this.remoteProfileVersions.get(key) !== version) return;
      this.remoteProfileOptions = { ...this.remoteProfileOptions, [key]: response.profiles.map((profile) => ({
        id: profile.id, label: profile.name, description: profile.description ?? null
      })) };
      this.remoteProfileErrors = { ...this.remoteProfileErrors, [key]: null };
    } catch (error) {
      if (!isCurrentSource() || this.remoteProfileVersions.get(key) !== version) return;
      this.remoteProfileOptions = { ...this.remoteProfileOptions, [key]: [] };
      this.remoteProfileErrors = { ...this.remoteProfileErrors, [key]: acpErrorMessage(error, 'Failed to load owner profiles.') };
    }
  }

  getLaunchProfileError(agentId: string | null): string | null {
    return agentId && this.composerTargetId !== 'local'
      ? this.remoteProfileErrors[buildSessionKey(agentId, this.composerTargetId)] ?? null : null;
  }

  getProfileOptions(agentId: string | null = this.composerAgentId ?? this.activeAgentId): ComposerOption[] {
    if (this.composerTargetId !== 'local') {
      return [{ id: 'querymt:owner-default', label: 'Owner default', description: 'Use the selected owner\'s active profile.' },
        ...(agentId ? this.remoteProfileOptions[buildSessionKey(agentId, this.composerTargetId)] ?? [] : [])];
    }
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
    const targets: ComposerOption[] = [isEmbedded
      ? { id: 'local', label: 'Local', description: 'Create the session on the serving qmtcode instance.' }
      : { id: 'local', label: 'Local', description: 'Create the session on this machine.' }];
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

    if (agentId === this.composerAgentId && this.composerTargetId !== 'local' &&
      !targets.some((target) => target.id === this.composerTargetId)) {
      const knownSession = this.sessionsByAgent[agentId]?.find((session) => session.remoteNodeId === this.composerTargetId);
      targets.push({
        id: this.composerTargetId,
        label: knownSession?.remoteNodeLabel || this.composerTargetId,
        description: 'Remote peer is currently unavailable.'
      });
    }

    return targets;
  }

  getLaunchModelId(agentId: string | null | undefined): string {
    if (!agentId) return '';
    return this.launchModelIds[agentId] ?? '';
  }

  setLaunchModel(agentId: string | null | undefined, modelId: string) {
    if (!agentId) return;
    this.launchModelIds = { ...this.launchModelIds, [agentId]: modelId };
  }

  getSessionModelId(agentId: string, sessionId: string): string {
    return this.sessionModelIds[buildSessionKey(agentId, sessionId)] ?? '';
  }

  /** Confirmed active mode for a session; empty when the agent has not reported one. */
  getSessionModeId(agentId: string, sessionId: string): string {
    const key = buildSessionKey(agentId, sessionId);
    return this.sessionModeIds[key] ?? getCurrentModeId(this.getSessionConfigOptions(agentId, sessionId)) ?? '';
  }

  async setSessionModel(agentId: string, sessionId: string, modelId: string) {
    if (this.isSelectedSession(agentId, sessionId)) this.error = null;
    try {
      await this.applySelectedModelToSession(agentId, sessionId, modelId);
      if (this.isSelectedSession(agentId, sessionId)) this.promptFailure = null;
    } catch (error) {
      if (this.isSelectedSession(agentId, sessionId)) {
        this.error = error instanceof Error ? error.message : 'Failed to change session model.';
      }
    }
  }

  /**
   * Desktop-initiated mode transition. Captures the outgoing mode's confirmed
   * preference, applies the target mode, and restores the target mode's saved
   * model and reasoning effort in a fixed order (mode → model → reasoning,
   * because model selection can change the reasoning choices an agent offers).
   * The whole sequence joins the session's config write queue, so rapid mode
   * changes and other config work serialize per session while other sessions
   * transition independently.
   */
  async setSessionMode(agentId: string, sessionId: string, targetModeId: string) {
    if (this.isSelectedSession(agentId, sessionId)) this.error = null;
    const key = buildSessionKey(agentId, sessionId);

    // Capture the outgoing confirmed preference before any write. While
    // another transition is in flight it owns preference persistence, so the
    // intermediate state here must not be recorded as an outgoing preference.
    const outgoing = this.captureConfirmedSessionState(agentId, sessionId);
    if (outgoing && outgoing.modeId !== targetModeId && !this.sessionModeTransitions.has(key)) {
      this.saveSessionModePreference(agentId, sessionId, outgoing.modeId, {
        modelId: outgoing.modelId || undefined,
        reasoningId: outgoing.reasoningId || undefined
      });
    }

    const previous = this.sessionConfigRequests.get(key);
    const request = (async (): Promise<SessionConfigWriteResult> => {
      if (previous) await previous.catch(() => undefined);
      // A newer transition for this session supersedes this request.
      if (this.sessionModeTransitions.has(key)) {
        return { configOptions: this.getSessionConfigOptions(agentId, sessionId) };
      }
      this.sessionModeTransitions.set(key, targetModeId);
      // Values this transition's writes got confirmed by the agent; on partial
      // failure only these are captured into the target preference, leaving
      // previously saved values intact for a later retry.
      let confirmedModelKey: string | undefined;
      let confirmedReasoningId: string | undefined;
      try {
        const modeOptionId =
          findModeConfigOption(this.getSessionConfigOptions(agentId, sessionId))?.id ?? CONFIG_MODE;
        const modeWrite = await this.updateSessionConfigOption(agentId, sessionId, modeOptionId, targetModeId, {
          transitionOwned: true
        });

        // Resolve against a loaded catalog: right after a refresh the model
        // list may still be loading, which would silently skip restoration.
        if ((this.modelsByAgent[agentId] ?? []).length === 0) {
          const record = await this.connectInitializedRecord(agentId);
          const ensured = record ? await record.client.listModels().catch(() => [] as ModelEntry[]) : [];
          if (ensured.length > 0 && (this.modelsByAgent[agentId] ?? []).length === 0) {
            this.modelsByAgent = { ...this.modelsByAgent, [agentId]: ensured };
          }
        }

        // Resolve the target model: exact saved selection, then the agent's
        // most recent available model, then the agent-confirmed mode value.
        const saved = this.getSessionModePreference(agentId, sessionId, targetModeId);
        const models = this.modelsByAgent[agentId] ?? [];
        const savedModel = saved?.modelId ? findModelBySelectionKey(models, saved.modelId) : undefined;
        const recentModel = savedModel
          ? undefined
          : (this.recentModelsByAgent[agentId] ?? [])
              .map((selectionKey) => findModelBySelectionKey(models, selectionKey))
              .find((model): model is ModelEntry => Boolean(model));
        const resolvedModel = savedModel ?? recentModel;
        // Only skip the restore write when the mode response itself confirmed
        // the resolved model. A response without model metadata confirms
        // nothing — the agent may have switched to its own mode default
        // silently — so the previously displayed selection must not suppress
        // restoration.
        const confirmedByModeResponse = modeWrite.confirmedModelKey;
        if (
          resolvedModel &&
          getModelSelectionKey(resolvedModel) !== confirmedByModeResponse &&
          resolvedModel.id !== confirmedByModeResponse
        ) {
          await this.applySelectedModelToSession(agentId, sessionId, getModelSelectionKey(resolvedModel), true);
          confirmedModelKey = getModelSelectionKey(resolvedModel);
        }

        // Reasoning resolves after the model response, against the refreshed
        // choices; a saved reasoning effort the agent no longer offers keeps
        // the agent-confirmed value instead.
        const reasoningOption = findReasoningConfigOption(this.getSessionConfigOptions(agentId, sessionId));
        const choices = getConfigOptionChoices(reasoningOption);
        const savedReasoning = saved?.reasoningId;
        const validSavedReasoning =
          savedReasoning && choices.some((choice) => choice.value === savedReasoning) ? savedReasoning : undefined;
        const confirmedAfterModel = this.captureConfirmedSessionState(agentId, sessionId);
        if (validSavedReasoning && reasoningOption && validSavedReasoning !== confirmedAfterModel?.reasoningId) {
          await this.updateSessionConfigOption(agentId, sessionId, reasoningOption.id, validSavedReasoning, {
            transitionOwned: true
          });
          confirmedReasoningId = validSavedReasoning;
        }

        // Persist the final confirmed target preference once restoration
        // settles. Values confirmed by this transition's writes take
        // precedence (a resolving write without returned metadata is still a
        // confirmation), falling back to the merged confirmed state.
        const final = this.captureConfirmedSessionState(agentId, sessionId);
        if (final) {
          this.saveSessionModePreference(agentId, sessionId, targetModeId, {
            modelId: confirmedModelKey ?? (final.modelId || undefined),
            reasoningId: confirmedReasoningId ?? (final.reasoningId || undefined)
          });
        }
        return { configOptions: this.getSessionConfigOptions(agentId, sessionId) };
      } catch (error) {
        // Partial failure: report it and capture only the values this
        // transition actually got confirmed — never the rejected request and
        // never stale state from before the switch.
        const confirmed = this.captureConfirmedSessionState(agentId, sessionId);
        if (confirmed?.modeId === targetModeId && (confirmedModelKey !== undefined || confirmedReasoningId !== undefined)) {
          this.saveSessionModePreference(agentId, sessionId, targetModeId, {
            modelId: confirmedModelKey,
            reasoningId: confirmedReasoningId
          });
        }
        throw error;
      } finally {
        if (this.sessionModeTransitions.get(key) === targetModeId) this.sessionModeTransitions.delete(key);
      }
    })();

    this.sessionConfigRequests.set(key, request);
    try {
      await request;
      if (this.isSelectedSession(agentId, sessionId)) this.promptFailure = null;
    } catch (error) {
      if (this.isSelectedSession(agentId, sessionId)) {
        this.error = error instanceof Error ? error.message : 'Failed to change session mode.';
      }
    } finally {
      if (this.sessionConfigRequests.get(key) === request) this.sessionConfigRequests.delete(key);
    }
  }

  requestPromptFocus() {
    this.promptFocusToken += 1;
  }

  saveConfig(input: AgentConfig) {
    if (isEmbedded) return;
    const existingIndex = this.configs.findIndex((config) => config.id === input.id);
    if (existingIndex === -1) {
      this.configs = [input, ...this.configs];
    } else {
      const lifecycle = { resolution: 'any', archive: 'any' } as const;
      if (sessionCatalogKey([this.configs[existingIndex]], [], lifecycle) !== sessionCatalogKey([input], [], lifecycle)) {
        this.sessionMutationScopes.delete(input.id);
      }
      this.configs = this.configs.map((config) => (config.id === input.id ? input : config));
    }

    persistAgents(this.configs);
  }

  updateConfig(agentId: string, updates: Partial<Omit<AgentConfig, 'id'>>) {
    if (isEmbedded && agentId === EMBEDDED_AGENT_ID) return;
    const current = this.configs.find((config) => config.id === agentId);
    const explicitWebSocketScheme = updates.websocketUrl?.match(/^(wss?):\/\//i)?.[1]?.toLowerCase();
    const normalizedUpdates = updates.websocketUrl
      ? {
          ...updates,
          websocketUrl: normalizeAcpWebSocketEndpoint(updates.websocketUrl),
          websocketSecure: updates.websocketSecure
            ?? (explicitWebSocketScheme ? explicitWebSocketScheme === 'wss' : current?.websocketSecure ?? false)
        }
      : updates;
    // Resume authorities are issued by a specific agent endpoint; drop them
    // when that endpoint changes so its secrets are never offered elsewhere.
    const endpointChanged =
      current !== undefined &&
      ((updates.transport !== undefined && updates.transport !== current.transport) ||
        (normalizedUpdates.websocketUrl !== undefined &&
          normalizedUpdates.websocketUrl !== current.websocketUrl) ||
        (updates.commandLine !== undefined && updates.commandLine !== current.commandLine) ||
        (normalizedUpdates.websocketSecure !== undefined && normalizedUpdates.websocketSecure !== (current.websocketSecure ?? false)));
    if (endpointChanged || normalizedUpdates.enabled === false) this.clearSessionPins(agentId);
    if (endpointChanged) {
      this.clearRemoteProfilesForAgent(agentId);
      this.sessionMutationScopes.delete(agentId);
      this.forgetRecentSessions(agentId);
      this.knownSessionParents = Object.fromEntries(Object.entries(this.knownSessionParents)
        .filter(([key]) => !key.startsWith(`${agentId}:`)));
      this.invalidateSessionCatalogCache();
      clearElicitationResumeAuthoritiesForAgent(agentId);
    }
    if (current?.transport === 'websocket' && (normalizedUpdates.transport || normalizedUpdates.websocketUrl !== undefined || normalizedUpdates.enabled === false)) {
      this.cancelReconnect(agentId);
      this.invalidateConnectGeneration(agentId);
      this.disposeClient(agentId);
      this.clearMeshStateForAgent(agentId);
    }
    this.configs = this.configs.map((config) =>
      config.id === agentId
        ? {
            ...config,
            ...normalizedUpdates
          }
        : config
    );
    persistAgents(this.configs);
  }

  async deleteConfig(agentId: string) {
    if (isEmbedded && agentId === EMBEDDED_AGENT_ID) return;
    this.clearRemoteProfilesForAgent(agentId);
    this.sessionMutationScopes.delete(agentId);
    this.invalidateSessionCatalogCache();
    this.invalidateConnectGeneration(agentId);
    await this.stopConfiguredAgent(agentId);
    this.clearSessionPins(agentId);
    this.configs = this.configs.filter((config) => config.id !== agentId);
    this.forgetRecentSessions(agentId);
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
    this.clearDelegateAssignmentsForAgent(agentId);
    delete this.lastScheduleActionByAgent[agentId];
    delete this.lastCreatedScheduleByAgent[agentId];
    delete this.lastMeshInviteByAgent[agentId];
    delete this.lastMeshRevokeByAgent[agentId];
    delete this.pluginUpdateStatusByAgent[agentId];
    delete this.lastPluginUpdateByAgent[agentId];
    delete this.lastRemoteAttachByAgent[agentId];
    delete this.lastRemoteDismissByAgent[agentId];
    delete this.sessionsByAgent[agentId];
    this.knownSessionParents = Object.fromEntries(Object.entries(this.knownSessionParents)
      .filter(([key]) => !key.startsWith(`${agentId}:`)));
    this.completedWorkspaceDiscoveries.delete(agentId);
    this.invalidateWorkspaceSources(agentId);
    delete this.workspaceSessionSources[agentId];
    delete this.logsByAgent[agentId];
    this.disposeClient(agentId);
    persistAgents(this.configs);
  }

  createConfig(name: string, transport: AgentConfig['transport'], endpoint: string): AgentConfig {
    if (isEmbedded) {
      throw new Error('Embedded qmtcode manages its agent connection.');
    }
    return {
      id: slugify(`${name}-${Date.now()}`),
      name,
      transport,
      commandLine: transport === 'stdio' ? endpoint : '',
      websocketUrl: transport === 'websocket' ? normalizeAcpWebSocketEndpoint(endpoint) : undefined,
      websocketSecure: transport === 'websocket' ? usesSecureWebSocket(endpoint) : undefined,
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

    const generation = this.connectGeneration(agentId);
    this.error = null;
    try {
      if (config.transport === 'websocket') {
        await this.connectAgent(config.id);
        if (this.connectGeneration(agentId) !== generation) return;
        await this.refreshAgent(config);
      } else {
        const status = await startAgent(config);
        this.statuses = { ...this.statuses, [config.id]: status };
        await this.connectAgent(config.id);
      }
      if (this.connectGeneration(agentId) !== generation) return;
      await Promise.allSettled([
        this.pollingIsVisible() || !this.loading ? this.refreshSessionsForAgent(config.id, true, !this.loading) : Promise.resolve(),
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

    this.invalidateConnectGeneration(agentId);
    this.cancelReconnect(agentId);
    this.reconnectAttempts.delete(agentId);
    try {
      if (config.transport === 'websocket') {
        this.disposeClient(agentId);
        this.statuses = { ...this.statuses, [config.id]: websocketStatus(config, 'idle') };
      } else {
        const status = await stopAgent(agentId);
        this.statuses = { ...this.statuses, [config.id]: status };
        // Stopping the sidecar kills the child without any loss callback on
        // the stdio transport; drop the client so the next start connects
        // fresh instead of reusing a zombie (mirrors the websocket branch).
        this.disposeClient(agentId);
      }
      this.sessionsByAgent = { ...this.sessionsByAgent, [config.id]: [] };
      this.completedWorkspaceDiscoveries.delete(config.id);
      this.invalidateWorkspaceSources(config.id);
      this.workspaceSessionSources = { ...this.workspaceSessionSources, [config.id]: {} };
      this.connectionStates = { ...this.connectionStates, [config.id]: 'idle' };
      this.clearMeshStateForAgent(config.id);
      if (this.activeAgentId === config.id) {
        this.activeAgentId = null;
        this.activeSessionId = null;
        this.activeSession = createEmptyActiveSession();
      }
      this.clearDelegateAssignmentsForAgent(config.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to disconnect ${config.name}.`;
    }
  }

    async restartConfiguredAgent(agentId: string) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;

    const generation = this.connectGeneration(agentId);
    this.cancelReconnect(agentId);
    this.reconnectAttempts.delete(agentId);
    this.completedWorkspaceDiscoveries.delete(agentId);
    try {
      if (config.transport === 'websocket') {
        this.disposeClient(agentId);
        this.clearMeshStateForAgent(agentId);
        await this.connectAgent(config.id, true);
        if (this.connectGeneration(agentId) !== generation) return;
        await this.refreshAgent(config);
      } else {
        const status = await restartAgent(config);
        this.statuses = { ...this.statuses, [config.id]: status };
        this.clearMeshStateForAgent(agentId);
        await this.connectAgent(config.id, true);
      }
      if (this.connectGeneration(agentId) !== generation) return;
      await Promise.allSettled([
        this.pollingIsVisible() || !this.loading ? this.refreshSessionsForAgent(config.id, true, !this.loading) : Promise.resolve(),
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
    const generation = this.connectGeneration(agentId);
    while (true) {
      if (this.connectGeneration(agentId) !== generation) {
        return;
      }

      const config = this.configs.find((candidate) => candidate.id === agentId);
      if (!config) {
        return;
      }

      const inFlight = this.connectFlights.get(agentId);
      if (inFlight) {
        // Overlapping startup (webview reload) must not dispose a handshake
        // that is still current, even when the other caller passed force.
        await inFlight.promise;
        if (this.connectGeneration(agentId) !== generation) {
          return;
        }
        const joined = this.clients.get(agentId);
        if (joined?.initializeResponse) {
          return;
        }
        continue;
      }

      const existing = this.clients.get(agentId);
      if (!force && existing?.initializeResponse) {
        return;
      }

      const record = this.ensureClientRecord(agentId, force);
      let abortConnect: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        abortConnect = () => reject(CONNECT_ABORTED);
      });
      aborted.catch(() => undefined);

      const connectPromise = this.connectAgentUnlocked(agentId, config, record, aborted);
      const flight: ConnectFlight = {
        owner: record,
        promise: connectPromise,
        abort: abortConnect
      };
      this.connectFlights.set(agentId, flight);
      try {
        await connectPromise;
      } finally {
        if (this.connectFlights.get(agentId) === flight) {
          this.connectFlights.delete(agentId);
        }
      }
      if (this.connectGeneration(agentId) !== generation) {
        return;
      }
      if (this.clients.get(agentId) === record) {
        return;
      }
    }
  }

  /** Catalog mutations survive reconnects, but not endpoint changes or removal/recreation. */
  private sessionMutationScope(agentId: string): () => boolean {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const lifecycle = { resolution: 'any', archive: 'any' } as const;
    const source = config ? sessionCatalogKey([config], [], lifecycle) : null;
    let token = this.sessionMutationScopes.get(agentId);
    if (!token) this.sessionMutationScopes.set(agentId, token = Symbol());
    return () => !this.pollingDisposed && this.sessionMutationScopes.get(agentId) === token &&
      this.configs.some((candidate) => candidate.id === agentId && sessionCatalogKey([candidate], [], lifecycle) === source);
  }

  /** A reconnect cannot turn server-confirmed creation into failure; reconcile its metadata instead. */
  private canPublishCreatedSession(agentId: string, record: AgentClientRecord, isCurrentSource: () => boolean): boolean {
    if (!isCurrentSource()) return false;
    if (this.clients.get(agentId) === record) return true;
    this.invalidateSessionCatalogCache();
    return false;
  }

  private initializedClientRecord(agentId: string): AgentClientRecord | undefined {
    const record = this.clients.get(agentId);
    return record?.initializeResponse ? record : undefined;
  }

  private async connectInitializedRecord(agentId: string): Promise<AgentClientRecord | undefined> {
    if (!this.initializedClientRecord(agentId)) {
      await this.connectAgent(agentId);
    }
    return this.initializedClientRecord(agentId);
  }

  private async connectAgentUnlocked(
    agentId: string,
    config: AgentConfig,
    record: AgentClientRecord,
    aborted: Promise<never>
  ) {
    record.connectionState = 'connecting';
    record.error = null;

    try {
      if (!record.unsubscribeInbox) {
        record.unsubscribeInbox = inboxStore.bindClient(record.client, config.id, config.name);
      }
      const handshake = record.client.connect();
      void handshake.catch(() => undefined);
      record.initializeResponse = await Promise.race([handshake, aborted]);
      if (this.clients.get(agentId) !== record) {
        return;
      }
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
      this.scheduleSessionRefresh(config.id);
      void this.refreshMeshAvailability(config.id);
      void this.loadInitialModelsForAgent(config.id, 6);
      if (this.activeAgentId === config.id && this.activeSessionId) {
        void this.refreshDelegateAssignments(config.id, this.activeSessionId);
        if (this.runtimePollingEnabled && this.pollingIsVisible() && record.client.supportsQuerymtMethod(QMT_METHOD_SESSION_RUNTIME_STATE)) {
          void this.refreshSessionRuntime(config.id, this.activeSessionId, record.client).catch(() => null);
        }
      }
      void this.recoverPendingElicitations(config, record);
    } catch (error) {
      if (error === CONNECT_ABORTED || this.clients.get(agentId) !== record) {
        return;
      }
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

  /**
   * After (re)connect, recover pending questions with held resume authorities.
   *
   * Re-delivered requests rebind in the inbox; authoritative snapshots clean up
   * stale cards. Recovery never starts a run and never fabricates user answers;
   * failures are non-fatal and leave offline cards for the next reconnect.
   */
  private async recoverPendingElicitations(config: AgentConfig, record: AgentClientRecord) {
    try {
      if (!record.client.supportsElicitationRecovery()) {
        return;
      }
      const snapshots = await record.client.recoverPendingElicitations();
      if (this.clients.get(config.id) !== record) {
        return;
      }
      for (const snapshot of snapshots) {
        inboxStore.reconcileReboundElicitations(config.id, snapshot.sessionId, snapshot.elicitationIds);
      }
    } catch {
      // Best-effort recovery: offline cards stay pending for the next reconnect.
    }
  }

  async refreshAllSessions() {
    this.workspaceVisibleLimits = {};
    // Mesh/settings changes must retire the old catalog even when Sessions is unmounted.
    this.selectSessionCatalog(this.sessionCatalogContext(this.sessionBrowser));
    await Promise.allSettled(
      this.configs
        .filter((config) => this.statuses[config.id]?.state === 'running')
        .map((config) => this.refreshSessionsForAgent(config.id, true))
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
    if (!this.initializedClientRecord(agentId)) {
      await this.connectAgent(agentId);
    }
    const record = this.initializedClientRecord(agentId);
    if (!record) {
      return;
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

  canPinSession(session: DesktopSessionSummary): boolean {
    void this.controlCapabilitiesByAgent[session.agentId];
    return this.configs.some((config) => config.id === session.agentId && config.enabled) &&
      isRootSession(session) && session.location !== 'remote' &&
      isOnlineConnectionState(this.connectionStates[session.agentId]) &&
      (this.clients.get(session.agentId)?.client.supportsSessionPins() ?? false);
  }

  private clearSessionPins(agentId: string) {
    this.pinVersions.set(agentId, (this.pinVersions.get(agentId) ?? 0) + 1);
    this.pinFlights.delete(agentId);
    for (const key of this.pinWrites.keys()) {
      if (key.startsWith(`${agentId}:`)) this.pinWrites.delete(key);
    }
    this.sessionPinPending = Object.fromEntries(Object.entries(this.sessionPinPending).filter(([key]) => !key.startsWith(`${agentId}:`)));
    this.sessionPinErrors = Object.fromEntries(Object.entries(this.sessionPinErrors).filter(([key]) => !key.startsWith(`${agentId}:`)));
    delete this.pinnedSessionsByAgent[agentId];
    delete this.pinnedSessionsLoading[agentId];
    delete this.pinnedSessionsErrors[agentId];
    this.sessionPins = Object.fromEntries(Object.entries(this.sessionPins).filter(([key]) => !key.startsWith(`${agentId}:`)));
  }

  private applySessionPin(agentId: string, pin: SessionPin) {
    this.applySessionPins(agentId, [pin]);
  }

  private applySessionPins(agentId: string, pins: SessionPin[]) {
    const updates = Object.fromEntries(pins.map((pin) => [buildSessionKey(agentId, pin.session_id), pin]));
    this.sessionPins = { ...this.sessionPins, ...updates };
    const update = (session: DesktopSessionSummary) => updates[getSessionKey(session)] ? { ...session, pin: updates[getSessionKey(session)] } : session;
    this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: (this.sessionsByAgent[agentId] ?? []).map(update) };
    this.sessionCatalog = this.sessionCatalog.map(update);
    this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent, [agentId]: (this.pinnedSessionsByAgent[agentId] ?? []).map(update) };
    for (const source of Object.values(this.workspaceSessionSources[agentId] ?? {})) {
      this.setWorkspaceSource({ ...source, sessions: source.sessions.map(update) });
    }
    this.sessionCatalogCache.update((entry) => {
      if (!entry.sessions.some((session) => updates[getSessionKey(session)])) return entry;
      const sessions = entry.sessions.map(update).filter((session) => !entry.scope?.pinned || session.pin?.pinned);
      return { ...entry, sessions };
    });
  }

  private reconcileSessionPins(agentId: string, sessions: DesktopSessionSummary[]) {
    const keys = new Set(sessions.map(getSessionKey));
    const known = new Map([
      ...(this.pinnedSessionsByAgent[agentId] ?? []), ...(this.sessionsByAgent[agentId] ?? []),
      ...this.sessionCatalog, ...Object.values(this.workspaceSessionSources[agentId] ?? {}).flatMap((source) => source.sessions)
    ].filter((session) => session.agentId === agentId && session.location !== 'remote' && isRootSession(session))
      .map((session) => [getSessionKey(session), session]));
    const removed = [...known.values()].filter((session) => !keys.has(getSessionKey(session)))
      .map((session): SessionPin => ({ session_id: session.sessionId, pinned: false, pinned_at: null }));
    this.applySessionPins(agentId, [...removed, ...sessions.map((session) => session.pin!)]);
    const current = this.sessionsByAgent[agentId] ?? [];
    const currentKeys = new Set(current.map(getSessionKey));
    this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: mergeSessions(current, sessions.filter((session) => !currentKeys.has(getSessionKey(session)))) };
    this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent, [agentId]: sessions };
  }

  async setSessionPinned(session: DesktopSessionSummary, pinned: boolean) {
    const { agentId, sessionId } = session;
    const key = getSessionKey(session);
    if (!this.canPinSession(session)) throw new Error('Pins are only available for root sessions owned by a directly connected supporting agent.');
    if (this.sessionPinPending[key]) return;
    const record = this.clients.get(agentId)!;
    const write = Symbol();
    this.pinWrites.set(key, write);
    const isCurrent = () => this.clients.get(agentId) === record && this.pinWrites.get(key) === write;
    this.sessionPinPending = { ...this.sessionPinPending, [key]: true };
    this.sessionPinErrors = { ...this.sessionPinErrors, [key]: null };
    this.invalidateSharedSessionLists(agentId);
    this.pinVersions.set(agentId, (this.pinVersions.get(agentId) ?? 0) + 1);
    try {
      const response = await record.client.setSessionPinned(sessionId, pinned);
      if (!isCurrent()) return;
      const pin = response?.session_id === sessionId ? readSessionPin({ pin: response }, sessionId) : null;
      if (!pin || pin.pinned !== pinned) throw new Error('Agent returned invalid session pin state.');
      this.invalidateSharedSessionLists(agentId);
      this.applySessionPin(agentId, pin);
      this.patchSessionCatalog(agentId, sessionId, { ...(this.findSessionSummary(agentId, sessionId) ?? session), pin });
      if (pinned) this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent,
        [agentId]: mergeSessions(this.pinnedSessionsByAgent[agentId] ?? [], [{ ...session, pin }]) };
      return pin;
    } catch (error) {
      if (isCurrent()) this.sessionPinErrors = { ...this.sessionPinErrors, [key]: acpErrorMessage(error, 'Could not update session pin.') };
      throw error;
    } finally {
      if (isCurrent()) {
        this.pinWrites.delete(key);
        this.sessionPinPending = { ...this.sessionPinPending, [key]: false };
        void this.ensurePinnedSessions(true, agentId);
      }
    }
  }

  async ensurePinnedSessions(force = false, agentId?: string) {
    if (this.pollingDisposed || (!force && !this.pollingIsVisible())) return;
    await Promise.all(this.connectedAgents.filter((config) => (!agentId || config.id === agentId) && this.clients.get(config.id)?.client.supportsSessionPins())
      .map((config) => this.readPinnedSessions(config, force)));
  }

  private async readPinnedSessions(config: AgentConfig, force: boolean) {
    const agentId = config.id;
    const record = this.initializedClientRecord(agentId);
    if (!record) return;
    if (force) this.pinVersions.set(agentId, (this.pinVersions.get(agentId) ?? 0) + 1);
    const version = this.pinVersions.get(agentId) ?? 0;
    const existing = this.pinFlights.get(agentId);
    if (existing?.version === version) return existing.promise;
    const source = sessionCatalogKey([config], [], { resolution: 'any', archive: 'any' });
    const cacheKey = `pins:${source}${isEmbedded ? this.sessionListSource(config, record) : ''}`;
    const cached = force ? undefined : this.sessionCatalogCache.get(cacheKey);
    if (cached) {
      this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent, [agentId]: cached.sessions };
      if (isCatalogFresh(cached)) {
        this.reconcileSessionPins(agentId, cached.sessions);
        return;
      }
    }
    const isCurrent = () => this.clients.get(agentId) === record && (this.pinVersions.get(agentId) ?? 0) === version &&
      this.configs.some((candidate) => candidate.enabled && candidate.id === agentId &&
        sessionCatalogKey([candidate], [], { resolution: 'any', archive: 'any' }) === source);
    const lifecycleRevision = this.sessionLifecycleRevision;
    const writeRevision = this.catalogWriteRevision;
    const promise = (async () => {
      this.pinnedSessionsLoading = { ...this.pinnedSessionsLoading, [agentId]: true };
      this.pinnedSessionsErrors = { ...this.pinnedSessionsErrors, [agentId]: null };
      try {
        let sessions: DesktopSessionSummary[] = [];
        let shared = false;
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          // Pin queries intentionally never include mesh peers or browser lifecycle filters.
          const page = await this.listSessionPage(config, record, buildListSessionsRequest({ cursor, pinned: true }), force, 5 * 60_000, () => { shared = true; });
          if (!isCurrent()) return;
          const listed = mapAcpSessionsToDesktopSessions(page.sessions, { agentId, agentName: config.name })
            .map((session) => this.withKnownSessionParent(session));
          if (listed.some((session) => isRootSession(session) && session.location !== 'remote' && !session.pin?.pinned)) {
            throw new Error('Agent did not return authoritative pinned-session metadata.');
          }
          const incoming = listed.filter((session) => isRootSession(session) && session.location !== 'remote' && session.pin?.pinned);
          sessions = mergeSessions(sessions, incoming);
          cursor = page.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw new Error('Agent returned a repeated pin cursor.');
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (!isCurrent()) return;
        sessions = this.preserveCatalogWrites(this.preserveNewerLifecycleWrites(sessions, lifecycleRevision), writeRevision, agentId)
          .filter((session) => session.pin?.pinned);
        this.reconcileSessionPins(agentId, sessions);
        this.sessionCatalogCache.set({ key: cacheKey, sessions, complete: true, checkedAt: Date.now(), hasSessions: sessions.length > 0,
          scope: { agentIds: [agentId], remoteNodeIds: [], lifecycle: { resolution: 'any', archive: 'any' }, pinned: true } }, !shared);
        this.sessionCatalogCache.flush();
      } catch (error) {
        if (error instanceof SupersededSessionListError) {
          this.retrySupersededList(`pins:${agentId}`, agentId, record, () => this.pinFlights.get(agentId)?.promise ?? this.ensurePinnedSessions(true, agentId));
          return;
        }
        if (isCurrent()) this.pinnedSessionsErrors = { ...this.pinnedSessionsErrors, [agentId]: `${config.name}: ${acpErrorMessage(error, 'Pinned sessions could not be loaded.')}` };
      } finally {
        if (isCurrent()) this.pinnedSessionsLoading = { ...this.pinnedSessionsLoading, [agentId]: false };
      }
    })();
    const flight = { version, promise };
    this.pinFlights.set(agentId, flight);
    try { await promise; } finally { if (this.pinFlights.get(agentId) === flight) this.pinFlights.delete(agentId); }
  }

  canSetSessionLifecycle(agentId: string): boolean {
    // Read reactive connection/capability state before consulting the client record.
    const online = isOnlineConnectionState(this.connectionStates[agentId]);
    void this.controlCapabilitiesByAgent[agentId];
    return online && (this.clients.get(agentId)?.client.supportsSessionLifecycle() ?? false);
  }

  private applySessionLifecycle(agentId: string, lifecycle: SessionLifecycle | null, sessionId: string) {
    const key = buildSessionKey(agentId, sessionId);
    this.sessionLifecycles = { ...this.sessionLifecycles, [key]: lifecycle };
    const update = (session: DesktopSessionSummary) => session.agentId === agentId && session.sessionId === sessionId
      ? { ...session, lifecycle } : session;
    this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: (this.sessionsByAgent[agentId] ?? []).map(update) };
    this.sessionCatalog = this.sessionCatalog.map(update);
    this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent, [agentId]: (this.pinnedSessionsByAgent[agentId] ?? []).map(update) };
    for (const source of Object.values(this.workspaceSessionSources[agentId] ?? {})) {
      this.setWorkspaceSource({ ...source, sessions: source.sessions.map(update) });
    }
  }

  async refreshSessionLifecycle(agentId: string, sessionId: string) {
    if (!this.canSetSessionLifecycle(agentId)) return;
    const key = buildSessionKey(agentId, sessionId);
    const revision = this.sessionLifecycleRevision;
    const record = this.clients.get(agentId)!;
    const read = Symbol();
    this.lifecycleReads.set(key, read);
    const isCurrent = () => this.lifecycleReads.get(key) === read && this.clients.get(agentId) === record &&
      revision === this.sessionLifecycleRevision;
    try {
      const lifecycle = await record.client.getSessionLifecycle(sessionId);
      if (isCurrent()) {
        this.applySessionLifecycle(agentId, lifecycle, sessionId);
        this.sessionLifecycleErrors = { ...this.sessionLifecycleErrors, [key]: null };
      }
    } catch (error) {
      // A failed read does not invalidate the last authoritative lifecycle.
      if (isCurrent()) {
        this.sessionLifecycleErrors = { ...this.sessionLifecycleErrors, [key]: acpErrorMessage(error, 'Could not refresh session lifecycle.') };
      }
    } finally {
      if (this.lifecycleReads.get(key) === read) this.lifecycleReads.delete(key);
    }
  }

  async setSessionLifecycle(agentId: string, sessionId: string, patch: SessionLifecyclePatch) {
    const key = buildSessionKey(agentId, sessionId);
    if (this.sessionLifecyclePending[key]) throw new Error('A lifecycle change is already in progress.');
    if (!this.canSetSessionLifecycle(agentId)) throw new Error('Session lifecycle is unavailable for this agent.');
    this.sessionLifecyclePending = { ...this.sessionLifecyclePending, [key]: true };
    this.sessionLifecycleErrors = { ...this.sessionLifecycleErrors, [key]: null };
    this.invalidateSharedSessionLists(agentId);
    try {
      const record = this.clients.get(agentId)!;
      const lifecycle = await record.client.setSessionLifecycle(sessionId, patch);
      if (this.pollingDisposed || this.clients.get(agentId) !== record) return lifecycle;
      this.sessionLifecycleRevision += 1;
      this.lifecycleWriteVersions.set(key, this.sessionLifecycleRevision);
      delete this.openSessionPages[agentId];
      this.invalidateSharedSessionLists(agentId);
      const summary = this.findSessionSummary(agentId, sessionId);
      this.applySessionLifecycle(agentId, lifecycle, sessionId);
      if (summary) this.patchSessionCatalog(agentId, sessionId, { ...summary, lifecycle });
      else this.sessionCatalogCache.update((entry) => !entry.scope || entry.scope.agentIds.includes(agentId) ? { ...entry, complete: false } : entry);
      return lifecycle;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update session lifecycle.';
      this.sessionLifecycleErrors = { ...this.sessionLifecycleErrors, [key]: message };
      throw error;
    } finally {
      this.sessionLifecyclePending = { ...this.sessionLifecyclePending, [key]: false };
    }
  }

  private findSessionSummary(agentId: string, sessionId: string): DesktopSessionSummary | undefined {
    return (this.sessionsByAgent[agentId] ?? []).find((session) => session.sessionId === sessionId) ??
      this.sessionCatalog.find((session) => session.agentId === agentId && session.sessionId === sessionId) ??
      (this.pinnedSessionsByAgent[agentId] ?? []).find((session) => session.sessionId === sessionId);
  }

  private patchSessionCatalog(agentId: string, sessionId: string, summary: DesktopSessionSummary | null) {
    this.catalogWrites.set(buildSessionKey(agentId, sessionId), { revision: ++this.catalogWriteRevision, session: summary });
    const patch = (sessions: DesktopSessionSummary[], scope: CachedSessionCatalog['scope']) => {
      const existing = sessions.find((session) => session.agentId === agentId && session.sessionId === sessionId);
      const included = summary && (scope ? scope.agentIds.includes(agentId) && isRootSession(summary) &&
        (summary.location !== 'remote' || scope.remoteNodeIds.includes(summary.remoteNodeId ?? '')) &&
        sessionMatchesLifecycle(summary.lifecycle, scope.lifecycle) &&
        (!scope.pinned || (summary.location !== 'remote' && summary.pin?.pinned)) : !!existing);
      if (!existing && !included) return sessions;
      const retained = sessions.filter((session) => session.agentId !== agentId || session.sessionId !== sessionId);
      return included ? mergeSessions(retained, [summary]) : retained;
    };
    let scope = this.selectedCatalogScope;
    if (!scope) {
      const context = this.sessionCatalogContext(this.sessionBrowser);
      scope = { agentIds: context.supportedConfigs.map((config) => config.id), remoteNodeIds: context.remoteNodeIds, lifecycle: context.lifecycle };
    }
    this.sessionCatalog = patch(this.sessionCatalog, scope);
    if (summary && this.sessionVisibleInCatalog(summary) && isRootSession(summary)) this.sessionCatalogHasSessions = true;
    else if (!this.sessionCatalog.length) this.sessionCatalogHasSessions = null;
    this.sessionCatalogCache.update((entry) => {
      const sessions = patch(entry.sessions, entry.scope);
      if (sessions === entry.sessions && entry.scope) return entry;
      return { ...entry, sessions, complete: entry.complete && !!entry.scope,
        hasSessions: sessions.length ? true : entry.scope?.pinned ? false : null };
    });
  }

  /** Overlay only writes confirmed after a read began; old pages cannot undo local mutations. */
  private preserveCatalogWrites(sessions: DesktopSessionSummary[], revision: number, agentId: string, includeNew = false) {
    const writes = [...this.catalogWrites].filter(([key, write]) => key.startsWith(`${agentId}:`) && write.revision > revision);
    if (!writes.length) return sessions;
    const byId = new Map(sessions.map((session) => [session.sessionId, session]));
    for (const [key, write] of writes) {
      const sessionId = key.slice(agentId.length + 1);
      if (!write.session) byId.delete(sessionId);
      else if (includeNew || byId.has(sessionId)) byId.set(sessionId, write.session);
    }
    return [...byId.values()].sort(compareSessionsByActivity);
  }

  private preserveNewerLifecycleWrites(sessions: DesktopSessionSummary[], revision: number): DesktopSessionSummary[] {
    return sessions.map((session) => {
      const key = getSessionKey(session);
      return (this.lifecycleWriteVersions.get(key) ?? 0) > revision
        ? { ...session, lifecycle: this.sessionLifecycles[key] } : session;
    });
  }

  private sessionCatalogContext(filter: SessionLifecycleFilter) {
    const lifecycle = { resolution: filter.resolution, archive: filter.archive };
    const configs = this.connectedAgents.slice();
    chatPreferencesStore.initialize();
    const remoteNodeIds = chatPreferencesStore.showRemoteSessions ? chatPreferencesStore.remoteSessionPeers.slice() : [];
    const signature = JSON.stringify([
      sessionCatalogKey(configs, remoteNodeIds, lifecycle),
      configs.map((config) => [config.id, this.clients.get(config.id)?.client.supportsSessionLifecycle() ?? false]).sort(),
      ...(isEmbedded ? [configs.map((config) => this.sessionListSource(config, this.clients.get(config.id)!))] : [])
    ]);
    const filtered = lifecycle.resolution !== 'any' || lifecycle.archive !== 'any';
    const excludedAgents = configs.filter((config) => filtered && !this.clients.get(config.id)?.client.supportsSessionLifecycle())
      .map(({ id, name }) => ({ id, name }));
    const excludedIds = new Set(excludedAgents.map((agent) => agent.id));
    const supportedConfigs = configs.filter((config) => !excludedIds.has(config.id));
    return { lifecycle, configs, supportedConfigs, excludedAgents, remoteNodeIds, signature };
  }

  private selectSessionCatalog({ signature, supportedConfigs, excludedAgents, remoteNodeIds, lifecycle }: ReturnType<AgentsStore['sessionCatalogContext']>) {
    this.selectedCatalogScope = { agentIds: supportedConfigs.map((config) => config.id), remoteNodeIds, lifecycle };
    this.sessionCatalogExcludedAgents = excludedAgents;
    this.sessionCatalogSupportedAgentCount = supportedConfigs.length;
    if (this.sessionCatalogSignature === signature) return;
    this.sessionCatalogGeneration += 1;
    this.sessionCatalogFlight = null;
    this.sessionCatalogSignature = signature;
    const cached = this.sessionCatalogCache.get(signature);
    this.sessionCatalog = cached?.sessions.slice() ?? [];
    for (const agentId of new Set(this.sessionCatalog.map((session) => session.agentId))) {
      const summaries = this.sessionCatalog.filter((session) => session.agentId === agentId);
      this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: mergeSessions(summaries, this.sessionsByAgent[agentId] ?? []) };
    }
    this.sessionCatalogHasSessions = cached?.hasSessions ?? null;
    this.sessionCatalogError = null;
    this.sessionCatalogLoading = false;
    this.sessionCatalogLoadedCount = 0;
  }

  private invalidateSessionCatalogCache(broadcast = true) {
    if (broadcast) this.invalidateSharedSessionLists();
    this.openSessionPages = {};
    this.sessionCatalogGeneration += 1;
    this.sessionCatalogFlight = null;
    this.sessionCatalogLoading = false;
    this.sessionCatalogCache.clear(broadcast);
  }

  async ensureSessionCatalog(filter: SessionLifecycleFilter = this.sessionBrowser) {
    const context = this.sessionCatalogContext(filter);
    const { signature } = context;
    this.selectSessionCatalog(context);
    if (this.sessionCatalogFlight?.key === signature) return this.sessionCatalogFlight.promise;
    const cached = this.sessionCatalogCache.get(signature);
    if (cached && isCatalogFresh(cached)) return;
    return this.refreshSessionCatalog(filter, false);
  }

  /** Explicit refresh reconciles the selected scope; ordinary navigation reuses fresh snapshots. */
  async refreshSessionCatalog(filter: SessionLifecycleFilter = this.sessionBrowser, fresh = true) {
    const context = this.sessionCatalogContext(filter);
    this.selectSessionCatalog(context);
    if (this.sessionCatalogFlight?.key === context.signature) return this.sessionCatalogFlight.promise;
    const promise = this.readSessionCatalog(context, fresh);
    const flight = { key: context.signature, promise };
    this.sessionCatalogFlight = flight;
    try {
      await promise;
    } finally {
      if (this.sessionCatalogFlight === flight) this.sessionCatalogFlight = null;
    }
  }

  /** Keep catalog membership separate from runtime, Inbox and scheduling caches. */
  private async readSessionCatalog({ lifecycle, configs: allConfigs, supportedConfigs: configs, remoteNodeIds, signature }: ReturnType<AgentsStore['sessionCatalogContext']>, fresh: boolean) {
    const generation = ++this.sessionCatalogGeneration;
    const writeRevision = this.catalogWriteRevision;
    let shared = false;
    let superseded = false;
    const retry = (config: AgentConfig, record: AgentClientRecord | undefined) => {
      superseded = true;
      if (record) this.retrySupersededList('catalog', config.id, record, () => this.refreshSessionCatalog());
    };
    const remember = (complete: boolean) => {
      if (generation !== this.sessionCatalogGeneration || !allConfigs.length) return;
      this.sessionCatalogCache.set({
        key: signature, sessions: this.sessionCatalog, complete,
        checkedAt: complete ? Date.now() : 0, hasSessions: this.sessionCatalogHasSessions,
        scope: { agentIds: configs.map((config) => config.id), remoteNodeIds, lifecycle }
      }, !this.sessionListSharing?.available || (complete && !shared));
    };
    this.sessionCatalogLoading = true;
    this.sessionCatalogLoadedCount = 0;
    this.sessionCatalogError = null;
    this.sessionCatalogHasSessions = configs.some((config) => (this.sessionsByAgent[config.id] ?? [])
      .some((session) => !session.parentSessionId && this.sessionVisibleInCatalog(session))) ? true : null;
    const filtered = lifecycle.resolution !== 'any' || lifecycle.archive !== 'any';
    const errors = new Map<string, string>();
    const records = new Map(configs.map((config) => [config.id, this.initializedClientRecord(config.id)]));
    await Promise.all(configs.map(async (config) => {
      try {
        const record = this.initializedClientRecord(config.id);
        if (!record) throw new Error('Agent disconnected.');
        let sessions: DesktopSessionSummary[] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = await this.listSessionPage(config, record, buildListSessionsRequest({
            cursor, remoteNodeIds, lifecycle: filtered ? lifecycle : undefined
          }), fresh, 5 * 60_000, () => { shared = true; });
          if (generation !== this.sessionCatalogGeneration) return;
          const incoming = this.preserveCatalogWrites(this.mapSessionSummaries(page.sessions, { agentId: config.id, agentName: config.name }), writeRevision, config.id)
            .filter((session) => sessionMatchesLifecycle(session.lifecycle, lifecycle));
          const previousCount = sessions.length;
          sessions = mergeSessions(sessions, incoming);
          this.sessionCatalogLoadedCount += sessions.length - previousCount;
          this.sessionCatalog = mergeSessions(this.sessionCatalog, incoming);
          if (incoming.length) this.sessionCatalogHasSessions = true;
          remember(false);
          this.sessionsByAgent = { ...this.sessionsByAgent, [config.id]: mergeSessions(this.sessionsByAgent[config.id] ?? [], incoming) };
          cursor = page.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw new Error('Agent returned a repeated session cursor.');
          if (cursor) seen.add(cursor);
        } while (cursor);
        // Remove stale cached rows only after this agent's entire refresh succeeds.
        sessions = this.preserveCatalogWrites(sessions, writeRevision, config.id, true)
          .filter((session) => sessionMatchesLifecycle(session.lifecycle, lifecycle));
        this.sessionCatalog = mergeSessions(this.sessionCatalog.filter((session) => session.agentId !== config.id), sessions);
        remember(false);
      } catch (error) {
        if (error instanceof SupersededSessionListError) { retry(config, records.get(config.id) ?? undefined); return; }
        if (generation !== this.sessionCatalogGeneration) return;
        errors.set(config.id, `${config.name}: ${acpErrorMessage(error, 'Sessions could not be loaded.')}`);
        this.sessionCatalogError = [...errors.values()].join(' ');
      }
    }));
    if (generation !== this.sessionCatalogGeneration) return;
    if (!errors.size && !superseded && configs.length) {
      if (!filtered) {
        this.sessionCatalogHasSessions = this.sessionCatalog.length > 0;
      } else if (this.sessionCatalogHasSessions === null) {
        // An empty lifecycle category does not establish that the whole catalog is empty.
        const existence = await Promise.all(configs.map(async (config): Promise<boolean | null> => {
          try {
            const record = this.initializedClientRecord(config.id);
            if (!record) return null;
            const seen = new Set<string>();
            let cursor: string | undefined;
            do {
              const page = await this.listSessionPage(config, record, buildListSessionsRequest({ cursor, remoteNodeIds }), fresh, 5 * 60_000, () => { shared = true; });
              if (generation !== this.sessionCatalogGeneration) return null;
              if (page.sessions.length) return true;
              cursor = page.nextCursor ?? undefined;
              if (cursor && seen.has(cursor)) return null;
              if (cursor) seen.add(cursor);
            } while (cursor);
            return false;
          } catch (error) {
            if (error instanceof SupersededSessionListError) retry(config, records.get(config.id) ?? undefined);
            return null;
          }
        }));
        if (generation !== this.sessionCatalogGeneration) return;
        this.sessionCatalogHasSessions = existence.includes(true) ? true : existence.every((value) => value === false) ? false : null;
      }
    }
    this.sessionCatalogLoading = false;
    remember(!errors.size && !superseded);
    this.sessionCatalogCache.flush();
  }

  private enqueueSessionListRefresh(agentId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.sessionListRefreshChain.get(agentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.sessionListRefreshChain.set(agentId, next);
    return next.finally(() => {
      if (this.sessionListRefreshChain.get(agentId) === next) {
        this.sessionListRefreshChain.delete(agentId);
      }
    });
  }

  async refreshSessionsForAgent(agentId: string, discoverAll = false, fresh = true) {
    if (discoverAll) {
      const config = this.configs.find((candidate) => candidate.id === agentId);
      if (!config) return;
      const scopeKey = this.openSessionListScope(config).key;
      const existingDiscovery = this.workspaceDiscoveryPromises.get(agentId);
      if (existingDiscovery?.scopeKey === scopeKey) {
        await existingDiscovery.promise;
        return;
      }

      const discovery = this.enqueueSessionListRefresh(agentId, async () => {
        if (this.openSessionListScope(config).key !== scopeKey) return;
        await this.refreshSessionsForAgentRequest(agentId, true, !fresh);
      }).finally(() => {
        if (this.workspaceDiscoveryPromises.get(agentId)?.promise === discovery) {
          this.workspaceDiscoveryPromises.delete(agentId);
        }
      });
      this.workspaceDiscoveryPromises.set(agentId, { scopeKey, promise: discovery });
      await discovery;
      return;
    }

    // The queue already waits for prior discoveries; the map may point to one queued after us.
    return this.enqueueSessionListRefresh(agentId, () => this.refreshSessionsForAgentRequest(agentId, false, !fresh));
  }

  private async refreshSessionsForAgentRequest(agentId: string, discoverAll: boolean, cooperative = false) {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      return;
    }

    let record = this.initializedClientRecord(agentId);
    if (!record) {
      await this.connectAgent(agentId);
      record = this.initializedClientRecord(agentId);
    }
    if (!record) {
      return;
    }

    record.connectionState = 'loading-sessions';
    record.error = null;
    const scope = this.openSessionListScope(config);
    const isCurrent = () => !this.pollingDisposed && this.clients.get(agentId) === record && this.openSessionListScope(config).key === scope.key;

    try {
      const lifecycleRevision = this.sessionLifecycleRevision;
      const writeRevision = this.catalogWriteRevision;
      const firstPage = await this.listSessionPage(config, record, buildListSessionsRequest({ remoteNodeIds: scope.remoteNodeIds }), !cooperative);
      if (!isCurrent()) return;
      const pages = discoverAll ? await this.collectSessionPages(config, record, firstPage, scope.remoteNodeIds, isCurrent, !cooperative) : [firstPage];
      if (!isCurrent()) return;
      const listedSessions = pages.flatMap((page) => page.sessions);
      const previousSessions = this.sessionsByAgent[agentId] ?? [];
      const nextSessions = this.preserveCatalogWrites(this.preserveNewerLifecycleWrites(this.mapSessionSummaries(listedSessions, {
        agentId: config.id,
        agentName: config.name
      }), lifecycleRevision), writeRevision, agentId, discoverAll);
      const mergedSessions = discoverAll ? nextSessions : mergeSessions(previousSessions, nextSessions);
      this.updateSessionAttention(agentId, previousSessions, mergedSessions);
      this.sessionsByAgent = {
        ...this.sessionsByAgent,
        [agentId]: mergedSessions
      };
      const openPage = this.openSessionPages[agentId];
      if (this.openSessionListScope(config).key === scope.key && this.clients.get(agentId) === record &&
        (discoverAll || !openPage || openPage.scopeKey !== scope.key)) {
        const nextCursor = discoverAll ? null : firstPage.nextCursor ?? null;
        this.openSessionPages[agentId] = {
          scopeKey: scope.key, nextCursor, initialized: true, loading: false, error: null,
          seenCursors: nextCursor ? [nextCursor] : []
        };
      }
      this.updateWorkspaceDiscovery(config, nextSessions, discoverAll);
      if (discoverAll) this.completedWorkspaceDiscoveries.add(agentId);
      this.scheduleSessionRefresh(agentId);
      const models = await record.client.listModels().catch(() => this.modelsByAgent[agentId] ?? []);
      if (!isCurrent()) return;
      if (models.length > 0) {
        this.modelsByAgent = {
          ...this.modelsByAgent,
          [agentId]: models
        };
        this.selectLaunchModelForAgent(agentId, models);
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
      if (error instanceof SupersededSessionListError) {
        if (isCurrent()) {
          record.connectionState = 'initialized';
          this.connectionStates = { ...this.connectionStates, [agentId]: 'initialized' };
          this.retrySupersededList(`summary:${agentId}`, agentId, record, () => this.sessionListRefreshChain.get(agentId) ?? this.refreshSessionsForAgent(agentId, discoverAll));
        }
        return;
      }
      if (!isCurrent()) return;
      if (discoverAll) this.completedWorkspaceDiscoveries.delete(agentId);
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
    } finally {
      if (!isCurrent() && record.connectionState === 'loading-sessions') record.connectionState = 'initialized';
    }
  }

  async loadWorkspaceSessions(cwd: string) {
    const target = this.workspaceVisibleLimits[cwd] ?? WORKSPACE_SESSION_PAGE_SIZE;
    while (true) {
      const group = this.workspaceSessionGroups.find((candidate) => candidate.cwd === cwd);
      const sources = this.getWorkspaceSources(cwd);
      if (sources.length === 0) return;
      const candidates = sources.filter((source) => !source.initialized || source.nextCursor !== null);
      if (candidates.length === 0) return;
      const initializedEnough =
        Boolean(group) &&
        group!.sessions.length >= target &&
        sources.every((source) => source.initialized);
      if (initializedEnough) return;
      const loaded = await Promise.all(candidates.map((source) => this.loadWorkspaceSourcePage(source)));
      if (loaded.includes(false)) return;
    }
  }

  /** Include remote peers only when the catalog preference explicitly enables them. */
  private openSessionListScope(config: AgentConfig) {
    chatPreferencesStore.initialize();
    const remoteNodeIds = chatPreferencesStore.showRemoteSessions ? chatPreferencesStore.remoteSessionPeers.slice() : [];
    return { remoteNodeIds, key: sessionCatalogKey([config], remoteNodeIds, { resolution: 'any', archive: 'any' }) };
  }

  get hasMoreOpenSessions(): boolean {
    return this.connectedAgents.some((config) => {
      if (!this.canSetSessionLifecycle(config.id)) return false;
      const page = this.openSessionPages[config.id];
      return !page || page.scopeKey !== this.openSessionListScope(config).key || !page.initialized || page.nextCursor !== null;
    });
  }

  get openSessionsLoading(): boolean {
    return this.connectedAgents.some((config) => {
      const page = this.openSessionPages[config.id];
      return page?.scopeKey === this.openSessionListScope(config).key && page.loading;
    });
  }

  get openSessionsLoadError(): string | null {
    return this.connectedAgents.flatMap((config) => {
      const page = this.openSessionPages[config.id];
      return page?.scopeKey === this.openSessionListScope(config).key && page.error ? [`${config.name}: ${page.error}`] : [];
    }).join(' ') || null;
  }

  /** Continue the existing root list only as the sidebar exhausts its loaded rows. */
  async loadMoreOpenSessions() {
    if (!this.pollingIsVisible()) return;
    await Promise.all(this.connectedAgents.map(async (config) => {
      if (!this.canSetSessionLifecycle(config.id)) return;
      const record = this.initializedClientRecord(config.id);
      if (!record) return;
      const scope = this.openSessionListScope(config);
      if (this.openSessionPages[config.id]?.scopeKey !== scope.key) {
        this.openSessionPages[config.id] = {
          scopeKey: scope.key, nextCursor: null, initialized: false, loading: false, error: null, seenCursors: []
        };
      }
      const page = this.openSessionPages[config.id];
      if (page.loading || (page.initialized && page.nextCursor === null)) return;
      page.loading = true;
      page.error = null;
      const revision = this.sessionLifecycleRevision;
      const cursor = page.nextCursor;
      try {
        const response = await this.listSessionPage(config, record, buildListSessionsRequest({ cursor, remoteNodeIds: scope.remoteNodeIds }));
        if (this.openSessionPages[config.id] !== page || this.clients.get(config.id) !== record ||
          this.openSessionListScope(config).key !== scope.key) return;
        const nextCursor = response.nextCursor ?? null;
        if (nextCursor && (nextCursor === cursor || page.seenCursors.includes(nextCursor))) {
          throw new Error('Agent returned a repeated session cursor.');
        }
        const sessions = this.preserveNewerLifecycleWrites(this.mapSessionSummaries(response.sessions, {
          agentId: config.id, agentName: config.name
        }), revision);
        this.sessionsByAgent = { ...this.sessionsByAgent, [config.id]: mergeSessions(this.sessionsByAgent[config.id] ?? [], sessions) };
        page.initialized = true;
        page.nextCursor = nextCursor;
        if (nextCursor) page.seenCursors.push(nextCursor);
      } catch (error) {
        if (error instanceof SupersededSessionListError) {
          this.retrySupersededList(`open:${config.id}`, config.id, record, () => this.loadMoreOpenSessions());
          return;
        }
        if (this.openSessionPages[config.id] === page) page.error = acpErrorMessage(error, 'Could not load more sessions.');
      } finally {
        page.loading = false;
      }
    }));
  }

  private buildSessionListRequest(input: { cwd?: string | null; cursor?: string | null } = {}) {
    chatPreferencesStore.initialize();
    const remoteNodeIds = chatPreferencesStore.showRemoteSessions ? chatPreferencesStore.remoteSessionPeers : [];
    return buildListSessionsRequest({ ...input, remoteNodeIds });
  }

  /** Seed a missing local summary only after the backend has accepted its load. */
  private ensureSessionLoadTarget(agentId: string, sessionId: string): DesktopSessionSummary | null {
    const existing = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    if (existing) return existing;

    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return null;

    const knownSessions = this.sessionsByAgent[agentId] ?? [];
    const cwd =
      this.composerCwd.trim() ||
      (this.activeAgentId === agentId
        ? getSessionById(knownSessions, this.activeSessionId ?? '')?.cwd ?? ''
        : '') ||
      knownSessions[0]?.cwd ||
      '';
    const fallback: DesktopSessionSummary = {
      agentId,
      agentName: config.name,
      sessionId,
      title: 'Session',
      cwd,
      updatedAt: null,
      runtimeId: agentId,
      runtimeName: config.name,
      source: 'acp',
      location: 'local',
      relationshipKnown: false,
      status: 'idle'
    };
    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: mergeSessions(knownSessions, [fallback])
    };
    return fallback;
  }

  /** Search selected peers until this load finds its owner or loses selection. */
  private async findRemoteNodeForMissingSession(agentId: string, sessionId: string, client: DesktopAcpClient, isCurrentLoad: () => boolean): Promise<string | null> {
    chatPreferencesStore.initialize();
    const selectedPeers = chatPreferencesStore.showRemoteSessions ? chatPreferencesStore.remoteSessionPeers : [];
    if (selectedPeers.length === 0) return null;

    for (const nodeId of selectedPeers) {
      if (this.remoteSessionsByAgent[agentId]?.[nodeId]?.sessions.some((session) => session.id === sessionId)) {
        return nodeId;
      }
    }

    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return null;

    // Root-only catalog discovery cannot rule out a delegate or fork. Search
    // all session kinds only for this missing ID, stopping at its first match.
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      if (!isCurrentLoad()) return null;
      const request = this.buildSessionListRequest({ cursor });
      request._meta = { ...request._meta, session_scope: 'all' };
      const page = await this.listSessionPage(config, this.clients.get(agentId)!, request);
      if (!isCurrentLoad()) return null;
      const match = page.sessions.find((session) => session.sessionId === sessionId &&
        session._meta?.location === 'remote' && typeof session._meta.nodeId === 'string' &&
        selectedPeers.includes(session._meta.nodeId));
      if (match) {
        const summary = this.mapSessionSummaries([match], { agentId, agentName: config.name })[0];
        this.sessionsByAgent = {
          ...this.sessionsByAgent,
          [agentId]: mergeSessions(this.sessionsByAgent[agentId] ?? [], [summary])
        };
        this.upsertWorkspaceSessions(agentId, [summary]);
        return summary.remoteNodeId ?? null;
      }
      cursor = page.nextCursor ?? null;
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return null;
  }

  /** Replace load metadata and move a corrected summary to its current workspace. */
  private syncLoadedSessionSummary(agentId: string, summary: DesktopSessionSummary) {
    const previous = getSessionById(this.sessionsByAgent[agentId] ?? [], summary.sessionId);
    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: mergeSessions(this.sessionsByAgent[agentId] ?? [], [summary])
    };
    if (previous && previous.cwd !== summary.cwd) {
      const source = this.workspaceSessionSources[agentId]?.[previous.cwd];
      if (source) {
        const sessions = source.sessions.filter((session) => session.sessionId !== summary.sessionId);
        this.workspaceSessionSources = {
          ...this.workspaceSessionSources,
          [agentId]: {
            ...this.workspaceSessionSources[agentId],
            [previous.cwd]: { ...source, sessions, latestActivity: maxTimestamp(sessions.map((session) => session.updatedAt)) }
          }
        };
      }
    }
    this.upsertWorkspaceSessions(agentId, [summary]);
  }

  private hydrateLoadedSessionSummary(agentId: string, sessionId: string, replay: SessionNotification[]) {
    const current = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    if (!current) return;

    let title = current.title;
    let replayUpdatedAt: string | null = null;
    for (const notification of replay) {
      if (notification.sessionId !== sessionId) continue;
      const update = notification.update;
      if (update.sessionUpdate !== 'session_info_update') continue;
      if (typeof update.title === 'string' && update.title.trim()) title = update.title.trim();
      if (update.updatedAt !== undefined) {
        replayUpdatedAt = newestTimestamp(replayUpdatedAt, update.updatedAt);
      }
    }

    const inferred = inferSessionSummaryFromActiveSession(this.activeSession);
    if (!title || title === 'Session') title = inferred.title ?? title;
    // Never let a replayed info update roll the summary's activity backwards.
    const nextUpdatedAt = newestTimestamp(current.updatedAt, replayUpdatedAt) ?? inferred.updatedAt;
    if (title === current.title && nextUpdatedAt === current.updatedAt) return;

    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: (this.sessionsByAgent[agentId] ?? []).map((session) =>
        session.sessionId === sessionId ? { ...session, title, updatedAt: nextUpdatedAt } : session
      )
    };
  }

  async loadMoreWorkspaceSessions(cwd: string) {
    const currentLimit = this.workspaceVisibleLimits[cwd] ?? WORKSPACE_SESSION_PAGE_SIZE;
    const nextLimit = currentLimit + WORKSPACE_SESSION_PAGE_SIZE;
    this.workspaceVisibleLimits = { ...this.workspaceVisibleLimits, [cwd]: nextLimit };
    try {
      await this.loadWorkspaceSessions(cwd);
    } catch (error) {
      this.workspaceVisibleLimits = { ...this.workspaceVisibleLimits, [cwd]: currentLimit };
      throw error;
    }
  }

  private async collectSessionPages(
    config: AgentConfig, record: AgentClientRecord, firstPage: ListSessionsResponse, remoteNodeIds: string[], isCurrent: () => boolean, fresh: boolean
  ): Promise<ListSessionsResponse[]> {
    const pages = [firstPage];
    const seenCursors = new Set<string>();
    let nextCursor = firstPage.nextCursor ?? null;

    // TODO(backend): QueryMT session/list cursors are integer offsets
    // (`"10"`, `"100"`), not opaque keyset tokens. Inserting a newly created
    // session at the top of `ORDER BY updated_at DESC` makes later pages
    // skip/duplicate. Desktop currently only uses these cursors for discovery
    // and "load more"; replace with a stable keyset/id cursor in
    // crates/agent session list before relying on them across creates.
    while (nextCursor && !seenCursors.has(nextCursor) && isCurrent()) {
      seenCursors.add(nextCursor);
      const page = await this.listSessionPage(config, record, buildListSessionsRequest({ cursor: nextCursor, remoteNodeIds }), fresh);
      pages.push(page);
      nextCursor = page.nextCursor ?? null;
    }

    return pages;
  }

  private updateWorkspaceDiscovery(config: AgentConfig, sessions: DesktopSessionSummary[], replace: boolean) {
    if (replace) this.invalidateWorkspaceSources(config.id);
    const currentSources = this.workspaceSessionSources[config.id] ?? {};
    const discovered = new Map<string, DesktopSessionSummary[]>();
    for (const session of sessions) {
      const workspaceSessions = discovered.get(session.cwd) ?? [];
      workspaceSessions.push(session);
      discovered.set(session.cwd, workspaceSessions);
    }

    const nextSources: Record<string, WorkspaceSessionSource> = replace ? {} : { ...currentSources };
    for (const [cwd, workspaceSessions] of discovered) {
      const current = currentSources[cwd];
      const latestActivity = maxTimestamp([
        current?.latestActivity ?? null,
        ...workspaceSessions.map((session) => session.updatedAt)
      ]);
      nextSources[cwd] = {
        agentId: config.id,
        agentName: config.name,
        cwd,
        sessions: mergeSessions(current?.sessions ?? [], workspaceSessions),
        latestActivity,
        nextCursor: current && !replace ? current.nextCursor : null,
        initialized: current && !replace ? current.initialized : !cwd,
        loading: false,
        error: null
      };
    }

    this.workspaceSessionSources = {
      ...this.workspaceSessionSources,
      [config.id]: nextSources
    };
  }

  private upsertWorkspaceSessions(agentId: string, sessions: DesktopSessionSummary[]) {
    if (sessions.length === 0) return;
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) return;

    const currentSources = { ...(this.workspaceSessionSources[agentId] ?? {}) };
    const grouped = new Map<string, DesktopSessionSummary[]>();
    for (const session of sessions) {
      const workspaceSessions = grouped.get(session.cwd) ?? [];
      workspaceSessions.push(session);
      grouped.set(session.cwd, workspaceSessions);
    }

    for (const [cwd, workspaceSessions] of grouped) {
      const current = currentSources[cwd];
      currentSources[cwd] = {
        agentId,
        agentName: config.name,
        cwd,
        sessions: mergeSessions(current?.sessions ?? [], workspaceSessions),
        latestActivity: maxTimestamp([
          current?.latestActivity ?? null,
          ...workspaceSessions.map((session) => session.updatedAt)
        ]),
        nextCursor: current?.nextCursor ?? null,
        initialized: current?.initialized ?? !cwd,
        loading: current?.loading ?? false,
        error: current?.error ?? null
      };
    }

    this.workspaceSessionSources = {
      ...this.workspaceSessionSources,
      [agentId]: currentSources
    };
  }

  private getWorkspaceSources(cwd: string): WorkspaceSessionSource[] {
    return Object.values(this.workspaceSessionSources).flatMap((sources) => (sources[cwd] ? [sources[cwd]] : []));
  }

  private async loadWorkspaceSourcePage(source: WorkspaceSessionSource) {
    let current = this.workspaceSessionSources[source.agentId]?.[source.cwd];
    if (!current || current.loading || (current.initialized && current.nextCursor === null)) {
      return;
    }

    this.updateWorkspaceSource(source.agentId, source.cwd, { loading: true, error: null });
    const sourceVersion = this.workspaceSourceVersions.get(source.agentId) ?? 0;
    const sourceKey = buildWorkspaceSourceKey(source.agentId, source.cwd);
    const seenCursors = this.seenWorkspaceCursors.get(sourceKey) ?? new Set<string>();
    this.seenWorkspaceCursors.set(sourceKey, seenCursors);
    let requestCursor: string | null | undefined;
    let record: AgentClientRecord | undefined;
    try {
      const config = this.configs.find((candidate) => candidate.id === source.agentId);
      if (!config) throw new Error(`Unable to locate ${source.agentName} for workspace sessions.`);
      record = await this.connectInitializedRecord(source.agentId);
      if (!record) {
        throw new Error(`Unable to connect ${source.agentName} for workspace sessions.`);
      }
      current = this.workspaceSessionSources[source.agentId]?.[source.cwd];

      requestCursor = current?.initialized ? current.nextCursor : null;
      // TODO(backend): these cwd cursors are QueryMT integer offsets. A create
      // that lands at the top of the workspace list makes "load more" skip or
      // duplicate until session/list uses a stable keyset cursor.
      if (requestCursor && seenCursors.has(requestCursor)) {
        throw new Error(`${source.agentName} returned a repeated session cursor.`);
      }
      if (requestCursor) seenCursors.add(requestCursor);
      const lifecycleRevision = this.sessionLifecycleRevision;
      const writeRevision = this.catalogWriteRevision;
      const response = await this.listSessionPage(config, record,
        this.buildSessionListRequest({
          cwd: source.cwd,
          cursor: requestCursor
        })
      );
      if ((this.workspaceSourceVersions.get(source.agentId) ?? 0) !== sourceVersion) return;
      current = this.workspaceSessionSources[source.agentId]?.[source.cwd];
      if (!current) return;
      const pageSessions = this.preserveCatalogWrites(this.preserveNewerLifecycleWrites(this.mapSessionSummaries(response.sessions, {
        agentId: config.id,
        agentName: config.name
      }), lifecycleRevision), writeRevision, source.agentId);
      current = {
        ...current,
        sessions: mergeSessions(current.sessions, pageSessions),
        latestActivity: maxTimestamp([current.latestActivity, ...pageSessions.map((session) => session.updatedAt)]),
        nextCursor: response.nextCursor ?? null,
        initialized: true,
        loading: true,
        error: null
      };
      this.setWorkspaceSource(current);

      if (current) {
        this.sessionsByAgent = {
          ...this.sessionsByAgent,
          [source.agentId]: mergeSessions(this.sessionsByAgent[source.agentId] ?? [], current.sessions)
        };
      }
    } catch (error) {
      if (error instanceof SupersededSessionListError) {
        if (requestCursor) seenCursors.delete(requestCursor);
        if (record) this.retrySupersededList(`workspace:${sourceKey}`, source.agentId, record, () => this.loadWorkspaceSourcePage(source));
        return false;
      }
      if ((this.workspaceSourceVersions.get(source.agentId) ?? 0) === sourceVersion) {
        const message = error instanceof Error ? error.message : `Failed to load sessions for ${source.agentName}.`;
        this.updateWorkspaceSource(source.agentId, source.cwd, { error: message });
        throw error instanceof Error ? error : new Error(message);
      }
    } finally {
      if ((this.workspaceSourceVersions.get(source.agentId) ?? 0) === sourceVersion) {
        this.updateWorkspaceSource(source.agentId, source.cwd, { loading: false });
      }
    }
  }

  private invalidateWorkspaceSources(agentId: string) {
    this.workspaceSourceVersions.set(agentId, (this.workspaceSourceVersions.get(agentId) ?? 0) + 1);
    const prefix = `${agentId}\u0000`;
    for (const key of this.seenWorkspaceCursors.keys()) {
      if (key.startsWith(prefix)) this.seenWorkspaceCursors.delete(key);
    }
  }

  private updateWorkspaceSource(agentId: string, cwd: string, updates: Partial<WorkspaceSessionSource>) {
    const current = this.workspaceSessionSources[agentId]?.[cwd];
    if (!current) return;
    this.setWorkspaceSource({ ...current, ...updates });
  }

  private setWorkspaceSource(source: WorkspaceSessionSource) {
    this.workspaceSessionSources = {
      ...this.workspaceSessionSources,
      [source.agentId]: {
        ...(this.workspaceSessionSources[source.agentId] ?? {}),
        [source.cwd]: source
      }
    };
  }

  async deleteSession(agentId: string, sessionId: string) {
    const isCurrentSource = this.sessionMutationScope(agentId);
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) {
      throw new Error('Unable to locate the agent for this session.');
    }

    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Unable to locate the agent for this session.');
    }
    if (!record.initializeResponse?.agentCapabilities?.sessionCapabilities?.delete) {
      throw new Error(`${config.name} does not support deleting sessions.`);
    }

    if (!isCurrentSource()) throw new Error('Agent endpoint changed before deleting the session.');
    this.invalidateSharedSessionLists(agentId);
    await record.client.deleteSession(sessionId);
    if (!isCurrentSource()) return;
    this.forgetRecentSessions(agentId, sessionId);
    this.pinVersions.set(agentId, (this.pinVersions.get(agentId) ?? 0) + 1);
    this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent, [agentId]: (this.pinnedSessionsByAgent[agentId] ?? []).filter((session) => session.sessionId !== sessionId) };
    delete this.sessionPins[buildSessionKey(agentId, sessionId)];
    this.invalidateSharedSessionLists(agentId);
    delete this.openSessionPages[agentId];
    this.patchSessionCatalog(agentId, sessionId, null);
    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: (this.sessionsByAgent[agentId] ?? []).filter((session) => session.sessionId !== sessionId)
    };
    const source = Object.values(this.workspaceSessionSources[agentId] ?? {}).find((candidate) =>
      candidate.sessions.some((session) => session.sessionId === sessionId)
    );
    if (source) {
      this.setWorkspaceSource({
        ...source,
        sessions: source.sessions.filter((session) => session.sessionId !== sessionId)
      });
    }
    // Catalog cleanup is endpoint-owned; the runtime below belongs to this connection.
    if (this.clients.get(agentId) !== record) return;
    this.acknowledgeSession(agentId, sessionId);
    const key = buildSessionKey(agentId, sessionId);
    this.lifecycleReads.delete(key);
    this.cancelSessionRuntimeRefresh(key);
    this.sessionRuntimeRefreshPromises.delete(key);
    this.removeSessionModePreferences(agentId, sessionId);
    delete this.delegateAssignmentsBySession[key];
    delete this.delegateAssignmentsLoadingBySession[key];
    delete this.delegateAssignmentsErrorBySession[key];
    delete this.delegateAssignmentPendingBySession[key];
    delete this.delegateAssignmentConflictBySession[key];
    this.delegateAssignmentRequests.delete(key);
    this.delegateAssignmentRefreshVersions.delete(key);
    for (const roleKey of this.delegateAssignmentRoleRequests.keys()) {
      if (roleKey.startsWith(`${key}\0`)) this.delegateAssignmentRoleRequests.delete(roleKey);
    }

    if (this.isSelectedSession(agentId, sessionId)) {
      this.activeAgentId = null;
      this.activeSessionId = null;
      this.activeSession = createEmptyActiveSession();
    }
  }

  async createBackgroundSession(agentId: string, cwd: string, profileId = this.composerProfileId) {
    const isCurrentSource = this.sessionMutationScope(agentId);
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const normalizedCwd = cwd.trim();
    if (!config || !normalizedCwd) {
      throw new Error('Working directory is required to create a session.');
    }

    if (config.transport === 'stdio' && platformCapabilities.managesAgents) {
      const isDirectory = await validateWorkspaceDirectory(normalizedCwd).catch(() => false);
      if (!isDirectory) {
        throw new Error('Workspace must point to an existing directory.');
      }
    }

    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error(`Failed to connect ${config.name}.`);
    }

    if (!isCurrentSource()) throw new Error('Agent endpoint changed before creating the session.');
    const response = await record.client.createSession(
      normalizedCwd,
      profileId === 'default' ? null : profileId
    );
    if (!this.canPublishCreatedSession(agentId, record, isCurrentSource)) return response;
    const summary: DesktopSessionSummary = {
      agentId,
      agentName: config.name,
      sessionId: response.sessionId,
      title: 'Untitled session',
      cwd: normalizedCwd,
      updatedAt: new Date().toISOString(),
      runtimeId: agentId,
      runtimeName: config.name,
      source: 'acp',
      location: 'local',
      status: 'idle',
      relationshipKnown: true,
      lifecycle: record.client.supportsSessionLifecycle()
        ? await record.client.getSessionLifecycle(response.sessionId).catch(() => null) : null
    };
    if (!this.canPublishCreatedSession(agentId, record, isCurrentSource)) return response;
    this.invalidateSharedSessionLists(agentId);
    delete this.openSessionPages[agentId];
    this.lastCreatedSession = response;
    this.applySessionConfigOptionsSnapshot(agentId, response.sessionId, response.configOptions ?? []);
    this.restoreSessionModel(agentId, response.sessionId, response.configOptions ?? [], response);
    this.rememberRecentWorkspace(normalizedCwd);
    this.patchSessionCatalog(agentId, response.sessionId, summary);
    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: mergeSessions(this.sessionsByAgent[agentId] ?? [], [summary])
    };
    this.upsertWorkspaceSessions(agentId, [summary]);
    await this.refreshSessionsForAgent(agentId);
    if (isCurrentSource() && this.clients.get(agentId) === record) {
      this.patchSessionCatalog(agentId, response.sessionId, this.findSessionSummary(agentId, response.sessionId) ?? summary);
    }
    return response;
  }

  async createSession(agentId: string): Promise<string | null> {
    const isCurrentSource = this.sessionMutationScope(agentId);
    this.error = null;
    const config = this.configs.find((candidate) => candidate.id === agentId);
    const cwd = this.composerCwd.trim();
    if (!config || !cwd) {
      this.error = 'Working directory is required to create a session.';
      return null;
    }

    const launch = {
      targetId: this.composerTargetId,
      profileId: this.composerProfileId,
      modeId: this.composerModeId,
      reasoningId: this.composerReasoningId,
      modelId: this.getLaunchModelId(agentId)
    };
    try {
      if (launch.targetId !== 'local') {
        const profileId = launch.profileId === 'querymt:owner-default' ? undefined : launch.profileId;
        if (profileId) {
          await this.refreshRemoteProfiles(agentId, launch.targetId);
          if (!isCurrentSource()) return null;
          const key = buildSessionKey(agentId, launch.targetId);
          if (this.remoteProfileErrors[key]) throw new Error(this.remoteProfileErrors[key]!);
          if (!this.remoteProfileOptions[key]?.some((profile) => profile.id === profileId)) {
            throw new Error('Selected profile is not available on the session owner. Choose an owner profile.');
          }
        }
        const sessionId = await this.createAttachedRemoteSession(agentId, launch.targetId, cwd, profileId);
        if (!isCurrentSource() || !this.isSelectedSession(agentId, sessionId)) return sessionId;
        await this.applyComposerLaunchConfig(agentId, sessionId, launch);
        await this.applySelectedModelToSession(agentId, sessionId, launch.modelId);
        this.captureLaunchSessionPreference(agentId, sessionId, launch);
        this.rememberRecentSession(agentId, sessionId);
        return sessionId;
      }

      const response = await this.createBackgroundSession(agentId, cwd, launch.profileId);
      const sessionId = response.sessionId;
      if (!isCurrentSource()) return sessionId;
      this.resetActiveSession(agentId, sessionId);
      this.activeSession.configOptions = response.configOptions ?? [];
      await this.applyComposerLaunchConfig(agentId, sessionId, launch);
      await this.applySelectedModelToSession(agentId, sessionId, launch.modelId);
      this.captureLaunchSessionPreference(agentId, sessionId, launch);
      await this.drainQueuedSessionUpdates(agentId, sessionId);
      await this.hydrateModelInfo(agentId, this.modelsByAgent[agentId] ?? []);
      this.rememberRecentSession(agentId, sessionId);
      return sessionId;
    } catch (error) {
      this.error = error instanceof Error ? error.message : `Failed to create session for ${config.name}.`;
      return null;
    }
  }

  /**
   * After a successful session creation the launch writes are confirmed, so
   * record the launch mode/model/reasoning as the launch mode's preference.
   * Agent-reported values win where the responses carried them.
   */
  private captureLaunchSessionPreference(
    agentId: string,
    sessionId: string,
    launch: { modeId: string; reasoningId: string; modelId: string }
  ) {
    const key = buildSessionKey(agentId, sessionId);
    const configOptions = this.getSessionConfigOptions(agentId, sessionId);
    const modeId = getCurrentModeId(configOptions) ?? launch.modeId;
    this.sessionModeIds = { ...this.sessionModeIds, [key]: modeId };
    this.saveSessionModePreference(agentId, sessionId, modeId, {
      modelId: this.getSessionModelId(agentId, sessionId) || (launch.modelId || undefined),
      reasoningId: getCurrentReasoningId(configOptions) ?? (launch.reasoningId || undefined)
    });
  }

  async startSessionWithPrompt(agentId: string): Promise<string | null> {
    const sessionId = await this.createSession(agentId);
    if (sessionId && this.isSelectedSession(agentId, sessionId) && (this.composerPrompt.trim() || this.promptAttachments.length > 0)) {
      void this.sendPromptToActiveSession();
    }
    return sessionId;
  }

  async sendPromptToActiveSession(retryFailure: PromptFailure | null = null) {
    this.error = null;
    this.promptFailure = null;
    const prompt = (retryFailure?.prompt ?? this.composerPrompt).trim();
    const attachments = (retryFailure?.attachments ?? this.promptAttachments).map((attachment) => ({ ...attachment }));
    if (!prompt && attachments.length === 0) {
      this.error = 'Enter a message or attach at least one file.';
      return;
    }

    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return;
    }

    const agentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const selection = this.sessionSelectionGeneration;
    let owner: AgentClientRecord | undefined;
    const ownsAction = () => !this.pollingDisposed && selection === this.sessionSelectionGeneration &&
      this.isSelectedSession(agentId, sessionId) && (!owner || this.clients.get(agentId) === owner);
    const imageMode = chatPreferencesStore.imageSendMode;
    const clientPromptId = retryFailure?.clientPromptId ?? createClientPromptId();
    let turnEventIndex = retryFailure?.turnEventIndex;

    try {
      const record = await this.connectInitializedRecord(agentId);
      if (!record) throw new Error('Failed to connect to the agent.');
      owner = record;
      if (!ownsAction()) return;

      const canControlRun = this.canControlSessionInput(record.client);
      const runtime = canControlRun
        ? await this.refreshSessionRuntime(agentId, sessionId, record.client, true)
        : null;
      if (!ownsAction() || (canControlRun && !runtime)) return;
      if (runtime && runtime.phase !== 'idle') {
        const delivery = this.inputDeliveryForSession(agentId, sessionId, runtime, prompt);
        await this.submitInputToActiveSession(
          agentId,
          sessionId,
          record.client,
          runtime,
          delivery,
          prompt,
          attachments,
          clientPromptId,
          imageMode
        );
        return;
      }
      if (runtime?.phase === 'idle' && PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState)) {
        this.activeSession.runState = 'completed';
        this.activeSession.activeToolCallId = null;
        this.activeSession.activityLabel = 'Turn completed.';
      }

      const hasImages = attachments.some((attachment) => attachment.mimeType.startsWith('image/'));
      const hasResources = attachments.some(
        (attachment) => imageMode === 'resource' || !attachment.mimeType.startsWith('image/')
      );
      if (hasImages && imageMode === 'image' && !record.client.supportsImagePrompts()) {
        throw new Error('This agent does not support native image prompts. Switch image attachments to Resources and try again.');
      }
      if (hasResources && !record.client.supportsEmbeddedContext()) {
        throw new Error('This agent does not support embedded resources. Remove file attachments or use an agent with embedded context support.');
      }

      turnEventIndex ??= this.addOptimisticUserPrompt(sessionId, prompt, attachments, clientPromptId);
      this.activeSession.undo.stack = [];
      this.activeSession.undo.lastRevertedFiles = [];
      this.activeSession.undo.lastMessage = null;
      this.activeSession.runState = 'thinking';
      this.activeSession.activityLabel = 'Waiting for the agent to respond…';
      beginSessionWork(this.activeSession);
      this.activeSession.lastError = null;
      if (!retryFailure) {
        this.composerPrompt = '';
        this.clearPromptAttachments();
      }
      const promptResponse = record.client.sendPrompt(sessionId, prompt, attachments, {
        imageMode,
        clientPromptId
      });
      this.scheduleSessionRuntimeRefresh(agentId, sessionId, record.client);
      const response = await promptResponse;
      if (!this.isSelectedSession(agentId, sessionId)) {
        await this.refreshSessionsForAgent(agentId);
        if (canControlRun) void this.refreshSessionRuntime(agentId, sessionId, record.client);
        return;
      }
      this.lastPromptResponse = response;
      if (retryFailure && this.composerPrompt.trim() === prompt && attachmentsMatch(this.promptAttachments, attachments)) {
        this.composerPrompt = '';
        this.clearPromptAttachments();
      }
      this.activeSession.lastStopReason = response.stopReason ?? null;
      endSessionWork(this.activeSession);
      await this.drainQueuedSessionUpdates(agentId, sessionId);
      if (!this.isSelectedSession(agentId, sessionId)) return;
      if (PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState)) {
        this.activeSession.runState = 'completed';
        this.activeSession.activeToolCallId = null;
        this.activeSession.activityLabel =
          response.stopReason === 'cancelled' ? 'Turn cancelled.' : 'Turn completed.';
      }
      await this.refreshSessionsForAgent(agentId);
      if (canControlRun) void this.refreshSessionRuntime(agentId, sessionId, record.client);
    } catch (error) {
      if (!ownsAction()) return;
      endSessionWork(this.activeSession);
      const normalizedError = normalizePromptError(error);
      if (turnEventIndex === undefined) {
        this.error = normalizedError.message;
        return;
      }
      if (!retryFailure && !this.composerPrompt.trim() && this.promptAttachments.length === 0) {
        this.composerPrompt = prompt;
        this.promptAttachments = attachments.map((attachment) => ({ ...attachment }));
      }
      this.activeSession.runState = 'failed';
      this.promptFailure = {
        ...normalizedError,
        id: `${sessionId}-prompt-failure-${turnEventIndex}`,
        sessionId,
        turnEventIndex,
        prompt,
        attachments,
        clientPromptId
      };
      this.activeSession.lastError = normalizedError.message;
      this.activeSession.activityLabel = normalizedError.title;
    }
  }

  private async submitInputToActiveSession(
    agentId: string,
    sessionId: string,
    client: DesktopAcpClient,
    runtime: SessionRuntimeStatus,
    delivery: SessionInputDeliveryMode,
    prompt: string,
    attachments: PromptAttachment[],
    clientInputId: string,
    imageMode: 'image' | 'resource'
  ) {
    if (!this.isSelectedSession(agentId, sessionId)) return;
    const key = buildSessionKey(agentId, sessionId);
    const pending: PendingSessionInput = {
      inputId: clientInputId,
      delivery,
      state: 'sending',
      prompt,
      attachments,
      runId: delivery === 'steer' ? runtime.active_run_id : undefined,
      createdAt: Date.now()
    };
    this.pendingInputsBySession = {
      ...this.pendingInputsBySession,
      [key]: upsertPendingSessionInput(this.pendingInputsBySession[key] ?? [], pending)
    };
    this.inputSubmitOwner = key;
    this.inputSubmitPending = true;
    this.inputSubmissionsBySession.set(key, (this.inputSubmissionsBySession.get(key) ?? 0) + 1);
    try {
      const result = delivery === 'steer'
        ? await client.steerSession(sessionId, prompt, attachments, clientInputId, runtime.active_run_id, imageMode)
        : await client.queueSession(sessionId, prompt, attachments, clientInputId, imageMode);
      this.applySubmitInputResult(agentId, sessionId, pending, result);
      if (!this.isSelectedSession(agentId, sessionId)) return;
      if (result.status === 'started') {
        this.activeSession.runState = 'thinking';
        this.activeSession.activityLabel = 'Waiting for the agent to respond…';
        beginSessionWork(this.activeSession);
      }
      if (this.composerPrompt.trim() === prompt && attachmentsMatch(this.promptAttachments, attachments)) {
        this.composerPrompt = '';
        this.clearPromptAttachments();
      }
      this.activeSession.lastError = null;
    } catch (error) {
      this.inputNotificationsDuringSubmit.delete(
        sessionInputNotificationKey(agentId, sessionId, clientInputId)
      );
      this.updatePendingSessionInput(agentId, sessionId, clientInputId, {
        state: 'failed',
        reason: error instanceof Error ? error.message : 'Input submission failed.'
      });
      if (this.isSelectedSession(agentId, sessionId)) {
        this.error = error instanceof Error ? error.message : 'Failed to submit input.';
      }
      await this.refreshSessionRuntime(agentId, sessionId, client).catch(() => null);
    } finally {
      const remainingSubmissions = (this.inputSubmissionsBySession.get(key) ?? 1) - 1;
      if (remainingSubmissions > 0) {
        this.inputSubmissionsBySession.set(key, remainingSubmissions);
      } else {
        this.inputSubmissionsBySession.delete(key);
      }
      if (this.inputSubmitOwner === key) {
        this.inputSubmitOwner = null;
        this.inputSubmitPending = false;
      }
    }
  }

  private canControlSessionInput(client: DesktopAcpClient): boolean {
    return client.supportsQuerymtFeature('steering') &&
      client.supportsQuerymtMethod(QMT_METHOD_SESSION_STEER) &&
      client.supportsQuerymtMethod(QMT_METHOD_SESSION_QUEUE) &&
      client.supportsQuerymtMethod(QMT_METHOD_SESSION_RUNTIME_STATE);
  }

  private inputDeliveryForSession(
    agentId: string,
    sessionId: string,
    runtime: SessionRuntimeStatus,
    prompt: string
  ): SessionInputDeliveryMode {
    if (prompt.trimStart().startsWith('/')) return 'queue';
    if (
      !runtime.steerable ||
      !runtime.active_run_id ||
      runtime.phase === 'closing' ||
      runtime.phase === 'cancel_requested'
    ) {
      return 'queue';
    }
    return this.composerInputDeliveryBySession[buildSessionKey(agentId, sessionId)]
      ?? chatPreferencesStore.inputDelivery;
  }

  async discardQueuedInput(inputId: string): Promise<void> {
    if (!this.activeAgentId || !this.activeSessionId) return;
    const agentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const pending = this.activePendingInputs.find((input) => input.inputId === inputId);
    if (!pending || pending.delivery !== 'queue' || pending.state !== 'queued' || pending.discardPending) {
      return;
    }
    const record = await this.connectInitializedRecord(agentId);
    const client = record?.client;
    if (!client?.supportsQuerymtMethod(QMT_METHOD_SESSION_DISCARD_QUEUED_INPUT)) return;

    this.updatePendingSessionInput(agentId, sessionId, inputId, { discardPending: true });
    try {
      await client.discardQueuedInput(sessionId, inputId);
      this.removePendingSessionInput(agentId, sessionId, inputId);
    } catch (error) {
      this.updatePendingSessionInput(agentId, sessionId, inputId, { discardPending: false });
      if (this.isSelectedSession(agentId, sessionId)) {
        this.error = error instanceof Error ? error.message : 'Failed to remove queued input.';
      }
    }
  }

  private applySubmitInputResult(
    agentId: string,
    sessionId: string,
    pending: PendingSessionInput,
    result: SubmitInputResult
  ) {
    const inputId = result.data.input_id;
    const key = buildSessionKey(agentId, sessionId);
    const bufferedNotification =
      this.inputNotificationsDuringSubmit.get(sessionInputNotificationKey(agentId, sessionId, inputId))
      ?? this.inputNotificationsDuringSubmit.get(sessionInputNotificationKey(agentId, sessionId, pending.inputId));
    this.inputNotificationsDuringSubmit.delete(sessionInputNotificationKey(agentId, sessionId, inputId));
    this.inputNotificationsDuringSubmit.delete(sessionInputNotificationKey(agentId, sessionId, pending.inputId));

    if (inputId !== pending.inputId) {
      const current = this.pendingInputsBySession[key] ?? [];
      const existing = current.find((input) => input.inputId === inputId)
        ?? current.find((input) => input.inputId === pending.inputId);
      const withoutPreviousIds = current.filter(
        (input) => input.inputId !== pending.inputId && input.inputId !== inputId
      );
      this.pendingInputsBySession = {
        ...this.pendingInputsBySession,
        [key]: existing
          ? upsertPendingSessionInput(withoutPreviousIds, { ...existing, inputId })
          : withoutPreviousIds
      };
    }

    if (
      result.status === 'started'
      || (bufferedNotification?.delivery === SessionInputDelivery.Queue
        && (bufferedNotification.state === SessionInputState.Started
          || bufferedNotification.state === SessionInputState.Discarded))
    ) {
      this.removePendingSessionInput(agentId, sessionId, inputId);
      this.removePendingSessionInput(agentId, sessionId, pending.inputId);
      return;
    }

    const current = (this.pendingInputsBySession[key] ?? []).find((input) => input.inputId === inputId);
    if (!current) return;
    const terminalState = current.state === 'applied' || current.state === 'discarded';
    if (!terminalState && result.status === 'steered') {
      this.updatePendingSessionInput(agentId, sessionId, inputId, {
        delivery: 'steer',
        state: 'accepted',
        runId: result.data.run_id,
        position: result.data.position
      });
    } else if (!terminalState && result.status === 'queued') {
      this.updatePendingSessionInput(agentId, sessionId, inputId, {
        delivery: 'queue',
        state: 'queued',
        position: result.data.position
      });
    }

    if (bufferedNotification) {
      this.updatePendingSessionInput(
        agentId,
        sessionId,
        inputId,
        pendingInputUpdatesFromNotification(bufferedNotification)
      );
    }
  }

  async refreshSessionRuntime(
    agentId = this.activeAgentId,
    sessionId = this.activeSessionId,
    client?: DesktopAcpClient,
    fresh = false
  ): Promise<SessionRuntimeStatus | null> {
    if (!agentId || !sessionId || this.pollingDisposed) return null;
    const record = client ? this.clients.get(agentId) : await this.connectInitializedRecord(agentId);
    if (!record || (client && record.client !== client)) return null;
    const resolvedClient = record.client;
    if (!resolvedClient.supportsQuerymtMethod(QMT_METHOD_SESSION_RUNTIME_STATE)) return null;
    const key = buildSessionKey(agentId, sessionId);
    const selection = this.sessionSelectionGeneration;
    const selected = this.isSelectedSession(agentId, sessionId);
    const existing = this.sessionRuntimeRefreshPromises.get(key);
    if (existing?.record === record) {
      if (!fresh && existing.selection === selection) return existing.promise;
      // Actions require a read started after any earlier polling request has settled.
      await existing.promise.catch(() => null);
      if (this.pollingDisposed || this.clients.get(agentId) !== record || selection !== this.sessionSelectionGeneration ||
        (selected && !this.isSelectedSession(agentId, sessionId))) return null;
      return this.refreshSessionRuntime(agentId, sessionId, resolvedClient, true);
    }
    this.cancelSessionRuntimeRefresh(key);
    const generation = (this.sessionRuntimeRefreshGenerations.get(key) ?? 0) + 1;
    this.sessionRuntimeRefreshGenerations.set(key, generation);
    const isCurrent = () => !this.pollingDisposed && this.clients.get(agentId) === record &&
      selection === this.sessionSelectionGeneration && (!selected || this.isSelectedSession(agentId, sessionId)) &&
      this.sessionRuntimeRefreshGenerations.get(key) === generation;
    const promise = resolvedClient.getSessionRuntimeStatus(sessionId).then((runtime) => {
      if (!isCurrent()) return null;
      this.sessionRuntimeBySession = { ...this.sessionRuntimeBySession, [key]: runtime };
      if (runtime.phase !== 'idle') this.scheduleSessionRuntimeRefresh(agentId, sessionId, resolvedClient);
      else this.cancelSessionRuntimeRefresh(key);
      return runtime;
    }).catch((error) => {
      if (isCurrent() && this.selectedRuntimeNeeded()) this.scheduleSessionRuntimeRefresh(agentId, sessionId, resolvedClient);
      throw error;
    });
    const flight = { record, selection, promise };
    this.sessionRuntimeRefreshPromises.set(key, flight);
    try {
      return await promise;
    } finally {
      if (this.sessionRuntimeRefreshPromises.get(key) === flight) this.sessionRuntimeRefreshPromises.delete(key);
    }
  }

  private updatePendingSessionInput(
    agentId: string,
    sessionId: string,
    inputId: string,
    updates: Partial<PendingSessionInput>
  ) {
    const key = buildSessionKey(agentId, sessionId);
    const current = this.pendingInputsBySession[key] ?? [];
    const index = current.findIndex((input) => input.inputId === inputId);
    if (index < 0) return;
    const next = current.slice();
    next[index] = { ...next[index], ...updates };
    this.pendingInputsBySession = { ...this.pendingInputsBySession, [key]: next };
  }

  private removePendingSessionInput(agentId: string, sessionId: string, inputId: string) {
    const key = buildSessionKey(agentId, sessionId);
    const current = this.pendingInputsBySession[key] ?? [];
    const next = current.filter((input) => input.inputId !== inputId);
    if (next.length === current.length) return;
    this.pendingInputsBySession = { ...this.pendingInputsBySession, [key]: next };
  }

  private applyInputStateNotification(agentId: string, notification: SessionInputStateNotification) {
    if (notification.version !== 1) return;
    const sessionKey = buildSessionKey(agentId, notification.session_id);
    if ((this.inputSubmissionsBySession.get(sessionKey) ?? 0) > 0) {
      this.inputNotificationsDuringSubmit.set(
        sessionInputNotificationKey(agentId, notification.session_id, notification.input_id),
        notification
      );
    }
    if (
      notification.delivery === SessionInputDelivery.Queue &&
      (notification.state === SessionInputState.Started || notification.state === SessionInputState.Discarded)
    ) {
      this.removePendingSessionInput(agentId, notification.session_id, notification.input_id);
      if (this.isSelectedSession(agentId, notification.session_id)) {
        this.scheduleSessionRuntimeRefresh(agentId, notification.session_id, this.clients.get(agentId)!.client);
      }
      return;
    }
    this.updatePendingSessionInput(
      agentId,
      notification.session_id,
      notification.input_id,
      pendingInputUpdatesFromNotification(notification)
    );
    if (this.isSelectedSession(agentId, notification.session_id)) {
      this.scheduleSessionRuntimeRefresh(agentId, notification.session_id, this.clients.get(agentId)!.client);
    }
  }

  async retryPromptFailure() {
    const failure = this.promptFailure;
    if (!failure || !failure.retryable || failure.sessionId !== this.activeSessionId || this.promptRetryPending) {
      return;
    }

    this.promptRetryPending = true;
    try {
      await this.sendPromptToActiveSession(failure);
    } finally {
      this.promptRetryPending = false;
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

    try {
      this.error = null;
      this.activeSession.activityLabel = 'Cancelling turn…';
      this.activeSession.lastError = null;
      const record = await this.connectInitializedRecord(this.activeAgentId);
      if (!record) {
        throw new Error('Failed to cancel ACP prompt.');
      }
      await record.client.cancelSession(this.activeSessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel ACP prompt.';
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = message;
      this.activeSession.activityLabel = message;
      this.error = message;
    }
  }

  /** Load history only while this selection generation still owns the view. */
  async loadSession(agentId: string, sessionId: string, pendingOperation: 'undo' | 'redo' | null = null) {
    const selectionGeneration = ++this.sessionSelectionGeneration;
    const isCurrentLoad = () => selectionGeneration === this.sessionSelectionGeneration &&
      this.isSelectedSession(agentId, sessionId);
    const sessionKey = buildSessionKey(agentId, sessionId);
    if (
      pendingOperation === null &&
      this.hydratedRemoteSessionKeys.delete(sessionKey) &&
      this.isSelectedSession(agentId, sessionId)
    ) {
      this.acknowledgeSession(agentId, sessionId);
      this.rememberRecentSession(agentId, sessionId);
      await this.refreshDelegateAssignments(agentId, sessionId);
      return;
    }

    // A deep link may arrive before catalog discovery. Do not create a local
    // placeholder or scan every peer before the backend checks the bookmark.
    let target = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    this.acknowledgeSession(agentId, sessionId);

    const record = await this.connectInitializedRecord(agentId);
    if (selectionGeneration !== this.sessionSelectionGeneration) return;
    if (!record) {
      this.error = 'Failed to connect to the agent.';
      return;
    }
    target ??= getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);

    if (!record.initializeResponse?.agentCapabilities?.loadSession) {
      this.error = 'This agent does not support session/load.';
      return;
    }

    const measurement = new SessionLoadMeasurement(agentId, sessionId);
    this.activeLoadMeasurement = measurement;
    const telemetryOperationId = await startSessionLoadTelemetry(agentId, sessionId);
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const telemetryCounters = (): SessionLoadTelemetryCounters => ({
      ...measurement.counters(),
      transcriptItems: this.activeSession.transcript.length,
      toolCalls: this.activeSession.toolCalls.length,
      debugEvents: this.activeSession.events.length,
      domNodes: typeof document === 'undefined' ? 0 : document.querySelectorAll('*').length
    });
    let telemetryQueue = Promise.resolve();
    const checkpoint = (phase: string) => {
      const durationMs = measurement.phase(phase);
      telemetryQueue = telemetryQueue.then(() =>
        checkpointSessionLoadTelemetry(telemetryOperationId, phase, durationMs, telemetryCounters())
      );
    };
    if (telemetryOperationId) {
      heartbeat = setInterval(() => {
        void heartbeatSessionLoadTelemetry(telemetryOperationId, telemetryCounters());
      }, 10_000);
    }
    let telemetryStatus = 'success';
    let finishReplay: (() => SessionNotification[]) | null = null;
    try {
      // Stale-while-revalidate: when reloading the session that is already on
      // screen and still has content, keep the transcript rendered while the
      // fresh history loads. Resetting here collapses the scrollable content,
      // which un-pins the sticky header and makes the top panel jump vertically.
      if (selectionGeneration !== this.sessionSelectionGeneration) {
        telemetryStatus = 'cancelled';
        return;
      }
      const keepStaleContent =
        this.isSelectedSession(agentId, sessionId) &&
        (this.activeSession.transcript.length > 0 ||
          this.activeSession.toolCalls.length > 0 ||
          this.activeSession.events.length > 0);
      if (keepStaleContent) {
        this.promptFailure = null;
        const staleRecord = this.ensureClientRecord(agentId);
        staleRecord.recentSessionUpdateKeys = [];
      } else {
        this.resetActiveSession(agentId, sessionId, true);
      }
      this.activeSession.undo.pendingOperation = pendingOperation;
      // Distinguish "history is loading" from a live prompt run: both set
      // runState to 'thinking', but only a real run should expose Stop.
      this.sessionHistoryLoading = true;
      this.activeSession.runState = 'thinking';
      this.activeSession.activityLabel = 'Loading session history...';
      this.activeSession.lastError = null;
      await tick();
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }
      checkpoint('frontend.prepare');
      let loaded;
      try {
        loaded = telemetryOperationId
          ? await record.client.loadSession(sessionId, target?.cwd ?? '', telemetryOperationId)
          : await record.client.loadSession(sessionId, target?.cwd ?? '');
      } catch (error) {
        // A never-attached remote session has no bookmark yet. Only if the
        // direct load reports a missing ID do we fall back to discovery.
        const message = error instanceof RequestError && error.data && typeof error.data === 'object'
          ? (error.data as Record<string, unknown>).message : null;
        if (error instanceof RequestError && error.code === -32602 &&
          (message === 'session not found' || message === 'Session has no profile binding') &&
          target?.location !== 'local' && isCurrentLoad()) {
          const nodeId = target?.location === 'remote' && target.remoteNodeId
            ? target.remoteNodeId
            : await this.findRemoteNodeForMissingSession(agentId, sessionId, record.client, isCurrentLoad);
          if (nodeId && isCurrentLoad()) {
            await this.attachRemoteSession(agentId, nodeId, sessionId, selectionGeneration);
            if (!isCurrentLoad()) telemetryStatus = 'cancelled';
            return;
          }
        }
        throw error;
      }
      const loadedSession = 'response' in loaded ? loaded.response : (loaded as unknown as LoadSessionResponse);
      let replay = 'replay' in loaded ? loaded.replay : [];
      if ('finishReplay' in loaded && typeof loaded.finishReplay === 'function') {
        finishReplay = loaded.finishReplay;
      }
      checkpoint('frontend.acp_wait');
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }
      this.lastLoadedSession = loadedSession;
      const loadMeta = loadedSession._meta;
      if (loadMeta?.location === 'remote' && typeof loadMeta.nodeId === 'string') {
        const config = this.configs.find((candidate) => candidate.id === agentId);
        if (config) {
          // Discovery may have populated or refreshed the summary while session/load was in flight.
          const current = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId) ?? target;
          const summary: DesktopSessionSummary = {
            ...current,
            agentId, agentName: config.name, sessionId,
            relationshipKnown: current?.relationshipKnown ?? false,
            title: typeof loadMeta.title === 'string' ? loadMeta.title : current?.title ?? sessionId,
            cwd: typeof loadMeta.cwd === 'string' ? loadMeta.cwd : current?.cwd ?? '',
            updatedAt: current?.updatedAt ?? null, runtimeId: agentId,
            runtimeName: config.name, source: 'acp', location: 'remote',
            remoteNodeId: loadMeta.nodeId,
            remoteNodeLabel: typeof loadMeta.nodeLabel === 'string' ? loadMeta.nodeLabel : current?.remoteNodeLabel,
            remoteProfileId: loadMeta.profileId === undefined ? current?.remoteProfileId :
              typeof loadMeta.profileId === 'string' ? loadMeta.profileId : undefined,
            remoteProfileLabel: loadMeta.profileLabel === undefined &&
              (loadMeta.profileId === undefined || loadMeta.profileId === current?.remoteProfileId)
              ? current?.remoteProfileLabel : typeof loadMeta.profileLabel === 'string' ? loadMeta.profileLabel : undefined,
            status: current?.status ?? 'idle'
          };
          this.syncLoadedSessionSummary(agentId, summary);
        }
      } else if (loadMeta?.location === 'local' && target?.location === 'remote') {
        this.syncLoadedSessionSummary(agentId, {
          ...target, location: 'local',
          title: typeof loadMeta.title === 'string' ? loadMeta.title : target.title,
          cwd: typeof loadMeta.cwd === 'string' ? loadMeta.cwd : target.cwd,
          remoteNodeId: undefined, remoteNodeLabel: undefined, remoteConnectionState: undefined,
          remoteProfileId: undefined, remoteProfileLabel: undefined
        });
      } else if (!target) {
        this.ensureSessionLoadTarget(agentId, sessionId);
      }
      const relationship = readSessionRelationshipMeta(loadedSession);
      if (relationship.parentSessionId || relationship.forkOrigin) {
        const current = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
        if (current) this.syncLoadedSessionSummary(agentId, { ...current, ...relationship, relationshipKnown: true });
        if (relationship.parentSessionId) this.rememberSessionChildren(agentId, relationship.parentSessionId, [sessionId]);
      }
      await Promise.resolve();
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkpoint('frontend.response_flush');
      if (finishReplay) {
        replay = finishReplay();
        finishReplay = null;
      }
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }
      // A snapshot-capable agent omits historical replay because this client
      // advertised that it hydrates history from the load-response snapshot.
      // Detect that case so we only transform the authoritative representation
      // instead of building both.
      const snapshotSession = activeSessionFromLoadResponse(sessionId, loadedSession);
      this.rememberSnapshotUserMessages(snapshotSession);
      this.activeLoadMeasurement?.increment('replayCapturedNotifications', replay.length);
      // Capture starts before the snapshot read. User messages in that snapshot
      // are already complete, so their captured echoes must not create new turns.
      replay = replay.filter((notification) => !this.isSnapshotUserEcho(notification));
      const replayIsEmpty = replay.length === 0;
      const replaySession = replayIsEmpty
        ? null
        : reduceSessionReplay(sessionId, replay);
      checkpoint('frontend.snapshot_transform');
      // The lifecycle override below must read the snapshot's pristine run
      // verdict; folding the captured updates into the baseline mutates it in
      // place, so capture those values before the fold.
      const snapshotLifecycle = snapshotSession.runStateFromLifecycle
        ? {
            runState: snapshotSession.runState,
            activityLabel: snapshotSession.activityLabel,
            activeToolCallId: snapshotSession.activeToolCallId,
            lastError: snapshotSession.lastError
          }
        : null;
      const liveSession = this.activeSession;
      const liveHasVisibleHistory =
        liveSession.sessionId === sessionId && sessionHasVisibleHistory(liveSession);
      // session_info_update and similar metadata create events without a
      // transcript. Treating those as history overwrites late live updates
      // that arrived after capture closed (first child load, empty chat).
      //
      // Preference order: when the agent served a snapshot, the snapshot is
      // the history baseline and the captured live updates are folded into it
      // exactly once (the capture window only holds updates observed while the
      // load was in flight, never the full conversation, so a visible replay
      // alone must not replace the snapshot). Replay stays authoritative when
      // the agent served no snapshot, so there is no baseline to extend.
      if (sessionHasVisibleHistory(snapshotSession)) {
        this.activeSession = replayIsEmpty
          ? snapshotSession
          : appendSessionReplay(snapshotSession, replay);
      } else if (replaySession && sessionHasVisibleHistory(replaySession)) {
        this.activeSession = replaySession;
      } else if (liveHasVisibleHistory) {
        this.activeSession = liveSession;
      } else {
        this.activeSession = replaySession ?? snapshotSession;
      }
      this.activeLoadMeasurement?.increment('historyAssignments');
      this.activeLoadMeasurement?.increment(
        replayIsEmpty ? 'snapshotHydratedSessions' : 'replayedSessions'
      );
      // Preserve context metrics from the candidates that lost the history
      // selection: replay capture may miss `usage_update` while the load
      // snapshot (or the still-rendered live session) already knows the
      // context window. The snapshot merges first so its load-time values win
      // over the stale still-rendered live session; present values win, and
      // later drained/live usage updates keep overriding these baselines.
      if (this.activeSession !== snapshotSession) mergeMissingSessionUsage(this.activeSession, snapshotSession);
      if (liveSession.sessionId === sessionId && this.activeSession !== liveSession) {
        mergeMissingSessionUsage(this.activeSession, liveSession);
      }
      if (replaySession && this.activeSession !== replaySession) {
        mergeMissingSessionUsage(this.activeSession, replaySession);
      }
      const drainedCount = await this.drainQueuedSessionUpdates(agentId, sessionId);
      checkpoint('frontend.queued_replay');
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }

      console.debug('querymt session/load replay', {
        agentId,
        sessionId,
        liveReplayCount: replay.length,
        drainedCount,
        totalEvents: this.activeSession.events.length
      });

      this.applySessionConfigOptionsSnapshot(agentId, sessionId, loadedSession.configOptions ?? []);
      this.restoreSessionModel(agentId, sessionId, this.activeSession.configOptions, loadedSession);
      // The agent's reported configuration is authoritative at load time: seed
      // the active mode's preference from it without issuing any config write
      // and without substituting a local model when metadata is missing.
      this.seedSessionModePreferenceFromLoad(agentId, sessionId);
      if (snapshotLifecycle) {
        this.activeSession.runState = snapshotLifecycle.runState;
        this.activeSession.runStateFromLifecycle = true;
        this.activeSession.activityLabel = snapshotLifecycle.activityLabel;
        this.activeSession.activeToolCallId = snapshotLifecycle.activeToolCallId;
        this.activeSession.lastError = snapshotLifecycle.lastError;
      }
      this.activeSession = normalizeHistoricalSession(this.activeSession, { loadCompleted: true });
      this.rememberSessionChildren(agentId, sessionId, this.activeSession.toolCalls.map((tool) => tool.childSessionId));
      checkpoint('frontend.normalize');
      this.activeSession.undo.pendingOperation = pendingOperation;
      this.reconcileInputStatesFromSnapshot(agentId, sessionId, loadedSession);
      if (record.client.supportsQuerymtMethod(QMT_METHOD_SESSION_RUNTIME_STATE)) {
        await this.refreshSessionRuntime(agentId, sessionId, record.client).catch(() => null);
        if (!isCurrentLoad()) {
          telemetryStatus = 'cancelled';
          return;
        }
      }
      await this.hydrateUndoStack(agentId, sessionId, record.client);
      checkpoint('frontend.undo_hydrate');
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }
      if (!sessionHasVisibleHistory(this.activeSession) && drainedCount === 0) {
        this.activeSession.activityLabel = 'Session loaded, but the agent returned no replayable history.';
      }
      this.hydrateLoadedSessionSummary(agentId, sessionId, replay);
      await this.hydrateModelInfo(agentId, this.modelsByAgent[agentId] ?? []);
      checkpoint('frontend.model_hydrate');
      if (isCurrentLoad() && pendingOperation === null) this.rememberRecentSession(agentId, sessionId);
      void this.refreshDelegateAssignments(agentId, sessionId);
      await tick();
      await new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        } else {
          resolve();
        }
      });
      checkpoint('frontend.render_frames');
      this.lastSessionLoadMetrics = measurement.finish({
        snapshotEvents: countSnapshotEvents(loadedSession),
        transcriptItems: this.activeSession.transcript.length,
        toolCalls: this.activeSession.toolCalls.length,
        debugEvents: this.activeSession.events.length
      });
    } catch (error) {
      if (!isCurrentLoad()) {
        telemetryStatus = 'cancelled';
        return;
      }
      if (error instanceof SupersededSessionListError) {
        telemetryStatus = 'cancelled';
        endSessionWork(this.activeSession);
        this.retrySupersededList(`load:${sessionKey}`, agentId, record, async () => {
          if (isCurrentLoad()) await this.loadSession(agentId, sessionId, pendingOperation);
        });
        return;
      }
      telemetryStatus = 'error';
      const message = error instanceof Error ? error.message : 'Failed to load ACP session.';
      this.activeSession.runState = 'failed';
      this.activeSession.lastError = message;
      this.activeSession.activityLabel = message;
      this.error = message;
    } finally {
      finishReplay?.();
      if (isCurrentLoad()) this.sessionHistoryLoading = false;
      if (heartbeat) clearInterval(heartbeat);
      await telemetryQueue;
      await finishSessionLoadTelemetry(telemetryOperationId, telemetryStatus, telemetryCounters());
      measurement.cleanup();
      if (this.activeLoadMeasurement === measurement) this.activeLoadMeasurement = null;
    }
  }

  async forkActiveSessionAt(messageId: string): Promise<string | null> {
    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return null;
    }
    if (
      PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState) ||
      this.activeSession.undo.pendingOperation ||
      this.forkPending
    ) {
      return null;
    }

    const agentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const source = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    if (!source) {
      this.error = 'Unable to locate the source session.';
      return null;
    }

    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      this.error = 'Failed to connect to the agent.';
      return null;
    }
    if (!this.canForkSession(agentId)) {
      this.error = 'This agent does not support session forks.';
      return null;
    }

    this.error = null;
    this.forkPending = true;
    this.activeSession.activityLabel = 'Creating fork...';
    try {
      const response = await record.client.forkSession(sessionId, source.cwd, messageId);
      this.invalidateSessionCatalogCache();
      if (!this.isSelectedSession(agentId, sessionId)) return null;

      await this.refreshSessionsForAgent(agentId);
      const refreshedSessions = this.sessionsByAgent[agentId] ?? [];
      const refreshedSource = refreshedSessions.find((session) => session.sessionId === source.sessionId);
      const sourceWithFork = {
        ...(refreshedSource ?? source),
        hasChildren: true,
        forkCount: Math.max(refreshedSource?.forkCount ?? 0, (source.forkCount ?? 0) + 1)
      };
      const optimisticSessions = refreshedSessions.map((session) =>
        session.sessionId === source.sessionId ? sourceWithFork : session
      );
      if (!optimisticSessions.some((session) => session.sessionId === response.sessionId)) {
        const forkSummary: DesktopSessionSummary = {
          ...source,
          sessionId: response.sessionId,
          title: `Fork of ${source.title}`,
          updatedAt: new Date().toISOString(),
          status: 'idle',
          parentSessionId: source.sessionId,
          forkOrigin: 'user',
          sessionKind: null,
          hasChildren: false,
          forkCount: 0
        };
        optimisticSessions.push(forkSummary);
      }
      this.sessionsByAgent = {
        ...this.sessionsByAgent,
        [agentId]: optimisticSessions.sort(compareSessionsByActivity)
      };
      this.upsertWorkspaceSessions(agentId, optimisticSessions);
      return response.sessionId;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fork session.';
      this.error = message;
      return null;
    } finally {
      this.forkPending = false;
    }
  }

  async undoActiveSessionTo(messageId: string) {
    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return false;
    }
    if (PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState) || this.activeSession.undo.pendingOperation || this.forkPending) {
      return false;
    }

    const agentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const target = getUndoableSessionTurns(this.activeSession).find((turn) => turn.messageId === messageId);
    if (!target || !canUndoToMessage(this.activeSession, messageId)) return false;
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      this.error = 'Failed to connect to the agent.';
      return false;
    }
    if (!this.canUseSessionUndo(agentId)) {
      this.error = 'This agent does not support session undo and redo.';
      return false;
    }

    this.error = null;
    this.activeSession.undo.pendingOperation = 'undo';
    this.activeSession.activityLabel = 'Undoing workspace changes...';
    try {
      const response = await record.client.undoSession(sessionId, messageId);
      if (!response.success) throw new Error(response.message ?? 'Undo failed.');
      if (!this.isSelectedSession(agentId, sessionId)) return false;

      const revertedFiles = response.reverted_files ?? [];
      const resultMessage = revertedFiles.length
        ? `Undid ${revertedFiles.length} changed file${revertedFiles.length === 1 ? '' : 's'}.`
        : 'Turn undone.';
      this.activeSession.undo.stack = response.undo_stack.map((frame) => frame.message_id);
      this.activeSession.undo.lastRevertedFiles = revertedFiles;
      this.activeSession.undo.lastMessage = resultMessage;
      if (!this.composerPrompt.trim() && target?.text) this.composerPrompt = target.text;
      await this.loadSession(agentId, sessionId, 'undo');
      if (this.isSelectedSession(agentId, sessionId)) {
        this.activeSession.undo.lastRevertedFiles = revertedFiles;
        this.activeSession.undo.lastMessage = resultMessage;
        this.activeSession.activityLabel = resultMessage;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Undo failed.';
      this.activeSession.undo.lastMessage = message;
      this.error = message;
      return false;
    } finally {
      if (this.isSelectedSession(agentId, sessionId)) this.activeSession.undo.pendingOperation = null;
    }
  }

  async undoLatestActiveSession() {
    const target = getCurrentUndoTarget(this.activeSession);
    return target ? this.undoActiveSessionTo(target.messageId) : false;
  }

  async redoActiveSession() {
    if (!this.activeAgentId || !this.activeSessionId) {
      this.error = 'No active session selected.';
      return false;
    }
    if (
      this.activeSession.undo.stack.length === 0 ||
      PROMPT_ACTIVE_RUN_STATES.has(this.activeSession.runState) ||
      this.activeSession.undo.pendingOperation ||
      this.forkPending
    ) {
      return false;
    }

    const agentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      this.error = 'Failed to connect to the agent.';
      return false;
    }
    if (!this.canUseSessionUndo(agentId)) {
      this.error = 'This agent does not support session undo and redo.';
      return false;
    }

    this.error = null;
    this.activeSession.undo.pendingOperation = 'redo';
    this.activeSession.activityLabel = 'Restoring workspace changes...';
    try {
      const response = await record.client.redoSession(sessionId);
      if (!response.success) throw new Error(response.message ?? 'Redo failed.');
      if (!this.isSelectedSession(agentId, sessionId)) return false;

      this.activeSession.undo.stack = response.undo_stack.map((frame) => frame.message_id);
      this.activeSession.undo.lastRevertedFiles = [];
      this.activeSession.undo.lastMessage = 'Turn restored.';
      await this.loadSession(agentId, sessionId, 'redo');
      if (this.isSelectedSession(agentId, sessionId)) {
        this.activeSession.undo.lastMessage = 'Turn restored.';
        this.activeSession.activityLabel = 'Turn restored.';
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redo failed.';
      this.activeSession.undo.lastMessage = message;
      this.error = message;
      return false;
    } finally {
      if (this.isSelectedSession(agentId, sessionId)) this.activeSession.undo.pendingOperation = null;
    }
  }

  async refreshDelegateAssignments(agentId = this.activeAgentId, sessionId = this.activeSessionId) {
    if (!agentId || !sessionId) return;
    const key = buildSessionKey(agentId, sessionId);
    const record = this.ensureClientRecord(agentId);
    if (!record.client.supportsQuerymtMethod(QMT_METHOD_SESSION_DELEGATE_MODELS)) {
      this.delegateAssignmentsBySession = { ...this.delegateAssignmentsBySession, [key]: null };
      this.delegateAssignmentsErrorBySession = { ...this.delegateAssignmentsErrorBySession, [key]: null };
      return;
    }

    const refreshVersion = (this.delegateAssignmentRefreshVersions.get(key) ?? 0) + 1;
    this.delegateAssignmentRefreshVersions.set(key, refreshVersion);
    this.delegateAssignmentsLoadingBySession = { ...this.delegateAssignmentsLoadingBySession, [key]: true };
    try {
      const state = await record.client.getDelegateModels({ session_id: sessionId });
      if (state.session_id !== sessionId) {
        throw new Error('Agent returned delegate assignments for a different session.');
      }
      if (this.delegateAssignmentRefreshVersions.get(key) !== refreshVersion) return;
      const current = this.delegateAssignmentsBySession[key];
      const stale = current?.revision != null && state.revision != null && state.revision < current.revision;
      if (!stale) {
        this.delegateAssignmentsBySession = { ...this.delegateAssignmentsBySession, [key]: state };
      }
      this.delegateAssignmentsErrorBySession = { ...this.delegateAssignmentsErrorBySession, [key]: null };
    } catch (error) {
      if (this.delegateAssignmentRefreshVersions.get(key) !== refreshVersion) return;
      const message = acpErrorMessage(error, 'Failed to load delegate models.');
      this.delegateAssignmentsErrorBySession = { ...this.delegateAssignmentsErrorBySession, [key]: message };
    } finally {
      if (this.delegateAssignmentRefreshVersions.get(key) === refreshVersion) {
        this.delegateAssignmentsLoadingBySession = { ...this.delegateAssignmentsLoadingBySession, [key]: false };
      }
    }
  }

  async setActiveDelegateModel(
    agentId: string,
    model: DelegateModelOverride | null,
    reasoningEffort?: DelegateReasoningEffort | null
  ): Promise<boolean> {
    if (!this.activeAgentId || !this.activeSessionId) return false;
    const ownerAgentId = this.activeAgentId;
    const sessionId = this.activeSessionId;
    const key = buildSessionKey(ownerAgentId, sessionId);
    const current = this.delegateAssignmentsBySession[key];
    if (!current?.editable) return false;

    if (reasoningEffort !== undefined && current.reasoning_effort_supported !== true) return false;
    const currentAssignment = current.assignments.find((assignment) => assignment.agent_id === agentId) ??
      current.orphaned_overrides.find((assignment) => assignment.agent_id === agentId);
    const previous = currentAssignment?.model ?? null;
    const reasoningUnchanged = reasoningEffort === undefined || (currentAssignment?.reasoning_effort ?? null) === reasoningEffort;
    const isExplicitModelSelection = model !== null && reasoningEffort === undefined &&
      current.assignments.some((assignment) => assignment.agent_id === agentId);
    if (sameDelegateModel(previous, model) && reasoningUnchanged) {
      if (isExplicitModelSelection) this.rememberRecentDelegateModel(ownerAgentId, current.profile_id, agentId, model);
      return true;
    }

    const pendingForSession = this.delegateAssignmentPendingBySession[key] ?? {};
    this.delegateAssignmentPendingBySession = {
      ...this.delegateAssignmentPendingBySession,
      [key]: { ...pendingForSession, [agentId]: true }
    };
    this.delegateAssignmentConflictBySession = { ...this.delegateAssignmentConflictBySession, [key]: false };
    this.delegateAssignmentsErrorBySession = { ...this.delegateAssignmentsErrorBySession, [key]: null };

    const previousRequest = this.delegateAssignmentRequests.get(key) ?? Promise.resolve(true);
    const request = previousRequest.catch(() => false).then(async (): Promise<boolean> => {
      const latest = this.delegateAssignmentsBySession[key];
      if (!latest?.editable) return false;
      const record = this.ensureClientRecord(ownerAgentId);
      try {
        const response = await record.client.setDelegateModel({
          session_id: sessionId,
          agent_id: agentId,
          model_id: model?.model_id ?? null,
          node_id: model?.node_id ?? null,
          ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
          expected_revision: latest.revision
        });
        if (response.session_id !== sessionId || response.agent_id !== agentId) {
          throw new Error('Agent confirmed a different delegate-model assignment.');
        }
        const confirmed = applyDelegateModelConfirmation(this.delegateAssignmentsBySession[key], response);
        if (confirmed) {
          this.delegateAssignmentsBySession = { ...this.delegateAssignmentsBySession, [key]: confirmed };
        }
        if (isExplicitModelSelection && sameDelegateModel(response.model, model)) {
          this.rememberRecentDelegateModel(ownerAgentId, latest.profile_id, agentId, model);
        }
        await this.refreshDelegateAssignments(ownerAgentId, sessionId);
        return true;
      } catch (error) {
        const conflict = readDelegateAssignmentConflict(error);
        if (conflict) {
          this.delegateAssignmentConflictBySession = { ...this.delegateAssignmentConflictBySession, [key]: true };
          await this.refreshDelegateAssignments(ownerAgentId, sessionId);
          return false;
        }
        const message = acpErrorMessage(error, 'Failed to update delegate model.');
        this.delegateAssignmentsErrorBySession = { ...this.delegateAssignmentsErrorBySession, [key]: message };
        return false;
      }
    });
    const roleKey = `${key}\0${agentId}`;
    this.delegateAssignmentRequests.set(key, request);
    this.delegateAssignmentRoleRequests.set(roleKey, request);
    try {
      return await request;
    } finally {
      if (this.delegateAssignmentRequests.get(key) === request) this.delegateAssignmentRequests.delete(key);
      if (this.delegateAssignmentRoleRequests.get(roleKey) === request) {
        this.delegateAssignmentRoleRequests.delete(roleKey);
        const latestPending = { ...(this.delegateAssignmentPendingBySession[key] ?? {}) };
        delete latestPending[agentId];
        this.delegateAssignmentPendingBySession = {
          ...this.delegateAssignmentPendingBySession,
          [key]: latestPending
        };
      }
    }
  }

  dismissActiveDelegateAssignmentConflict() {
    if (!this.activeAgentId || !this.activeSessionId) return;
    const key = buildSessionKey(this.activeAgentId, this.activeSessionId);
    this.delegateAssignmentConflictBySession = { ...this.delegateAssignmentConflictBySession, [key]: false };
  }

  private clearDelegateAssignmentsForAgent(agentId: string) {
    const prefix = `${agentId}:`;
    const omitAgent = <T>(values: Record<string, T>) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith(prefix)));
    this.delegateAssignmentsBySession = omitAgent(this.delegateAssignmentsBySession);
    this.delegateAssignmentsLoadingBySession = omitAgent(this.delegateAssignmentsLoadingBySession);
    this.delegateAssignmentsErrorBySession = omitAgent(this.delegateAssignmentsErrorBySession);
    this.delegateAssignmentPendingBySession = omitAgent(this.delegateAssignmentPendingBySession);
    this.delegateAssignmentConflictBySession = omitAgent(this.delegateAssignmentConflictBySession);
    for (const key of this.delegateAssignmentRequests.keys()) {
      if (key.startsWith(prefix)) this.delegateAssignmentRequests.delete(key);
    }
    for (const key of this.delegateAssignmentRoleRequests.keys()) {
      if (key.startsWith(prefix)) this.delegateAssignmentRoleRequests.delete(key);
    }
    for (const key of this.delegateAssignmentRefreshVersions.keys()) {
      if (key.startsWith(prefix)) this.delegateAssignmentRefreshVersions.delete(key);
    }
  }

  private async hydrateUndoStack(agentId: string, sessionId: string, client: DesktopAcpClient) {
    if (!client.supportsQuerymtMethod(QMT_METHOD_SESSION_UNDO_STACK)) {
      this.activeSession.undo.stack = [];
      return;
    }
    try {
      const response = await client.getUndoStack(sessionId);
      if (this.isSelectedSession(agentId, sessionId)) {
        this.activeSession.undo.stack = response.undo_stack.map((frame) => frame.message_id);
      }
    } catch (error) {
      console.warn('Failed to load QueryMT undo stack', error);
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

  private connectGeneration(agentId: string): number {
    return this.connectGenerations.get(agentId) ?? 0;
  }

  private invalidateConnectGeneration(agentId: string) {
    this.connectGenerations.set(agentId, this.connectGeneration(agentId) + 1);
  }

  private bumpMeshRefreshGeneration(agentId: string): number {
    const generation = (this.meshRefreshGenerations.get(agentId) ?? 0) + 1;
    this.meshRefreshGenerations.set(agentId, generation);
    return generation;
  }

  private isMeshRefreshCurrent(agentId: string, generation: number, record: AgentClientRecord): boolean {
    return this.meshRefreshGenerations.get(agentId) === generation && this.clients.get(agentId) === record;
  }

  private disposeClient(agentId: string) {
    for (const [key, retry] of this.supersededListRetries) if (retry.agentId === agentId) {
      if (retry.timer !== null) clearTimeout(retry.timer);
      this.supersededListRetries.delete(key);
    }
    const sharedSource = this.sharedListSources.get(agentId);
    if (sharedSource) this.sessionListSharing?.drop(sharedSource);
    this.sharedListSources.delete(agentId);
    this.sharedListVersions.set(agentId, (this.sharedListVersions.get(agentId) ?? 0) + 1);
    this.clearScheduledSessionRefresh(agentId);
    this.routineSessionRefreshes.delete(agentId);
    for (const key of new Set([...this.sessionRuntimeRefreshTimers.keys(), ...this.sessionRuntimeRefreshPromises.keys()])) {
      if (key.startsWith(`${agentId}:`)) {
        this.cancelSessionRuntimeRefresh(key);
        this.sessionRuntimeRefreshPromises.delete(key);
      }
    }
    for (const key of this.lifecycleReads.keys()) {
      if (key.startsWith(`${agentId}:`)) this.lifecycleReads.delete(key);
    }
    const record = this.clients.get(agentId);
    if (!record) return;
    const flight = this.connectFlights.get(agentId);
    if (flight?.owner === record) {
      this.connectFlights.delete(agentId);
      flight.abort();
    }
    record.unsubscribeSessionUpdates?.();
    record.unsubscribeExtensionNotifications?.();
    record.unsubscribeConnectionLoss?.();
    record.unsubscribeInbox?.();
    inboxStore.disconnectAgent(agentId);
    void record.client.disconnect();
    delete this.openSessionPages[agentId];
    this.clearSessionPins(agentId);
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
        if (notification.method === QMT_NOTIFICATION_SESSION_PINS_CHANGED) {
          this.sessionCatalogCache.update((entry) => entry.key.startsWith('pins:') && (!entry.scope || entry.scope.agentIds.includes(agentId))
            ? { ...entry, complete: false } : entry);
          this.invalidateSharedSessionLists(agentId);
          if (!this.pollingIsVisible()) return;
          if (!Object.entries(this.sessionPinPending).some(([key, pending]) => key.startsWith(`${agentId}:`) && pending)) {
            void this.ensurePinnedSessions(true, agentId);
          }
        }
        if (notification.method === QMT_NOTIFICATION_SESSION_INPUT_STATE) {
          this.applyInputStateNotification(agentId, notification.params as SessionInputStateNotification);
        }
        if (notification.method === 'querymt/session/delegateModelsChanged') {
          const params = notification.params as DelegateModelsChangedNotification;
          if (this.isSelectedSession(agentId, params.session_id)) {
            void this.refreshDelegateAssignments(agentId, params.session_id);
          }
        }
        if (notification.method === 'querymt/session/delegationUpdate') {
          const params = (notification.params ?? {}) as {
            sessionId?: string;
            session_id?: string;
            toolCallId?: string;
            tool_call_id?: string;
            childSessionId?: string;
            child_session_id?: string;
          };
          const sessionId = params.sessionId ?? params.session_id;
          if (sessionId) {
            this.rememberSessionChildren(agentId, sessionId, [params.childSessionId ?? params.child_session_id]);
            if (this.isSelectedSession(agentId, sessionId)) {
              this.activeSession = applyDelegationChildSession(this.activeSession, params);
            }
          }
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
          void this.refreshMeshAvailability(agentId);
          chatPreferencesStore.initialize();
          if (chatPreferencesStore.showRemoteSessions && chatPreferencesStore.remoteSessionPeers.length > 0) {
            if (this.pollingIsVisible()) void this.refreshSessionsForAgent(agentId, true);
          }
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
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      return [];
    }

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
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    return record.client.startProviderOAuth(provider);
  }

  async completeProviderSignIn(agentId: string, flow_id: string, response: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.completeProviderOAuth(flow_id, response);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async disconnectProvider(agentId: string, provider: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.disconnectProviderOAuth(provider);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async setProviderApiToken(agentId: string, provider: string, api_key: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.setProviderApiToken(provider, api_key);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async clearProviderApiToken(agentId: string, provider: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.clearProviderApiToken(provider);
    await Promise.allSettled([this.refreshAuthProviders(agentId), this.refreshModelsForAgent(agentId)]);
    return result;
  }

  async setProviderAuthMethod(agentId: string, provider: string, method: AuthMethod) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
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
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
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
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const schedules = await record.client.listSchedules(node_id ? { node_id } : {});
    this.schedulesByAgent = {
      ...this.schedulesByAgent,
      [agentId]: schedules
    };
    return schedules;
  }

  async createSchedule(agentId: string, request: CreateScheduleControlRequest) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
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
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
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

  private clearMeshStateForAgent(agentId: string) {
    // Invalidate first: pending refresh commits and catches owned by older
    // tokens must be suppressed by the ownership check, not resurrect or
    // clobber this explicit invalidation.
    this.bumpMeshRefreshGeneration(agentId);
    this.meshStatusByAgent = { ...this.meshStatusByAgent, [agentId]: null };
    this.meshNodesByAgent = { ...this.meshNodesByAgent, [agentId]: null };
    this.meshInvitesByAgent = { ...this.meshInvitesByAgent, [agentId]: null };
  }

  private async refreshMeshForRecord(agentId: string, generation: number, record: AgentClientRecord) {
    const [meshStatus, meshNodes, meshInvites] = await Promise.all([
      record.client.listMeshStatus(),
      record.client.listMeshNodes(),
      record.client.listMeshInvites().catch(() => null)
    ]);
    // A stop/restart/reconnect or a newer refresh owns this slot now; a stale
    // response must not overwrite newer mesh state.
    if (!this.isMeshRefreshCurrent(agentId, generation, record)) {
      return null;
    }
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
    if (this.activeAgentId === agentId && this.activeSessionId && configuredModelIdentity(this.activeSession.configOptions)) {
      this.restoreSessionModel(agentId, this.activeSessionId, this.activeSession.configOptions);
    }
    return { meshStatus, meshNodes, meshInvites };
  }

  private async refreshMeshAvailability(agentId: string) {
    // Mesh is an optional extension: an agent without the capability (or a
    // transient RPC failure) simply reports no available nodes, matching how
    // optional mesh data is handled elsewhere. Availability must never break
    // the connection itself and must never connect as a side effect, so this
    // only refreshes an already initialized client and absorbs rejections.
    // A rejection owned by an older generation/record is swallowed without
    // clearing newer data; clearMeshStateForAgent bumps the token itself,
    // which is why the check must happen before clearing.
    const record = this.initializedClientRecord(agentId);
    if (!record) return;
    const generation = this.bumpMeshRefreshGeneration(agentId);
    try {
      await this.refreshMeshForRecord(agentId, generation, record);
    } catch {
      if (this.isMeshRefreshCurrent(agentId, generation, record)) {
        this.clearMeshStateForAgent(agentId);
      }
    }
  }

  async refreshMeshForAgent(agentId: string) {
    // Manual refresh for the mesh page and invite flows: unlike
    // refreshMeshAvailability it may connect and it rejects on failure. It
    // may resolve without writing state when superseded. The generation token
    // is claimed only after the connection completes: the connection itself
    // triggers the automatic refreshMeshAvailability hook which bumps and
    // consumes the token, so claiming first would strand the manual refresh
    // with an already-stale token whose success gets suppressed.
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const generation = this.bumpMeshRefreshGeneration(agentId);
    return this.refreshMeshForRecord(agentId, generation, record);
  }

  async createMeshInvite(agentId: string, request: CreateMeshInviteRequest = {}) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.createMeshInvite(request);
    this.lastMeshInviteByAgent = {
      ...this.lastMeshInviteByAgent,
      [agentId]: result
    };
    await this.refreshMeshForAgent(agentId);
    return result;
  }

  async revokeMeshInvite(agentId: string, invite_id: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.revokeMeshInvite({ invite_id });
    this.lastMeshRevokeByAgent = {
      ...this.lastMeshRevokeByAgent,
      [agentId]: result
    };
    await this.refreshMeshForAgent(agentId);
    return result;
  }

  async refreshRemoteSessionsForAgent(agentId: string, node_id: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
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
    const isCurrentSource = this.sessionMutationScope(agentId);
    const result = await this.createRemoteSessionAttach(agentId, node_id, cwd);
    if (isCurrentSource()) await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return result;
  }

  private async createAttachedRemoteSession(agentId: string, node_id: string, cwd: string, profileId?: string): Promise<string> {
    const isCurrentSource = this.sessionMutationScope(agentId);
    const record = await this.connectInitializedRecord(agentId);
    const result = await this.createRemoteSessionAttach(agentId, node_id, cwd, profileId);
    if (!isCurrentSource() || this.clients.get(agentId) !== record) return result.session_id;
    return this.hydrateRemoteAttach(agentId, node_id, result, {
      id: result.session_id,
      node_id,
      cwd,
      updated_at: new Date().toISOString()
    });
  }

  private async createRemoteSessionAttach(agentId: string, node_id: string, cwd?: string, profileId?: string) {
    const isCurrentSource = this.sessionMutationScope(agentId);
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    if (!isCurrentSource()) throw new Error('Agent endpoint changed before creating the session.');
    const result = await record.client.createRemoteSession({ node_id, cwd, attach: true, ...(profileId ? { profile_id: profileId } : {}) });
    if (!this.canPublishCreatedSession(agentId, record, isCurrentSource)) return result;
    const config = this.configs.find((candidate) => candidate.id === agentId)!;
    if (cwd) {
      const lifecycle = record.client.supportsSessionLifecycle()
        ? await record.client.getSessionLifecycle(result.session_id).catch(() => null) : null;
      if (!this.canPublishCreatedSession(agentId, record, isCurrentSource)) return result;
      const summary: DesktopSessionSummary = {
        agentId, agentName: config.name, sessionId: result.session_id, title: 'Untitled session', cwd,
        updatedAt: new Date().toISOString(), runtimeId: agentId, runtimeName: config.name,
        source: 'acp', location: 'remote', remoteNodeId: node_id, remoteConnectionState: 'available',
        relationshipKnown: true, lifecycle, status: 'idle'
      };
      this.invalidateSharedSessionLists(agentId);
      delete this.openSessionPages[agentId];
      this.patchSessionCatalog(agentId, result.session_id, summary);
      this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: mergeSessions(this.sessionsByAgent[agentId] ?? [], [summary]) };
      this.upsertWorkspaceSessions(agentId, [summary]);
    } else {
      // Without an owner-reported workspace, the new row cannot be placed safely.
      this.invalidateSessionCatalogCache();
    }
    this.lastRemoteAttachByAgent = {
      ...this.lastRemoteAttachByAgent,
      [agentId]: result
    };
    return result;
  }

  /** Attach without letting a delayed response replace a newer selection. */
  async attachRemoteSession(agentId: string, node_id: string, session_id: string, expectedGeneration?: number) {
    const generation = expectedGeneration ?? ++this.sessionSelectionGeneration;
    const remoteSession = this.remoteSessionsByAgent[agentId]?.[node_id]?.sessions.find((session) => session.id === session_id);
    let result: RemoteSessionAttachInfo;
    try {
      const record = await this.connectInitializedRecord(agentId);
      if (generation !== this.sessionSelectionGeneration) return session_id;
      if (!record) {
        throw new Error('Failed to connect to the agent.');
      }
      result = await record.client.attachRemoteSession({ node_id, session_id });
      if (generation !== this.sessionSelectionGeneration) return session_id;
      if (result.session_id !== session_id || result.node_id !== node_id) {
        throw new Error('Remote attachment identity does not match the requested session.');
      }
    } catch (error) {
      // A fallback load owns its cleanup; only an explicit attachment can
      // inherit loading from the operation it superseded.
      if (expectedGeneration === undefined && generation === this.sessionSelectionGeneration) {
        this.sessionHistoryLoading = false;
      }
      throw error;
    }
    this.lastRemoteAttachByAgent = {
      ...this.lastRemoteAttachByAgent,
      [agentId]: result
    };
    const discovered = this.sessionsByAgent[agentId]?.find((session) => session.sessionId === session_id && session.remoteNodeId === node_id);
    return this.hydrateRemoteAttach(agentId, node_id, result, remoteSession ?? {
      id: session_id, node_id, title: discovered?.title, cwd: discovered?.cwd, updated_at: discovered?.updatedAt ?? undefined,
      profile_id: discovered?.remoteProfileId, profile_label: discovered?.remoteProfileLabel
    }, true);
  }

  /** Publish the owner's snapshot and metadata after attachment validation. */
  private async hydrateRemoteAttach(
    agentId: string,
    nodeId: string,
    result: RemoteSessionAttachInfo,
    remoteSession: { id: string; node_id: string; title?: string; cwd?: string; updated_at?: string;
      profile_id?: string | null; profile_label?: string | null },
    preserveSelectionGeneration = false
  ): Promise<string> {
    const config = this.configs.find((candidate) => candidate.id === agentId);
    if (!config) throw new Error(`Unable to locate agent ${agentId}.`);

    const sessionId = result.session_id;
    this.resetActiveSession(agentId, sessionId, preserveSelectionGeneration);
    const configOptions = result.config_options ?? [];
    const snapshot = activeSessionFromLoadResponse(sessionId, {
      _meta: { 'querymt/sessionLoadSnapshot.v1': result.snapshot }
    });
    snapshot.configOptions = configOptions;
    this.activeSession = normalizeHistoricalSession(snapshot, { loadCompleted: true });
    this.rememberSnapshotUserMessages(snapshot);
    this.rememberSessionChildren(agentId, sessionId, this.activeSession.toolCalls.map((tool) => tool.childSessionId));
    this.reconcileInputStatesFromSnapshot(agentId, sessionId, {
      _meta: { 'querymt/sessionLoadSnapshot.v1': result.snapshot }
    });
    this.applySessionConfigOptionsSnapshot(agentId, sessionId, configOptions);
    const current = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    const summary: DesktopSessionSummary = {
      ...current,
      agentId,
      agentName: config.name,
      sessionId,
      relationshipKnown: current?.relationshipKnown ?? false,
      title: remoteSession.title?.trim() || sessionId,
      cwd: remoteSession.cwd ?? '',
      updatedAt: remoteSession.updated_at ?? new Date().toISOString(),
      runtimeId: agentId,
      runtimeName: config.name,
      source: 'acp',
      location: 'remote',
      remoteNodeId: nodeId,
      remoteNodeLabel: this.meshNodesByAgent[agentId]?.nodes.find((node) => node.id === nodeId)?.label,
      remoteProfileId: result.profile_id === undefined ? remoteSession.profile_id ?? undefined : result.profile_id ?? undefined,
      remoteProfileLabel: result.profile_label === undefined &&
        (result.profile_id === undefined || result.profile_id === remoteSession.profile_id)
        ? remoteSession.profile_label ?? undefined : result.profile_label ?? undefined,
      status: 'idle'
    };
    this.sessionsByAgent = {
      ...this.sessionsByAgent,
      [agentId]: mergeSessions(this.sessionsByAgent[agentId] ?? [], [summary])
    };
    // Resolve owner-local model identities only after publishing the owner node.
    this.restoreSessionModel(agentId, sessionId, configOptions, {
      _meta: { 'querymt/sessionLoadSnapshot.v1': result.snapshot }
    });
    this.seedSessionModePreferenceFromLoad(agentId, sessionId);
    this.updateWorkspaceDiscovery(config, [summary], false);
    this.hydratedRemoteSessionKeys.add(buildSessionKey(agentId, sessionId));
    this.rememberRecentSession(agentId, sessionId);
    // Attachment is committed; a retryable catalog refresh must not fail its load.
    await this.refreshRemoteSessionsForAgent(agentId, nodeId).catch((error) => {
      console.warn('Remote session attached, but catalog refresh failed', error);
    });
    return sessionId;
  }

  async dismissRemoteSession(agentId: string, node_id: string, session_id: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      throw new Error('Failed to connect to the agent.');
    }
    const result = await record.client.dismissRemoteSession(session_id);
    this.lastRemoteDismissByAgent = {
      ...this.lastRemoteDismissByAgent,
      [agentId]: result
    };
    await this.refreshRemoteSessionsForAgent(agentId, node_id);
    return result;
  }

  private async drainQueuedSessionUpdates(agentId: string, sessionId: string): Promise<number> {
    if (!platformCapabilities.managesAgents) return 0;
    try {
      const queued = await drainAgentSessionUpdates(agentId, sessionId);
      this.activeLoadMeasurement?.increment('drainedNotifications', queued.length);
      let applied = 0;
      this.applyingDrainedUpdates = true;
      for (const notification of queued as SessionNotification[]) {
        const record = this.ensureClientRecord(agentId);
        const before = this.activeSession.events.length;
        this.handleSessionNotification(agentId, notification, record);
        if (this.activeSession.events.length > before) {
          applied += 1;
        }
      }
      this.applyingDrainedUpdates = false;
      return applied;
    } catch {
      this.applyingDrainedUpdates = false;
      // Ignore drain failures and continue with live session streaming.
      return 0;
    }
  }

  async refreshModelsForAgent(agentId: string) {
    const record = await this.connectInitializedRecord(agentId);
    if (!record) {
      return;
    }
    await this.loadModelsForAgent(agentId, () => record.client.refreshAndListModels(), 'Failed to refresh models.', {
      refreshModelInfo: true
    });
  }

  private async loadModelsForAgent(
    agentId: string,
    load: () => Promise<ModelEntry[]>,
    errorMessage: string,
    options: { keepExistingOnEmpty?: boolean; suppressEmptyError?: boolean; refreshModelInfo?: boolean } = {}
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
      await this.hydrateModelInfo(agentId, models, options.refreshModelInfo);
      this.selectLaunchModelForAgent(agentId, models);
      if (this.activeAgentId === agentId && this.activeSessionId && configuredModelIdentity(this.activeSession.configOptions)) {
        this.restoreSessionModel(agentId, this.activeSessionId, this.activeSession.configOptions);
      }
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
    const seen = new Set<string>();
    return recentIds
      .map((selectionKey) => findModelBySelectionKey(allModels, selectionKey) ?? null)
      .filter((entry): entry is ModelEntry => {
        if (!entry) return false;
        const selectionKey = getModelSelectionKey(entry);
        if (seen.has(selectionKey)) return false;
        seen.add(selectionKey);
        return true;
      });
  }

  getRecentDelegateModels(ownerAgentId: string, profileId: string | null, delegateAgentId: string): ModelEntry[] {
    const key = JSON.stringify([ownerAgentId, profileId, delegateAgentId]);
    const available = new Map((this.modelsByAgent[ownerAgentId] ?? []).map((model) => [getModelSelectionKey(model), model]));
    return (this.recentModelsByDelegate[key] ?? []).flatMap((selectionKey) => {
      const model = available.get(selectionKey);
      return model ? [model] : [];
    });
  }

  private rememberRecentDelegateModel(
    ownerAgentId: string,
    profileId: string | null,
    delegateAgentId: string,
    model: DelegateModelOverride
  ) {
    // Delegate IDs such as "coder" can be reused by different agents/profiles.
    const key = JSON.stringify([ownerAgentId, profileId, delegateAgentId]);
    const selectionKey = getModelSelectionKey({ id: model.model_id, node_id: model.node_id });
    const current = this.recentModelsByDelegate[key] ?? [];
    this.recentModelsByDelegate = {
      ...this.recentModelsByDelegate,
      [key]: [selectionKey, ...current.filter((entry) => entry !== selectionKey)].slice(0, RECENT_MODELS_LIMIT)
    };
    persistRecentModels(this.recentModelsByDelegate, RECENT_DELEGATE_MODELS_STORAGE_KEY);
  }

  /**
   * Resolves and keeps the launch model for one agent against the current
   * catalog: keep an explicit selection while it is still available, else the
   * first available entry from the agent's recent history, else the catalog
   * default.
   */
  private selectLaunchModelForAgent(agentId: string, models: ModelEntry[]) {
    if (models.length === 0) {
      return;
    }

    const selected = this.launchModelIds[agentId];
    if (selected && findModelBySelectionKey(models, selected)) return;

    const recentModel = (this.recentModelsByAgent[agentId] ?? [])
      .map((selectionKey) => findModelBySelectionKey(models, selectionKey))
      .find((model): model is ModelEntry => Boolean(model));
    this.launchModelIds = {
      ...this.launchModelIds,
      [agentId]: recentModel ? getModelSelectionKey(recentModel) : getDefaultModelId(models)
    };
  }

  private rememberRecentModel(agentId: string, model: ModelEntry) {
    const selectionKey = getModelSelectionKey(model);
    const current = this.recentModelsByAgent[agentId] ?? [];
    const next = [selectionKey, ...current.filter((entry) => entry !== selectionKey)].slice(0, RECENT_MODELS_LIMIT);
    this.recentModelsByAgent = {
      ...this.recentModelsByAgent,
      [agentId]: next
    };
    persistRecentModels(this.recentModelsByAgent);
  }

  /** Reads the saved model/reasoning preference for one agent, session, and mode. */
  getSessionModePreference(agentId: string, sessionId: string, modeId: string) {
    return readSessionModePreference(this.sessionModePreferences, agentId, sessionId, modeId);
  }

  /**
   * Persists a preference patch for a mode. Callers must only pass values the
   * agent has already confirmed (write responses, authoritative updates, or
   * session-load state) — requested values are never persisted optimistically.
   * Model ids are exact selection keys, so mesh copies stay distinct from
   * local models.
   */
  private saveSessionModePreference(agentId: string, sessionId: string, modeId: string, patch: SessionModePreferencePatch) {
    this.sessionModePreferences = withSessionModePreference(this.sessionModePreferences, agentId, sessionId, modeId, patch);
    persistSessionModePreferences(this.sessionModePreferences);
  }

  private removeSessionModePreferences(agentId: string, sessionId: string) {
    this.sessionModePreferences = withoutSessionModePreferences(this.sessionModePreferences, agentId, sessionId);
    persistSessionModePreferences(this.sessionModePreferences);
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

  private async applyComposerLaunchConfig(
    agentId: string,
    sessionId: string,
    launch: { modeId: string; reasoningId: string }
  ) {
    for (const kind of ['mode', 'reasoning'] as const) {
      const configOptions = this.getSessionConfigOptions(agentId, sessionId);
      const option = kind === 'mode' ? findModeConfigOption(configOptions) : findReasoningConfigOption(configOptions);
      const value = kind === 'mode' ? launch.modeId : launch.reasoningId;
      if (!option) continue;
      if (!getConfigOptionChoices(option).some((choice) => choice.value === value)) {
        if (kind === 'mode' && this.composerModeId === value) this.composerModeId = option.currentValue;
        if (kind === 'reasoning' && this.composerReasoningId === value) this.composerReasoningId = option.currentValue;
        continue;
      }
      if (option.currentValue !== value) {
        await this.updateSessionConfigOption(agentId, sessionId, option.id, value);
      }
    }
  }

  private getSessionConfigOptions(agentId: string, sessionId: string): SessionConfigOption[] {
    return this.sessionConfigOptions.get(buildSessionKey(agentId, sessionId)) ??
      (this.isSelectedSession(agentId, sessionId) ? this.activeSession.configOptions : []);
  }

  /**
   * Merges a config-option patch by option id into the confirmed snapshot for
   * a session. Partial responses (mode-only, model-only, reasoning-only) must
   * not erase unrelated confirmed options or make the active mode unknown.
   */
  private mergeSessionConfigOptions(agentId: string, sessionId: string, patch: SessionConfigOption[]): SessionConfigOption[] {
    const key = buildSessionKey(agentId, sessionId);
    const existing = this.getSessionConfigOptions(agentId, sessionId);
    if (existing.length === 0) {
      return this.applySessionConfigOptionsSnapshot(agentId, sessionId, patch);
    }

    const patchIds = new Set(patch.map((option) => option.id));
    const merged = [...existing.filter((option) => !patchIds.has(option.id)), ...patch];
    this.sessionConfigOptions.set(key, merged);
    const modeId = getCurrentModeId(merged);
    if (modeId) this.sessionModeIds = { ...this.sessionModeIds, [key]: modeId };
    if (this.isSelectedSession(agentId, sessionId)) this.activeSession.configOptions = merged;
    return merged;
  }

  /** Applies a complete, authoritative config snapshot (session load or creation). */
  private applySessionConfigOptionsSnapshot(agentId: string, sessionId: string, configOptions: SessionConfigOption[]): SessionConfigOption[] {
    const key = buildSessionKey(agentId, sessionId);
    this.sessionConfigOptions.set(key, configOptions);
    const modeId = getCurrentModeId(configOptions);
    if (modeId) this.sessionModeIds = { ...this.sessionModeIds, [key]: modeId };
    if (this.isSelectedSession(agentId, sessionId)) this.activeSession.configOptions = configOptions;
    return configOptions;
  }

  /** Snapshot of the confirmed session configuration used to capture preferences. */
  private captureConfirmedSessionState(agentId: string, sessionId: string): {
    modeId: string;
    modelId: string;
    reasoningId: string;
  } | null {
    const key = buildSessionKey(agentId, sessionId);
    const configOptions = this.getSessionConfigOptions(agentId, sessionId);
    const modeId = this.sessionModeIds[key] ?? getCurrentModeId(configOptions) ?? '';
    if (!modeId) return null;
    return {
      modeId,
      modelId: this.sessionModelIds[key] ?? '',
      reasoningId: getCurrentReasoningId(configOptions) ?? ''
    };
  }

  /**
   * Saves the confirmed configuration for the active mode. Only confirmed
   * values are written; unknown fields are left untouched rather than treated
   * as empty selections.
   */
  private persistConfirmedSessionPreference(agentId: string, sessionId: string) {
    const confirmed = this.captureConfirmedSessionState(agentId, sessionId);
    if (!confirmed) return;
    this.saveSessionModePreference(agentId, sessionId, confirmed.modeId, {
      modelId: confirmed.modelId || undefined,
      reasoningId: confirmed.reasoningId || undefined
    });
  }

  /**
   * After an existing-session load, the agent-reported active configuration is
   * the authority: seed the loaded mode's preference from it without issuing
   * config writes. Fields the agent did not report (e.g. missing model
   * metadata) stay untouched instead of being substituted with local guesses.
   */
  private seedSessionModePreferenceFromLoad(agentId: string, sessionId: string) {
    this.persistConfirmedSessionPreference(agentId, sessionId);
  }

  getSessionModelLocation(agentId: string, sessionId: string): ModelLocationContext {
    const servingNodeId = this.meshStatusByAgent[agentId]?.peer_id;
    const session = getSessionById(this.sessionsByAgent[agentId] ?? [], sessionId);
    return {
      servingNodeId,
      ownerNodeId: session?.remoteNodeId ?? servingNodeId,
      servingNodeLabel: this.meshStatusByAgent[agentId]?.hostname
    };
  }

  private restoreSessionModel(agentId: string, sessionId: string, configOptions: SessionConfigOption[], response?: unknown) {
    const configuredId = getCurrentModelId(configOptions);
    const snapshot = getSnapshotProviderChange(response);
    const identity = configuredModelIdentity(configOptions) ??
      (!configuredId || configuredId === `${snapshot?.provider}/${snapshot?.model}` ? snapshot : undefined);
    // Legacy confirmations identify the model but not its node. Do not turn an
    // unchanged remote selection into the same-named local catalog entry.
    const previous = findModelBySelectionKey(this.modelsByAgent[agentId] ?? [], this.getSessionModelId(agentId, sessionId));
    const modelId = identity
      ? resolveSessionModelKey(this.modelsByAgent[agentId] ?? [], identity, this.getSessionModelLocation(agentId, sessionId))
      : previous && previous.id === configuredId ? getModelSelectionKey(previous) : configuredId ?? '';
    this.sessionModelIds = { ...this.sessionModelIds, [buildSessionKey(agentId, sessionId)]: modelId };
  }

  private async applySelectedModelToSession(agentId: string, sessionId: string, modelId: string, transitionOwned = false) {
    if (!modelId) return;
    const model = (this.modelsByAgent[agentId] ?? []).find((entry) => getModelSelectionKey(entry) === modelId);
    if (!model) throw new Error(`Selected model is unavailable: ${modelId}`);

    const configId = findModelConfigOption(this.getSessionConfigOptions(agentId, sessionId))?.id ?? 'model';
    await this.updateSessionConfigOption(agentId, sessionId, configId, model.id, { model, transitionOwned });
  }

  async setActiveSessionConfigOption(configId: string, value: string) {
    if (!this.activeAgentId || !this.activeSessionId) {
      throw new Error('No active session selected.');
    }

    // Mode controls route through the semantic transition operation so the
    // outgoing preference is captured and the target mode's preferences are
    // restored in order.
    const modeOptionId = findModeConfigOption(this.getSessionConfigOptions(this.activeAgentId, this.activeSessionId))?.id;
    if (isModeConfigOptionId(configId) || (modeOptionId != null && configId === modeOptionId)) {
      await this.setSessionMode(this.activeAgentId, this.activeSessionId, value);
      return;
    }

    await this.updateSessionConfigOption(this.activeAgentId, this.activeSessionId, configId, value);
  }

  /**
   * Applies one session config write. Returns the merged confirmed options
   * and, when the agent's response carried model metadata, the selection key
   * it confirmed — absent otherwise, so callers never mistake the previously
   * displayed selection for an agent confirmation.
   */
  private async updateSessionConfigOption(
    agentId: string,
    sessionId: string,
    configId: string,
    value: string,
    options: { model?: ModelEntry; transitionOwned?: boolean } = {}
  ): Promise<{ configOptions: SessionConfigOption[]; confirmedModelKey?: string }> {
    const key = buildSessionKey(agentId, sessionId);
    const pending = this.pendingSessionConfigs[key] ?? {};
    this.pendingSessionConfigs = {
      ...this.pendingSessionConfigs,
      [key]: { ...pending, [configId]: (pending[configId] ?? 0) + 1 }
    };
    // Serialize mode/model changes for this session; another session can update
    // independently. Writes owned by a mode transition run inline inside that
    // transition instead of chaining onto its own queue entry (which would
    // deadlock); user writes issued while a transition is in flight still chain
    // behind it and stay serialized.
    const ownsQueue = !options.transitionOwned;
    const previous = ownsQueue ? this.sessionConfigRequests.get(key) : null;
    const request = (async () => {
      if (previous) await previous.catch(() => undefined);
      const record = await this.connectInitializedRecord(agentId);
      if (!record) {
        throw new Error('Failed to connect to the agent.');
      }
      const payload = options.model
        ? setModelConfigOptionRequest(sessionId, options.model, configId)
        : setSessionConfigOptionRequest(sessionId, configId, value);
      const response = await record.client.setSessionConfigOption(payload);
      // ACP may answer with only the options relevant to the write; merge the
      // patch by option id so unrelated confirmed options survive.
      let configOptions = this.mergeSessionConfigOptions(agentId, sessionId, response);
      // Model confirmation is read from the raw response: an empty patch
      // carries no model metadata and must not resurrect stale options.
      const confirmedId = getCurrentModelId(response);
      // Selection changes only when the response carries model metadata; a mode
      // change may omit it, in which case the last known selection is kept.
      let confirmedModelKey: string | undefined;
      if (confirmedId) {
        if (configuredModelIdentity(response)) {
          this.restoreSessionModel(agentId, sessionId, response);
          confirmedModelKey = this.getSessionModelId(agentId, sessionId);
        } else {
          const selectedModel = options.model ?? findModelBySelectionKey(this.modelsByAgent[agentId] ?? [], this.getSessionModelId(agentId, sessionId));
          confirmedModelKey = selectedModel?.id === confirmedId ? getModelSelectionKey(selectedModel) : confirmedId;
          this.sessionModelIds = { ...this.sessionModelIds, [key]: confirmedModelKey };
        }
      } else if (options.model) {
        // An acknowledgement without model metadata must retire the old identity,
        // or a later catalog/mesh refresh will restore the previous selection.
        const modelOption = findModelConfigOption(configOptions);
        if (modelOption) {
          const querymt = { ...(modelOption._meta?.querymt as Record<string, unknown> | undefined) };
          delete querymt.modelEntry;
          configOptions = this.mergeSessionConfigOptions(agentId, sessionId, [{
            ...modelOption, currentValue: options.model.id,
            _meta: { ...modelOption._meta, querymt }
          }]);
        }
        this.sessionModelIds = { ...this.sessionModelIds, [key]: getModelSelectionKey(options.model) };
      }
      if (isModeConfigOptionId(configId)) {
        // A resolved mode write is confirmed even when the response omits the
        // mode option (older servers ack without config options).
        this.sessionModeIds = { ...this.sessionModeIds, [key]: getCurrentModeId(response) ?? value };
      }
      // Recency tracks explicit user selections only; transition-owned restore
      // writes must not reorder recent models.
      if (options.model && !options.transitionOwned && (!confirmedId || confirmedId === options.model.id)) {
        this.rememberRecentModel(agentId, options.model);
      }
      // Explicit model/reasoning writes confirm a preference for the currently
      // active mode; transition restore writes are persisted once, at the end.
      if (
        !options.transitionOwned &&
        (isModelConfigOptionId(configId) || isReasoningConfigOptionId(configId))
      ) {
        this.persistConfirmedSessionPreference(agentId, sessionId);
      }
      return { configOptions, confirmedModelKey };
    })();
    if (ownsQueue) this.sessionConfigRequests.set(key, request);
    try {
      return await request;
    } finally {
      const pending = this.pendingSessionConfigs[key] ?? {};
      this.pendingSessionConfigs = {
        ...this.pendingSessionConfigs,
        [key]: { ...pending, [configId]: Math.max(0, (pending[configId] ?? 1) - 1) }
      };
      if (ownsQueue && this.sessionConfigRequests.get(key) === request) this.sessionConfigRequests.delete(key);
    }
  }

  private async hydrateModelInfo(agentId: string, models: ModelEntry[], refresh = false) {
    if (models.length === 0) {
      this.modelInfoByAgent = { ...this.modelInfoByAgent, [agentId]: {} };
      return;
    }

    const identities = new Map<string, { provider: string; model: string }>();
    for (const entry of models) {
      identities.set(`${entry.provider}/${entry.model}`, { provider: entry.provider, model: entry.model });
    }

    const requests = new Set<Promise<void>>();
    const missing = [...identities.entries()].filter(([key]) => {
      if (refresh) return true;
      const pending = this.modelInfoRequests.get(key);
      if (pending) requests.add(pending);
      return !this.modelInfoCache.has(key) && !pending;
    });

    if (missing.length > 0) {
      const record = this.ensureClientRecord(agentId);
      let request!: Promise<void>;
      request = record.client
        .getModelInfo(missing.map(([, identity]) => identity))
        .then((infoByKey) => {
          for (const [key] of missing) {
            this.modelInfoCache.set(key, infoByKey[key] ?? null);
          }
          this.projectModelInfoForAllAgents();
        })
        .catch((error) => {
          console.error('Failed to load model capabilities', error);
          for (const [key] of missing) this.modelInfoCache.set(key, null);
          this.projectModelInfoForAllAgents();
        })
        .finally(() => {
          for (const [key] of missing) {
            if (this.modelInfoRequests.get(key) === request) this.modelInfoRequests.delete(key);
          }
        });

      for (const [key] of missing) this.modelInfoRequests.set(key, request);
      requests.add(request);
    }

    await Promise.all(requests);
    this.projectModelInfoForAllAgents();
  }

  private projectModelInfoForAllAgents() {
    const projected = Object.fromEntries(
      Object.entries(this.modelsByAgent).map(([agentId, models]) => [
        agentId,
        models.reduce<Record<string, ModelInfo | null>>((acc, entry) => {
          acc[getModelSelectionKey(entry)] = this.modelInfoCache.get(`${entry.provider}/${entry.model}`) ?? null;
          return acc;
        }, {})
      ])
    );
    this.modelInfoByAgent = projected;
  }

  private reconcileInputStatesFromSnapshot(agentId: string, sessionId: string, response: unknown) {
    const key = buildSessionKey(agentId, sessionId);
    let pending = this.pendingInputsBySession[key] ?? [];
    for (const state of getSnapshotInputStates(response)) {
      if (['applied', 'started', 'discarded'].includes(state.state)) {
        pending = pending.filter((input) => input.inputId !== state.inputId);
        continue;
      }
      const existing = pending.find((input) => input.inputId === state.inputId);
      if (!existing && (state.prompt === undefined || state.attachments === undefined || state.createdAt === undefined)) {
        continue;
      }
      pending = upsertPendingSessionInput(pending, {
        inputId: state.inputId,
        delivery: state.delivery,
        state: state.state,
        prompt: state.prompt ?? existing?.prompt ?? '',
        attachments: state.attachments ?? existing?.attachments ?? [],
        createdAt: state.createdAt ?? existing?.createdAt ?? Date.now(),
        runId: state.runId,
        position: state.position,
        boundary: state.boundary,
        reason: state.reason,
        latencyMs: state.latencyMs
      });
    }
    this.pendingInputsBySession = { ...this.pendingInputsBySession, [key]: pending };
  }

  /** Reset the view, invalidating prior loads unless this operation already owns a generation. */
  private resetActiveSession(agentId: string, sessionId: string, preserveSelectionGeneration = false) {
    if (!preserveSelectionGeneration) this.sessionSelectionGeneration += 1;
    for (const key of this.sessionRuntimeRefreshTimers.keys()) this.cancelSessionRuntimeRefresh(key);
    this.activeAgentId = agentId;
    this.activeSessionId = sessionId;
    this.activeSession = createEmptyActiveSession();
    this.activeSession.sessionId = sessionId;
    this.snapshotUserMessageIds.clear();
    this.sessionHistoryLoading = false;
    this.promptFailure = null;

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

  private addOptimisticUserPrompt(
    sessionId: string,
    prompt: string,
    attachments: PromptAttachment[],
    clientPromptId: string
  ): number {
    const eventIndex = getNextConversationEventIndex(this.activeSession);
    const id = `${sessionId}-optimistic-user-${eventIndex + 1}`;
    const blocks: SessionContentBlock[] = [
      ...(prompt ? [{ type: 'text' as const, text: prompt }] : []),
      ...attachments.map((attachment): SessionContentBlock => attachment.mimeType.startsWith('image/')
        ? {
            type: 'image',
            data: attachment.data,
            mimeType: attachment.mimeType,
            id: attachment.id,
            name: attachment.name,
            size: attachment.size
          }
        : {
            type: 'resource',
            uri: attachmentUri(attachment),
            mimeType: attachment.mimeType,
            data: attachment.data,
            id: attachment.id,
            name: attachment.name,
            size: attachment.size
          })
    ];
    this.activeSession.transcript.push({
      id,
      kind: 'user_message_chunk',
      text: prompt,
      blocks,
      messageId: id,
      clientPromptId,
      eventIndex
    });
    this.activeSession.events.push({
      id: `${id}-event`,
      kind: 'user_message_chunk',
      text: prompt || `${attachments.length} attachment(s)`,
      messageId: id
    });
    return eventIndex;
  }

  private rememberSnapshotUserMessages(snapshot: ActiveSessionViewModel) {
    this.snapshotUserMessageIds = new Set(snapshot.transcript.flatMap((item) =>
      item.kind === 'user_message_chunk' && item.messageId ? [item.messageId] : []));
  }

  private isSnapshotUserEcho(notification: SessionNotification): boolean {
    const update = notification.update;
    return update.sessionUpdate === 'user_message_chunk' && !!update.messageId &&
      this.snapshotUserMessageIds.has(update.messageId);
  }

  private reconcileOptimisticUserPrompt(notification: SessionNotification): number | undefined {
    const update = notification.update;
    if (update.sessionUpdate !== 'user_message_chunk') return undefined;

    const clientPromptId = readClientPromptId(update) ?? readClientPromptId(notification);
    const canonical = this.activeSession.transcript.find((item) =>
      item.kind === 'user_message_chunk' &&
      !item.id.includes('-optimistic-user-') &&
      ((update.messageId && item.messageId === update.messageId) ||
        (clientPromptId && item.clientPromptId === clientPromptId))
    );
    if (canonical) return canonical.eventIndex;

    const optimisticItems = this.activeSession.transcript.filter((item) =>
      item.kind === 'user_message_chunk' && item.id.includes('-optimistic-user-')
    );
    let optimistic = clientPromptId
      ? optimisticItems.find((item) => item.clientPromptId === clientPromptId)
      : undefined;
    optimistic ??= update.messageId
      ? optimisticItems.find((item) => item.messageId === update.messageId)
      : undefined;

    if (!optimistic) {
      const incoming = normalizeContentBlock(update.content);
      if (incoming) {
        const contentMatches = optimisticItems.filter((item) =>
          getTranscriptBlocks(item).some((block) => contentBlocksMatch(block, incoming))
        );
        if (contentMatches.length === 1) optimistic = contentMatches[0];
      }
    }
    if (!optimistic) {
      // The echo may be a shape normalizeContentBlock drops (e.g. resource_link)
      // or nest attachment identity deeper than the normalized block carries.
      const echoIdentity = readRawAttachmentIdentity(update.content);
      if (echoIdentity) {
        const identityMatches = optimisticItems.filter((item) =>
          getTranscriptBlocks(item).some((block) => attachmentIdentityKey(block) === echoIdentity)
        );
        if (identityMatches.length === 1) optimistic = identityMatches[0];
      }
    }
    if (!optimistic) {
      console.debug('querymt session/update optimistic prompt unmatched', {
        sessionId: this.activeSession.sessionId,
        content: update.content
      });
      return undefined;
    }

    const optimisticMessageId = optimistic.messageId;
    this.activeSession.transcript = this.activeSession.transcript.filter((item) => item.id !== optimistic.id);
    this.activeSession.events = this.activeSession.events.filter((event) => event.messageId !== optimisticMessageId);
    return optimistic.eventIndex;
  }

  private applySessionSummaryUpdates(notifications: Array<{ agentId: string; notification: SessionNotification }>) {
    const patches = new Map<string, Map<string, Partial<DesktopSessionSummary>>>();
    const activityUpdatedAt = new Date().toISOString();
    for (const { agentId, notification } of notifications) {
      const update = notification.update;
      const status = inferSessionStatusFromNotification(update);
      if (!status && update.sessionUpdate !== 'session_info_update') continue;
      let agentPatches = patches.get(agentId);
      if (!agentPatches) patches.set(agentId, agentPatches = new Map());
      const patch = agentPatches.get(notification.sessionId) ?? {};
      if (status) {
        patch.status = status;
        patch.updatedAt = newestTimestamp(patch.updatedAt, activityUpdatedAt);
      }
      if (update.sessionUpdate === 'session_info_update') {
        if (update.title !== undefined) patch.title = update.title ?? 'Untitled session';
        patch.updatedAt = newestTimestamp(patch.updatedAt, update.updatedAt);
      }
      agentPatches.set(notification.sessionId, patch);
    }

    const updated = new Map<string, DesktopSessionSummary>();
    for (const [agentId, agentPatches] of patches) {
      const changes: DesktopSessionSummary[] = [];
      const sessions = (this.sessionsByAgent[agentId] ?? []).map((session) => {
        const patch = agentPatches.get(session.sessionId);
        if (!patch) return session;
        const next = { ...session, ...patch, updatedAt: newestTimestamp(session.updatedAt, patch.updatedAt) };
        if (next.title === session.title && next.status === session.status && next.updatedAt === session.updatedAt) return session;
        const key = getSessionKey(next);
        updated.set(key, next);
        const write = this.catalogWrites.get(key);
        if (write?.session) write.session = { ...write.session, title: next.title, updatedAt: next.updatedAt, status: next.status };
        changes.push(next);
        return next;
      });
      if (!changes.length) continue;
      this.sessionsByAgent = { ...this.sessionsByAgent, [agentId]: sessions };
      this.upsertWorkspaceSessions(agentId, changes);
    }
    if (!updated.size) return;
    const updateKnown = (session: DesktopSessionSummary) => {
      const next = updated.get(getSessionKey(session));
      return next ? { ...session, title: next.title, updatedAt: next.updatedAt, status: next.status } : session;
    };
    this.sessionCatalog = this.sessionCatalog.map(updateKnown);
    if (notifications.some(({ notification }) => notification.update.sessionUpdate === 'session_info_update')) {
      this.sessionCatalogCache.update((entry) => entry.sessions.some((session) => updated.has(getSessionKey(session)))
        ? { ...entry, sessions: entry.sessions.map(updateKnown) } : entry);
    }
    for (const agentId of patches.keys()) {
      this.pinnedSessionsByAgent = { ...this.pinnedSessionsByAgent,
        [agentId]: (this.pinnedSessionsByAgent[agentId] ?? []).map(updateKnown) };
    }
  }

  private handleSessionNotification(
    agentId: string,
    notification: SessionNotification,
    record: AgentClientRecord
  ) {
    if (this.applyingDrainedUpdates) {
      this.applySessionNotificationNow(agentId, notification, record);
      return;
    }

    const kind = notification.update.sessionUpdate;
    const canBatch = kind === 'agent_message_chunk' || kind === 'agent_thought_chunk';
    if (canBatch && this.pendingSessionNotificationFrame !== null) {
      this.pendingSessionNotifications.push({ agentId, notification, record });
      return;
    }

    if (!canBatch) this.flushPendingSessionNotifications();
    this.applySessionNotificationNow(agentId, notification, record);
    if (canBatch) this.schedulePendingSessionNotifications();
  }

  private schedulePendingSessionNotifications() {
    if (this.pendingSessionNotificationFrame !== null) return;
    this.pendingSessionNotificationFrame = requestAnimationFrame(() => {
      this.flushPendingSessionNotifications();
    });
  }

  private cancelPendingSessionNotifications() {
    if (this.pendingSessionNotificationFrame !== null) {
      cancelAnimationFrame(this.pendingSessionNotificationFrame);
      this.pendingSessionNotificationFrame = null;
    }
    this.pendingSessionNotifications = [];
  }

  private flushPendingSessionNotifications() {
    if (this.pendingSessionNotificationFrame !== null) {
      cancelAnimationFrame(this.pendingSessionNotificationFrame);
      this.pendingSessionNotificationFrame = null;
    }
    const queued = this.pendingSessionNotifications.filter((item) => !this.pollingDisposed && this.clients.get(item.agentId) === item.record);
    this.pendingSessionNotifications = [];
    // Preserve every transcript delta, but touch catalog arrays only once per batch.
    this.applySessionSummaryUpdates(queued);
    for (const item of queued) {
      this.applySessionNotificationNow(item.agentId, item.notification, item.record, false);
    }
  }

  private applySessionNotificationNow(
    agentId: string,
    notification: SessionNotification,
    record: AgentClientRecord,
    updateSummary = true
  ) {
    if (this.pollingDisposed || this.clients.get(agentId) !== record) return;
    if (updateSummary) this.applySessionSummaryUpdates([{ agentId, notification }]);
    if (notification.update.sessionUpdate === 'session_info_update') this.scheduleSessionRefresh(agentId);

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

    if (!this.applyingDrainedUpdates) this.activeLoadMeasurement?.increment('liveNotifications');
    const notificationKey = getSessionNotificationKey(notification);
    if (this.isSnapshotUserEcho(notification) || record.recentSessionUpdateKeys.includes(notificationKey)) {
      this.activeLoadMeasurement?.increment('duplicateNotifications');
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

    const optimisticEventIndex = this.reconcileOptimisticUserPrompt(notification);
    const beforeEvents = this.activeSession.events.length;
    this.activeSession = applySessionNotification(this.activeSession, notification, optimisticEventIndex);
    if (notification.update.sessionUpdate === 'config_option_update') {
      const key = buildSessionKey(agentId, notification.sessionId);
      // Authoritative updates may carry only the options relevant to the
      // change; merge by option id and keep the confirmed active mode. Model
      // metadata is read from the raw patch: a patch without a model option
      // must not resurrect stale model values from the merged snapshot.
      const patch = notification.update.configOptions ?? [];
      const configOptions = this.mergeSessionConfigOptions(agentId, notification.sessionId, patch);
      const modelId = getCurrentModelId(patch);
      // Selection changes only when the update carries model metadata; a mode
      // change may omit it, in which case the last known selection is kept.
      if (modelId) {
        this.restoreSessionModel(agentId, notification.sessionId, patch);
      }
      // During a desktop-initiated transition, intermediate mode defaults and
      // racing notifications refresh confirmed UI state but never overwrite
      // the saved target preference; the transition persists it on completion.
      if (!this.sessionModeTransitions.has(key)) {
        this.persistConfirmedSessionPreference(agentId, notification.sessionId);
      }
    } else if (notification.update.sessionUpdate === 'current_mode_update') {
      const key = buildSessionKey(agentId, notification.sessionId);
      this.sessionModeIds = { ...this.sessionModeIds, [key]: notification.update.currentModeId };
      if (!this.sessionModeTransitions.has(key)) {
        this.persistConfirmedSessionPreference(agentId, notification.sessionId);
      }
    }
    this.activeLoadMeasurement?.increment('appliedNotifications');
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
    if (
      record.client.supportsQuerymtMethod(QMT_METHOD_SESSION_RUNTIME_STATE) &&
      ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update'].includes(
        notification.update.sessionUpdate
      )
    ) {
      this.scheduleSessionRuntimeRefresh(agentId, notification.sessionId, record.client);
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
    this.clearMeshStateForAgent(agentId);
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

    const generation = this.connectGeneration(agentId);
    this.completedWorkspaceDiscoveries.delete(agentId);
    await this.connectAgent(agentId, true);
    if (this.connectGeneration(agentId) !== generation) return;
    const record = this.clients.get(agentId);
    if (record?.connectionState === 'initialized') {
      await Promise.allSettled([
        this.pollingIsVisible() ? this.refreshSessionsForAgent(agentId, true) : Promise.resolve(),
        this.refreshAuthProviders(agentId)
      ]);
      if (this.activeAgentId === agentId && this.activeSessionId) {
        await this.loadSession(agentId, this.activeSessionId);
      }
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

  private scheduleSessionRuntimeRefresh(
    agentId: string,
    sessionId: string,
    client: DesktopAcpClient,
    delayMs = SESSION_RUNTIME_POLL_MS
  ) {
    const key = buildSessionKey(agentId, sessionId);
    if (!this.runtimePollingEnabled || !this.pollingIsVisible() || !this.isSelectedSession(agentId, sessionId) ||
      this.clients.get(agentId)?.client !== client || this.sessionRuntimeRefreshTimers.has(key)) return;
    const selection = this.sessionSelectionGeneration;
    const timer = setTimeout(() => {
      this.sessionRuntimeRefreshTimers.delete(key);
      if (this.runtimePollingEnabled && this.pollingIsVisible() && this.isSelectedSession(agentId, sessionId) &&
        selection === this.sessionSelectionGeneration && this.initializedClientRecord(agentId)?.client === client) {
        void this.refreshSessionRuntime(agentId, sessionId, client).catch(() => null);
      }
    }, delayMs);
    this.sessionRuntimeRefreshTimers.set(key, timer);
  }

  private cancelSessionRuntimeRefresh(key: string) {
    const timer = this.sessionRuntimeRefreshTimers.get(key);
    if (timer) clearTimeout(timer);
    this.sessionRuntimeRefreshTimers.delete(key);
  }

  private scheduleSessionRefresh(agentId: string, delayMs = SESSION_SUMMARY_POLL_MS) {
    if (!this.sessionPollingStarted || !this.pollingIsVisible() || !this.initializedClientRecord(agentId) ||
      this.sessionRefreshTimers.has(agentId) || !this.configs.some((config) => config.id === agentId && config.enabled)) return;
    const timer = setTimeout(() => {
      this.sessionRefreshTimers.delete(agentId);
      void this.refreshRoutineSessions(agentId);
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

function getSessionNotificationKey(notification: SessionNotification): string {
  const update = notification.update;
  const prefix = `${notification.sessionId}:${update.sessionUpdate}`;

  if (update.sessionUpdate === 'tool_call') return `${prefix}:${update.toolCallId}`;
  if (update.sessionUpdate === 'tool_call_update') {
    return `${prefix}:${update.toolCallId}:${update.status ?? 'updated'}`;
  }
  if (
    update.sessionUpdate === 'user_message_chunk' ||
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    return `${prefix}:${update.messageId ?? ''}:${readClientPromptId(notification) ?? ''}:${contentBlockKey(update.content)}`;
  }

  return `${prefix}:${JSON.stringify(update)}`;
}

function contentBlockKey(content: unknown): string {
  const block = normalizeContentBlock(content);
  if (!block) return 'unsupported';
  if (block.type === 'text') return `text:${block.text}`;
  if (block.type === 'image') {
    return `image:${block.id ?? block.name ?? ''}:${block.mimeType}:${block.data?.length ?? 0}:${hashString(block.data ?? '')}`;
  }
  return `resource:${block.id ?? block.name ?? block.uri}:${block.mimeType ?? ''}:${block.data?.length ?? block.text?.length ?? 0}:${hashString(block.data ?? block.text ?? '')}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function isOnlineConnectionState(connectionState: AgentConnectionState | undefined): boolean {
  return connectionState === 'initialized' || connectionState === 'loading-sessions';
}

function websocketStatus(
  config: AgentConfig,
  connectionState: AgentConnectionState,
  reconnectAttempt?: number,
  reconnectDelayMs?: number
): AgentRuntimeStatus {
  const connected = isOnlineConnectionState(connectionState);
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

export { normalizeAcpWebSocketEndpoint };

function normalizeAgentConfig(config: AgentConfig): AgentConfig {
  const transport = config.transport === 'websocket' ? 'websocket' : 'stdio';
  return {
    ...config,
    transport,
    commandLine: config.commandLine ?? '',
    websocketUrl: transport === 'websocket' ? normalizeAcpWebSocketEndpoint(config.websocketUrl ?? '') : undefined,
    websocketSecure: transport === 'websocket'
      ? config.websocketSecure ?? usesSecureWebSocket(config.websocketUrl ?? '')
      : undefined
  };
}

function loadInitialAgents(): AgentConfig[] {
  if (isEmbedded) {
    return typeof window === 'undefined' ? [] : [createEmbeddedAgentConfig(window.location)];
  }
  if (typeof localStorage === 'undefined') {
    return DEFAULT_AGENTS;
  }

  try {
    const raw = localStorage.getItem(AGENTS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_AGENTS;
    }

    const parsed = JSON.parse(raw) as AgentConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_AGENTS;
    const normalized = parsed.map(normalizeAgentConfig);
    try {
      localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Keep migrated settings in memory when browser storage is unavailable.
    }
    return normalized;
  } catch {
    return DEFAULT_AGENTS;
  }
}

function persistAgents(agents: AgentConfig[]) {
  if (isEmbedded || typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(agents));
}

function loadRecentModels(storageKey = RECENT_MODELS_STORAGE_KEY): Record<string, string[]> {
  if (typeof localStorage === 'undefined') {
    return {};
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persistRecentModels(value: Record<string, string[]>, storageKey = RECENT_MODELS_STORAGE_KEY) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(storageKey, JSON.stringify(value));
}

function loadRecentSessions(): RecentSessionEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((value): value is RecentSessionEntry => {
      if (!value || typeof value !== 'object') return false;
      const { agentId, sessionId, source } = value as Partial<RecentSessionEntry>;
      if (typeof agentId !== 'string' || !agentId.trim() || typeof sessionId !== 'string' || !sessionId.trim() ||
        typeof source !== 'string' || !source) return false;
      const key = buildSessionKey(agentId, sessionId);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, RECENT_SESSIONS_LIMIT).map(({ agentId, sessionId, source }) => ({ agentId, sessionId, source }));
  } catch {
    return [];
  }
}

function persistRecentSessions(entries: RecentSessionEntry[]) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Recent navigation remains usable in memory when browser storage is unavailable.
  }
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
  return models[0] ? getModelSelectionKey(models[0]) : '';
}

function sameDelegateModel(left: DelegateModelOverride | null, right: DelegateModelOverride | null): boolean {
  return left?.model_id === right?.model_id && (left?.node_id ?? null) === (right?.node_id ?? null);
}

function confirmedDelegateReasoningEffort(
  current: DelegateReasoningEffort | null | undefined,
  incoming: DelegateReasoningEffort | null | undefined
): DelegateReasoningEffort | null {
  return incoming === undefined ? current ?? null : incoming;
}

function applyDelegateModelConfirmation(
  state: DelegateAssignmentsInfo | null | undefined,
  response: SetDelegateModelResponse
): DelegateAssignmentsInfo | null {
  if (!state || state.session_id !== response.session_id) return null;
  const currentAssignment = state.assignments.find((assignment) => assignment.agent_id === response.agent_id) ??
    state.orphaned_overrides.find((assignment) => assignment.agent_id === response.agent_id);
  const reasoningEffort = confirmedDelegateReasoningEffort(currentAssignment?.reasoning_effort, response.reasoning_effort);
  const hasAssignment = Boolean(
    currentAssignment && state.assignments.some((assignment) => assignment === currentAssignment)
  );
  return {
    ...state,
    revision: response.revision,
    durable: response.durable,
    assignments: state.assignments.map((assignment) =>
      assignment.agent_id === response.agent_id
        ? {
          ...assignment,
          model: response.model,
          source: response.model ? DelegateAssignmentSource.Override : DelegateAssignmentSource.ProfileDefault,
          reasoning_effort: reasoningEffort
        }
        : assignment
    ),
    orphaned_overrides: state.orphaned_overrides
      .filter((assignment) => assignment.agent_id !== response.agent_id)
      .concat(
        !hasAssignment && (response.model || reasoningEffort)
          ? [{
            agent_id: response.agent_id,
            model: response.model,
            reasoning_effort: reasoningEffort
          }]
          : []
      )
  };
}

function readDelegateAssignmentConflict(error: unknown): { expected_revision: number; actual_revision: number } | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  return candidate.code === 'delegate_assignment_conflict' &&
    typeof candidate.expected_revision === 'number' &&
    typeof candidate.actual_revision === 'number'
    ? { expected_revision: candidate.expected_revision, actual_revision: candidate.actual_revision }
    : null;
}

function acpErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return error instanceof Error ? error.message : fallback;
}

function buildWorkspaceSourceKey(agentId: string, cwd: string): string {
  return `${agentId}\u0000${cwd}`;
}

function sessionHasVisibleHistory(session: ActiveSessionViewModel): boolean {
  return session.transcript.length > 0 || session.toolCalls.length > 0;
}

function inferSessionSummaryFromActiveSession(session: ActiveSessionViewModel): { title: string | null; updatedAt: string | null } {
  const firstUser = session.transcript.find((item) => item.kind === 'user_message_chunk' && item.text.trim());
  const title = firstUser?.text.trim().split(/\n/)[0]?.slice(0, 80) || null;
  const timestamps = session.transcript
    .map((item) => item.timestampMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const latestMs = timestamps.length > 0 ? Math.max(...timestamps) : null;
  return {
    title,
    updatedAt: latestMs !== null ? new Date(latestMs).toISOString() : null
  };
}

function compareSessionsByActivity(a: DesktopSessionSummary, b: DesktopSessionSummary): number {
  const activityDifference = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  if (activityDifference !== 0) return activityDifference;
  return getSessionKey(a).localeCompare(getSessionKey(b));
}

function deduplicateSessions(sessions: DesktopSessionSummary[]): DesktopSessionSummary[] {
  return [...new Map(sessions.map((session) => [getSessionKey(session), session])).values()];
}

function mergeSessions(current: DesktopSessionSummary[], incoming: DesktopSessionSummary[]): DesktopSessionSummary[] {
  const sessions = new Map(current.map((session) => [getSessionKey(session), session]));
  for (const session of incoming) {
    // A delayed session/list response must never roll a summary's activity
    // timestamp backwards past what live notifications already recorded.
    const key = getSessionKey(session);
    const existing = sessions.get(key);
    sessions.set(key, existing ? {
      ...existing,
      ...session,
      // Parentage is immutable; an incomplete list/load must not promote a known child.
      parentSessionId: session.parentSessionId ?? existing.parentSessionId,
      forkOrigin: session.forkOrigin ?? existing.forkOrigin,
      relationshipKnown: existing.relationshipKnown === true ? true : session.relationshipKnown ?? existing.relationshipKnown,
      updatedAt: newestTimestamp(existing.updatedAt, session.updatedAt)
    } : session);
  }
  return [...sessions.values()].sort(compareSessionsByActivity);
}

function maxTimestamp(values: Array<string | null>): string | null {
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    return !latest || value > latest ? value : latest;
  }, null);
}

function sessionInputNotificationKey(agentId: string, sessionId: string, inputId: string): string {
  return JSON.stringify([agentId, sessionId, inputId]);
}

function pendingInputUpdatesFromNotification(
  notification: SessionInputStateNotification
): Partial<PendingSessionInput> {
  return {
    delivery: notification.delivery === SessionInputDelivery.Queue ? 'queue' : 'steer',
    state: sessionInputLifecycleState(notification.state),
    runId: notification.run_id,
    position: notification.position,
    boundary: notification.boundary,
    reason: notification.reason,
    latencyMs: notification.latency_ms
  };
}

function sessionInputLifecycleState(
  state: SessionInputState
): PendingSessionInput['state'] {
  switch (state) {
    case SessionInputState.Queued:
      return 'queued';
    case SessionInputState.Applied:
      return 'applied';
    case SessionInputState.Started:
      return 'started';
    case SessionInputState.Discarded:
      return 'discarded';
    default:
      return 'accepted';
  }
}

function upsertPendingSessionInput(
  inputs: PendingSessionInput[],
  input: PendingSessionInput
): PendingSessionInput[] {
  const index = inputs.findIndex((candidate) => candidate.inputId === input.inputId);
  if (index < 0) return [...inputs, input];
  const next = inputs.slice();
  next[index] = { ...next[index], ...input };
  return next;
}

function createClientPromptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function attachmentUri(attachment: PromptAttachment): string {
  return `attachment:///${encodeURIComponent(attachment.id)}/${encodeURIComponent(attachment.name)}`;
}

function attachmentsMatch(left: PromptAttachment[], right: PromptAttachment[]): boolean {
  return left.length === right.length && left.every((attachment, index) => {
    const candidate = right[index];
    return candidate?.id === attachment.id && candidate.data === attachment.data;
  });
}

function attachmentIdentityKey(block: SessionContentBlock): string | null {
  if (block.type === 'text') return null;
  if (block.id) return block.id;
  if (block.uri?.startsWith('attachment:///')) {
    const identity = decodeURIComponent(block.uri.slice('attachment:///'.length).split('/')[0] ?? '');
    return identity || null;
  }
  return null;
}

function attachmentIdentitiesMatch(left: SessionContentBlock, right: SessionContentBlock): boolean {
  const leftKey = attachmentIdentityKey(left);
  return leftKey !== null && leftKey === attachmentIdentityKey(right);
}

function readRawAttachmentIdentity(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  const root = value as Record<string, unknown>;

  const meta = root._meta;
  if (meta && typeof meta === 'object') {
    const querymt = (meta as Record<string, unknown>).querymt;
    const source = (querymt && typeof querymt === 'object' ? querymt : meta) as Record<string, unknown>;
    const attachmentId =
      typeof source.attachment_id === 'string' ? source.attachment_id : typeof source.attachmentId === 'string' ? source.attachmentId : null;
    if (attachmentId) return attachmentId;
  }

  const uri = typeof root.uri === 'string' ? root.uri : null;
  if (uri?.startsWith('attachment:///')) {
    const identity = decodeURIComponent(uri.slice('attachment:///'.length).split('/')[0] ?? '');
    if (identity) return identity;
  }

  for (const nested of Object.values(root)) {
    if (!nested || typeof nested !== 'object') continue;
    const found = readRawAttachmentIdentity(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

function contentBlocksMatch(left: SessionContentBlock, right: SessionContentBlock): boolean {
  if (left.type !== right.type) return attachmentIdentitiesMatch(left, right);
  if (left.type === 'text' && right.type === 'text') return left.text === right.text;
  if (left.type === 'image' && right.type === 'image') {
    return (left.mimeType === right.mimeType && left.data === right.data) || attachmentIdentitiesMatch(left, right);
  }
  if (left.type === 'resource' && right.type === 'resource') {
    return (
      (left.mimeType === right.mimeType && left.data === right.data && left.text === right.text) ||
      attachmentIdentitiesMatch(left, right)
    );
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const agentsStore = new AgentsStore();
