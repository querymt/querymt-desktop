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
  ModelsChangedNotification,
  MeshJoinedNotification,
  MeshNodesChangedNotification,
  MeshPeerExpiredNotification,
  OAuthFlowKindTs,
  PluginUpdateResult,
  SchedulesChangedNotification
} from '$lib/querymt/generated/types';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';

export type QuerymtLogicalMethod = `querymt/${string}`;
export type QuerymtWireMethod = QuerymtLogicalMethod | `_${QuerymtLogicalMethod}`;
export type QuerymtExtensionNotification =
  | { method: 'querymt/models/changed'; params: ModelsChangedNotification }
  | { method: 'querymt/mesh/joined'; params: MeshJoinedNotification }
  | { method: 'querymt/mesh/nodesChanged'; params: MeshNodesChangedNotification }
  | { method: 'querymt/mesh/peerExpired'; params: MeshPeerExpiredNotification }
  | { method: 'querymt/schedules/changed'; params: SchedulesChangedNotification }
  | { method: 'querymt/pluginUpdateStatus'; params: { plugin_name: string; image_reference: string; phase: string; bytes_downloaded: number; bytes_total?: number; percent?: number; message?: string } }
  | { method: 'querymt/pluginUpdateComplete'; params: { results: PluginUpdateResult[] } }
  | { method: QuerymtLogicalMethod; params: unknown };

export const QMT_METHOD_CAPABILITIES = 'querymt/capabilities';
export const QMT_METHOD_MODELS = 'querymt/models';
export const QMT_METHOD_REFRESH_MODELS = 'querymt/refreshModels';
export const QMT_METHOD_MODEL_INFO = 'querymt/modelInfo';
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

export function toAcpExtensionMethod(method: QuerymtLogicalMethod): QuerymtWireMethod {
  return `_${method}`;
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

  async models(): Promise<QuerymtModelsResponse> {
    const response = await this.call<QuerymtModelsWireResponse>(QMT_METHOD_MODELS);
    return normalizeQuerymtModelsResponse(response);
  }

  async refreshModels(request: { wait_for_completion?: boolean } = {}): Promise<QuerymtModelsResponse> {
    const response = await this.call<QuerymtModelsWireResponse>(QMT_METHOD_REFRESH_MODELS, request);
    return normalizeQuerymtModelsResponse(response);
  }

  async modelInfo(models: Array<{ provider: string; model: string }>): Promise<QuerymtModelInfoResponse> {
    const response = await this.call<QuerymtModelInfoResponse>(QMT_METHOD_MODEL_INFO, { models });
    return {
      models: response.models ?? {}
    };
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
}
