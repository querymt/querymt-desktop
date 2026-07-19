import { renderMarkdownToHtml } from '$lib/domain/markdown';
import type {
  ActiveSessionViewModel,
  SessionToolCallItem,
  SessionTranscriptGroup,
  SessionTranscriptItem
} from '$lib/domain/types';

export type SessionReasoningContent = {
  type: 'reasoning';
  id: string;
  html: string;
  isLive: boolean;
};

export type SessionAssistantContent = {
  type: 'assistant';
  id: string;
  html: string;
  text: string;
  relatedEvents: Array<{ kind: string; text: string }>;
};

export type SessionToolContent = {
  type: 'tool';
  id: string;
  tool: SessionToolCallItem;
};

export type SessionConversationContent = SessionReasoningContent | SessionAssistantContent | SessionToolContent;

export type SessionConversationTurn = {
  id: string;
  user?: {
    id: string;
    html: string;
    text: string;
  };
  content: SessionConversationContent[];
};

type RawConversationItem =
  | { type: 'transcript'; transcript: SessionTranscriptItem; eventIndex?: number; sourceOrder: number }
  | { type: 'tool'; tool: SessionToolCallItem; eventIndex?: number; sourceOrder: number };

type OrderedConversationItem =
  | { type: 'group'; group: SessionTranscriptGroup }
  | { type: 'tool'; tool: SessionToolCallItem };

export function buildSessionConversation(session: ActiveSessionViewModel): SessionConversationTurn[] {
  const orderedItems = buildOrderedItems(session.transcript, canonicalizeTools(session.toolCalls));

  const turns: SessionConversationTurn[] = [];
  let current: SessionConversationTurn | null = null;

  for (const item of orderedItems) {
    if (item.type === 'group' && item.group.role === 'user') {
      current = {
        id: `turn-${item.group.id}`,
        user: {
          id: item.group.id,
          html: renderMarkdownToHtml(item.group.text),
          text: item.group.text
        },
        content: []
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      const id = item.type === 'group' ? item.group.id : item.tool.id;
      current = { id: `turn-${id}`, content: [] };
      turns.push(current);
    }

    if (item.type === 'tool') {
      current.content.push({ type: 'tool', id: item.tool.id, tool: item.tool });
      continue;
    }

    if (item.group.role === 'thought') {
      current.content.push({
        type: 'reasoning',
        id: item.group.id,
        html: renderMarkdownToHtml(item.group.text),
        isLive: session.runState === 'thinking' || session.runState === 'tool-running'
      });
      continue;
    }

    current.content.push({
      type: 'assistant',
      id: item.group.id,
      html: renderMarkdownToHtml(item.group.text),
      text: item.group.text,
      relatedEvents: session.events
        .filter((event) => item.group.eventIds.includes(event.id) || event.messageId === item.group.messageId)
        .map((event) => ({ kind: event.kind, text: event.text }))
    });
  }

  return turns.filter((turn) => turn.user || turn.content.length > 0);
}

function buildOrderedItems(transcript: SessionTranscriptItem[], tools: SessionToolCallItem[]): OrderedConversationItem[] {
  const rawItems: RawConversationItem[] = [
    ...transcript.map((item, sourceOrder) => ({
      type: 'transcript' as const,
      transcript: item,
      eventIndex: item.eventIndex,
      sourceOrder
    })),
    ...tools.map((tool, index) => ({
      type: 'tool' as const,
      tool,
      eventIndex: tool.eventIndex,
      sourceOrder: transcript.length + index
    }))
  ].sort(compareRawItems);

  const orderedItems: OrderedConversationItem[] = [];
  for (const item of rawItems) {
    if (item.type === 'tool') {
      orderedItems.push({ type: 'tool', tool: item.tool });
      continue;
    }

    const role = mapTranscriptRole(item.transcript.kind);
    const previous = orderedItems[orderedItems.length - 1];
    if (
      previous?.type === 'group' &&
      previous.group.role === role &&
      previous.group.messageId === item.transcript.messageId
    ) {
      previous.group.text += item.transcript.text;
      previous.group.eventIds.push(item.transcript.id);
      continue;
    }

    orderedItems.push({
      type: 'group',
      group: {
        id: item.transcript.id,
        role,
        text: item.transcript.text,
        messageId: item.transcript.messageId,
        eventIds: [item.transcript.id],
        eventIndex: item.transcript.eventIndex
      }
    });
  }
  return orderedItems;
}

function compareRawItems(a: RawConversationItem, b: RawConversationItem): number {
  const aHasIndex = typeof a.eventIndex === 'number';
  const bHasIndex = typeof b.eventIndex === 'number';

  if (aHasIndex && bHasIndex && a.eventIndex !== b.eventIndex) {
    return a.eventIndex! - b.eventIndex!;
  }
  if (aHasIndex !== bHasIndex) {
    return aHasIndex ? -1 : 1;
  }
  return a.sourceOrder - b.sourceOrder;
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
