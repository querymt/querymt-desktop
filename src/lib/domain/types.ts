import type { SessionConfigOption } from '@agentclientprotocol/sdk';

export type RuntimeStatus = 'running' | 'starting' | 'degraded' | 'stopped';
export type SessionStatus = 'idle' | 'thinking' | 'waiting' | 'completed' | 'cancelling';
export type SessionRunState =
  | 'idle'
  | 'submitting'
  | 'thinking'
  | 'streaming'
  | 'tool-running'
  | 'waiting-input'
  | 'completed'
  | 'failed';
export type InboxSeverity = 'high' | 'medium' | 'low';
export type AgentLifecycle = 'idle' | 'starting' | 'running' | 'failed' | 'stopping' | 'stopped';
export type AgentConnectionState = 'idle' | 'connecting' | 'reconnecting' | 'initialized' | 'loading-sessions' | 'failed';
export type AgentControlState = 'unknown' | 'ready' | 'legacy' | 'degraded' | 'failed';
export type AgentTransport = 'stdio' | 'websocket';

export interface AgentConfig {
  id: string;
  name: string;
  transport: AgentTransport;
  commandLine: string;
  websocketUrl?: string;
  enabled: boolean;
  autoStart: boolean;
}

export interface AgentRuntimeStatus {
  agentId: string;
  state: AgentLifecycle;
  commandLine: string;
  pid: number | null;
  version: string | null;
  message: string;
  lastError: string | null;
}

export interface AgentControlHealth {
  state: AgentControlState;
  summary: string;
  missingMethods: string[];
  missingFeatures: string[];
}

export interface CommandPalettePrefill {
  agentId?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  prompt?: string | null;
  nodeId?: string | null;
}

export interface RuntimeCard {
  id: string;
  name: string;
  profile: string;
  workspace: string;
  model: string;
  status: RuntimeStatus;
  activeSessions: number;
  lastActivity: string;
}

export interface SessionItem {
  id: string;
  title: string;
  runtime: string;
  workspace: string;
  status: SessionStatus;
  lastMessage: string;
  updatedAt: string;
}

export interface DesktopSessionSummary {
  agentId: string;
  agentName: string;
  sessionId: string;
  title: string;
  cwd: string;
  updatedAt: string | null;
  runtimeId: string;
  runtimeName: string;
  source: 'acp';
  status: SessionStatus;
}

export interface ModelEntry {
  id: string;
  provider: string;
  model: string;
  label?: string | null;
  node_id?: string | null;
  node_label?: string | null;
  source?: string | null;
  family?: string | null;
  quant?: string | null;
}

export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data: string;
}

export interface ComposerOption {
  id: string;
  label: string;
  description?: string | null;
}

export interface ModelInfo {
  id?: string;
  name?: string;
  knowledge?: string | null;
  release_date?: string | null;
  last_updated?: string | null;
  open_weights?: boolean | null;
  capabilities?: {
    attachment?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    modalities?: {
      input?: string[];
      output?: string[];
    };
  };
  limits?: {
    context?: number | null;
    output?: number | null;
  };
  pricing?: {
    input?: number | null;
    output?: number | null;
    cache_read?: number | null;
    cache_write?: number | null;
  };
}

export interface WorkspaceSuggestion {
  path: string;
  name: string;
}

export interface SessionTranscriptItem {
  id: string;
  kind: 'user_message_chunk' | 'agent_message_chunk' | 'agent_thought_chunk';
  text: string;
  messageId: string | null;
  eventIndex?: number;
}

export interface SessionTranscriptGroup {
  id: string;
  role: 'user' | 'assistant' | 'thought';
  text: string;
  messageId: string | null;
  eventIds: string[];
  eventIndex?: number;
}

export interface SessionToolCallItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  kind: string | null;
  messageId?: string | null;
  arguments?: string | null;
  result?: string | null;
  isError?: boolean;
  eventIndex?: number;
}

export interface SessionPlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ActiveSessionViewModel {
  sessionId: string | null;
  transcript: SessionTranscriptItem[];
  toolCalls: SessionToolCallItem[];
  plans: SessionPlanEntry[];
  events: SessionEventItem[];
  configOptions: SessionConfigOption[];
  runState: SessionRunState;
  activityLabel: string | null;
  activeToolCallId: string | null;
  lastStopReason: string | null;
  lastError: string | null;
}

export interface SessionEventItem {
  id: string;
  kind: string;
  text: string;
  messageId: string | null;
}

export interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  when: string;
  kind: 'run' | 'approval' | 'warning' | 'completion';
}

export interface InboxAction {
  id: string;
  label: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'accept' | 'decline' | 'cancel';
}

export interface InboxFormOption {
  value: string;
  label: string;
}

export interface InboxFormField {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  required: boolean;
  description?: string | null;
  options?: InboxFormOption[];
  value: string | number | boolean | string[];
  allowCustom?: boolean;
  customActive?: boolean;
  customValue?: string;
}

export interface InboxItem {
  id: string;
  title: string;
  detail: string;
  owner: string;
  severity: InboxSeverity;
  type: 'permission' | 'elicitation' | 'auth' | 'review';
  agentId?: string | null;
  agentName?: string | null;
  sessionId?: string | null;
  status?: 'pending' | 'resolved';
  resolution?: string | null;
  error?: string | null;
  actions?: InboxAction[];
  formFields?: InboxFormField[];
}

export interface WorkspaceItem {
  id: string;
  name: string;
  path: string;
  status: 'indexed' | 'indexing' | 'attention';
  defaultRuntime: string;
}

export interface SettingsGroup {
  title: string;
  description: string;
  items: Array<{ label: string; value: string; hint: string }>;
}
