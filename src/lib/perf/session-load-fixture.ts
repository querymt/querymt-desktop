import type { LoadSessionResponse, SessionNotification } from '@agentclientprotocol/sdk';

export const TRACE_SESSION_LOAD_1X = {
  events: 4_189,
  notifications: 1_463,
  notificationsBeforeResponse: 1_391,
  notificationsAfterResponse: 72,
  responseBytes: 4_959_561,
  notificationBytesBeforeResponse: 3_759_604
} as const;

export interface SyntheticSessionLoadSpec {
  scale: number;
  toolResultBytes?: number;
}

export interface SyntheticSessionLoadFixture {
  sessionId: string;
  response: LoadSessionResponse;
  notifications: SessionNotification[];
  notificationsBeforeResponse: SessionNotification[];
  notificationsAfterResponse: SessionNotification[];
  eventCount: number;
}

type SnapshotEvent = {
  seq: number;
  timestamp: number;
  kind: { type: string; data: Record<string, unknown> };
};

function scaled(value: number, scale: number): number {
  return Math.max(1, Math.round(value * scale));
}

function payload(prefix: string, index: number, bytes: number): string {
  const header = `${prefix}-${index.toString().padStart(6, '0')}:`;
  return header + 'x'.repeat(Math.max(0, bytes - header.length));
}

export function createSyntheticSessionLoadFixture({
  scale,
  toolResultBytes = 5_800
}: SyntheticSessionLoadSpec): SyntheticSessionLoadFixture {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Synthetic session scale must be positive.');

  const sessionId = `synthetic-session-${scale}`;
  const eventTarget = scaled(TRACE_SESSION_LOAD_1X.events, scale);
  const promptCount = scaled(16, scale);
  const assistantCount = scaled(329, scale);
  const toolPairCount = Math.max(1, Math.floor((scaled(TRACE_SESSION_LOAD_1X.notifications, scale) - promptCount - assistantCount) / 2));
  const events: SnapshotEvent[] = [];
  const notifications: SessionNotification[] = [];
  let seq = 1;

  const addEvent = (type: string, data: Record<string, unknown>) => {
    events.push({ seq, timestamp: 1_788_000_000 + seq, kind: { type, data } });
    seq += 1;
  };
  const addNotification = (update: SessionNotification['update']) => {
    notifications.push({ sessionId, update });
  };

  for (let index = 0; index < promptCount; index += 1) {
    const messageId = `user-${index}`;
    const content = payload('prompt', index, 420);
    addEvent('prompt_received', { message_id: messageId, content });
    addNotification({ sessionUpdate: 'user_message_chunk', messageId, content: { type: 'text', text: content } });
  }

  for (let index = 0; index < assistantCount; index += 1) {
    const messageId = `assistant-${index}`;
    const content = payload('assistant', index, 520);
    addEvent('assistant_message_stored', { message_id: messageId, content });
    addNotification({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: content } });
  }

  for (let index = 0; index < toolPairCount; index += 1) {
    const toolCallId = `tool-${index}`;
    const messageId = `assistant-${index % assistantCount}`;
    const rawInput = { path: `src/generated-${index}.ts`, query: payload('input', index, 300) };
    const result = payload('tool-result', index, toolResultBytes + (index % 31 === 0 ? 24_000 : 0));
    addEvent('tool_call_start', {
      tool_call_id: toolCallId,
      tool_name: 'read_tool',
      assistant_message_id: messageId,
      arguments: JSON.stringify(rawInput)
    });
    addNotification({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: 'read_tool',
      kind: 'read',
      status: 'in_progress',
      rawInput,
      content: []
    });
    addEvent('tool_call_end', {
      tool_call_id: toolCallId,
      tool_name: 'read_tool',
      assistant_message_id: messageId,
      result,
      is_error: false
    });
    addNotification({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: 'read_tool',
      kind: 'read',
      status: 'completed',
      rawOutput: result,
      content: []
    });
  }

  while (events.length < eventTarget) {
    const index = events.length;
    addEvent(index % 3 === 0 ? 'progress_recorded' : 'hook_notice', {
      content: payload('lifecycle', index, 240),
      is_error: false
    });
  }

  const notificationTarget = scaled(TRACE_SESSION_LOAD_1X.notifications, scale);
  if (notifications.length > notificationTarget) notifications.length = notificationTarget;
  while (notifications.length < notificationTarget) {
    const index = notifications.length;
    notifications.push({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: `filler-${index}`,
        content: { type: 'text', text: payload('filler', index, 160) }
      }
    });
  }

  const beforeCount = Math.min(notifications.length, scaled(TRACE_SESSION_LOAD_1X.notificationsBeforeResponse, scale));
  const response = {
    configOptions: [],
    _meta: {
      'querymt/sessionLoadSnapshot.v1': {
        audit: { events }
      }
    }
  } as unknown as LoadSessionResponse;

  return {
    sessionId,
    response,
    notifications,
    notificationsBeforeResponse: notifications.slice(0, beforeCount),
    notificationsAfterResponse: notifications.slice(beforeCount),
    eventCount: events.length
  };
}
