import type { ModelEntry, ModelInfo } from '$lib/domain/types';
import type {
  AuthMethod,
  AuthProviderEntry,
  CapabilitiesInfo,
  MeshStatusInfo,
  MeshNodesInfo,
  MeshInviteCreatedInfo,
  MeshInviteListInfo,
  MeshInviteRevokedInfo,
  MeshJoinInfo,
  CreateMeshInviteRequest,
  RevokeMeshInviteRequest,
  MeshJoinRequest,
  RemoteSessionsRequest,
  RemoteSessionListInfo,
  CreateRemoteSessionRequest,
  AttachRemoteSessionRequest,
  DismissRemoteSessionRequest,
  RemoteSessionAttachInfo,
  RemoteSessionDismissInfo,
  CreateScheduleControlRequest,
  ListSchedulesControlRequest,
  GetScheduleControlRequest,
  ScheduleActionControlRequest,
  ScheduleInfo,
  ScheduleListInfo,
  ScheduleActionResult,
  DelegateAssignmentsInfo,
  DelegateModelsChangedNotification,
  DelegateModelsRequest,
  SetDelegateModelRequest,
  SetDelegateModelResponse,
  ModelsChangedNotification,
  MeshJoinedNotification,
  MeshNodesChangedNotification,
  MeshPeerExpiredNotification,
  OAuthFlowKindTs,
  PluginUpdateResult,
  SchedulesChangedNotification,
  SessionInputStateNotification,
  SessionRuntimeState,
  DiscardQueuedInputResult,
  SubmitInputResult,
  UndoStackFrame
} from '$lib/querymt/generated/types';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';

export type QuerymtLogicalMethod = `querymt/${string}`;
export type QuerymtWireMethod = QuerymtLogicalMethod | `_${QuerymtLogicalMethod}`;
export type QuerymtExtensionNotification =
  | { method: 'querymt/models/changed'; params: ModelsChangedNotification }
  | { method: 'querymt/session/delegateModelsChanged'; params: DelegateModelsChangedNotification }
  | { method: 'querymt/session/inputState'; params: SessionInputStateNotification }
  | {
      method: 'querymt/elicitation/recoveryAuthority';
      params: QuerymtElicitationRecoveryAuthorityNotification;
    }
  | {
      method: 'querymt/elicitation/validationFailed';
      params: QuerymtElicitationValidationFailedNotification;
    }
  | {
      method: 'querymt/elicitation/completed';
      params: QuerymtElicitationCompletedNotification;
    }
  | { method: 'querymt/mesh/joined'; params: MeshJoinedNotification }
  | { method: 'querymt/mesh/nodesChanged'; params: MeshNodesChangedNotification }
  | { method: 'querymt/mesh/peerExpired'; params: MeshPeerExpiredNotification }
  | { method: 'querymt/schedules/changed'; params: SchedulesChangedNotification }
  | { method: 'querymt/pluginUpdateStatus'; params: { plugin_name: string; image_reference: string; phase: string; bytes_downloaded: number; bytes_total?: number; percent?: number; message?: string } }
  | { method: 'querymt/pluginUpdateComplete'; params: { results: PluginUpdateResult[] } }
  | { method: QuerymtLogicalMethod; params: unknown };

export const QMT_METHOD_CAPABILITIES = 'querymt/capabilities';
export const QMT_METHOD_ELICITATION_LIST_PENDING = 'querymt/elicitation/listPendingSessions';
export const QMT_METHOD_ELICITATION_ATTACH_SESSION = 'querymt/elicitation/attachSession';
export const QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY =
  'querymt/elicitation/recoveryAuthority';
export const QMT_NOTIFICATION_ELICITATION_VALIDATION_FAILED =
  'querymt/elicitation/validationFailed';
export const QMT_NOTIFICATION_ELICITATION_COMPLETED = 'querymt/elicitation/completed';
export const QMT_ELICITATION_RECOVERY_VERSION = 1;
export const QMT_METHOD_MODELS = 'querymt/models';
export const QMT_METHOD_REFRESH_MODELS = 'querymt/refreshModels';
export const QMT_METHOD_MODEL_INFO = 'querymt/modelInfo';
export const QMT_METHOD_PROFILES = 'querymt/profiles';
export const QMT_METHOD_MESH_STATUS = 'querymt/mesh/status';
export const QMT_METHOD_MESH_JOIN = 'querymt/mesh/join';
export const QMT_METHOD_MESH_NODES = 'querymt/mesh/nodes';
export const QMT_METHOD_MESH_CREATE_INVITE = 'querymt/mesh/createInvite';
export const QMT_METHOD_MESH_LIST_INVITES = 'querymt/mesh/listInvites';
export const QMT_METHOD_MESH_REVOKE_INVITE = 'querymt/mesh/revokeInvite';
export const QMT_METHOD_REMOTE_SESSIONS = 'querymt/remote/sessions';
export const QMT_METHOD_REMOTE_CREATE_SESSION = 'querymt/remote/createSession';
export const QMT_METHOD_REMOTE_ATTACH_SESSION = 'querymt/remote/attachSession';
export const QMT_METHOD_REMOTE_DISMISS_SESSION = 'querymt/remote/dismissSession';
export const QMT_METHOD_SCHEDULES_CREATE = 'querymt/schedules/create';
export const QMT_METHOD_SCHEDULES_LIST = 'querymt/schedules/list';
export const QMT_METHOD_SCHEDULES_GET = 'querymt/schedules/get';
export const QMT_METHOD_SCHEDULES_PAUSE = 'querymt/schedules/pause';
export const QMT_METHOD_SCHEDULES_RESUME = 'querymt/schedules/resume';
export const QMT_METHOD_SCHEDULES_TRIGGER = 'querymt/schedules/trigger';
export const QMT_METHOD_SCHEDULES_DELETE = 'querymt/schedules/delete';
export const QMT_METHOD_AUTH_STATUS = 'querymt/auth/status';
export const QMT_METHOD_AUTH_START = 'querymt/auth/start';
export const QMT_METHOD_AUTH_COMPLETE = 'querymt/auth/complete';
export const QMT_METHOD_AUTH_LOGOUT = 'querymt/auth/logout';
export const QMT_METHOD_AUTH_SET_API_TOKEN = 'querymt/auth/setApiToken';
export const QMT_METHOD_AUTH_CLEAR_API_TOKEN = 'querymt/auth/clearApiToken';
export const QMT_METHOD_AUTH_SET_METHOD = 'querymt/auth/setMethod';
export const QMT_METHOD_UPDATE_PLUGINS = 'querymt/updatePlugins';
export const QMT_METHOD_SESSION_UNDO_STACK = 'querymt/session/undoStack';
export const QMT_METHOD_SESSION_UNDO = 'querymt/session/undo';
export const QMT_METHOD_SESSION_REDO = 'querymt/session/redo';
export const QMT_METHOD_SESSION_DELEGATE_MODELS = 'querymt/session/delegateModels';
export const QMT_METHOD_SESSION_SET_DELEGATE_MODEL = 'querymt/session/setDelegateModel';
export const QMT_METHOD_SESSION_STEER = 'querymt/session/steer';
export const QMT_METHOD_SESSION_QUEUE = 'querymt/session/queue';
export const QMT_METHOD_SESSION_DISCARD_QUEUED_INPUT = 'querymt/session/discardQueuedInput';
export const QMT_METHOD_SESSION_RUNTIME_STATE = 'querymt/session/runtimeState';
export const QMT_NOTIFICATION_SESSION_INPUT_STATE = 'querymt/session/inputState';

export interface QuerymtProfileInfo {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  config_kind?: string | null;
  source?: string | null;
  fingerprint?: string | null;
}

/** Versioned v1 elicitation-recovery contract advertised by compatible agents. */
export interface QuerymtElicitationRecoveryCapability {
  version: number;
  authority_notification: string;
  list_pending_method: string;
  attach_method: string;
}

export interface QuerymtListPendingElicitationSessionsRequest {
  version: number;
  resume_authority: string;
}

export interface QuerymtListPendingElicitationSessionsResponse {
  version: number;
  session_ids: string[];
}

export interface QuerymtAttachPendingElicitationSessionRequest {
  version: number;
  session_id: string;
  resume_authority: string;
}

export interface QuerymtAttachPendingElicitationSessionResponse {
  version: number;
  session_id: string;
  elicitation_ids: string[];
}

export interface QuerymtElicitationRecoveryAuthorityNotification {
  version: number;
  session_id: string;
  resume_authority: string;
}

export interface QuerymtElicitationValidationFailedNotification {
  session_id: string;
  elicitation_id: string;
  message: string;
}

export interface QuerymtElicitationCompletedNotification {
  session_id: string;
  elicitation_id: string;
  outcome: 'accept' | 'decline' | 'cancel' | 'superseded' | 'completed_elsewhere';
}

export interface QuerymtProfilesResponse {
  profiles: QuerymtProfileInfo[];
  active_profile_id?: string | null;
}

export interface QuerymtModelsResponse {
  models: ModelEntry[];
  meta?: {
    stale?: boolean;
    refresh_in_progress?: boolean;
    remote_timeout_count?: number;
    remote_node_count?: number;
    refresh_trigger?: string;
    started_new_refresh?: boolean;
    wait_for_completion?: boolean;
  };
}

type QuerymtModelsWireResponse =
  | QuerymtModelsResponse
  | {
      type?: string;
      data?: QuerymtModelsResponse;
      meta?: QuerymtModelsResponse['meta'];
    };

export function normalizeQuerymtModelsResponse(response: QuerymtModelsWireResponse): QuerymtModelsResponse {
  if ('data' in response && response.data?.models) {
    return {
      models: response.data.models.slice(),
      meta: response.data.meta ?? response.meta
    };
  }

  const direct = response as QuerymtModelsResponse;
  return {
    models: (direct.models ?? []).slice(),
    meta: direct.meta
  };
}

export interface QuerymtModelInfoResponse {
  models: Record<string, ModelInfo | null>;
}

type QuerymtModelInfoWire = ModelInfo & {
  attachment?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  modalities?: NonNullable<ModelInfo['capabilities']>['modalities'];
  limit?: ModelInfo['limits'];
  cost?: ModelInfo['pricing'];
};

type QuerymtModelInfoWireResponse = {
  models?: Record<string, QuerymtModelInfoWire | null>;
};

export function normalizeQuerymtModelInfoResponse(response: QuerymtModelInfoWireResponse): QuerymtModelInfoResponse {
  const models = Object.fromEntries(
    Object.entries(response.models ?? {}).map(([key, info]) => {
      if (!info) return [key, null];

      const capabilities = info.capabilities ?? {};
      return [
        key,
        {
          id: info.id,
          name: info.name,
          knowledge: info.knowledge,
          release_date: info.release_date,
          last_updated: info.last_updated,
          open_weights: info.open_weights,
          capabilities: {
            attachment: info.attachment ?? capabilities.attachment,
            reasoning: info.reasoning ?? capabilities.reasoning,
            temperature: info.temperature ?? capabilities.temperature,
            tool_call: info.tool_call ?? capabilities.tool_call,
            modalities: info.modalities ?? capabilities.modalities
          },
          limits: info.limit ?? info.limits,
          pricing: info.cost ?? info.pricing
        } satisfies ModelInfo
      ];
    })
  );

  return { models };
}

export interface QuerymtAuthStatusResponse {
  providers: AuthProviderEntry[];
}

export interface QuerymtAuthStartResponse {
  flow_id: string;
  provider: string;
  authorization_url?: string;
  flow_kind?: OAuthFlowKindTs;
}

export interface QuerymtAuthResult {
  provider?: string;
  success?: boolean;
  message?: string;
}

export interface QuerymtPluginUpdateResponse {
  results: PluginUpdateResult[];
}

export interface QuerymtUndoStackResponse {
  undo_stack: UndoStackFrame[];
}

export interface QuerymtUndoResponse extends QuerymtUndoStackResponse {
  success: boolean;
  message_id?: string;
  reverted_files?: string[];
  message?: string;
}

export interface QuerymtRedoResponse extends QuerymtUndoStackResponse {
  success: boolean;
  restored?: boolean;
  message?: string;
}

export interface QuerymtSubmitInputRequest {
  session_id: string;
  prompt: import('@agentclientprotocol/sdk').ContentBlock[];
  client_input_id: string;
  expected_run_id?: string;
}

/** Error thrown when a QueryMT extension response violates its wire contract. */
export class QuerymtExtensionResponseError extends Error {
  constructor(method: string) {
    super(`Malformed response for ${method}.`);
    this.name = 'QuerymtExtensionResponseError';
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function toAcpExtensionMethod(method: QuerymtLogicalMethod): QuerymtWireMethod {
  return `_${method}`;
}

/**
 * Validate the advertised elicitation-recovery contract.
 *
 * Returns null when the agent is legacy, the capability is unavailable, or the
 * advertised version or contract methods are incompatible with this client.
 */
export function parseQuerymtElicitationRecoveryCapability(
  capabilities: CapabilitiesInfo
): QuerymtElicitationRecoveryCapability | null {
  const advertised = (
    capabilities as CapabilitiesInfo & { elicitation_recovery?: unknown }
  ).elicitation_recovery;
  if (!advertised || typeof advertised !== 'object') {
    return null;
  }

  const candidate = advertised as Partial<QuerymtElicitationRecoveryCapability>;
  if (
    candidate.version !== QMT_ELICITATION_RECOVERY_VERSION ||
    candidate.authority_notification !== QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY ||
    candidate.list_pending_method !== QMT_METHOD_ELICITATION_LIST_PENDING ||
    candidate.attach_method !== QMT_METHOD_ELICITATION_ATTACH_SESSION
  ) {
    return null;
  }

  const methods = capabilities.methods ?? [];
  const notifications = capabilities.notifications ?? [];
  if (
    !methods.includes(QMT_METHOD_ELICITATION_LIST_PENDING) ||
    !methods.includes(QMT_METHOD_ELICITATION_ATTACH_SESSION) ||
    !notifications.includes(QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY)
  ) {
    return null;
  }

  return {
    version: candidate.version,
    authority_notification: candidate.authority_notification,
    list_pending_method: candidate.list_pending_method,
    attach_method: candidate.attach_method
  };
}

/** Validate a recoveryAuthority notification payload; returns null when malformed. */
export function parseQuerymtElicitationRecoveryAuthority(
  params: unknown
): QuerymtElicitationRecoveryAuthorityNotification | null {
  if (!params || typeof params !== 'object') {
    return null;
  }
  const candidate = params as Partial<QuerymtElicitationRecoveryAuthorityNotification>;
  if (
    candidate.version !== QMT_ELICITATION_RECOVERY_VERSION ||
    typeof candidate.session_id !== 'string' ||
    candidate.session_id.length === 0 ||
    typeof candidate.resume_authority !== 'string' ||
    candidate.resume_authority.length === 0
  ) {
    return null;
  }
  return {
    version: candidate.version,
    session_id: candidate.session_id,
    resume_authority: candidate.resume_authority
  };
}

export function toLogicalQuerymtMethod(method: string): QuerymtLogicalMethod | null {
  if (method.startsWith('_querymt/')) {
    return method.slice(1) as QuerymtLogicalMethod;
  }
  if (method.startsWith('querymt/')) {
    return method as QuerymtLogicalMethod;
  }
  return null;
}

export class QuerymtExtensions {
  constructor(private connection: ClientSideConnection) {}

  private async call<T>(method: QuerymtLogicalMethod, params: unknown = {}): Promise<T> {
    const response = await this.connection.extMethod(
      toAcpExtensionMethod(method),
      params as Record<string, unknown>
    );
    return response as T;
  }

  async capabilities(): Promise<CapabilitiesInfo> {
    return this.call<CapabilitiesInfo>(QMT_METHOD_CAPABILITIES);
  }

  async listPendingElicitationSessions(
    request: QuerymtListPendingElicitationSessionsRequest
  ): Promise<QuerymtListPendingElicitationSessionsResponse> {
    const response = await this.call<Partial<QuerymtListPendingElicitationSessionsResponse>>(
      QMT_METHOD_ELICITATION_LIST_PENDING,
      request
    );
    if (
      !response ||
      response.version !== QMT_ELICITATION_RECOVERY_VERSION ||
      !isStringArray(response.session_ids)
    ) {
      throw new QuerymtExtensionResponseError(QMT_METHOD_ELICITATION_LIST_PENDING);
    }
    return {
      version: response.version,
      session_ids: response.session_ids
    };
  }

  async attachPendingElicitationSession(
    request: QuerymtAttachPendingElicitationSessionRequest
  ): Promise<QuerymtAttachPendingElicitationSessionResponse> {
    const response = await this.call<Partial<QuerymtAttachPendingElicitationSessionResponse>>(
      QMT_METHOD_ELICITATION_ATTACH_SESSION,
      request
    );
    if (
      !response ||
      response.version !== QMT_ELICITATION_RECOVERY_VERSION ||
      typeof response.session_id !== 'string' ||
      !response.session_id ||
      !isStringArray(response.elicitation_ids)
    ) {
      throw new QuerymtExtensionResponseError(QMT_METHOD_ELICITATION_ATTACH_SESSION);
    }
    return {
      version: response.version,
      session_id: response.session_id,
      elicitation_ids: response.elicitation_ids
    };
  }

  async models(): Promise<QuerymtModelsResponse> {
    const response = await this.call<QuerymtModelsWireResponse>(QMT_METHOD_MODELS);
    return normalizeQuerymtModelsResponse(response);
  }

  async refreshModels(request: { wait_for_completion?: boolean } = {}): Promise<QuerymtModelsResponse> {
    const response = await this.call<QuerymtModelsWireResponse>(QMT_METHOD_REFRESH_MODELS, request);
    return normalizeQuerymtModelsResponse(response);
  }

  async modelInfo(models: Array<{ provider: string; model: string }>): Promise<QuerymtModelInfoResponse> {
    const response = await this.call<QuerymtModelInfoWireResponse>(QMT_METHOD_MODEL_INFO, { models });
    return normalizeQuerymtModelInfoResponse(response);
  }

  async profiles(): Promise<QuerymtProfilesResponse> {
    const response = await this.call<QuerymtProfilesResponse>(QMT_METHOD_PROFILES);
    return { ...response, profiles: response.profiles ?? [] };
  }

  async meshStatus(): Promise<MeshStatusInfo> {
    return this.call<MeshStatusInfo>(QMT_METHOD_MESH_STATUS);
  }

  async meshJoin(request: MeshJoinRequest): Promise<MeshJoinInfo> {
    return this.call<MeshJoinInfo>(QMT_METHOD_MESH_JOIN, request);
  }

  async meshNodes(): Promise<MeshNodesInfo> {
    return this.call<MeshNodesInfo>(QMT_METHOD_MESH_NODES);
  }

  async createMeshInvite(request: CreateMeshInviteRequest): Promise<MeshInviteCreatedInfo> {
    return this.call<MeshInviteCreatedInfo>(QMT_METHOD_MESH_CREATE_INVITE, request);
  }

  async listMeshInvites(): Promise<MeshInviteListInfo> {
    return this.call<MeshInviteListInfo>(QMT_METHOD_MESH_LIST_INVITES);
  }

  async revokeMeshInvite(request: RevokeMeshInviteRequest): Promise<MeshInviteRevokedInfo> {
    return this.call<MeshInviteRevokedInfo>(QMT_METHOD_MESH_REVOKE_INVITE, request);
  }

  async remoteSessions(request: RemoteSessionsRequest): Promise<RemoteSessionListInfo> {
    return this.call<RemoteSessionListInfo>(QMT_METHOD_REMOTE_SESSIONS, request);
  }

  async createRemoteSession(request: CreateRemoteSessionRequest): Promise<RemoteSessionAttachInfo> {
    return this.call<RemoteSessionAttachInfo>(QMT_METHOD_REMOTE_CREATE_SESSION, request);
  }

  async attachRemoteSession(request: AttachRemoteSessionRequest): Promise<RemoteSessionAttachInfo> {
    return this.call<RemoteSessionAttachInfo>(QMT_METHOD_REMOTE_ATTACH_SESSION, request);
  }

  async dismissRemoteSession(request: DismissRemoteSessionRequest): Promise<RemoteSessionDismissInfo> {
    return this.call<RemoteSessionDismissInfo>(QMT_METHOD_REMOTE_DISMISS_SESSION, request);
  }

  async createSchedule(request: CreateScheduleControlRequest): Promise<{ schedule: ScheduleInfo }> {
    return this.call<{ schedule: ScheduleInfo }>(QMT_METHOD_SCHEDULES_CREATE, request);
  }

  async listSchedules(request: ListSchedulesControlRequest): Promise<ScheduleListInfo> {
    return this.call<ScheduleListInfo>(QMT_METHOD_SCHEDULES_LIST, request);
  }

  async getSchedule(request: GetScheduleControlRequest): Promise<{ schedule: ScheduleInfo }> {
    return this.call<{ schedule: ScheduleInfo }>(QMT_METHOD_SCHEDULES_GET, request);
  }

  async pauseSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    return this.call<ScheduleActionResult>(QMT_METHOD_SCHEDULES_PAUSE, request);
  }

  async resumeSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    return this.call<ScheduleActionResult>(QMT_METHOD_SCHEDULES_RESUME, request);
  }

  async triggerSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    return this.call<ScheduleActionResult>(QMT_METHOD_SCHEDULES_TRIGGER, request);
  }

  async deleteSchedule(request: ScheduleActionControlRequest): Promise<ScheduleActionResult> {
    return this.call<ScheduleActionResult>(QMT_METHOD_SCHEDULES_DELETE, request);
  }

  async authStatus(): Promise<QuerymtAuthStatusResponse> {
    const response = await this.call<QuerymtAuthStatusResponse>(QMT_METHOD_AUTH_STATUS);
    return {
      providers: response.providers ?? []
    };
  }

  async startAuth(provider: string): Promise<QuerymtAuthStartResponse> {
    return this.call<QuerymtAuthStartResponse>(QMT_METHOD_AUTH_START, { provider });
  }

  async completeAuth(flow_id: string, response: string): Promise<QuerymtAuthResult> {
    return this.call<QuerymtAuthResult>(QMT_METHOD_AUTH_COMPLETE, { flow_id, response });
  }

  async logoutAuth(provider: string): Promise<QuerymtAuthResult> {
    return this.call<QuerymtAuthResult>(QMT_METHOD_AUTH_LOGOUT, { provider });
  }

  async setApiToken(provider: string, api_key: string): Promise<QuerymtAuthResult> {
    return this.call<QuerymtAuthResult>(QMT_METHOD_AUTH_SET_API_TOKEN, { provider, api_key });
  }

  async clearApiToken(provider: string): Promise<QuerymtAuthResult> {
    return this.call<QuerymtAuthResult>(QMT_METHOD_AUTH_CLEAR_API_TOKEN, { provider });
  }

  async setAuthMethod(provider: string, method: AuthMethod): Promise<QuerymtAuthResult> {
    return this.call<QuerymtAuthResult>(QMT_METHOD_AUTH_SET_METHOD, { provider, method });
  }

  async updatePlugins(): Promise<QuerymtPluginUpdateResponse> {
    const response = await this.call<QuerymtPluginUpdateResponse>(QMT_METHOD_UPDATE_PLUGINS);
    return {
      results: response.results ?? []
    };
  }

  async steerSession(request: QuerymtSubmitInputRequest): Promise<SubmitInputResult> {
    return this.call<SubmitInputResult>(QMT_METHOD_SESSION_STEER, request);
  }

  async queueSession(request: QuerymtSubmitInputRequest): Promise<SubmitInputResult> {
    return this.call<SubmitInputResult>(QMT_METHOD_SESSION_QUEUE, request);
  }

  async discardQueuedInput(session_id: string, input_id: string): Promise<DiscardQueuedInputResult> {
    return this.call<DiscardQueuedInputResult>(QMT_METHOD_SESSION_DISCARD_QUEUED_INPUT, {
      session_id,
      input_id
    });
  }

  async sessionRuntimeState(session_id: string): Promise<SessionRuntimeState> {
    return this.call<SessionRuntimeState>(QMT_METHOD_SESSION_RUNTIME_STATE, { session_id });
  }

  async undoStack(session_id: string): Promise<QuerymtUndoStackResponse> {
    const response = await this.call<QuerymtUndoStackResponse>(QMT_METHOD_SESSION_UNDO_STACK, { session_id });
    return { undo_stack: response.undo_stack ?? [] };
  }

  async undoSession(session_id: string, message_id: string): Promise<QuerymtUndoResponse> {
    const response = await this.call<QuerymtUndoResponse>(QMT_METHOD_SESSION_UNDO, { session_id, message_id });
    return { ...response, undo_stack: response.undo_stack ?? [], reverted_files: response.reverted_files ?? [] };
  }

  async redoSession(session_id: string): Promise<QuerymtRedoResponse> {
    const response = await this.call<QuerymtRedoResponse>(QMT_METHOD_SESSION_REDO, { session_id });
    return { ...response, undo_stack: response.undo_stack ?? [] };
  }

  async delegateModels(request: DelegateModelsRequest): Promise<DelegateAssignmentsInfo> {
    const response = await this.call<DelegateAssignmentsInfo>(QMT_METHOD_SESSION_DELEGATE_MODELS, request);
    if (response.version !== 1) {
      throw new Error(`Unsupported delegate-model contract version ${response.version}.`);
    }
    return {
      ...response,
      assignments: response.assignments ?? [],
      orphaned_overrides: response.orphaned_overrides ?? []
    };
  }

  async setDelegateModel(request: SetDelegateModelRequest): Promise<SetDelegateModelResponse> {
    const response = await this.call<SetDelegateModelResponse>(QMT_METHOD_SESSION_SET_DELEGATE_MODEL, request);
    if (response.version !== 1) {
      throw new Error(`Unsupported delegate-model contract version ${response.version}.`);
    }
    return response;
  }
}
