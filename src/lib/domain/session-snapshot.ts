import { createEmptyActiveSession } from '$lib/domain/session-updates';
import type { ActiveSessionViewModel, SessionToolCallItem } from '$lib/domain/types';

type SnapshotEvent = {
  seq?: number;
  timestamp?: number;
  kind?: {
    type?: string;
    data?: Record<string, unknown>;
  };
};

type SessionLoadSnapshot = {
  audit?: {
    events?: SnapshotEvent[];
  };
};

const TOOL_TERMINAL_EVENT_TYPES = new Set(['assistant_message_stored', 'llm_request_end']);

export function activeSessionFromLoadResponse(sessionId: string, response: unknown): ActiveSessionViewModel {
  const session = createEmptyActiveSession();
  session.sessionId = sessionId;

  const snapshot = readSnapshot(response);
  if (!snapshot) {
    return session;
  }

  const toolCallsById = new Map<string, SessionToolCallItem>();
  let lastAssistantMessageId: string | null = null;

  for (const event of snapshot.audit?.events ?? []) {
    const kind = event.kind?.type;
    const data = event.kind?.data ?? {};
    const eventId = `snapshot-${event.seq ?? session.events.length + 1}`;

    if (kind === 'prompt_received') {
      const messageId = readString(data.message_id) ?? eventId;
      const text = readString(data.content) ?? '';
      session.transcript.push({
        id: eventId,
        kind: 'user_message_chunk',
        text,
        messageId,
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text, messageId });
      continue;
    }

    if (kind === 'assistant_content_delta') {
      const messageId: string = readString(data.message_id) ?? lastAssistantMessageId ?? eventId;
      lastAssistantMessageId = messageId;
      const text = readString(data.content) ?? '';
      session.transcript.push({
        id: eventId,
        kind: 'agent_message_chunk',
        text,
        messageId,
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text, messageId });
      continue;
    }

    if (kind === 'assistant_message_stored') {
      const messageId: string = readString(data.message_id) ?? lastAssistantMessageId ?? eventId;
      lastAssistantMessageId = messageId;
      const text = readString(data.content) ?? '';
      replaceTranscriptForMessage(session, messageId, text, eventId);
      session.events.push({ id: eventId, kind, text, messageId });
      continue;
    }

    if (kind === 'tool_call_start') {
      const toolCallId = readString(data.tool_call_id) ?? eventId;
      const messageId = resolveAssistantMessageId(data, lastAssistantMessageId);
      mergeHistoricalToolCall(toolCallsById, toolCallId, {
        title: readString(data.tool_name),
        status: 'in_progress',
        kind: readString(data.tool_name) ?? null,
        messageId,
        arguments: readToolText(data.arguments ?? data.input),
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text: readToolText(data.arguments ?? data.input) ?? '', messageId });
      continue;
    }

    if (kind === 'tool_call_end') {
      const toolCallId = readString(data.tool_call_id) ?? eventId;
      const messageId = resolveAssistantMessageId(data, lastAssistantMessageId);
      mergeHistoricalToolCall(toolCallsById, toolCallId, {
        title: readString(data.tool_name),
        status: readBoolean(data.is_error) ? 'failed' : 'completed',
        kind: readString(data.tool_name) ?? null,
        messageId,
        result: readToolText(data.result ?? data.output ?? data.content),
        isError: readBoolean(data.is_error),
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text: readToolText(data.result ?? data.output ?? data.content) ?? '', messageId });
    }
  }

  session.toolCalls = finalizeHistoricalToolCalls(Array.from(toolCallsById.values()), snapshot.audit?.events ?? []);
  return normalizeHistoricalSession(session);
}

export function normalizeHistoricalSession(
  session: ActiveSessionViewModel,
  options: { loadCompleted?: boolean } = {}
): ActiveSessionViewModel {
  const hasActiveTool = session.toolCalls.some((tool) => tool.status === 'in_progress' || tool.status === 'pending');
  if (hasActiveTool && !options.loadCompleted) {
    const activeTool = session.toolCalls.find((tool) => tool.status === 'in_progress' || tool.status === 'pending') ?? null;
    session.runState = 'tool-running';
    session.activeToolCallId = activeTool?.id ?? null;
    session.activityLabel = activeTool ? `Running tool: ${activeTool.title}` : 'Running tool…';
    session.lastError = null;
    return session;
  }

  if (options.loadCompleted) {
    session.toolCalls = session.toolCalls.map((tool) =>
      tool.status === 'in_progress' || tool.status === 'pending'
        ? { ...tool, status: tool.isError ? 'failed' : 'completed' }
        : tool
    );
    session.runState = 'completed';
    session.activeToolCallId = null;
    session.activityLabel = 'Loaded from session history.';
    session.lastError = null;
    return session;
  }

  if (session.transcript.some((item) => item.kind === 'agent_message_chunk' || item.kind === 'agent_thought_chunk')) {
    session.runState = 'completed';
    session.activeToolCallId = null;
    session.activityLabel = 'Loaded from session history.';
    session.lastError = null;
  }

  return session;
}

function readSnapshot(response: unknown): SessionLoadSnapshot | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const meta = (response as { _meta?: Record<string, unknown> | null })._meta;
  const snapshot = meta?.['querymt/sessionLoadSnapshot.v1'];
  return snapshot && typeof snapshot === 'object' ? (snapshot as SessionLoadSnapshot) : null;
}

function mergeHistoricalToolCall(
  toolCallsById: Map<string, SessionToolCallItem>,
  toolCallId: string,
  update: Partial<SessionToolCallItem>
) {
  const existing = toolCallsById.get(toolCallId);
  const nextStatus = mergeToolStatus(existing?.status, update.status);
  toolCallsById.set(toolCallId, {
    ...existing,
    id: toolCallId,
    title: update.title ?? existing?.title ?? 'Tool call',
    status: nextStatus,
    kind: update.kind ?? existing?.kind ?? null,
    messageId: update.messageId ?? existing?.messageId ?? null,
    arguments: update.arguments ?? existing?.arguments ?? null,
    result: update.result ?? existing?.result ?? null,
    isError: update.isError ?? existing?.isError,
    eventIndex: mergeEventIndex(existing?.eventIndex, update.eventIndex)
  });
}

function finalizeHistoricalToolCalls(tools: SessionToolCallItem[], events: SnapshotEvent[]): SessionToolCallItem[] {
  const terminalEventIndexes = events
    .filter((event) => TOOL_TERMINAL_EVENT_TYPES.has(event.kind?.type ?? '') && typeof event.seq === 'number')
    .map((event) => event.seq as number);

  return tools.map((tool) => {
    if (tool.status !== 'in_progress' && tool.status !== 'pending') {
      return tool;
    }

    if (tool.result) {
      return {
        ...tool,
        status: tool.isError ? 'failed' : 'completed'
      };
    }

    const toolEventIndex = tool.eventIndex ?? Number.MAX_SAFE_INTEGER;
    const hasLaterTerminalEvent = terminalEventIndexes.some((seq) => seq > toolEventIndex);
    if (!hasLaterTerminalEvent) {
      return tool;
    }

    return {
      ...tool,
      status: tool.isError ? 'failed' : 'completed'
    };
  });
}

function mergeToolStatus(
  current: SessionToolCallItem['status'] | undefined,
  next: SessionToolCallItem['status'] | undefined
): SessionToolCallItem['status'] {
  if (next === 'failed' || current === 'failed') {
    return 'failed';
  }
  if (next === 'completed' || current === 'completed') {
    return 'completed';
  }
  if (next === 'in_progress' || current === 'in_progress') {
    return 'in_progress';
  }
  return next ?? current ?? 'pending';
}

function mergeEventIndex(current: number | undefined, next: number | undefined): number | undefined {
  if (typeof current === 'number' && typeof next === 'number') {
    return Math.min(current, next);
  }
  return current ?? next;
}

function replaceTranscriptForMessage(
  session: ActiveSessionViewModel,
  messageId: string,
  text: string,
  eventId: string
) {
  const existing = session.transcript.find((item) => item.kind === 'agent_message_chunk' && item.messageId === messageId);
  if (existing) {
    existing.text = text || existing.text;
    existing.id = eventId;
    return;
  }

  session.transcript.push({
    id: eventId,
    kind: 'agent_message_chunk',
    text,
    messageId,
    eventIndex: undefined
  });
}

function resolveAssistantMessageId(data: Record<string, unknown>, fallback: string | null): string | null {
  return readString(data.message_id) ?? readString(data.assistant_message_id) ?? fallback;
}

function readToolText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}
