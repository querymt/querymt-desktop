import { createEmptyActiveSession, normalizeContentBlocks, stringifyOptional, summarizeContentBlocks } from '$lib/domain/session-updates';
import type { ActiveSessionViewModel, SessionToolCallItem } from '$lib/domain/types';

type SnapshotEvent = {
  seq?: number;
  timestamp?: number;
  kind?: {
    type?: string;
    data?: Record<string, unknown>;
  };
};

type StructuredPromptRecord = {
  messageId?: string;
  message_id?: string;
  messageOrder?: number;
  message_order?: number;
  timestamp?: number;
  eventIndex?: number;
  event_index?: number;
  seq?: number;
  content?: unknown[];
  blocks?: unknown[];
  contentBlocks?: unknown[];
  content_blocks?: unknown[];
  prompt?: unknown[];
  clientPromptId?: string;
  client_prompt_id?: string;
};

type IndexedStructuredPrompt = {
  record: StructuredPromptRecord;
  sourceIndex: number;
};

type SessionLoadSnapshot = {
  audit?: {
    events?: SnapshotEvent[];
  };
  userPrompts?: StructuredPromptRecord[];
  user_prompts?: StructuredPromptRecord[];
  prompts?: StructuredPromptRecord[];
  userPromptRecords?: StructuredPromptRecord[];
  user_prompt_records?: StructuredPromptRecord[];
  structuredUserPrompts?: StructuredPromptRecord[];
  structured_user_prompts?: StructuredPromptRecord[];
};

export interface SnapshotProviderChange {
  provider: string;
  model: string;
  providerNodeId: string | null;
}

const TOOL_TERMINAL_EVENT_TYPES = new Set(['assistant_message_stored', 'llm_request_end']);

export function activeSessionFromLoadResponse(sessionId: string, response: unknown): ActiveSessionViewModel {
  const session = createEmptyActiveSession();
  session.sessionId = sessionId;

  const snapshot = readSnapshot(response);
  if (!snapshot) {
    return session;
  }

  const toolCallsById = new Map<string, SessionToolCallItem>();
  const structuredPrompts = indexStructuredPrompts(snapshot);
  const restoredStructuredPrompts = new Set<string>();
  let lastAssistantMessageId: string | null = null;
  let activeWorkStartedAt: number | null = null;

  for (const event of snapshot.audit?.events ?? []) {
    const kind = event.kind?.type;
    const data = event.kind?.data ?? {};
    const eventId = `snapshot-${event.seq ?? session.events.length + 1}`;

    if (kind === 'llm_request_start') {
      activeWorkStartedAt ??= readTimestampMs(event.timestamp);
      continue;
    }

    if (kind === 'provider_changed') {
      session.usage.contextLimit = readPositiveNumber(data.context_limit) ?? session.usage.contextLimit;
      continue;
    }

    if (kind === 'llm_request_end') {
      session.usage.contextUsed = readNonNegativeNumber(data.context_tokens) ?? session.usage.contextUsed;
      session.usage.cumulativeCostUsd = readNonNegativeNumber(data.cumulative_cost_usd) ?? session.usage.cumulativeCostUsd;
      session.usage.activeWorkMs += elapsedWorkMs(activeWorkStartedAt, readTimestampMs(event.timestamp));
      activeWorkStartedAt = null;
      continue;
    }

    if (kind === 'cancelled' || kind === 'error') {
      session.usage.activeWorkMs += elapsedWorkMs(activeWorkStartedAt, readTimestampMs(event.timestamp));
      activeWorkStartedAt = null;
    }

    if (kind === 'prompt_received') {
      const messageId = readString(data.message_id) ?? readString(data.messageId) ?? eventId;
      if (restoredStructuredPrompts.has(messageId)) continue;

      const structured = structuredPrompts.get(messageId);
      if (structured && appendStructuredPrompt(session, structured.record, messageId, eventId, event.seq)) {
        restoredStructuredPrompts.add(messageId);
      } else {
        const legacyBlocks = normalizeContentBlocks(Array.isArray(data.content) ? data.content : []);
        const text = legacyBlocks.length > 0
          ? legacyBlocks.filter((block) => block.type === 'text').map((block) => block.text).join('')
          : readString(data.content) ?? '';
        const blocks = legacyBlocks.length > 0 ? legacyBlocks : text ? [{ type: 'text' as const, text }] : [];
        session.transcript.push({
          id: eventId,
          kind: 'user_message_chunk',
          text,
          blocks,
          messageId,
          eventIndex: event.seq
        });
        session.events.push({ id: eventId, kind, text: summarizeContentBlocks(blocks), messageId });
      }
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
        blocks: text ? [{ type: 'text', text }] : [],
        messageId,
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text, messageId });
      continue;
    }

    if (kind === 'assistant_thinking_delta') {
      const messageId: string = readString(data.message_id) ?? lastAssistantMessageId ?? eventId;
      lastAssistantMessageId = messageId;
      const text = readString(data.content) ?? '';
      if (text) {
        session.transcript.push({
          id: eventId,
          kind: 'agent_thought_chunk',
          text,
          blocks: [{ type: 'text', text }],
          messageId,
          eventIndex: event.seq
        });
        session.events.push({ id: eventId, kind: 'agent_thought_chunk', text, messageId });
      }
      continue;
    }

    if (kind === 'assistant_message_stored') {
      const messageId: string = readString(data.message_id) ?? lastAssistantMessageId ?? eventId;
      lastAssistantMessageId = messageId;
      const text = readString(data.content) ?? '';
      const thinking = readString(data.thinking) ?? '';
      if (thinking) {
        const thinkingEventId = `${eventId}-thinking`;
        replaceThinkingTranscriptForMessage(session, messageId, thinking, thinkingEventId, event.seq);
        session.events.push({ id: thinkingEventId, kind: 'agent_thought_chunk', text: thinking, messageId });
      }
      if (text) {
        replaceTranscriptForMessage(session, messageId, text, eventId, event.seq);
        session.events.push({ id: eventId, kind, text, messageId });
      }
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
        arguments: stringifyOptional(data.arguments ?? data.input),
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text: stringifyOptional(data.arguments ?? data.input) ?? '', messageId });
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
        result: stringifyOptional(data.result ?? data.output ?? data.content),
        isError: readBoolean(data.is_error),
        eventIndex: event.seq
      });
      session.events.push({ id: eventId, kind, text: stringifyOptional(data.result ?? data.output ?? data.content) ?? '', messageId });
    }
  }

  const unmatchedPrompts = [...structuredPrompts.values()]
    .filter(({ record }) => {
      const messageId = readString(record.messageId) ?? readString(record.message_id);
      return !messageId || !restoredStructuredPrompts.has(messageId);
    })
    .sort(compareStructuredPromptFallback);
  for (const { record, sourceIndex } of unmatchedPrompts) {
    const messageId = readString(record.messageId) ?? readString(record.message_id) ?? `structured-prompt-${sourceIndex + 1}`;
    appendStructuredPrompt(
      session,
      record,
      messageId,
      `snapshot-structured-${messageId}`,
      readNonNegativeNumber(record.eventIndex ?? record.event_index ?? record.seq) ?? undefined
    );
  }

  session.toolCalls = finalizeHistoricalToolCalls(Array.from(toolCallsById.values()), snapshot.audit?.events ?? []);
  return normalizeHistoricalSession(session);
}

export function getSnapshotProviderChange(response: unknown): SnapshotProviderChange | null {
  const events = readSnapshot(response)?.audit?.events ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind?.type !== 'provider_changed') continue;

    const provider = readString(event.kind.data?.provider);
    const model = readString(event.kind.data?.model);
    if (!provider || !model) continue;

    return {
      provider,
      model,
      providerNodeId: readString(event.kind.data?.provider_node_id) ?? null
    };
  }
  return null;
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

function indexStructuredPrompts(snapshot: SessionLoadSnapshot): Map<string, IndexedStructuredPrompt> {
  const records = snapshot.userPrompts
    ?? snapshot.user_prompts
    ?? snapshot.userPromptRecords
    ?? snapshot.user_prompt_records
    ?? snapshot.structuredUserPrompts
    ?? snapshot.structured_user_prompts
    ?? snapshot.prompts
    ?? [];
  const indexed = new Map<string, IndexedStructuredPrompt>();
  for (const [sourceIndex, record] of records.entries()) {
    if (!record || typeof record !== 'object') continue;
    const messageId = readString(record.messageId) ?? readString(record.message_id) ?? `structured-prompt-${sourceIndex + 1}`;
    if (!indexed.has(messageId)) indexed.set(messageId, { record, sourceIndex });
  }
  return indexed;
}

function appendStructuredPrompt(
  session: ActiveSessionViewModel,
  record: StructuredPromptRecord,
  messageId: string,
  eventId: string,
  eventIndex?: number
) {
  const blocks = normalizeContentBlocks(
    record.blocks ?? record.content ?? record.contentBlocks ?? record.content_blocks ?? record.prompt ?? []
  );
  if (blocks.length === 0) return false;
  const text = blocks.filter((block) => block.type === 'text').map((block) => block.text).join('');
  session.transcript.push({
    id: eventId,
    kind: 'user_message_chunk',
    text,
    blocks,
    messageId,
    clientPromptId: readString(record.clientPromptId) ?? readString(record.client_prompt_id) ?? null,
    eventIndex
  });
  session.events.push({
    id: `${eventId}-event`,
    kind: 'prompt_received',
    text: summarizeContentBlocks(blocks),
    messageId
  });
  return true;
}

function compareStructuredPromptFallback(a: IndexedStructuredPrompt, b: IndexedStructuredPrompt): number {
  const orderDifference = compareOptionalNumbers(
    readNonNegativeNumber(a.record.messageOrder ?? a.record.message_order),
    readNonNegativeNumber(b.record.messageOrder ?? b.record.message_order)
  );
  if (orderDifference !== 0) return orderDifference;
  const timestampDifference = compareOptionalNumbers(
    readNonNegativeNumber(a.record.timestamp),
    readNonNegativeNumber(b.record.timestamp)
  );
  return timestampDifference || a.sourceIndex - b.sourceIndex;
}

function compareOptionalNumbers(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return a - b;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return 0;
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readPositiveNumber(value: unknown): number | null {
  const number = readNonNegativeNumber(value);
  return number !== null && number > 0 ? number : null;
}

function readTimestampMs(value: unknown): number | null {
  const seconds = readNonNegativeNumber(value);
  return seconds === null ? null : seconds * 1000;
}

function elapsedWorkMs(startedAt: number | null, endedAt: number | null): number {
  return startedAt !== null && endedAt !== null && endedAt >= startedAt ? endedAt - startedAt : 0;
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
  eventId: string,
  eventIndex?: number
) {
  const existing = session.transcript.find((item) => item.kind === 'agent_message_chunk' && item.messageId === messageId);
  if (existing) {
    existing.text = text || existing.text;
    existing.blocks = text ? [{ type: 'text', text }] : existing.blocks;
    existing.id = eventId;
    existing.eventIndex = eventIndex ?? existing.eventIndex;
    return;
  }

  session.transcript.push({
    id: eventId,
    kind: 'agent_message_chunk',
    text,
    blocks: text ? [{ type: 'text', text }] : [],
    messageId,
    eventIndex
  });
}

function replaceThinkingTranscriptForMessage(
  session: ActiveSessionViewModel,
  messageId: string,
  text: string,
  eventId: string,
  eventIndex?: number
) {
  const existing = session.transcript.find((item) => item.kind === 'agent_thought_chunk' && item.messageId === messageId);
  if (existing) {
    existing.text = text || existing.text;
    existing.blocks = text ? [{ type: 'text', text }] : existing.blocks;
    existing.id = eventId;
    existing.eventIndex = eventIndex ?? existing.eventIndex;
    return;
  }

  const assistantIndex = session.transcript.findIndex((item) => item.kind === 'agent_message_chunk' && item.messageId === messageId);
  const item = {
    id: eventId,
    kind: 'agent_thought_chunk' as const,
    text,
    blocks: [{ type: 'text' as const, text }],
    messageId,
    eventIndex
  };

  if (assistantIndex >= 0) {
    session.transcript.splice(assistantIndex, 0, item);
    return;
  }

  session.transcript.push(item);
}

function resolveAssistantMessageId(data: Record<string, unknown>, fallback: string | null): string | null {
  return readString(data.message_id) ?? readString(data.assistant_message_id) ?? fallback;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}
