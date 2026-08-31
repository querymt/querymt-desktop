import type { LoadSessionResponse, SessionNotification } from '@agentclientprotocol/sdk';
import type { ActiveSessionViewModel } from '$lib/domain/types';
import { activeSessionFromLoadResponse, normalizeHistoricalSession } from '$lib/domain/session-snapshot';
import { applySessionNotification, createEmptyActiveSession } from '$lib/domain/session-updates';

export interface SessionLoadPipelineResult {
  session: ActiveSessionViewModel;
  appliedNotifications: number;
  duplicateNotifications: number;
}

export function runObservedSessionLoadPipeline(
  sessionId: string,
  response: LoadSessionResponse,
  notificationsBeforeResponse: SessionNotification[],
  notificationsAfterResponse: SessionNotification[],
  drainedNotifications: SessionNotification[] = []
): SessionLoadPipelineResult {
  let session = createEmptyActiveSession();
  const seen = new Set<string>();
  let appliedNotifications = 0;
  let duplicateNotifications = 0;

  const apply = (notification: SessionNotification) => {
    const key = notificationKey(notification);
    if (seen.has(key)) {
      duplicateNotifications += 1;
      return;
    }
    seen.add(key);
    session = applySessionNotification(session, notification);
    appliedNotifications += 1;
  };

  for (const notification of notificationsBeforeResponse) apply(notification);
  const snapshot = activeSessionFromLoadResponse(sessionId, response);
  if (session.events.length === 0 && snapshot.events.length > 0) session = snapshot;
  for (const notification of notificationsAfterResponse) apply(notification);
  for (const notification of drainedNotifications) apply(notification);
  session.configOptions = response.configOptions ?? [];
  session = normalizeHistoricalSession(session, { loadCompleted: true });

  return { session, appliedNotifications, duplicateNotifications };
}

function notificationKey(notification: SessionNotification): string {
  const update = notification.update;
  const prefix = `${notification.sessionId}:${update.sessionUpdate}`;
  if (update.sessionUpdate === 'tool_call') return `${prefix}:${update.toolCallId}`;
  if (update.sessionUpdate === 'tool_call_update') return `${prefix}:${update.toolCallId}:${update.status ?? 'updated'}`;
  if (
    update.sessionUpdate === 'user_message_chunk' ||
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    const content = update.content.type === 'text' ? update.content.text : JSON.stringify(update.content);
    return `${prefix}:${update.messageId ?? ''}:${content}`;
  }
  return `${prefix}:${JSON.stringify(update)}`;
}
