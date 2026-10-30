import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { DelegationUpdateNotification, SessionRuntimeStatus } from '$lib/querymt/generated/types';
import { readAccountingMeta, readUsageBreakdown } from '$lib/domain/session-usage';
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
      standardCostUsd: null,
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
  // Fast path: replay is one uninterrupted run with no intermediate readers, so
  // the view model is folded in place in a single pass. The previous
  // implementation reused the incremental reducer, which clones the entire view
  // model (transcript, blocks, tools, plans) and rescans for the next event
  // index on every notification, making long session loads quadratic.
  const session = createEmptyActiveSession();
  session.sessionId = sessionId;
  return appendSessionReplay(session, notifications);
}

/**
 * Folds a captured replay window onto `session` in place and returns it.
 *
 * Same linear pass as `reduceSessionReplay`, but starts from an existing view
 * model so a snapshot-backed load can keep the snapshot as its baseline and
 * merge the captured live updates into it exactly once. Tool calls merge by id
 * and stream chunks append by kind + message id, so replayed updates extend
 * the baseline instead of duplicating it.
 */
export function appendSessionReplay(
  session: ActiveSessionViewModel,
  notifications: readonly SessionNotification[]
): ActiveSessionViewModel {
  // Mirrors `getNextConversationEventIndex`: the index advances only when a
  // non-merge update records an entry, and merged stream chunks reuse the last
  // recorded index. Tracking a running maximum keeps this linear.
  let nextEventIndex = getNextConversationEventIndex(session);

  for (const notification of notifications) {
    applySessionNotificationInPlace(session, notification, nextEventIndex);
    nextEventIndex = currentConversationEventIndex(session);
  }

  projectDelegationActivity(session);
  return session;
}

/** Max recorded `eventIndex` plus one, matching `getNextConversationEventIndex`. */
function currentConversationEventIndex(session: ActiveSessionViewModel): number {
  let maxIndex = -1;
  for (const item of session.transcript) {
    if (typeof item.eventIndex === 'number') maxIndex = Math.max(maxIndex, item.eventIndex);
  }
  for (const tool of session.toolCalls) {
    if (typeof tool.eventIndex === 'number') maxIndex = Math.max(maxIndex, tool.eventIndex);
  }
  return maxIndex + 1;
}

/**
 * Applies one notification to `session` by mutating it, for bulk replay.
 *
 * `applySessionNotification` clones on every call to stay safe for the
 * incremental/live path. Replay has no other readers, so mutation is both
 * equivalent and linear-time. It is only valid to mutate the arrays/objects
 * that the incremental reducer also cloned via `cloneSession`.
 */
function applySessionNotificationInPlace(
  session: ActiveSessionViewModel,
  notification: SessionNotification,
  conversationEventIndex: number
): void {
  const update = notification.update;

  if (
    update.sessionUpdate === 'agent_message_chunk' ||
    update.sessionUpdate === 'agent_thought_chunk'
  ) {
    const messageId = update.messageId ?? null;
    const reasoningPartId =
      update.sessionUpdate === 'agent_thought_chunk' ? readReasoningPartId(update) : null;
    const last = session.transcript.at(-1);
    if (canMergeStreamChunk(last, update.sessionUpdate, messageId, reasoningPartId)) {
      // Mirror `mergeStreamChunk`: append the new text, then rebuild blocks.
      // `last` is the mutable transcript entry owned by this replay pass.
      const incomingBlocks = normalizeContentBlocks([update.content]);
      last.text = `${last.text}${getTextContent(update.content)}`;
      last.blocks = appendTextBlocks(last.blocks, incomingBlocks);
      last.reasoningPartId = last.reasoningPartId ?? reasoningPartId;
      last.timestampMs = Date.now();
      session.sessionId = notification.sessionId;
      session.runState = update.sessionUpdate === 'agent_message_chunk' ? 'streaming' : 'thinking';
      session.activityLabel =
        update.sessionUpdate === 'agent_message_chunk'
          ? 'Agent is replying\u2026'
          : 'Agent is thinking\u2026';
      session.lastError = null;
      return;
    }
  }

  session.events.push({
    id: `${notification.sessionId}-event-${session.events.length + 1}`,
    kind: update.sessionUpdate,
    text: summarizeUpdate(notification),
    messageId: 'messageId' in update ? (update.messageId ?? null) : null
  });

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      session.transcript.push({
        id: `${notification.sessionId}-${session.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        clientPromptId: readClientPromptId(update) ?? readClientPromptId(notification),
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
      });
      session.runState = 'thinking';
      session.activityLabel = 'Waiting for the agent to respond\u2026';
      break;
    case 'agent_message_chunk':
      session.transcript.push({
        id: `${notification.sessionId}-${session.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
      });
      session.runState = 'streaming';
      session.activityLabel = 'Agent is replying\u2026';
      session.lastError = null;
      break;
    case 'agent_thought_chunk':
      session.transcript.push({
        id: `${notification.sessionId}-${session.transcript.length + 1}`,
        kind: update.sessionUpdate,
        text: getTextContent(update.content),
        blocks: normalizeContentBlocks([update.content]),
        messageId: update.messageId ?? null,
        reasoningPartId: readReasoningPartId(update),
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
      });
      session.runState = 'thinking';
      session.activityLabel = 'Agent is thinking\u2026';
      session.lastError = null;
      break;
    case 'tool_call': {
      const incomingStatus = update.status ?? 'pending';
      const target = canonicalizeToolCall(session.toolCalls, update.toolCallId);
      if (target) {
        target.title = update.title || target.title;
        target.status = mergeToolStatus(target.status, incomingStatus);
        target.kind = update.kind ?? target.kind;
        target.messageId = target.messageId ?? readMessageId(update);
        target.arguments = stringifyOptional(update.rawInput) ?? target.arguments;
        mergeToolResult(target, incomingStatus, update.rawOutput ?? update.content);
        target.eventIndex = target.eventIndex ?? conversationEventIndex;
      } else {
        session.toolCalls.push({
          id: update.toolCallId,
          title: update.title,
          status: incomingStatus,
          kind: update.kind ?? null,
          messageId: readMessageId(update),
          arguments: stringifyOptional(update.rawInput),
          result: stringifyToolContent(update.rawOutput ?? update.content),
          eventIndex: conversationEventIndex
        });
        session.toolCalls = session.toolCalls.slice();
      }
      updateToolActivity(session);
      break;
    }
    case 'tool_call_update': {
      let target = canonicalizeToolCall(session.toolCalls, update.toolCallId);
      if (target) {
        target.title = update.title ?? target.title;
        target.status = mergeToolStatus(target.status, update.status ?? target.status);
        target.kind = update.kind ?? target.kind;
        target.messageId = target.messageId ?? readMessageId(update);
        mergeToolResult(target, update.status ?? undefined, update.rawOutput ?? update.content);
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
        session.toolCalls.push(target);
        session.toolCalls = session.toolCalls.slice();
      }
      updateToolActivity(session);
      break;
    }
    case 'plan':
      session.plans = update.entries.map(mapPlanEntry);
      if (session.runState === 'idle') session.runState = 'thinking';
      session.activityLabel = 'Working through a plan\u2026';
      break;
    case 'config_option_update':
      session.configOptions = update.configOptions ?? [];
      break;
    case 'usage_update':
      session.usage.contextUsed = readFiniteNumber(update.used) ?? session.usage.contextUsed;
      session.usage.contextLimit = readPositiveNumber(update.size) ?? session.usage.contextLimit;
      session.usage.breakdown = readUsageBreakdown(update._meta) ?? session.usage.breakdown;
      session.usage.standardCostUsd = readCostUsd(update.cost) ?? session.usage.standardCostUsd;
      applyAccountingMeta(session, update._meta);
      break;
    case 'session_info_update':
      // Metadata-only accounting fallback when no reliable context pair exists.
      applyAccountingMeta(session, update._meta);
      break;
    case 'plan_update':
      if (update.plan.type === 'items') {
        session.plans = update.plan.entries.map(mapPlanEntry);
      }
      session.activityLabel = 'Plan updated.';
      break;
    case 'plan_removed':
      session.plans = [];
      session.activityLabel = 'Plan removed.';
      break;
    default:
      break;
  }
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

const STREAM_CHUNK_KINDS = new Set(['agent_message_chunk', 'agent_thought_chunk']);

function cloneSession(current: ActiveSessionViewModel): ActiveSessionViewModel {
  return {
    ...current,
    transcript: current.transcript.map((item) => ({ ...item, blocks: item.blocks?.map((block) => ({ ...block })) })),
    toolCalls: current.toolCalls.map((item) => ({ ...item })),
    plans: current.plans.map((item) => ({ ...item })),
    events: current.events.map((item) => ({ ...item })),
    configOptions: current.configOptions.map((item) => ({ ...item })),
    lastRunOutcome: current.lastRunOutcome ? { ...current.lastRunOutcome } : undefined,
    delegations: current.delegations?.map((item) => ({ ...item })),
    usage: { ...current.usage },
    undo: {
      ...current.undo,
      stack: current.undo.stack.slice(),
      lastRevertedFiles: current.undo.lastRevertedFiles.slice()
    }
  };
}

function canMergeStreamChunk(
  last: SessionTranscriptItem | undefined,
  kind: SessionTranscriptItem['kind'],
  messageId: string | null,
  reasoningPartId: string | null = null
): last is SessionTranscriptItem {
  if (!last || !STREAM_CHUNK_KINDS.has(kind) || last.kind !== kind || last.messageId !== messageId) {
    return false;
  }
  if (kind !== 'agent_thought_chunk') return true;
  const current = last.reasoningPartId ?? null;
  // Untagged historical chunks still append. A different part id is a new summary.
  if (!reasoningPartId && !current) return true;
  return reasoningPartId === current;
}

function appendTextBlocks(current: SessionContentBlock[] | undefined, incoming: SessionContentBlock[]): SessionContentBlock[] {
  const blocks = current?.map((block) => ({ ...block })) ?? [];
  for (const block of incoming) {
    const previous = blocks.at(-1);
    if (block.type === 'text' && previous?.type === 'text') {
      previous.text += block.text;
      continue;
    }
    blocks.push({ ...block });
  }
  return blocks;
}

function mergeStreamChunk(
  current: ActiveSessionViewModel,
  notification: SessionNotification,
  kind: 'agent_message_chunk' | 'agent_thought_chunk',
  text: string,
  blocks: SessionContentBlock[],
  messageId: string | null,
  reasoningPartId: string | null = null
): ActiveSessionViewModel {
  const lastIndex = current.transcript.length - 1;
  const last = current.transcript[lastIndex];
  const merged: SessionTranscriptItem = {
    ...last,
    text: `${last.text}${text}`,
    blocks: appendTextBlocks(last.blocks, blocks),
    reasoningPartId: last.reasoningPartId ?? reasoningPartId,
    timestampMs: Date.now()
  };
  const transcript = current.transcript.slice();
  transcript[lastIndex] = merged;
  return {
    ...current,
    sessionId: notification.sessionId,
    transcript,
    runState: kind === 'agent_message_chunk' ? 'streaming' : 'thinking',
    activityLabel: kind === 'agent_message_chunk' ? 'Agent is replying…' : 'Agent is thinking…',
    lastError: null,
    usage: { ...current.usage },
    undo: current.undo
  };
}

export function applySessionNotification(
  current: ActiveSessionViewModel,
  notification: SessionNotification,
  conversationEventIndex = getNextConversationEventIndex(current)
): ActiveSessionViewModel {
  const update = notification.update;
  if (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') {
    const messageId = update.messageId ?? null;
    const reasoningPartId = update.sessionUpdate === 'agent_thought_chunk' ? readReasoningPartId(update) : null;
    const last = current.transcript.at(-1);
    if (canMergeStreamChunk(last, update.sessionUpdate, messageId, reasoningPartId)) {
      return mergeStreamChunk(
        current,
        notification,
        update.sessionUpdate,
        getTextContent(update.content),
        normalizeContentBlocks([update.content]),
        messageId,
        reasoningPartId
      );
    }
  }

  const next = cloneSession(current);
  next.sessionId = notification.sessionId;
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
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
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
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
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
        reasoningPartId: readReasoningPartId(update),
        eventIndex: conversationEventIndex,
        timestampMs: Date.now()
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
        mergeToolResult(target, incomingStatus, update.rawOutput ?? update.content);
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
      updateToolActivity(next);
      break;
    }
    case 'tool_call_update': {
      let target = canonicalizeToolCall(next.toolCalls, update.toolCallId);
      if (target) {
        target.title = update.title ?? target.title;
        target.status = mergeToolStatus(target.status, update.status ?? target.status);
        target.kind = update.kind ?? target.kind;
        target.messageId = target.messageId ?? readMessageId(update);
        mergeToolResult(target, update.status ?? undefined, update.rawOutput ?? update.content);
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
      updateToolActivity(next);
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
      next.usage.breakdown = readUsageBreakdown(update._meta) ?? next.usage.breakdown;
      next.usage.standardCostUsd = readCostUsd(update.cost) ?? next.usage.standardCostUsd;
      applyAccountingMeta(next, update._meta);
      break;
    case 'session_info_update':
      applyAccountingMeta(next, update._meta);
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

  projectDelegationActivity(next);
  return next;
}

export function getActiveSessionTools(session: ActiveSessionViewModel): SessionToolCallItem[] {
  return session.toolCalls.filter((tool) =>
    (tool.status === 'pending' || tool.status === 'in_progress') &&
    (!session.runId || !tool.runId || tool.runId === session.runId));
}

export function projectSessionRuntime(session: ActiveSessionViewModel, runtime: SessionRuntimeStatus): void {
  const previousRunId = session.runId;
  if (runtime.active_run_id) session.runId = runtime.active_run_id;
  session.activeToolCallId = null;
  if (runtime.phase === 'unknown' || runtime.observation?.availability === 'unavailable') {
    session.runState = 'unknown';
    session.activityLabel = 'Execution status unavailable';
    endSessionWork(session);
    return;
  }
  if (runtime.phase === 'idle') {
    session.toolCalls = session.toolCalls.map((tool) =>
      (tool.status === 'pending' || tool.status === 'in_progress') && (!tool.runId || tool.runId === previousRunId)
        ? { ...tool, status: 'failed', isError: true, result: tool.result ?? 'Execution ended without a recorded tool result.' }
        : tool);
    const outcome = session.lastRunOutcome;
    const matches = outcome && (!previousRunId || !outcome.runId || outcome.runId === previousRunId);
    const failed = matches ? outcome.outcome === 'failed' : session.runState === 'failed';
    session.runState = failed ? 'failed' : 'completed';
    session.activityLabel = failed ? 'Turn failed.' : matches && outcome.outcome === 'cancelled' ? 'Turn cancelled.' : 'Turn completed.';
    if (!failed) session.lastError = null;
    endSessionWork(session);
    return;
  }
  beginSessionWork(session);
  session.lastError = null;
  const responding = runtime.phase === 'model' && session.runState === 'streaming' && previousRunId === session.runId;
  session.runState = runtime.phase === 'tools' ? 'tool-running' : responding ? 'streaming' : 'thinking';
  const active = getActiveSessionTools(session);
  if (runtime.phase === 'tools') session.activeToolCallId = active[0]?.id ?? null;
  session.activityLabel = runtime.phase === 'cancel_requested' ? 'Cancelling turn...'
    : runtime.phase === 'closing' ? 'Finishing turn...'
    : runtime.phase === 'waiting' ? 'Waiting for delegates'
    : runtime.phase === 'tools' ? active.length > 1 ? `Running ${active.length} tools`
      : active[0] ? `Running tool: ${active[0].title}` : 'Running tools...'
    : runtime.phase === 'starting' ? 'Starting turn...' : 'Agent is working...';
}

export function mergeDelegationActivity(
  current: DelegationUpdateNotification[],
  incoming: readonly DelegationUpdateNotification[],
  complete = false,
  allowNewSource = false
): DelegationUpdateNotification[] {
  const items = new Map(current.map((item) => [item.delegationId, item]));
  for (const update of incoming) {
    const previous = items.get(update.delegationId);
    if (previous && (previous.sessionId !== update.sessionId ||
      (previous.targetAgentId && update.targetAgentId && previous.targetAgentId !== update.targetAgentId) ||
      (previous.toolCallId && update.toolCallId && previous.toolCallId !== update.toolCallId) ||
      (previous.childSessionId && update.childSessionId && previous.childSessionId !== update.childSessionId))) continue;
    if (previous?.sourceEpoch && previous.sourceEpoch !== update.sourceEpoch && !allowNewSource) continue;
    const staleOrder = previous?.sourceEpoch === update.sourceEpoch && previous?.sessionSeq !== undefined &&
      (update.sessionSeq === undefined || update.sessionSeq <= previous.sessionSeq);
    const staleTime = previous && previous.sessionSeq === undefined && update.sessionSeq === undefined &&
      (update.updatedAt < previous.updatedAt || (previous.state === 'forked' && update.state === 'requested'));
    const terminalRegression = previous && isTerminalDelegation(previous.state) && update.state !== previous.state;
    // History seeding can recover durable lifecycle facts behind an unchanged live stage watermark.
    const seededFact = previous?.sourceEpoch && previous.sourceEpoch === update.sourceEpoch &&
      previous.sessionSeq !== undefined && previous.sessionSeq === update.sessionSeq &&
      previous.targetAgentId && previous.targetAgentId === update.targetAgentId && previous.requestedAt === update.requestedAt &&
      ((previous.state === 'requested' && update.state === 'forked') ||
       ((previous.state === 'requested' || previous.state === 'forked') && isTerminalDelegation(update.state)));
    if (seededFact) {
      items.set(update.delegationId, { ...previous, ...update, activity: previous.activity, stage: previous.stage,
        updatedAt: Math.max(previous.updatedAt, update.updatedAt) });
      continue;
    }
    if (staleOrder || staleTime || terminalRegression ||
      (previous?.activity === 'live' && update.activity !== 'live' && update.sessionSeq === undefined)) {
      // Late history can fill correlation metadata, never replace accepted lifecycle/order.
      if (previous?.targetAgentId && previous.targetAgentId === update.targetAgentId &&
        ((!previous.toolCallId && update.toolCallId) || (!previous.childSessionId && update.childSessionId))) {
        items.set(update.delegationId, { ...previous, toolCallId: previous.toolCallId ?? update.toolCallId,
          childSessionId: previous.childSessionId ?? update.childSessionId });
      }
      continue;
    }
    items.set(update.delegationId, { ...previous, ...update });
  }
  if (complete) {
    const liveIds = new Set(incoming.filter((item) => item.activity === 'live').map((item) => item.delegationId));
    for (const [id, item] of items) {
      if (item.activity === 'live' && !liveIds.has(id)) items.set(id, { ...item, activity: 'historical' });
    }
  }
  const merged = [...items.values()];
  return merged.length === current.length && merged.every((item, index) => item === current[index]) ? current : merged;
}

function isTerminalDelegation(state: string | undefined): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

export function projectDelegationActivity(session: ActiveSessionViewModel): void {
  if (!session.delegations?.length) {
    session.dependencyLabel = null;
    return;
  }
  // One join for live, cached, replayed and snapshot observations. Dispatch completion is not child completion.
  const byTool = new Map<string, DelegationUpdateNotification | null>();
  for (const observation of session.delegations ?? []) {
    if (observation.sessionId !== session.sessionId || !observation.toolCallId) continue;
    const previous = byTool.get(observation.toolCallId);
    byTool.set(observation.toolCallId, previous === undefined ? observation : null);
  }
  let joined: SessionToolCallItem[] | undefined;
  for (const [index, tool] of session.toolCalls.entries()) {
    const observation = byTool.get(tool.id);
    if (!observation || tool.delegationObservation === observation ||
      (tool.childSessionId && observation.childSessionId && tool.childSessionId !== observation.childSessionId)) continue;
    const previous = tool.delegationObservation;
    if (previous && (previous.delegationId !== observation.delegationId || previous.sessionId !== observation.sessionId ||
      (previous.targetAgentId && observation.targetAgentId && previous.targetAgentId !== observation.targetAgentId))) continue;
    if (tool.arguments && observation.targetAgentId) {
      try {
        const target = JSON.parse(tool.arguments)?.target_agent_id;
        if (typeof target === 'string' && target !== observation.targetAgentId) continue;
      } catch { /* Some providers deliver arguments as text rather than JSON. */ }
    }
    const terminal = isTerminalDelegation(tool.delegationState);
    const observedTerminal = isTerminalDelegation(observation.state);
    if (terminal && observedTerminal && tool.delegationState !== observation.state) {
      // Only comparable retained truth can repair an older snapshot projection's terminal kind.
      const newer = previous && previous.state === tool.delegationState && previous.sourceEpoch === observation.sourceEpoch &&
        (previous.sessionSeq !== undefined && observation.sessionSeq !== undefined
          ? observation.sessionSeq > previous.sessionSeq
          : previous.sessionSeq === undefined && observation.sessionSeq === undefined && observation.updatedAt > previous.updatedAt);
      if (!newer) continue;
    }
    const state = observedTerminal ? observation.state : terminal ? tool.delegationState
      : observation.activity === 'historical' ? undefined : observation.state;
    const childSessionId = tool.childSessionId ?? observation.childSessionId;
    const updatedAt = terminal && !observedTerminal ? tool.delegationUpdatedAt : observation.updatedAt;
    // Nonterminal metadata cannot establish ordering for an outcome it did not support.
    const supporting = terminal && !observedTerminal ? previous : observation;
    if (tool.delegationState === state && tool.childSessionId === childSessionId &&
      tool.delegationUpdatedAt === updatedAt && tool.delegationObservation === supporting) continue;
    joined ??= session.toolCalls.slice();
    joined[index] = { ...tool, childSessionId, delegationState: state, delegationUpdatedAt: updatedAt, delegationObservation: supporting };
  }
  if (joined) session.toolCalls = joined;
  const live = (session.delegations ?? []).filter((item) => item.sessionId === session.sessionId && item.activity === 'live');
  session.dependencyLabel = live.some((item) => item.stage === 'verifying') ? 'Verifying delegate result'
    : live.some((item) => item.stage === 'finalizing') ? 'Finalizing delegate result'
    : live.some((item) => item.stage === 'cancel_requested') ? 'Delegate cancellation requested'
    : live.length ? `${live.length} delegate${live.length === 1 ? '' : 's'} active` : null;
}

function updateToolActivity(session: ActiveSessionViewModel): void {
  const active = getActiveSessionTools(session);
  session.activeToolCallId = active[0]?.id ?? null;
  session.runState = active.length ? 'tool-running' : 'streaming';
  session.activityLabel = active.length > 1 ? `Running ${active.length} tools`
    : active[0] ? `Running tool: ${active[0].title}` : 'Continuing reply...';
  session.lastError = null;
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
    canonical.childSessionId = canonical.childSessionId ?? duplicate.childSessionId;
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

function mergeToolResult(tool: SessionToolCallItem, status: SessionToolCallItem['status'] | undefined, output: unknown): void {
  const terminal = status !== undefined && isTerminalToolStatus(status);
  // A real terminal result supersedes a provisional interruption error.
  tool.result = stringifyToolContent(output) ?? (terminal && tool.isError ? null : tool.result);
  if (terminal) tool.isError = status === 'failed';
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
      if (item.timestampMs !== undefined) previous.endedAtMs = item.timestampMs;
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
        eventIndex: item.eventIndex,
        startedAtMs: item.timestampMs,
        endedAtMs: item.timestampMs
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

export function readReasoningPartId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Record<string, unknown>;
  const direct = readString(root.reasoning_part_id) ?? readString(root.reasoningPartId);
  if (direct) return direct;

  for (const key of ['_meta', 'metadata', 'querymt', 'content'] as const) {
    const nested = root[key];
    if (nested && typeof nested === 'object' && nested !== value) {
      const partId = readReasoningPartId(nested);
      if (partId) return partId;
    }
  }
  return null;
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

export function applyDelegationChildSession(
  current: ActiveSessionViewModel,
  update: {
    sessionId?: string | null;
    session_id?: string | null;
    toolCallId?: string | null;
    tool_call_id?: string | null;
    childSessionId?: string | null;
    child_session_id?: string | null;
    state?: SessionToolCallItem['delegationState'];
    updatedAt?: number;
    delegationId?: string;
    stage?: DelegationUpdateNotification['stage'];
    activity?: DelegationUpdateNotification['activity'];
    sessionSeq?: number;
    sourceEpoch?: string;
  }
): ActiveSessionViewModel {
  const sessionId = readNonEmptyString(update.sessionId) ?? readNonEmptyString(update.session_id);
  const toolCallId = readNonEmptyString(update.toolCallId) ?? readNonEmptyString(update.tool_call_id);
  const childSessionId = readNonEmptyString(update.childSessionId) ?? readNonEmptyString(update.child_session_id);
  if (sessionId && current.sessionId && sessionId !== current.sessionId) return current;
  if (update.delegationId) {
    const next = { ...current, delegations: mergeDelegationActivity(current.delegations ?? [], [update as DelegationUpdateNotification]) };
    projectDelegationActivity(next);
    return next;
  }
  if (!toolCallId) return current;
  // A partial/ID-only extension must not bypass a canonical observation's identity/order gates.
  if (current.delegations?.some((item) => item.sessionId === current.sessionId && item.toolCallId === toolCallId)) return current;

  const target = current.toolCalls.find((tool) => tool.id === toolCallId);
  if (!target) return current;
  const state = ['requested', 'forked', 'completed', 'failed', 'cancelled'].includes(update.state ?? '')
    ? update.state : undefined;
  const updatedAt = typeof update.updatedAt === 'number' && Number.isFinite(update.updatedAt) ? update.updatedAt : undefined;
  const terminal = ['completed', 'failed', 'cancelled'].includes(target.delegationState ?? '');
  const stale = target.delegationUpdatedAt !== undefined && (updatedAt === undefined || updatedAt < target.delegationUpdatedAt);
  const acceptState = state && !terminal && !stale && !(target.delegationState === 'forked' && state === 'requested');
  const hasLifecycleUpdate = state !== undefined || updatedAt !== undefined;
  const acceptChildSessionId = childSessionId && (!hasLifecycleUpdate || !stale);
  const patch = {
    childSessionId: acceptChildSessionId ? childSessionId : target.childSessionId,
    delegationState: acceptState ? state : target.delegationState,
    delegationUpdatedAt: acceptState ? updatedAt : target.delegationUpdatedAt
  };
  if (target.childSessionId === patch.childSessionId && target.delegationState === patch.delegationState &&
    target.delegationUpdatedAt === patch.delegationUpdatedAt) return current;
  return { ...current, toolCalls: current.toolCalls.map((tool) => tool.id === toolCallId ? { ...tool, ...patch } : tool) };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

/**
 * Fills context metrics missing on `target` from an older `source` model. Used
 * after a session load picks one history source (replay, snapshot, or live) so
 * context data captured by the losing candidates is not dropped: replay may
 * miss `usage_update` while the load snapshot already knows the context
 * window. Present values always win, later live or drained `usage_update`
 * notifications keep overriding, and active-work timers are never merged.
 *
 * Accounting is only copied when the target has never received a payload.
 * A received payload, including one whose `completeTotalUsd` is an explicit
 * `null`, is authoritative and is never refilled from an older candidate.
 */
export function mergeMissingSessionUsage(target: ActiveSessionViewModel, source: ActiveSessionViewModel): void {
  target.usage.breakdown ??= source.usage.breakdown;
  if (target.usage.contextUsed === null && source.usage.contextUsed !== null) {
    target.usage.contextUsed = source.usage.contextUsed;
  }
  if (target.usage.contextLimit === null && source.usage.contextLimit !== null) {
    target.usage.contextLimit = source.usage.contextLimit;
  }
  if (target.usage.accounting === undefined && source.usage.accounting !== undefined) {
    target.usage.accounting = source.usage.accounting;
  }
  // Only displayed while no accounting exists, so filling it cannot
  // resurrect a cleared QueryMT total.
  if (target.usage.standardCostUsd === null && source.usage.standardCostUsd !== null) {
    target.usage.standardCostUsd = source.usage.standardCostUsd;
  }
}

/**
 * A present `_meta.querymt.accounting` payload replaces accounting state
 * atomically (explicit nulls included); an absent or malformed payload does
 * not touch it. Standard ACP `cost` is tracked separately in
 * `standardCostUsd` and is only displayed for sessions without accounting
 * (non-QueryMT or older QueryMT agents); its omission is not a clearing
 * signal.
 */
function applyAccountingMeta(session: ActiveSessionViewModel, meta: unknown): void {
  const accounting = readAccountingMeta(meta);
  if (accounting) session.usage.accounting = accounting;
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
