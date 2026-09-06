import { renderMarkdownToHtml } from '$lib/domain/markdown';
import { getTranscriptBlocks, mapTranscriptRole } from '$lib/domain/session-updates';
import type {
  ActiveSessionViewModel,
  SessionContentBlock,
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
  messageId: string | null;
  html: string;
  text: string;
  blocks?: SessionContentBlock[];
  relatedEvents: Array<{ kind: string; text: string }>;
};

export type SessionToolContent = {
  type: 'tool';
  id: string;
  tool: SessionToolCallItem;
};

export type SessionConversationContent = SessionReasoningContent | SessionAssistantContent | SessionToolContent;

export type SessionConversationWorkGroup = {
  type: 'work-group';
  id: string;
  content: Array<SessionReasoningContent | SessionToolContent>;
  toolCount: number;
  reasoningCount: number;
  failedToolCount: number;
  settled: boolean;
};

export type SessionConversationPresentationItem = SessionAssistantContent | SessionConversationWorkGroup;

export type SessionConversationTurn = {
  id: string;
  forkMessageId: string | null;
  durationMs?: number;
  user?: {
    id: string;
    messageId: string | null;
    html: string;
    text: string;
    blocks?: SessionContentBlock[];
    eventIndex?: number;
  };
  content: SessionConversationContent[];
  presentation?: SessionConversationPresentationItem[];
  settled?: boolean;
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
  // Index-aligned with `turns`: wall-clock window of each turn, in ms.
  const turnTimings: Array<{ started?: number; ended?: number }> = [];
  let current: SessionConversationTurn | null = null;

  for (const item of orderedItems) {
    if (item.type === 'group' && item.group.role === 'user') {
      current = {
        id: `turn-${item.group.id}`,
        forkMessageId: item.group.messageId,
        user: {
          id: item.group.id,
          messageId: item.group.messageId,
          html: renderMarkdownToHtml(item.group.text),
          text: item.group.text,
          blocks: item.group.blocks ?? [],
          eventIndex: item.group.eventIndex
        },
        content: [],
        presentation: [],
        settled: false
      };
      turns.push(current);
      turnTimings.push({ started: item.group.startedAtMs, ended: item.group.endedAtMs });
      continue;
    }

    if (!current) {
      const id = item.type === 'group' ? item.group.id : item.tool.id;
      current = { id: `turn-${id}`, forkMessageId: null, content: [], presentation: [], settled: false };
      turns.push(current);
      turnTimings.push({});
    }

    if (item.type === 'group' && item.group.endedAtMs !== undefined) {
      const timing = turnTimings[turnTimings.length - 1];
      if (timing) timing.ended = item.group.endedAtMs;
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

    current.forkMessageId = item.group.messageId ?? current.forkMessageId;
    current.content.push({
      type: 'assistant',
      id: item.group.id,
      messageId: item.group.messageId,
      html: renderMarkdownToHtml(item.group.text),
      text: item.group.text,
      blocks: item.group.blocks ?? [],
      relatedEvents: session.events
        .filter((event) => item.group.eventIds.includes(event.id) || event.messageId === item.group.messageId)
        .map((event) => ({ kind: event.kind, text: event.text }))
    });
  }

  turns.forEach((turn, index) => {
    const timing = turnTimings[index];
    if (timing?.started !== undefined && timing?.ended !== undefined && timing.ended >= timing.started) {
      const delta = timing.ended - timing.started;
      // Instant answers don't need a "Worked for 0s" badge.
      if (delta >= 1000) turn.durationMs = delta;
    }
  });

  const visibleTurns = turns.filter((turn) => turn.user || turn.content.length > 0);
  const busy = ['submitting', 'thinking', 'streaming', 'tool-running'].includes(session.runState);
  const activeTurnIndex = busy ? visibleTurns.length - 1 : -1;

  return visibleTurns.map((turn, index) => {
    const settled = index !== activeTurnIndex;
    return {
      ...turn,
      settled,
      // Durations are only meaningful for finished turns; the active one is
      // still accumulating.
      durationMs: settled ? turn.durationMs : undefined,
      presentation: buildTurnPresentation(turn.content, settled)
    };
  });
}

export function formatTurnDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function buildTurnPresentation(
  content: SessionConversationContent[],
  settled: boolean
): SessionConversationPresentationItem[] {
  const items: SessionConversationPresentationItem[] = [];
  let work: Array<SessionReasoningContent | SessionToolContent> = [];

  const flushWork = () => {
    if (work.length === 0) return;
    const tools = work.filter((item): item is SessionToolContent => item.type === 'tool');
    items.push({
      type: 'work-group',
      id: `work-${work[0].id}`,
      content: work,
      toolCount: tools.length,
      reasoningCount: work.length - tools.length,
      failedToolCount: tools.filter((item) => item.tool.status === 'failed').length,
      settled,
    });
    work = [];
  };

  for (const item of content) {
    if (item.type === 'assistant') {
      flushWork();
      items.push(item);
    } else {
      work.push(item);
    }
  }
  flushWork();
  return items;
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
  let openAssistantGroup: SessionTranscriptGroup | null = null;
  let openThoughtGroup: SessionTranscriptGroup | null = null;
  for (const item of rawItems) {
    if (item.type === 'tool') {
      // A tool call ends both the current assistant text segment and the
      // current reasoning trace: what streams after it starts fresh.
      openAssistantGroup = null;
      openThoughtGroup = null;
      orderedItems.push({ type: 'tool', tool: item.tool });
      continue;
    }

    const role = mapTranscriptRole(item.transcript.kind);
    const previous = orderedItems[orderedItems.length - 1];
    // Agent chunks stream a single response and may arrive with per-chunk (or
    // missing) message ids, and reasoning notifications can interleave
    // mid-sentence (or trail after the answer): keep appending to the open
    // assistant / thought groups so each renders as one markdown run instead
    // of orphaned fragments. Tool calls and user prompts close both segments.
    // User chunks stay strict: distinct message ids mean distinct prompts.
    const sameRole = previous?.type === 'group' && previous.group.role === role;
    const sameMessage = previous?.type === 'group' && previous.group.messageId === item.transcript.messageId;
    const mergeTarget =
      role === 'assistant' && openAssistantGroup
        ? openAssistantGroup
        : role === 'thought' && openThoughtGroup
          ? openThoughtGroup
          : sameRole && (role !== 'user' || sameMessage)
            ? previous.group
            : null;
    if (mergeTarget) {
      mergeTarget.text += item.transcript.text;
      mergeTarget.messageId = item.transcript.messageId ?? mergeTarget.messageId;
      mergeTarget.blocks = [...(mergeTarget.blocks ?? []), ...getTranscriptBlocks(item.transcript)];
      mergeTarget.eventIds.push(item.transcript.id);
      if (item.transcript.timestampMs !== undefined) mergeTarget.endedAtMs = item.transcript.timestampMs;
      continue;
    }

    const group: SessionTranscriptGroup = {
      id: item.transcript.id,
      role,
      text: item.transcript.text,
      blocks: getTranscriptBlocks(item.transcript),
      messageId: item.transcript.messageId,
      clientPromptId: item.transcript.clientPromptId,
      eventIds: [item.transcript.id],
      eventIndex: item.transcript.eventIndex,
      startedAtMs: item.transcript.timestampMs,
      endedAtMs: item.transcript.timestampMs
    };
    if (role === 'assistant') openAssistantGroup = group;
    else if (role === 'thought') openThoughtGroup = group;
    else {
      openAssistantGroup = null;
      openThoughtGroup = null;
    }
    orderedItems.push({ type: 'group', group });
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
