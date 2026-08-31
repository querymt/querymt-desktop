import { invoke } from '@tauri-apps/api/core';

export interface SessionLoadTelemetryCounters {
  liveNotifications?: number;
  drainedNotifications?: number;
  appliedNotifications?: number;
  duplicateNotifications?: number;
  snapshotEvents?: number;
  transcriptItems?: number;
  toolCalls?: number;
  debugEvents?: number;
  domNodes?: number;
  longTaskCount?: number;
  longTaskTotalMs?: number;
  longestTaskMs?: number;
}

export async function startSessionLoadTelemetry(agentId: string, sessionId: string): Promise<string | null> {
  try {
    return await invoke<string>('querymt_session_load_start', { request: { agentId, sessionId } });
  } catch {
    return null;
  }
}

export async function checkpointSessionLoadTelemetry(
  operationId: string | null,
  phase: string,
  durationMs: number,
  counters: SessionLoadTelemetryCounters
): Promise<void> {
  if (!operationId) return;
  try {
    await invoke('querymt_session_load_checkpoint', {
      request: { operationId, phase, durationMs, counters }
    });
  } catch {
    // Telemetry must never block or fail session loading.
  }
}

export async function heartbeatSessionLoadTelemetry(
  operationId: string | null,
  counters: SessionLoadTelemetryCounters
): Promise<void> {
  if (!operationId) return;
  try {
    await invoke('querymt_session_load_heartbeat', { request: { operationId, counters } });
  } catch {
    // Telemetry must never block or fail session loading.
  }
}

export async function finishSessionLoadTelemetry(
  operationId: string | null,
  status: string,
  counters: SessionLoadTelemetryCounters
): Promise<void> {
  if (!operationId) return;
  try {
    await invoke('querymt_session_load_finish', { request: { operationId, status, counters } });
  } catch {
    // Telemetry must never block or fail session loading.
  }
}
