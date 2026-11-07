import { OAuthStatus, type AuthProviderStatus, type CapabilitiesInfo } from '$lib/querymt/generated/types';
import { findModelBySelectionKey } from '$lib/querymt/config-options';
import { hasUsableProviderCredential } from '$lib/domain/provider-auth';
import { splitAuthEntries } from '$lib/domain/mcp-auth';
import type { AgentConfig, AgentConnectionState, AgentRuntimeStatus, ModelEntry } from '$lib/domain/types';

export type ReadinessCheckId = 'agent' | 'providers' | 'models' | 'model';
export type ReadinessStatus = 'ok' | 'pending' | 'blocked' | 'warning' | 'not_applicable';

export type ReadinessAction =
  | { kind: 'retry-agent'; agentId: string }
  | { kind: 'open-agents' }
  | { kind: 'open-providers'; agentId: string }
  | { kind: 'refresh-providers'; agentId: string }
  | { kind: 'refresh-models'; agentId: string }
  | { kind: 'choose-model'; agentId: string };

export interface ReadinessCheck {
  id: ReadinessCheckId;
  status: ReadinessStatus;
  title: string;
  reason: string | null;
  action: ReadinessAction | null;
}

export interface ReadinessReport {
  /** Agent the provider and model checks refer to. */
  agentId: string | null;
  checks: ReadinessCheck[];
  /** Every check is ok or not_applicable. */
  setupComplete: boolean;
}

export interface ReadinessInput {
  configs: AgentConfig[];
  primaryAgentId: string | null;
  statuses: Record<string, AgentRuntimeStatus | undefined>;
  connectionStates: Record<string, AgentConnectionState | undefined>;
  agentErrors: Record<string, string | null | undefined>;
  capabilities: Record<string, CapabilitiesInfo | null | undefined>;
  authProviders: Record<string, AuthProviderStatus[] | undefined>;
  authLoading: Record<string, boolean | undefined>;
  authErrors: Record<string, string | null | undefined>;
  models: Record<string, ModelEntry[] | undefined>;
  modelLoading: Record<string, boolean | undefined>;
  launchModelIds: Record<string, string | undefined>;
  initializing: boolean;
}

const PENDING_CONNECTIONS = new Set<AgentConnectionState>(['connecting', 'reconnecting']);

function isRunning(input: ReadinessInput, agentId: string): boolean {
  return input.statuses[agentId]?.state === 'running' && input.connectionStates[agentId] !== 'failed';
}

function isStarting(input: ReadinessInput, agentId: string): boolean {
  const state = input.statuses[agentId]?.state;
  const connection = input.connectionStates[agentId];
  return state === 'starting' || (connection !== undefined && PENDING_CONNECTIONS.has(connection));
}

function check(id: ReadinessCheckId, title: string, status: ReadinessStatus, reason: string | null = null, action: ReadinessAction | null = null): ReadinessCheck {
  return { id, title, status, reason: status === 'ok' || status === 'not_applicable' ? null : reason, action: status === 'ok' || status === 'not_applicable' ? null : action };
}

/**
 * Derives first-run readiness from existing agent, provider and model state.
 * Pure: the store builds the snapshot, the wizard and start screen render the result.
 */
export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const enabled = input.configs.filter((config) => config.enabled);
  const running = enabled.filter((config) => isRunning(input, config.id));
  const primary = input.primaryAgentId ? enabled.find((config) => config.id === input.primaryAgentId) : undefined;
  const checked = primary && isRunning(input, primary.id) ? primary : running[0];
  const agentId = checked?.id ?? null;

  let agent: ReadinessCheck;
  if (checked) {
    agent = check('agent', 'Agent', 'ok');
  } else if (enabled.length === 0) {
    agent = check('agent', 'Agent', 'blocked', 'No agent is configured.', { kind: 'open-agents' });
  } else if (input.initializing || enabled.some((config) => isStarting(input, config.id))) {
    agent = check('agent', 'Agent', 'pending', 'Starting the agent…');
  } else {
    const failing = primary ?? enabled[0];
    const error = input.agentErrors[failing.id] ?? input.statuses[failing.id]?.lastError ?? null;
    agent = check('agent', 'Agent', 'blocked', error ?? `${failing.name} is not running.`, { kind: 'retry-agent', agentId: failing.id });
  }

  if (!agentId) {
    const na = (id: ReadinessCheckId, title: string) => check(id, title, 'not_applicable');
    const checks = [agent, na('providers', 'Providers'), na('models', 'Models'), na('model', 'Model')];
    return { agentId: null, checks, setupComplete: false };
  }

  let providers: ReadinessCheck;
  const supportsAuth = Boolean(input.capabilities[agentId]?.features?.auth);
  // MCP connector logins share the auth list but are not model providers.
  const entries = splitAuthEntries(input.authProviders[agentId] ?? []).providers;
  const authError = input.authErrors[agentId] ?? null;
  if (!supportsAuth) {
    providers = check('providers', 'Providers', 'not_applicable');
  } else if (entries.some(hasUsableProviderCredential)) {
    providers = check('providers', 'Providers', 'ok');
  } else if (input.authLoading[agentId]) {
    providers = check('providers', 'Providers', 'pending', 'Checking providers…');
  } else if (authError) {
    providers = check('providers', 'Providers', 'blocked', `Could not load providers: ${authError}`, { kind: 'refresh-providers', agentId });
  } else if (input.authProviders[agentId] === undefined) {
    providers = check('providers', 'Providers', 'pending', 'Checking providers…');
  } else {
    const expired = entries.filter((entry) => entry.oauth_status === OAuthStatus.Expired);
    providers = expired.length > 0
      ? check('providers', 'Providers', 'warning', `Sign-in expired for ${expired.map((entry) => entry.display_name).join(', ')}. Reconnect to continue.`, { kind: 'open-providers', agentId })
      : check('providers', 'Providers', 'blocked', 'No provider is connected. Connect one to load models.', { kind: 'open-providers', agentId });
  }

  const modelList = input.models[agentId] ?? [];
  let models: ReadinessCheck;
  if (modelList.length > 0) {
    models = check('models', 'Models', 'ok');
  } else if (input.modelLoading[agentId] || input.models[agentId] === undefined && input.initializing) {
    models = check('models', 'Models', 'pending', 'Loading models…');
  } else if (providers.status === 'blocked' || providers.status === 'warning') {
    models = check('models', 'Models', 'blocked', 'No models available. Connect a provider first.', { kind: 'open-providers', agentId });
  } else {
    models = check('models', 'Models', 'blocked', 'The agent returned no models.', { kind: 'refresh-models', agentId });
  }

  let model: ReadinessCheck;
  if (modelList.length === 0) {
    model = check('model', 'Model', 'not_applicable');
  } else if (findModelBySelectionKey(modelList, input.launchModelIds[agentId])) {
    model = check('model', 'Model', 'ok');
  } else {
    model = check('model', 'Model', 'blocked', 'Choose a model for new sessions.', { kind: 'choose-model', agentId });
  }

  const checks = [agent, providers, models, model];
  return { agentId, checks, setupComplete: checks.every((entry) => entry.status === 'ok' || entry.status === 'not_applicable') };
}

/** First check that is neither ok nor not_applicable. */
export function firstOpenCheck(report: ReadinessReport): ReadinessCheck | null {
  return report.checks.find((entry) => entry.status !== 'ok' && entry.status !== 'not_applicable') ?? null;
}
