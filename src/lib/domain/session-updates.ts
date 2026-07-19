import type { SessionNotification } from '@agentclientprotocol/sdk';
import type {
  ActiveSessionViewModel,
  SessionEventItem,
  SessionPlanEntry,
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
    lastError: null
  };
}

export function applySessionNotification(
  current: ActiveSessionViewModel,
  notification: SessionNotification
): ActiveSessionViewModel {
  const next: ActiveSessionViewModel = {
    sessionId: current.sessionId,
    transcript: current.transcript.map((item) => ({ ...item })),
    toolCalls: current.toolCalls.map((item) => ({ ...item })),
    plans: current.plans.map((item) => ({ ...item })),
    events: current.events.map((item) => ({ ...item })),
    configOptions: current.configOptions.map((item) => ({ ...item })),
    runState: current.runState,
    activityLabel: current.activityLabel,
    activeToolCallId: current.activeToolCallId,
    lastStopReason: current.lastStopReason,
    lastError: current.lastError
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
        messageId: update.messageId ?? null,
        eventIndex: next.events.length - 1
      });
      next.runState = 'thinking';
      next.activityLabel = 'Waiting for the agent to respond…';
      break;
    case 'agent_message_chunk':
      next.transcript.push({
        id: `${notification.sessionId}-${next.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        messageId: update.messageId ?? null,
        eventIndex: next.events.length - 1
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
        messageId: update.messageId ?? null,
        eventIndex: next.events.length - 1
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
        target.eventIndex = Math.min(target.eventIndex ?? Number.MAX_SAFE_INTEGER, next.events.length - 1);
      } else {
        next.toolCalls.push({
          id: update.toolCallId,
          title: update.title,
          status: incomingStatus,
          kind: update.kind ?? null,
          messageId: readMessageId(update),
          arguments: stringifyOptional(update.rawInput),
          result: stringifyToolContent(update.rawOutput ?? update.content),
          eventIndex: next.events.length - 1
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
        target.eventIndex = target.eventIndex ?? next.events.length - 1;
      } else {
        target = {
          id: update.toolCallId,
          title: update.title ?? 'Tool call',
          status: update.status ?? 'pending',
          kind: update.kind ?? null,
          messageId: readMessageId(update),
          result: stringifyToolContent(update.rawOutput ?? update.content),
          eventIndex: next.events.length - 1
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
      previous.eventIds = [...previous.eventIds, item.id];
      continue;
    }

      groups.push({
        id: item.id,
        role,
        text: item.text,
        messageId: item.messageId,
        eventIds: [item.id],
        eventIndex: item.eventIndex
      });

  }

  return groups;
}

function getTextContent(content: { type: string; text?: string }): string {
  if (content.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }

  return `[${content.type}]`;
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

function summarizeUpdate(notification: SessionNotification): string {
  const update = notification.update;

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
      return getTextContent(update.content);
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
    case 'usage_update':
      return 'Usage update';
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

function mapTranscriptRole(kind: SessionTranscriptItem['kind']): SessionTranscriptGroup['role'] {
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
