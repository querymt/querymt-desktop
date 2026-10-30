import { applyDelegationChildSession, createEmptyActiveSession, normalizeContentBlocks, stringifyOptional, summarizeContentBlocks } from '$lib/domain/session-updates';
import type { ActiveSessionViewModel, PromptAttachment, SessionContentBlock, SessionToolCallItem, SessionTranscriptItem } from '$lib/domain/types';
import { appendHistoricalUsage, readAccountingSnapshot } from '$lib/domain/session-usage';
import type { DelegationUpdateNotification, SessionRuntimeStatus } from '$lib/querymt/generated/types';

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
  /** Authoritative reducer-backed accounting at the snapshot cursor. */
  accounting?: unknown;
  runtimeStatus?: SessionRuntimeStatus;
  delegationUpdates?: DelegationUpdateNotification[];
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

export interface SnapshotInputState {
  sessionId: string;
  inputId: string;
  delivery: 'steer' | 'queue';
  state: 'accepted' | 'queued' | 'applied' | 'started' | 'discarded';
  runId?: string;
  position?: number;
  boundary?: string;
  reason?: string;
  latencyMs?: number;
  prompt?: string;
  attachments?: PromptAttachment[];
  createdAt?: number;
}


export function activeSessionFromLoadResponse(sessionId: string, response: unknown): ActiveSessionViewModel {
  const session = createEmptyActiveSession();
  session.sessionId = sessionId;

  const snapshot = readSnapshot(response);
  if (!snapshot) {
    return session;
  }

  // Present even without historical replay or a known context limit.
  session.usage.accounting = readAccountingSnapshot(snapshot.accounting);

  const toolCallsById = new Map<string, SessionToolCallItem>();
  const supersededRunIds = new Set<string>();
  const pendingDelegationToolCalls = new Map<string, string>();
  const pendingChildSessionsByDelegation = new Map<string, string>();
  const structuredPrompts = indexStructuredPrompts(snapshot);
  const restoredStructuredPrompts = new Set<string>();
  let lastAssistantMessageId: string | null = null;
  let activeWorkStartedAt: number | null = null;
  let missingHistoricalUsage = false;

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
      if (data.usage != null || session.usage.breakdown) {
        session.usage.breakdown = appendHistoricalUsage(session.usage.breakdown, data.usage);
        session.usage.breakdown.partial ||= missingHistoricalUsage;
      } else {
        missingHistoricalUsage = true;
      }
      // Money comes only from `snapshot.accounting`; request-end costs are
      // presentation figures that omit auxiliary, failed and retry attempts.
      session.usage.contextUsed = readNonNegativeNumber(data.context_tokens) ?? session.usage.contextUsed;
      session.usage.activeWorkMs += elapsedWorkMs(activeWorkStartedAt, readTimestampMs(event.timestamp));
      activeWorkStartedAt = null;
      continue;
    }

    if (kind === 'cancelled' || kind === 'error') {
      session.usage.activeWorkMs += elapsedWorkMs(activeWorkStartedAt, readTimestampMs(event.timestamp));
      activeWorkStartedAt = null;
    }

    if (kind === 'run_started') {
      const runId = readString(data.run_id) ?? null;
      if (session.runId && runId && session.runId !== runId) supersededRunIds.add(session.runId);
      session.runId = runId;
      session.runState = 'thinking';
      session.runStateFromLifecycle = true;
      session.activityLabel = 'Agent is working…';
      continue;
    }

    if (kind === 'run_completed') {
      const outcome = readString(data.outcome);
      const runId = readString(data.run_id) ?? null;
      if (session.runId && runId && session.runId !== runId) continue;
      session.runId = runId ?? session.runId;
      session.lastRunOutcome = { runId: session.runId ?? null, outcome: outcome ?? 'completed' };
      session.runState = outcome === 'failed' ? 'failed' : 'completed';
      session.runStateFromLifecycle = true;
      session.activityLabel = outcome === 'cancelled'
        ? 'Turn cancelled.'
        : outcome === 'failed'
          ? 'Turn failed.'
          : 'Turn completed.';
      continue;
    }

    if (kind === 'prompt_received') {
      const messageId = readString(data.message_id) ?? readString(data.messageId) ?? eventId;
      if (restoredStructuredPrompts.has(messageId)) continue;

      const structured = structuredPrompts.get(messageId);
      if (structured && appendStructuredPrompt(session, structured.record, messageId, eventId, event.seq, readTimestampMs(event.timestamp) ?? undefined)) {
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
          eventIndex: event.seq,
          timestampMs: readTimestampMs(event.timestamp) ?? undefined
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
        eventIndex: event.seq,
        timestampMs: readTimestampMs(event.timestamp) ?? undefined
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
          reasoningPartId: readString(data.part_id) ?? null,
          eventIndex: event.seq,
          timestampMs: readTimestampMs(event.timestamp) ?? undefined
        });
        session.events.push({ id: eventId, kind: 'agent_thought_chunk', text, messageId });
      }
      continue;
    }

    if (kind === 'assistant_message_stored') {
      const messageId: string = readString(data.message_id) ?? lastAssistantMessageId ?? eventId;
      lastAssistantMessageId = messageId;
      const text = readString(data.content) ?? '';
      const parts = readReasoningParts(data.reasoning_parts);
      const thinking = parts.length > 0 ? '' : readString(data.thinking) ?? '';
      if (parts.length > 0) {
        for (const [index, part] of parts.entries()) {
          const partEventId = `${eventId}-thinking-${index}`;
          session.transcript.push({
            id: partEventId,
            kind: 'agent_thought_chunk',
            text: part.text,
            blocks: [{ type: 'text', text: part.text }],
            messageId,
            reasoningPartId: part.id,
            eventIndex: event.seq,
            timestampMs: readTimestampMs(event.timestamp) ?? undefined
          });
          session.events.push({ id: partEventId, kind: 'agent_thought_chunk', text: part.text, messageId });
        }
      } else if (thinking) {
        const thinkingEventId = `${eventId}-thinking`;
        replaceThinkingTranscriptForMessage(session, messageId, thinking, thinkingEventId, event.seq, readTimestampMs(event.timestamp) ?? undefined);
        session.events.push({ id: thinkingEventId, kind: 'agent_thought_chunk', text: thinking, messageId });
      }
      if (text) {
        replaceTranscriptForMessage(session, messageId, text, eventId, event.seq, readTimestampMs(event.timestamp) ?? undefined);
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
        runId: session.runId,
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
      continue;
    }

    if (kind === 'delegation_requested') {
      const toolCallId = readString(data.tool_call_id);
      const publicId = readString(readObject(data.delegation)?.public_id);
      if (toolCallId && publicId) {
        pendingDelegationToolCalls.set(publicId, toolCallId);
        const childSessionId = pendingChildSessionsByDelegation.get(publicId);
        if (childSessionId) mergeHistoricalToolCall(toolCallsById, toolCallId, { childSessionId });
      }
      continue;
    }

    if (kind === 'session_forked') {
      const childSessionId = readString(data.child_session_id);
      const forkPointRef = readString(data.fork_point_ref);
      const toolCallId = pendingDelegationToolCalls.get(forkPointRef ?? '') ?? readString(data.tool_call_id);
      if (childSessionId && forkPointRef) pendingChildSessionsByDelegation.set(forkPointRef, childSessionId);
      if (childSessionId && toolCallId) mergeHistoricalToolCall(toolCallsById, toolCallId, { childSessionId });
    }
  }

  restoreUnmatchedPrompts(session, snapshot, structuredPrompts, restoredStructuredPrompts, toolCallsById);

  // A later own run proves the earlier run ended, but not that its tools succeeded.
  session.toolCalls = Array.from(toolCallsById.values(), (tool) =>
    tool.runId && supersededRunIds.has(tool.runId) && (tool.status === 'pending' || tool.status === 'in_progress')
      ? { ...tool, status: 'failed' as const, isError: true, result: tool.result ?? 'Run ended before a tool result was recorded.' }
      : tool);
  return (snapshot.delegationUpdates ?? []).reduce(applyDelegationChildSession, normalizeHistoricalSession(session));
}

export function getSnapshotRuntimeStatus(response: unknown): SessionRuntimeStatus | null {
  return readSnapshot(response)?.runtimeStatus ?? null;
}

export function getSnapshotInputStates(response: unknown): SnapshotInputState[] {
  const states = new Map<string, SnapshotInputState>();
  for (const event of readSnapshot(response)?.audit?.events ?? []) {
    const kind = event.kind?.type;
    const data = event.kind?.data ?? {};
    const inputId = readString(data.input_id) ?? readString(data.inputId);
    if (!inputId) continue;

    let next: SnapshotInputState | null = null;
    if (kind === 'steering_accepted') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'steer',
        state: 'accepted',
        runId: readString(data.run_id) ?? readString(data.runId) ?? undefined,
        position: readNonNegativeNumber(data.position) ?? undefined,
        ...pendingInputContent(data, event)
      };
    } else if (kind === 'steering_applied') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'steer',
        state: 'applied',
        runId: readString(data.run_id) ?? readString(data.runId) ?? undefined,
        boundary: readString(data.boundary) ?? undefined,
        latencyMs: readNonNegativeNumber(data.latency_ms ?? data.latencyMs) ?? undefined
      };
    } else if (kind === 'steering_discarded') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'steer',
        state: 'discarded',
        runId: readString(data.run_id) ?? readString(data.runId) ?? undefined,
        reason: readString(data.reason) ?? undefined
      };
    } else if (kind === 'input_queued') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'queue',
        state: 'queued',
        position: readNonNegativeNumber(data.position) ?? undefined,
        ...pendingInputContent(data, event)
      };
    } else if (kind === 'queued_input_started') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'queue',
        state: 'started',
        runId: readString(data.run_id) ?? readString(data.runId) ?? undefined
      };
    } else if (kind === 'queued_input_discarded') {
      next = {
        sessionId: '',
        inputId,
        delivery: 'queue',
        state: 'discarded',
        reason: readString(data.reason) ?? undefined
      };
    }
    if (next) states.set(inputId, next);
  }
  return [...states.values()];
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
  _options: { loadCompleted?: boolean } = {}
): ActiveSessionViewModel {
  // Loading history is not evidence that execution or a pending tool ended.
  if (session.runStateFromLifecycle && (session.runState === 'completed' || session.runState === 'failed')) {
    session.activeToolCallId = null;
    session.toolCalls = session.toolCalls.map((tool) =>
      (tool.status === 'pending' || tool.status === 'in_progress') && (!tool.runId || tool.runId === session.runId)
        ? { ...tool, status: 'failed', isError: true, result: tool.result ?? 'Run ended before a tool result was recorded.' }
        : tool);
    return session;
  }
  const activeTool = session.toolCalls.find((tool) =>
    (tool.status === 'in_progress' || tool.status === 'pending') &&
    (!session.runId || !tool.runId || tool.runId === session.runId));
  if (activeTool) {
    session.runState = 'tool-running';
    session.activeToolCallId = activeTool.id;
    session.activityLabel = `Running tool: ${activeTool.title}`;
    session.lastError = null;
  } else if (!session.runStateFromLifecycle && session.transcript.some((item) => item.kind !== 'user_message_chunk')) {
    session.runState = 'completed';
    session.activeToolCallId = null;
    session.activityLabel = 'Loaded from session history.';
    session.lastError = null;
  }
  return session;
}

function pendingInputContent(
  data: Record<string, unknown>,
  event: SnapshotEvent
): Pick<SnapshotInputState, 'prompt' | 'attachments' | 'createdAt'> {
  const blocks = normalizeContentBlocks(data.blocks);
  const createdAt = readNonNegativeNumber(data.accepted_at_ms ?? data.acceptedAtMs)
    ?? readTimestampMs(event.timestamp)
    ?? undefined;
  if (blocks.length === 0) return { createdAt };
  return {
    prompt: blocks
      .filter((block): block is Extract<SessionContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join(''),
    attachments: blocks.flatMap(blockToPromptAttachment),
    createdAt
  };
}

function blockToPromptAttachment(block: SessionContentBlock): PromptAttachment[] {
  if (block.type === 'text' || block.data == null) return [];
  return [{
    id: block.id ?? block.uri ?? `snapshot-attachment-${block.name ?? block.mimeType ?? 'file'}`,
    name: block.name ?? block.uri?.split('/').at(-1) ?? (block.type === 'image' ? 'image' : 'attachment'),
    mimeType: block.mimeType ?? 'application/octet-stream',
    size: block.size ?? decodedBase64Size(block.data),
    data: block.data
  }];
}

function decodedBase64Size(data: string): number {
  const normalized = data.replace(/\s/g, '');
  if (!normalized) return 0;
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(normalized.length * 3 / 4) - padding);
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

function restoreUnmatchedPrompts(
  session: ActiveSessionViewModel,
  snapshot: SessionLoadSnapshot,
  prompts: Map<string, IndexedStructuredPrompt>,
  restored: Set<string>,
  tools: Map<string, SessionToolCallItem>
) {
  if (restored.size === prompts.size) return;
  const ordered = [...prompts.entries()].sort((a, b) => compareStructuredPromptFallback(a[1], b[1]));
  const matchedPositions = new Map(session.transcript
    .filter((item) => item.messageId && typeof item.eventIndex === 'number')
    .map((item) => [item.messageId!, item.eventIndex!]));
  const visiblePositions = new Set([
    ...session.transcript.map((item) => item.eventIndex),
    ...[...tools.values()].map((tool) => tool.eventIndex)
  ].filter((index): index is number => typeof index === 'number'));
  const visibleEvents = (snapshot.audit?.events ?? [])
    .filter((event) => typeof event.seq === 'number' && visiblePositions.has(event.seq))
    .sort((a, b) => a.seq! - b.seq!);
  const lastPosition = visibleEvents.at(-1)?.seq ?? -1;
  const nextPositions = new Map<string, number>();
  let nextPosition: number | undefined;
  for (const [id] of [...ordered].reverse()) {
    if (nextPosition !== undefined) nextPositions.set(id, nextPosition);
    if (restored.has(id)) nextPosition = matchedPositions.get(id) ?? nextPosition;
  }
  let previousPosition = -1;
  let previousAnchor: SessionTranscriptItem['historyAnchor'];
  for (const [id, { record }] of ordered) {
    if (restored.has(id)) {
      previousPosition = matchedPositions.get(id) ?? previousPosition;
      previousAnchor = { eventIndex: previousPosition, side: 'after' };
      continue;
    }
    const eventIndex = readNonNegativeNumber(record.eventIndex ?? record.event_index ?? record.seq) ?? undefined;
    const timestampMs = readTimestampMs(record.timestamp) ?? undefined;
    const next = nextPositions.get(id);
    // History order bounds a missing prompt between known prompts. Timestamps
    // refine that placement among intervening assistant/tool events. Anchors
    // are presentation-only: never invent a journal index from messageOrder.
    const later = timestampMs === undefined ? undefined : visibleEvents.find((event) =>
      event.seq! > previousPosition && (next === undefined || event.seq! <= next)
      && (readTimestampMs(event.timestamp) ?? -1) > timestampMs
    )?.seq;
    const before = later ?? next;
    let historyAnchor: NonNullable<SessionTranscriptItem['historyAnchor']> = before === undefined
      ? { eventIndex: lastPosition, side: 'after' }
      : { eventIndex: before, side: 'before' };
    if (previousAnchor && (previousAnchor.eventIndex > historyAnchor.eventIndex
        || (previousAnchor.eventIndex === historyAnchor.eventIndex && previousAnchor.side === 'after'))) {
      historyAnchor = previousAnchor;
    }
    previousAnchor = eventIndex === undefined ? historyAnchor : { eventIndex, side: 'after' };
    appendStructuredPrompt(session, record, id, `snapshot-structured-${id}`, eventIndex, timestampMs,
      eventIndex === undefined ? historyAnchor : undefined);
  }
}

function appendStructuredPrompt(
  session: ActiveSessionViewModel,
  record: StructuredPromptRecord,
  messageId: string,
  eventId: string,
  eventIndex?: number,
  timestampMs?: number,
  historyAnchor?: SessionTranscriptItem['historyAnchor']
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
    eventIndex,
    timestampMs,
    historyAnchor
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
    runId: update.runId ?? existing?.runId ?? null,
    eventIndex: mergeEventIndex(existing?.eventIndex, update.eventIndex),
    childSessionId: update.childSessionId ?? existing?.childSessionId ?? null
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
  eventIndex?: number,
  timestampMs?: number
) {
  const existing = session.transcript.find((item) => item.kind === 'agent_message_chunk' && item.messageId === messageId);
  if (existing) {
    existing.text = text || existing.text;
    existing.blocks = text ? [{ type: 'text', text }] : existing.blocks;
    existing.id = eventId;
    existing.eventIndex = eventIndex ?? existing.eventIndex;
    if (timestampMs !== undefined) existing.timestampMs = timestampMs;
    return;
  }

  session.transcript.push({
    id: eventId,
    kind: 'agent_message_chunk',
    text,
    blocks: text ? [{ type: 'text', text }] : [],
    messageId,
    eventIndex,
    timestampMs
  });
}

function replaceThinkingTranscriptForMessage(
  session: ActiveSessionViewModel,
  messageId: string,
  text: string,
  eventId: string,
  eventIndex?: number,
  timestampMs?: number
) {
  const existing = session.transcript.find((item) => item.kind === 'agent_thought_chunk' && item.messageId === messageId);
  if (existing) {
    existing.text = text || existing.text;
    existing.blocks = text ? [{ type: 'text', text }] : existing.blocks;
    existing.id = eventId;
    existing.eventIndex = eventIndex ?? existing.eventIndex;
    if (timestampMs !== undefined) existing.timestampMs = timestampMs;
    return;
  }

  const assistantIndex = session.transcript.findIndex((item) => item.kind === 'agent_message_chunk' && item.messageId === messageId);
  const item = {
    id: eventId,
    kind: 'agent_thought_chunk' as const,
    text,
    blocks: [{ type: 'text' as const, text }],
    messageId,
    eventIndex,
    timestampMs
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

function readReasoningParts(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  const parts: Array<{ id: string; text: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = readString(record.id);
    const text = readString(record.text);
    if (!id || !text) continue;
    parts.push({ id, text });
  }
  return parts;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}
