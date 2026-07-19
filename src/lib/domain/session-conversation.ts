import { renderMarkdownToHtml } from '$lib/domain/markdown';
import { groupTranscriptItems } from '$lib/domain/session-updates';
import type { ActiveSessionViewModel, SessionToolCallItem, SessionTranscriptGroup } from '$lib/domain/types';

export type SessionActivityItem = {
  id: string;
  tool: SessionToolCallItem;
  attachedBy: 'message-id' | 'nearest-previous' | 'next-assistant' | 'fallback';
};

export type SessionConversationTurn = {
  id: string;
  user?: {
    id: string;
    html: string;
    text: string;
  };
  reasoning: Array<{
    id: string;
    html: string;
    isLive: boolean;
  }>;
  assistant?: {
    id: string;
    html: string;
    text: string;
    relatedEvents: Array<{ kind: string; text: string }>;
  };
  activities: SessionActivityItem[];
};

export function buildSessionConversation(session: ActiveSessionViewModel): SessionConversationTurn[] {
  const groups = groupTranscriptItems(session.transcript);
  const turns = buildTurns(groups, session);
  attachTools(turns, canonicalizeTools(session.toolCalls), groups);
  return turns.filter((turn) => turn.user || turn.reasoning.length > 0 || turn.assistant || turn.activities.length > 0);
}

function buildTurns(groups: SessionTranscriptGroup[], session: ActiveSessionViewModel): SessionConversationTurn[] {
  const turns: SessionConversationTurn[] = [];
  let current: SessionConversationTurn | null = null;

  for (const group of groups) {
    if (group.role === 'user') {
      current = {
        id: `turn-${group.id}`,
        user: {
          id: group.id,
          html: renderMarkdownToHtml(group.text),
          text: group.text
        },
        reasoning: [],
        assistant: undefined,
        activities: []
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: `turn-${group.id}`,
        reasoning: [],
        assistant: undefined,
        activities: []
      };
      turns.push(current);
    }

    if (group.role === 'thought') {
      current.reasoning.push({
        id: group.id,
        html: renderMarkdownToHtml(group.text),
        isLive: session.runState === 'thinking' || session.runState === 'tool-running'
      });
      continue;
    }

    if (group.role === 'assistant') {
      current.assistant = {
        id: group.id,
        html: renderMarkdownToHtml(group.text),
        text: group.text,
        relatedEvents: session.events
          .filter((event) => group.eventIds.includes(event.id) || event.messageId === group.messageId)
          .map((event) => ({ kind: event.kind, text: event.text }))
      };
      current = null;
    }
  }

  return turns;
}

function canonicalizeTools(tools: SessionToolCallItem[]): SessionToolCallItem[] {
  const canonicalById = new Map<string, SessionToolCallItem>();

  for (const tool of tools) {
    const existing = canonicalById.get(tool.id);
    if (!existing) {
      canonicalById.set(tool.id, { ...tool });
      continue;
    }

    const existingTerminal = existing.status === 'completed' || existing.status === 'failed';
    const toolTerminal = tool.status === 'completed' || tool.status === 'failed';
    if (!existingTerminal && toolTerminal) existing.status = tool.status;
    existing.title = existing.title || tool.title;
    existing.kind = existing.kind ?? tool.kind;
    existing.messageId = existing.messageId ?? tool.messageId;
    existing.arguments = existing.arguments ?? tool.arguments;
    existing.result = existing.result ?? tool.result;
    existing.isError = existing.isError ?? tool.isError;
    existing.eventIndex = Math.min(
      existing.eventIndex ?? Number.MAX_SAFE_INTEGER,
      tool.eventIndex ?? Number.MAX_SAFE_INTEGER
    );
  }

  return [...canonicalById.values()];
}

function attachTools(turns: SessionConversationTurn[], tools: SessionToolCallItem[], groups: SessionTranscriptGroup[]) {
  const assistantByMessageId = new Map<string, SessionConversationTurn>();
  const assistantOrder = groups
    .filter((group) => group.role === 'assistant' || group.role === 'thought')
    .map((group) => ({
      messageId: group.messageId,
      eventIndex: group.eventIndex ?? Number.MAX_SAFE_INTEGER,
      turn: turns.find((turn) => turn.assistant?.id === group.id || turn.reasoning.some((item) => item.id === group.id)) ?? null
    }))
    .filter((entry) => entry.turn !== null);

  for (const turn of turns) {
    if (turn.assistant) {
      const assistantGroup = groups.find((group) => group.id === turn.assistant?.id);
      if (assistantGroup?.messageId) {
        assistantByMessageId.set(assistantGroup.messageId, turn);
      }
    }
  }

  const fallbackTurn = turns[turns.length - 1] ?? null;

  for (const tool of tools.slice().sort((a, b) => (a.eventIndex ?? Number.MAX_SAFE_INTEGER) - (b.eventIndex ?? Number.MAX_SAFE_INTEGER))) {
    if (tool.messageId && assistantByMessageId.has(tool.messageId)) {
      assistantByMessageId.get(tool.messageId)!.activities.push({
        id: tool.id,
        tool,
        attachedBy: 'message-id'
      });
      continue;
    }

    const previous = [...assistantOrder]
      .reverse()
      .find((entry) => (entry.eventIndex ?? Number.MAX_SAFE_INTEGER) <= (tool.eventIndex ?? Number.MAX_SAFE_INTEGER));
    if (previous?.turn) {
      previous.turn.activities.push({
        id: tool.id,
        tool,
        attachedBy: 'nearest-previous'
      });
      continue;
    }

    const next = assistantOrder.find((entry) => (entry.eventIndex ?? Number.MAX_SAFE_INTEGER) > (tool.eventIndex ?? Number.MAX_SAFE_INTEGER));
    if (next?.turn) {
      next.turn.activities.push({
        id: tool.id,
        tool,
        attachedBy: 'next-assistant'
      });
      continue;
    }

    if (fallbackTurn) {
      fallbackTurn.activities.push({
        id: tool.id,
        tool,
        attachedBy: 'fallback'
      });
    }
  }
}
