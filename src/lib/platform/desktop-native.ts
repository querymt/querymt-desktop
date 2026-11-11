import type { Stream } from '@agentclientprotocol/sdk/unstable';
import type { AnyMessage } from '@agentclientprotocol/sdk/unstable';

export { createTauriAcpStream } from '$lib/querymt/transport-tauri';

interface NativeWebSocketEvent {
  type: 'message' | 'closed' | 'error';
  data?: string;
  reason?: string;
  message?: string;
}

/** Opens an ACP stream over a native (Rust) WebSocket. */
export async function createNativeWebSocketAcpStream(
  url: string,
  onDisconnect?: (reason: string) => void
): Promise<Stream> {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  let connectionId: string | null = null;
  let closed = false;
  let notified = false;
  let readableController!: ReadableStreamDefaultController<AnyMessage>;

  /** Reports a disconnect to the caller at most once. */
  const notifyDisconnect = (reason: string) => {
    if (notified) return;
    notified = true;
    onDisconnect?.(reason);
  };
  const events = new Channel<NativeWebSocketEvent>((event) => {
    if (closed) return;
    if (event.type === 'message' && typeof event.data === 'string') {
      try {
        readableController.enqueue(JSON.parse(event.data) as AnyMessage);
      } catch {
        const message = 'ACP WebSocket received invalid JSON-RPC payload.';
        notifyDisconnect(message);
        closed = true;
        readableController.error(new Error(message));
      }
      return;
    }

    const reason = event.type === 'closed'
      ? event.reason ?? 'WebSocket closed.'
      : event.message ?? 'ACP WebSocket connection failed.';
    notifyDisconnect(reason);
    closed = true;
    if (event.type === 'closed') readableController.close();
    else readableController.error(new Error(reason));
  });
  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      readableController = controller;
    },
    async cancel() {
      closed = true;
      if (connectionId) {
        await invoke('querymt_websocket_close', { request: { connectionId } }).catch(() => undefined);
      }
    }
  });

  connectionId = await invoke<string>('querymt_websocket_connect', {
    request: { url },
    events
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      if (closed || !connectionId) throw new Error('ACP WebSocket is not connected.');
      await invoke('querymt_websocket_send', {
        request: { connectionId, data: JSON.stringify(message) }
      });
    },
    async close() {
      closed = true;
      if (connectionId) await invoke('querymt_websocket_close', { request: { connectionId } });
    },
    async abort() {
      closed = true;
      if (connectionId) {
        await invoke('querymt_websocket_close', { request: { connectionId } }).catch(() => undefined);
      }
    }
  });

  return { readable, writable };
}
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
  checkForUpdates,
  getUpdatesStatus,
  installUpdate,
  listenUpdateState,
  restartForUpdate,
  setUpdatePreferences,
  type InstallEvent,
  type UpdatePreferencesPatch,
  type UpdateState,
  type UpdatesStatus
} from '$lib/querymt/updates';
export {
  checkpointSessionLoadTelemetry,
  finishSessionLoadTelemetry,
  heartbeatSessionLoadTelemetry,
  startSessionLoadTelemetry,
  type SessionLoadTelemetryCounters
} from '$lib/querymt/session-load-telemetry';

/** Subscribes to agent log events. */
export async function listenAgentLogs<T>(handler: (payload: T) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>('querymt://agent/log', ({ payload }) => handler(payload));
}

/** Asks the user for a workspace folder. */
export async function pickWorkspaceDirectory(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selection = await open({
    directory: true,
    multiple: false,
    title: 'Choose a workspace folder'
  });
  return typeof selection === 'string' ? selection : null;
}

/** Opens an http(s) link outside the app. */
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

/** The current native window. */
export async function getNativeWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

/** The webview runtime the app runs on. */
export async function getAppRuntime(): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('app_runtime');
}

/** Switches between OS and custom window decorations. */
export async function setWindowDecorationMode(useOsDecorations: boolean): Promise<void> {
  const currentWindow = await getNativeWindow();
  if ((await currentWindow.isDecorated()) !== useOsDecorations) {
    await currentWindow.setDecorations(useOsDecorations);
  }
  await currentWindow.setShadow(true);
}

/** Schedules a reset of desktop-only app data; the app restarts to apply it. */
export async function resetAppData(options: { includeProfiles: boolean }): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('querymt_app_reset_data', { options });
}
