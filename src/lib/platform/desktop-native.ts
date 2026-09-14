export { createTauriAcpStream } from '$lib/querymt/transport-tauri';
export {
  drainAgentSessionUpdates,
  getAgentLogs,
  getAgentStatus,
  restartAgent,
  startAgent,
  stopAgent,
  suggestWorkspacePaths,
  validateWorkspaceDirectory,
  writeAgentAcpLine,
  type AgentLogEntry
} from '$lib/querymt/sidecar';
export {
  enableProfileTemplate,
  listManagedProfiles,
  listProfileTemplates,
  type ManagedProfileInfo,
  type ProfileTemplateInfo
} from '$lib/querymt/profile-templates';
export {
  checkpointSessionLoadTelemetry,
  finishSessionLoadTelemetry,
  heartbeatSessionLoadTelemetry,
  startSessionLoadTelemetry,
  type SessionLoadTelemetryCounters
} from '$lib/querymt/session-load-telemetry';

export async function listenAgentLogs<T>(handler: (payload: T) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>('querymt://agent/log', ({ payload }) => handler(payload));
}

export async function pickWorkspaceDirectory(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selection = await open({
    directory: true,
    multiple: false,
    title: 'Choose a workspace folder'
  });
  return typeof selection === 'string' ? selection : null;
}

export async function openExternalUrl(value: string): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS links can be opened.');
  }
  const { open } = await import('@tauri-apps/plugin-shell');
  await open(url.toString());
}

export type WindowResizeDirection =
  | 'North'
  | 'East'
  | 'South'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest';

export async function getNativeWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function getAppRuntime(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('app_runtime');
}

export async function setWindowDecorationMode(useOsDecorations: boolean): Promise<void> {
  const currentWindow = await getNativeWindow();
  if ((await currentWindow.isDecorated()) !== useOsDecorations) {
    await currentWindow.setDecorations(useOsDecorations);
  }
  await currentWindow.setShadow(true);
}
