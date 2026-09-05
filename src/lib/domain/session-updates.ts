import type { SessionNotification } from '@agentclientprotocol/sdk';
import type {
  ActiveSessionViewModel,
  SessionEventItem,
  SessionPlanEntry,
  SessionContentBlock,
  SessionToolCallItem,
  SessionTranscriptGroup,
  SessionTranscriptItem
} from '$lib/domain/types';

export function createEmptyActiveSession(): ActiveSessionViewModel {
  return {
    sessionId: null,
    transcript: [],
    toolCalls: [],
    plans: [],
    events: [],
    configOptions: [],
    runState: 'idle',
    activityLabel: null,
    activeToolCallId: null,
    lastStopReason: null,
    lastError: null,
    usage: {
      contextUsed: null,
      contextLimit: null,
      cumulativeCostUsd: null,
      activeWorkMs: 0,
      activeWorkStartedAt: null
    },
    undo: {
      stack: [],
      pendingOperation: null,
      lastRevertedFiles: [],
      lastMessage: null
    }
  };
}

export function reduceSessionReplay(
  sessionId: string,
  notifications: readonly SessionNotification[]
): ActiveSessionViewModel {
  let session = createEmptyActiveSession();
  session.sessionId = sessionId;
  for (const notification of notifications) {
    session = applySessionNotification(session, notification);
  }
  return session;
}

export function getNextConversationEventIndex(session: ActiveSessionViewModel): number {
  let maxIndex = -1;
  for (const item of session.transcript) {
    if (typeof item.eventIndex === 'number') maxIndex = Math.max(maxIndex, item.eventIndex);
  }
  for (const tool of session.toolCalls) {
    if (typeof tool.eventIndex === 'number') maxIndex = Math.max(maxIndex, tool.eventIndex);
  }
  return maxIndex + 1;
}

export function applySessionNotification(
  current: ActiveSessionViewModel,
  notification: SessionNotification,
  conversationEventIndex = getNextConversationEventIndex(current)
): ActiveSessionViewModel {
  const next: ActiveSessionViewModel = {
    sessionId: current.sessionId,
    transcript: current.transcript.map((item) => ({ ...item, blocks: item.blocks?.map((block) => ({ ...block })) })),
    toolCalls: current.toolCalls.map((item) => ({ ...item })),
    plans: current.plans.map((item) => ({ ...item })),
    events: current.events.map((item) => ({ ...item })),
    configOptions: current.configOptions.map((item) => ({ ...item })),
    runState: current.runState,
    activityLabel: current.activityLabel,
    activeToolCallId: current.activeToolCallId,
    lastStopReason: current.lastStopReason,
    lastError: current.lastError,
    usage: { ...current.usage },
    undo: {
      ...current.undo,
      stack: current.undo.stack.slice(),
      lastRevertedFiles: current.undo.lastRevertedFiles.slice()
    }
  };
  next.sessionId = notification.sessionId;

  const update = notification.update;
  next.events.push({
    id: `${notification.sessionId}-event-${next.events.length + 1}`,
    kind: update.sessionUpdate,
    text: summarizeUpdate(notification),
    messageId: 'messageId' in update ? (update.messageId ?? null) : null
  });

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      next.transcript.push({
        id: `${notification.sessionId}-${next.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        clientPromptId: readClientPromptId(update) ?? readClientPromptId(notification),
        eventIndex: conversationEventIndex
      });
      next.runState = 'thinking';
      next.activityLabel = 'Waiting for the agent to respond…';
      break;
    case 'agent_message_chunk':
      next.transcript.push({
        id: `${notification.sessionId}-${next.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        eventIndex: conversationEventIndex
      });
      next.runState = 'streaming';
      next.activityLabel = 'Agent is replying…';
      next.lastError = null;
      break;
    case 'agent_thought_chunk':
      next.transcript.push({
        id: `${notification.sessionId}-${next.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        eventIndex: conversationEventIndex
      });
      next.runState = 'thinking';
      next.activityLabel = 'Agent is thinking…';
      next.lastError = null;
      break;
    case 'tool_call': {
      const incomingStatus = update.status ?? 'pending';
      const target = canonicalizeToolCall(next.toolCalls, update.toolCallId);
      if (target) {
        target.title = update.title || target.title;
        target.status = mergeToolStatus(target.status, incomingStatus);
        target.kind = update.kind ?? target.kind;
        target.messageId = target.messageId ?? readMessageId(update);
        target.arguments = stringifyOptional(update.rawInput) ?? target.arguments;
        target.result = stringifyToolContent(update.rawOutput ?? update.content) ?? target.result;
        target.eventIndex = target.eventIndex ?? conversationEventIndex;
      } else {
        next.toolCalls.push({
          id: update.toolCallId,
          title: update.title,
          status: incomingStatus,
          kind: update.kind ?? null,
          messageId: readMessageId(update),
          arguments: stringifyOptional(update.rawInput),
          result: stringifyToolContent(update.rawOutput ?? update.content),
          eventIndex: conversationEventIndex
        });
      }
      const current = next.toolCalls.find((tool) => tool.id === update.toolCallId);
      if (current && isTerminalToolStatus(current.status)) {
        if (next.activeToolCallId === update.toolCallId) next.activeToolCallId = null;
      } else {
        next.runState = 'tool-running';
        next.activeToolCallId = update.toolCallId;
        next.activityLabel = `Running tool: ${update.title}`;
        next.lastError = null;
      }
      break;
    }
    case 'tool_call_update': {
      let target = canonicalizeToolCall(next.toolCalls, update.toolCallId);
      if (target) {
        target.title = update.title ?? target.title;
        target.status = mergeToolStatus(target.status, update.status ?? target.status);
        target.kind = update.kind ?? target.kind;
        target.messageId = target.messageId ?? readMessageId(update);
        target.result = stringifyToolContent(update.rawOutput ?? update.content) ?? target.result;
        target.eventIndex = target.eventIndex ?? conversationEventIndex;
      } else {
        target = {
          id: update.toolCallId,
          title: update.title ?? 'Tool call',
          status: update.status ?? 'pending',
          kind: update.kind ?? null,
          messageId: readMessageId(update),
          result: stringifyToolContent(update.rawOutput ?? update.content),
          eventIndex: conversationEventIndex
        };
        next.toolCalls.push(target);
      }
      if (target.status === 'completed') {
        next.runState = 'streaming';
        next.activeToolCallId = null;
        next.activityLabel = 'Tool finished. Continuing reply…';
        next.lastError = null;
      } else if (target.status === 'failed') {
        next.runState = 'failed';
        next.activeToolCallId = update.toolCallId;
        next.lastError = update.title ? `${update.title} failed.` : 'Tool call failed.';
        next.activityLabel = next.lastError;
      } else {
        next.runState = 'tool-running';
        next.activeToolCallId = update.toolCallId;
        next.activityLabel = `Running ${update.title ?? 'tool'}…`;
      }
      break;
    }
    case 'plan':
      next.plans = update.entries.map(mapPlanEntry);
      if (next.runState === 'idle') {
        next.runState = 'thinking';
      }
      next.activityLabel = 'Working through a plan…';
      break;
    case 'config_option_update':
      next.configOptions = update.configOptions ?? [];
      break;
    case 'usage_update':
      next.usage.contextUsed = readFiniteNumber(update.used) ?? next.usage.contextUsed;
      next.usage.contextLimit = readPositiveNumber(update.size) ?? next.usage.contextLimit;
      next.usage.cumulativeCostUsd = readCostUsd(update.cost) ?? next.usage.cumulativeCostUsd;
      break;
    case 'plan_update':
      if (update.plan.type === 'items') {
        next.plans = update.plan.entries.map(mapPlanEntry);
      }
      next.activityLabel = 'Plan updated.';
      break;
    case 'plan_removed':
      next.plans = [];
      next.activityLabel = 'Plan removed.';
      break;
    default:
      break;
  }

  return next;
}

function canonicalizeToolCall(toolCalls: SessionToolCallItem[], toolCallId: string): SessionToolCallItem | null {
  const matches = toolCalls.filter((tool) => tool.id === toolCallId);
  if (matches.length === 0) return null;

  const canonical = matches[0];
  for (const duplicate of matches.slice(1)) {
    canonical.title = canonical.title || duplicate.title;
    canonical.status = mergeToolStatus(canonical.status, duplicate.status);
    canonical.kind = canonical.kind ?? duplicate.kind;
    canonical.messageId = canonical.messageId ?? duplicate.messageId;
    canonical.arguments = canonical.arguments ?? duplicate.arguments;
    canonical.result = canonical.result ?? duplicate.result;
    canonical.isError = canonical.isError ?? duplicate.isError;
    canonical.eventIndex = Math.min(
      canonical.eventIndex ?? Number.MAX_SAFE_INTEGER,
      duplicate.eventIndex ?? Number.MAX_SAFE_INTEGER
    );
  }

  if (matches.length > 1) {
    const firstIndex = toolCalls.indexOf(canonical);
    toolCalls.splice(0, toolCalls.length, ...toolCalls.filter((tool, index) => tool.id !== toolCallId || index === firstIndex));
  }
  return canonical;
}

function mergeToolStatus(
  current: SessionToolCallItem['status'],
  incoming: SessionToolCallItem['status']
): SessionToolCallItem['status'] {
  if (isTerminalToolStatus(current) && !isTerminalToolStatus(incoming)) return current;
  return incoming;
}

function isTerminalToolStatus(status: SessionToolCallItem['status']): boolean {
  return status === 'completed' || status === 'failed';
}

export function groupTranscriptItems(items: SessionTranscriptItem[]): SessionTranscriptGroup[] {
  const groups: SessionTranscriptGroup[] = [];

  for (const item of items) {
    const role = mapTranscriptRole(item.kind);
    const previous = groups[groups.length - 1];

    if (previous && previous.role === role && previous.messageId === item.messageId) {
      previous.text = `${previous.text}${item.text}`;
      previous.blocks = [...(previous.blocks ?? []), ...getTranscriptBlocks(item)];
      previous.eventIds = [...previous.eventIds, item.id];
      continue;
    }

      groups.push({
        id: item.id,
        role,
        text: item.text,
        blocks: getTranscriptBlocks(item),
        messageId: item.messageId,
        clientPromptId: item.clientPromptId,
        eventIds: [item.id],
        eventIndex: item.eventIndex
      });

  }

  return groups;
}

function getTextContent(content: { type: string; text?: string }): string {
  return content.type === 'text' && typeof content.text === 'string' ? content.text : '';
}

export function getTranscriptBlocks(item: Pick<SessionTranscriptItem, 'text' | 'blocks'>): SessionContentBlock[] {
  return item.blocks?.length ? item.blocks : item.text ? [{ type: 'text', text: item.text }] : [];
}

export function normalizeContentBlocks(values: unknown): SessionContentBlock[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeContentBlock).filter((block): block is SessionContentBlock => block !== null);
}

export function normalizeContentBlock(value: unknown): SessionContentBlock | null {
  if (!value || typeof value !== 'object') return null;
  const block = value as Record<string, unknown>;
  if (block.type === 'text' && typeof block.text === 'string') return { type: 'text', text: block.text };

  const meta = readAttachmentMeta(block._meta);
  if (block.type === 'image') {
    const mimeType = readString(block.mimeType) ?? readString(block.mime_type) ?? 'image/*';
    const data = readStringAllowEmpty(block.data);
    return {
      type: 'image',
      data,
      mimeType,
      uri: readString(block.uri),
      ...meta,
      unavailable: !data || !mimeType.startsWith('image/')
    };
  }

  if (block.type !== 'resource' || !block.resource || typeof block.resource !== 'object') return null;
  const resource = block.resource as Record<string, unknown>;
  const resourceMeta = { ...readAttachmentMeta(resource._meta), ...meta };
  const uri = readString(resource.uri) ?? 'attachment:///unavailable/attachment';
  const mimeType = readString(resource.mimeType) ?? readString(resource.mime_type);
  const data = readStringAllowEmpty(resource.blob);
  if (mimeType?.startsWith('image/')) {
    return {
      type: 'image',
      data,
      mimeType,
      uri,
      ...resourceMeta,
      unavailable: !data
    };
  }
  return {
    type: 'resource',
    uri,
    mimeType,
    data,
    text: readString(resource.text),
    ...resourceMeta,
    unavailable: data === null && typeof resource.text !== 'string'
  };
}

export function summarizeContentBlocks(blocks: SessionContentBlock[]): string {
  const text = blocks.filter((block): block is Extract<SessionContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text).join('');
  if (text) return text;
  if (blocks.length === 1 && blocks[0].type === 'image') return blocks[0].name ?? 'Image attachment';
  if (blocks.length === 1 && blocks[0].type === 'resource') return blocks[0].name ?? 'File attachment';
  return `${blocks.length} attachments`;
}

function readAttachmentMeta(value: unknown): { id?: string; name?: string; size?: number } {
  if (!value || typeof value !== 'object') return {};
  const root = value as Record<string, unknown>;
  const querymt = root.querymt && typeof root.querymt === 'object' ? root.querymt as Record<string, unknown> : root;
  return {
    id: readString(querymt.attachment_id) ?? readString(querymt.attachmentId),
    name: readString(querymt.filename) ?? readString(querymt.name),
    size: typeof querymt.size === 'number' && Number.isFinite(querymt.size) ? querymt.size : undefined
  };
}

export function readClientPromptId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const direct = readString(root.client_prompt_id)
    ?? readString(root.clientPromptId)
    ?? readString(root['querymt.client_prompt_id']);
  if (direct) return direct;

  for (const key of ['_meta', 'metadata', 'querymt', 'content'] as const) {
    const nested = root[key];
    if (nested && typeof nested === 'object' && nested !== value) {
      const clientPromptId = readClientPromptId(nested);
      if (clientPromptId) return clientPromptId;
    }
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringAllowEmpty(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readMessageId(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return typeof record.messageId === 'string'
      ? record.messageId
      : typeof record.message_id === 'string'
        ? record.message_id
        : typeof record.assistantMessageId === 'string'
          ? record.assistantMessageId
          : null;
  }
  return null;
}

export function stringifyOptional(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function stringifyToolContent(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyToolContent(entry)).filter(Boolean).join('\n\n') || null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.type === 'content' && record.content) {
      return stringifyToolContent(record.content);
    }
    if (record.type === 'text' && typeof record.text === 'string') {
      return record.text;
    }
    if (record.type === 'terminal') {
      return stringifyOptional(record.output ?? record.text ?? record.content);
    }
    if (record.type === 'diff') {
      return stringifyOptional(record.diff ?? record.content);
    }
  }

  return stringifyOptional(value);
}

export function beginSessionWork(session: ActiveSessionViewModel, startedAt = Date.now()) {
  if (session.usage.activeWorkStartedAt === null) {
    session.usage.activeWorkStartedAt = startedAt;
  }
}

export function endSessionWork(session: ActiveSessionViewModel, endedAt = Date.now()) {
  const startedAt = session.usage.activeWorkStartedAt;
  if (startedAt === null) return;
  session.usage.activeWorkMs += Math.max(0, endedAt - startedAt);
  session.usage.activeWorkStartedAt = null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readPositiveNumber(value: unknown): number | null {
  const number = readFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function readCostUsd(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const cost = value as { amount?: unknown; currency?: unknown };
  if (typeof cost.currency !== 'string' || cost.currency.toUpperCase() !== 'USD') return null;
  return readFiniteNumber(cost.amount);
}

function summarizeUpdate(notification: SessionNotification): string {
  const update = notification.update;

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return summarizeContentBlocks(normalizeContentBlocks([update.content]));
    case 'tool_call':
      return `${update.title} (${update.status ?? 'pending'})`;
    case 'tool_call_update':
      return `${update.title ?? 'tool update'} (${update.status ?? 'updated'})`;
    case 'plan':
      return `Plan with ${update.entries.length} entries`;
    case 'plan_update':
      return `Plan update (${update.plan.type})`;
    case 'plan_removed':
      return 'Plan removed';
    case 'session_info_update':
      return `Session info updated${update.title ? `: ${update.title}` : ''}`;
    case 'usage_update': {
      const percent = update.size > 0 ? ` (${Math.round((update.used / update.size) * 100)}%)` : '';
      const cost = readCostUsd(update.cost);
      return `Context ${update.used}/${update.size} tokens${percent}${cost !== null ? ` · $${cost.toFixed(4)}` : ''}`;
    }
    case 'available_commands_update':
      return 'Available commands update';
    case 'current_mode_update':
      return `Mode update: ${update.currentModeId}`;
    case 'config_option_update':
      return `Config options updated: ${update.configOptions.length} option(s)`;
    default:
      return 'Unhandled ACP update';
  }
}

export function mapTranscriptRole(kind: SessionTranscriptItem['kind']): SessionTranscriptGroup['role'] {
  switch (kind) {
    case 'user_message_chunk':
      return 'user';
    case 'agent_thought_chunk':
      return 'thought';
    default:
      return 'assistant';
  }
}

function mapPlanEntry(entry: {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}): SessionPlanEntry {
  return {
    content: entry.content,
    priority: entry.priority,
    status: entry.status
  };
}
