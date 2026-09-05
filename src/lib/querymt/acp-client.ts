import {
  ClientSideConnection,
  type ClientCapabilities,
  type ContentBlock,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationCapabilities,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SetSessionConfigOptionRequest
} from '@agentclientprotocol/sdk';
import type { AgentConfig, AgentControlHealth, ModelEntry, ModelInfo, PromptAttachment, PromptSendOptions } from '$lib/domain/types';
import type {
  AttachRemoteSessionRequest,
  AuthMethod,
  AuthProviderEntry,
  CapabilitiesInfo,
  CreateMeshInviteRequest,
  CreateRemoteSessionRequest,
  CreateScheduleControlRequest,
  MeshInviteCreatedInfo,
  MeshInviteListInfo,
  MeshInviteRevokedInfo,
  MeshNodesInfo,
  MeshStatusInfo,
  RemoteSessionAttachInfo,
  RemoteSessionDismissInfo,
  RemoteSessionListInfo,
  RemoteSessionsRequest,
  RevokeMeshInviteRequest,
  ScheduleActionControlRequest,
  ScheduleActionResult,
  ScheduleInfo,
  ScheduleListInfo,
  ListSchedulesControlRequest,
  PluginUpdateResult
} from '$lib/querymt/generated/types';
import { BrowserClient } from '$lib/querymt/browser-client';
import {
  QMT_METHOD_AUTH_CLEAR_API_TOKEN,
  QMT_METHOD_AUTH_COMPLETE,
  QMT_METHOD_AUTH_LOGOUT,
  QMT_METHOD_AUTH_SET_API_TOKEN,
  QMT_METHOD_AUTH_SET_METHOD,
  QMT_METHOD_AUTH_START,
  QMT_METHOD_AUTH_STATUS,
  QMT_METHOD_MESH_CREATE_INVITE,
  QMT_METHOD_UPDATE_PLUGINS,
  QMT_METHOD_MESH_LIST_INVITES,
  QMT_METHOD_MESH_NODES,
  QMT_METHOD_MESH_REVOKE_INVITE,
  QMT_METHOD_MESH_STATUS,
  QMT_METHOD_REMOTE_ATTACH_SESSION,
  QMT_METHOD_REMOTE_CREATE_SESSION,
  QMT_METHOD_REMOTE_DISMISS_SESSION,
  QMT_METHOD_REMOTE_SESSIONS,
  QMT_METHOD_SCHEDULES_CREATE,
  QMT_METHOD_SCHEDULES_DELETE,
  QMT_METHOD_SCHEDULES_LIST,
  QMT_METHOD_SCHEDULES_PAUSE,
  QMT_METHOD_SCHEDULES_RESUME,
  QMT_METHOD_SCHEDULES_TRIGGER,
  QMT_METHOD_SESSION_REDO,
  QMT_METHOD_SESSION_UNDO,
  QMT_METHOD_SESSION_UNDO_STACK,
  QuerymtExtensions,
  type QuerymtAuthResult,
  type QuerymtAuthStartResponse,
  type QuerymtPluginUpdateResponse,
  type QuerymtRedoResponse,
  type QuerymtUndoResponse,
  type QuerymtUndoStackResponse,
  toLogicalQuerymtMethod,
  type QuerymtExtensionNotification,
  type QuerymtLogicalMethod
} from '$lib/querymt/querymt-extensions';
import { createTauriAcpStream, createWebSocketAcpStream } from '$lib/querymt/transport';
import type { Stream } from '@agentclientprotocol/sdk';

const PROTOCOL_VERSION = 1;

export interface LoadedAcpSession {
  response: LoadSessionResponse;
  replay: SessionNotification[];
}

export class DesktopAcpClient {
  private config: AgentConfig;
  private browserClient = new BrowserClient();
  private connection: ClientSideConnection | null = null;
  private stream: Stream | null = null;
  private initializeResponse: InitializeResponse | null = null;
  private querymtExtensions: QuerymtExtensions | null = null;
  private controlCapabilities: CapabilitiesInfo | null = null;
  private connectionLossHandlers = new Set<(reason: string) => void>();
  private intentionallyDisconnected = false;
  private controlHealth: AgentControlHealth = {
    state: 'unknown',
    summary: 'Capabilities not checked yet.',
    missingMethods: [],
    missingFeatures: []
  };

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async connect(): Promise<InitializeResponse> {
    this.intentionallyDisconnected = false;
    if (this.connection && this.initializeResponse) {
      return this.initializeResponse;
    }

    this.stream =
      this.config.transport === 'websocket'
        ? await createWebSocketAcpStream(requireWebSocketUrl(this.config), (reason) => this.handleConnectionLoss(reason))
        : await createTauriAcpStream(this.config.id);
    const browserClient = this.browserClient;
    this.connection = new ClientSideConnection(() => browserClient, this.stream);

    const request: InitializeRequest = {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'QueryMT Desktop',
        version: '0.1.0'
      },
      clientCapabilities: buildClientCapabilities()
    };

    this.initializeResponse = await this.connection.initialize(request);
    this.querymtExtensions = new QuerymtExtensions(this.connection);

    try {
      this.controlCapabilities = await this.querymtExtensions.capabilities();
      this.controlHealth = {
        state: 'ready',
        summary: `Control API v${this.controlCapabilities.querymt_control_version} ready.`,
        missingMethods: [],
        missingFeatures: []
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QueryMT capabilities unavailable.';
      const isLegacy = /method not found/i.test(message);
      this.controlCapabilities = null;
      this.controlHealth = {
        state: isLegacy ? 'legacy' : 'failed',
        summary: isLegacy ? 'ACP connected, but QueryMT control API is unavailable.' : message,
        missingMethods: [],
        missingFeatures: []
      };
    }

    return this.initializeResponse;
  }

  async listSessions(request: ListSessionsRequest = {}): Promise<ListSessionsResponse> {
    if (!this.connection) {
      await this.connect();
    }

    return this.connection!.listSessions(request);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.connection) {
      await this.connect();
    }

    await this.connection!.deleteSession({ sessionId });
  }

  async createSession(cwd: string, profileId?: string | null): Promise<NewSessionResponse> {
    if (!this.connection) {
      await this.connect();
    }

    return this.connection!.newSession({
      cwd,
      mcpServers: [],
      _meta: profileId
        ? {
            querymt: {
              profile_id: profileId
            }
          }
        : undefined
    });
  }

  async loadSession(sessionId: string, cwd: string, operationId?: string | null): Promise<LoadedAcpSession> {
    if (!this.connection) {
      await this.connect();
    }

    const capture = this.browserClient.beginSessionReplay(sessionId);
    try {
      const response = await this.connection!.loadSession({
        sessionId,
        cwd,
        mcpServers: [],
        _meta: operationId
          ? {
              querymt: {
                session_load_operation_id: operationId
              }
            }
          : undefined
      });
      return {
        response,
        replay: this.browserClient.completeSessionReplay(capture)
      };
    } catch (error) {
      this.browserClient.abortSessionReplay(capture);
      throw error;
    }
  }

  async forkSession(sessionId: string, cwd: string, messageId: string): Promise<ForkSessionResponse> {
    if (!this.connection) {
      await this.connect();
    }

    return this.connection!.unstable_forkSession({
      sessionId,
      cwd,
      mcpServers: [],
      _meta: {
        querymt: {
          message_id: messageId
        }
      }
    });
  }

  getInitializeResponse(): InitializeResponse | null {
    return this.initializeResponse;
  }

  getControlCapabilities(): CapabilitiesInfo | null {
    return this.controlCapabilities;
  }

  getControlHealth(): AgentControlHealth {
    return this.controlHealth;
  }

  supportsQuerymtMethod(method: QuerymtLogicalMethod): boolean {
    return this.controlCapabilities?.methods.includes(method) ?? false;
  }

  supportsQuerymtFeature(feature: keyof CapabilitiesInfo['features']): boolean {
    return this.controlCapabilities?.features?.[feature] ?? false;
  }

  async getUndoStack(sessionId: string): Promise<QuerymtUndoStackResponse> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SESSION_UNDO_STACK);
    return this.querymtExtensions!.undoStack(sessionId);
  }

  async undoSession(sessionId: string, messageId: string): Promise<QuerymtUndoResponse> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SESSION_UNDO);
    return this.querymtExtensions!.undoSession(sessionId, messageId);
  }

  async redoSession(sessionId: string): Promise<QuerymtRedoResponse> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SESSION_REDO);
    return this.querymtExtensions!.redoSession(sessionId);
  }

  async listModels(): Promise<ModelEntry[]> {
    if (!this.querymtExtensions) {
      await this.connect();
    }

    const response = await this.querymtExtensions!.models();
    return response.models ?? [];
  }

  async refreshAndListModels(): Promise<ModelEntry[]> {
    if (!this.querymtExtensions) {
      await this.connect();
    }

    const refreshed = await this.querymtExtensions!.refreshModels({ wait_for_completion: true });
    if (refreshed.models?.length) {
      return refreshed.models;
    }

    const response = await this.querymtExtensions!.models();
    return response.models ?? [];
  }

  async getModelInfo(models: Array<{ provider: string; model: string }>): Promise<Record<string, ModelInfo | null>> {
    if (!this.querymtExtensions) {
      await this.connect();
    }

    const response = await this.querymtExtensions!.modelInfo(models);
    return response.models ?? {};
  }

  async listMeshStatus(): Promise<MeshStatusInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_MESH_STATUS);
    return this.querymtExtensions!.meshStatus();
  }

  async listMeshNodes(): Promise<MeshNodesInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_MESH_NODES);
    return this.querymtExtensions!.meshNodes();
  }

  async listMeshInvites(): Promise<MeshInviteListInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_MESH_LIST_INVITES);
    return this.querymtExtensions!.listMeshInvites();
  }

  async createMeshInvite(request: CreateMeshInviteRequest): Promise<MeshInviteCreatedInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_MESH_CREATE_INVITE);
    return this.querymtExtensions!.createMeshInvite(request);
  }

  async revokeMeshInvite(request: RevokeMeshInviteRequest): Promise<MeshInviteRevokedInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_MESH_REVOKE_INVITE);
    return this.querymtExtensions!.revokeMeshInvite(request);
  }

  async listRemoteSessions(request: RemoteSessionsRequest): Promise<RemoteSessionListInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_REMOTE_SESSIONS);
    return this.querymtExtensions!.remoteSessions(request);
  }

  async createRemoteSession(request: CreateRemoteSessionRequest): Promise<RemoteSessionAttachInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_REMOTE_CREATE_SESSION);
    return this.querymtExtensions!.createRemoteSession(request);
  }

  async attachRemoteSession(request: AttachRemoteSessionRequest): Promise<RemoteSessionAttachInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_REMOTE_ATTACH_SESSION);
    return this.querymtExtensions!.attachRemoteSession(request);
  }

  async dismissRemoteSession(session_id: string): Promise<RemoteSessionDismissInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_REMOTE_DISMISS_SESSION);
    return this.querymtExtensions!.dismissRemoteSession({ session_id });
  }

  async createSchedule(request: CreateScheduleControlRequest): Promise<ScheduleInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_CREATE);
    const response = await this.querymtExtensions!.createSchedule(request);
    return response.schedule;
  }

  async listSchedules(request: ListSchedulesControlRequest = {}): Promise<ScheduleListInfo> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_LIST);
    return this.querymtExtensions!.listSchedules(request);
  }

  async pauseSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_PAUSE);
    return this.querymtExtensions!.pauseSchedule(request);
  }

  async resumeSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_RESUME);
    return this.querymtExtensions!.resumeSchedule(request);
  }

  async triggerSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_TRIGGER);
    return this.querymtExtensions!.triggerSchedule(request);
  }

  async deleteSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_SCHEDULES_DELETE);
    return this.querymtExtensions!.deleteSchedule(request);
  }

  async listAuthProviders(): Promise<AuthProviderEntry[]> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_STATUS);
    const response = await this.querymtExtensions!.authStatus();
    return response.providers ?? [];
  }

  async startProviderOAuth(provider: string): Promise<QuerymtAuthStartResponse> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_START);
    return this.querymtExtensions!.startAuth(provider);
  }

  async completeProviderOAuth(flow_id: string, response: string): Promise<QuerymtAuthResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_COMPLETE);
    return this.querymtExtensions!.completeAuth(flow_id, response);
  }

  async disconnectProviderOAuth(provider: string): Promise<QuerymtAuthResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_LOGOUT);
    return this.querymtExtensions!.logoutAuth(provider);
  }

  async setProviderApiToken(provider: string, api_key: string): Promise<QuerymtAuthResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_SET_API_TOKEN);
    return this.querymtExtensions!.setApiToken(provider, api_key);
  }

  async clearProviderApiToken(provider: string): Promise<QuerymtAuthResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_CLEAR_API_TOKEN);
    return this.querymtExtensions!.clearApiToken(provider);
  }

  async setProviderAuthMethod(provider: string, method: AuthMethod): Promise<QuerymtAuthResult> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtFeature('auth');
    this.assertQuerymtMethod(QMT_METHOD_AUTH_SET_METHOD);
    return this.querymtExtensions!.setAuthMethod(provider, method);
  }

  async updatePlugins(): Promise<PluginUpdateResult[]> {
    if (!this.querymtExtensions) {
      await this.connect();
    }
    this.assertQuerymtMethod(QMT_METHOD_UPDATE_PLUGINS);
    const response = await this.querymtExtensions!.updatePlugins();
    return response.results ?? [];
  }

  async setSessionConfigOption(request: SetSessionConfigOptionRequest): Promise<SessionConfigOption[]> {
    if (!this.connection) {
      await this.connect();
    }

    const response = await this.connection!.setSessionConfigOption(request);
    return response.configOptions ?? [];
  }

  supportsImagePrompts(): boolean {
    return this.initializeResponse?.agentCapabilities?.promptCapabilities?.image === true;
  }

  supportsEmbeddedContext(): boolean {
    return this.initializeResponse?.agentCapabilities?.promptCapabilities?.embeddedContext === true;
  }

  async sendPrompt(
    sessionId: string,
    prompt: string,
    attachments: PromptAttachment[] = [],
    options: PromptSendOptions = {}
  ): Promise<PromptResponse> {
    if (!this.connection) {
      await this.connect();
    }

    const imageMode = options.imageMode ?? 'image';
    const hasImages = attachments.some((attachment) => attachment.mimeType.startsWith('image/'));
    const hasResources = attachments.some(
      (attachment) => imageMode === 'resource' || !attachment.mimeType.startsWith('image/')
    );
    if (hasImages && imageMode === 'image' && !this.supportsImagePrompts()) {
      throw new Error('This agent does not support native image prompts. Switch image attachments to Resources and try again.');
    }
    if (hasResources && !this.supportsEmbeddedContext()) {
      throw new Error('This agent does not support embedded resources. Remove file attachments or use an agent with embedded context support.');
    }

    const content: ContentBlock[] = [];
    if (prompt.length > 0) {
      content.push({ type: 'text', text: prompt });
    }
    for (const attachment of attachments) {
      const metadata = {
        querymt: {
          attachment_id: attachment.id,
          filename: attachment.name,
          size: attachment.size
        }
      };
      if (imageMode === 'image' && attachment.mimeType.startsWith('image/')) {
        content.push({
          type: 'image',
          data: attachment.data,
          mimeType: attachment.mimeType,
          _meta: metadata
        });
        continue;
      }

      content.push({
        type: 'resource',
        _meta: metadata,
        resource: {
          uri: buildAttachmentUri(attachment),
          blob: attachment.data,
          mimeType: attachment.mimeType,
          _meta: metadata
        }
      });
    }

    return this.connection!.prompt({
      sessionId,
      prompt: content,
      _meta: options.clientPromptId
        ? { querymt: { client_prompt_id: options.clientPromptId } }
        : undefined
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (!this.connection) {
      await this.connect();
    }

    await this.connection!.cancel({ sessionId });
  }

  async disconnect() {
    this.intentionallyDisconnected = true;
    await this.stream?.readable.cancel().catch(() => undefined);
    await this.stream?.writable.abort().catch(() => undefined);
    this.stream = null;
    this.connection = null;
    this.initializeResponse = null;
    this.querymtExtensions = null;
    this.controlCapabilities = null;
  }

  onConnectionLost(handler: (reason: string) => void): () => void {
    this.connectionLossHandlers.add(handler);
    return () => this.connectionLossHandlers.delete(handler);
  }

  onSessionUpdate(handler: Parameters<BrowserClient['onSessionUpdate']>[0]): () => void {
    this.browserClient.onSessionUpdate(handler);
    return () => this.browserClient.offSessionUpdate(handler);
  }

  onPermissionRequest(
    handler: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>
  ): () => void {
    this.browserClient.onPermissionRequest(handler);
    return () => this.browserClient.offPermissionRequest(handler);
  }

  onElicitationRequest(
    handler: (request: CreateElicitationRequest) => Promise<CreateElicitationResponse>
  ): () => void {
    this.browserClient.onElicitationRequest(handler);
    return () => this.browserClient.offElicitationRequest(handler);
  }

  onExtensionNotification(handler: (notification: QuerymtExtensionNotification) => void): () => void {
    const wrapped = (notification: QuerymtExtensionNotification) => {
      const logicalMethod = toLogicalQuerymtMethod(notification.method);
      if (!logicalMethod) {
        return;
      }
      handler({
        ...notification,
        method: logicalMethod
      });
    };
    this.browserClient.onExtensionNotification(wrapped);
    return () => this.browserClient.offExtensionNotification(wrapped);
  }

  private handleConnectionLoss(reason: string) {
    if (this.intentionallyDisconnected) return;
    this.connection = null;
    this.stream = null;
    this.initializeResponse = null;
    this.querymtExtensions = null;
    this.controlCapabilities = null;
    for (const handler of this.connectionLossHandlers) handler(reason);
  }

  private assertQuerymtMethod(method: QuerymtLogicalMethod) {
    if (!this.supportsQuerymtMethod(method)) {
      throw new Error(`Agent is missing required capability ${method}.`);
    }
  }

  private assertQuerymtFeature(feature: keyof CapabilitiesInfo['features']) {
    if (!this.supportsQuerymtFeature(feature)) {
      throw new Error(`Agent is missing required feature ${feature}.`);
    }
  }
}

function buildAttachmentUri(attachment: PromptAttachment): string {
  return `attachment:///${encodeURIComponent(attachment.id)}/${encodeURIComponent(attachment.name)}`;
}

function requireWebSocketUrl(config: AgentConfig): string {
  const url = config.websocketUrl?.trim();
  if (!url) {
    throw new Error(`WebSocket URL is required for ${config.name}.`);
  }
  return `ws://${url.replace(/^wss?:\/\//i, '').replace(/\/ws\/?$/i, '').replace(/\/$/, '')}/ws`;
}

function buildClientCapabilities(): ClientCapabilities {
  const elicitation: ElicitationCapabilities = {
    form: {}
  };

  return {
    elicitation,
    fs: {},
    terminal: false
  };
}
