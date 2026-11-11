import type { Stream } from '@agentclientprotocol/sdk/unstable';
import type { AgentConfig, AgentRuntimeStatus, WorkspaceSuggestion } from '$lib/domain/types';
import type { SessionLoadTelemetryCounters } from '$lib/perf/session-load-metrics';
export type { SessionLoadTelemetryCounters } from '$lib/perf/session-load-metrics';

export interface AgentLogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface ProfileTemplateInfo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  userPath?: string;
}

export interface ManagedProfileInfo {
  id: string;
  name: string;
  description?: string | null;
  tags: string[];
  userPath: string;
}

/** Throws: the operation has no embedded implementation. */
function unavailable(): never {
  throw new Error('This native operation is unavailable in the embedded QueryMT UI.');
}

export type {
  InstallEvent,
  UpdatePreferencesPatch,
  UpdateState,
  UpdatesStatus
} from '$lib/querymt/updates';
import type { InstallEvent, UpdatePreferencesPatch, UpdateState, UpdatesStatus } from '$lib/querymt/updates';

/** Embedded builds have no desktop updater. */
export async function getUpdatesStatus(): Promise<UpdatesStatus> {
  return unavailable();
}
/** Not available in the embedded UI; always throws. */
export async function setUpdatePreferences(_patch: UpdatePreferencesPatch): Promise<UpdatesStatus> {
  return unavailable();
}
/** Not available in the embedded UI; always throws. */
export async function checkForUpdates(_manual: boolean): Promise<UpdatesStatus> {
  return unavailable();
}
/** Not available in the embedded UI; always throws. */
export async function installUpdate(_onEvent: (event: InstallEvent) => void): Promise<void> {
  return unavailable();
}
/** Not available in the embedded UI; always throws. */
export async function restartForUpdate(): Promise<void> {
  return unavailable();
}
/** Not available in the embedded UI; always throws. */
export async function listenUpdateState(_handler: (state: UpdateState) => void): Promise<() => void> {
  return () => {};
}

/** Not available in the embedded UI; always throws. */
export async function createTauriAcpStream(_agentId: string): Promise<Stream> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function createNativeWebSocketAcpStream(
  _url: string,
  _onDisconnect?: (reason: string) => void
): Promise<Stream> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function listenAgentLogs<T>(_handler: (payload: T) => void): Promise<() => void> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function pickWorkspaceDirectory(): Promise<string | null> {
  return unavailable();
}

/** Opens an http(s) link in a new browser tab. */
export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS links can be opened.');
  }
  const opened = window.open(url.toString(), '_blank', 'noopener,noreferrer');
  if (!opened) {
    throw new Error('The browser blocked the new window. Copy the link and open it manually.');
  }
}

/** Not available in the embedded UI; always throws. */
export async function getAgentStatus(_config: AgentConfig): Promise<AgentRuntimeStatus> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function startAgent(_config: AgentConfig): Promise<AgentRuntimeStatus> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function stopAgent(_agentId: string): Promise<AgentRuntimeStatus> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function restartAgent(_config: AgentConfig): Promise<AgentRuntimeStatus> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function getAgentLogs(_agentId: string): Promise<AgentLogEntry[]> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function drainAgentSessionUpdates(
  _agentId: string,
  _sessionId?: string | null
): Promise<unknown[]> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function writeAgentAcpLine(_agentId: string, _line: string): Promise<void> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function suggestWorkspacePaths(_input: string, _limit = 12): Promise<WorkspaceSuggestion[]> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function validateWorkspaceDirectory(_path: string): Promise<boolean> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function listProfileTemplates(): Promise<ProfileTemplateInfo[]> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function listManagedProfiles(): Promise<ManagedProfileInfo[]> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function enableProfileTemplate(_profileId: string): Promise<ProfileTemplateInfo> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function startSessionLoadTelemetry(_agentId: string, _sessionId: string): Promise<string | null> {
  return null;
}

/** Not available in the embedded UI; always throws. */
export async function checkpointSessionLoadTelemetry(
  _operationId: string | null,
  _phase: string,
  _durationMs: number,
  _counters: SessionLoadTelemetryCounters
): Promise<void> {}

/** Not available in the embedded UI; always throws. */
export async function heartbeatSessionLoadTelemetry(
  _operationId: string | null,
  _counters: SessionLoadTelemetryCounters
): Promise<void> {}

/** Not available in the embedded UI; always throws. */
export async function finishSessionLoadTelemetry(
  _operationId: string | null,
  _status: string,
  _counters: SessionLoadTelemetryCounters
): Promise<void> {}

export type WindowResizeDirection =
  | 'North'
  | 'East'
  | 'South'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

/** Not available in the embedded UI; always throws. */
export async function getNativeWindow(): Promise<never> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function getAppRuntime(): Promise<string> {
  return unavailable();
}

/** Not available in the embedded UI; always throws. */
export async function setWindowDecorationMode(_useOsDecorations: boolean): Promise<void> {
  return unavailable();
}

/** Embedded mode has no app folders; only browser storage is cleared, then the page reloads. */
export async function resetAppData(_options: { includeProfiles: boolean }): Promise<void> {
  window.location.reload();
}
