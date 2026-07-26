import { describe, expect, it } from 'vitest';
import type { ActiveSessionViewModel } from './types';
import { buildSessionConversation } from './session-conversation';
import { activeSessionFromLoadResponse, getSnapshotProviderChange, normalizeHistoricalSession } from './session-snapshot';

describe('getSnapshotProviderChange', () => {
  it('returns the last valid provider change including its mesh node', () => {
    const change = getSnapshotProviderChange({
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                kind: {
                  type: 'provider_changed',
                  data: { provider: 'anthropic', model: 'claude-3-5' }
                }
              },
              {
                kind: {
                  type: 'provider_changed',
                  data: { provider: 'openrouter', model: 'claude-sonnet-4', provider_node_id: 'node-1' }
                }
              }
            ]
          }
        }
      }
    });

    expect(change).toEqual({
      provider: 'openrouter',
      model: 'claude-sonnet-4',
      providerNodeId: 'node-1'
    });
  });

  it('skips malformed provider changes and returns null when none are valid', () => {
    expect(
      getSnapshotProviderChange({
        _meta: {
          'querymt/sessionLoadSnapshot.v1': {
            audit: {
              events: [
                { kind: { type: 'provider_changed', data: { provider: 'anthropic' } } },
                { kind: { type: 'assistant_message_stored', data: { content: 'done' } } }
              ]
            }
          }
        }
      })
    ).toBeNull();
  });
});

describe('activeSessionFromLoadResponse', () => {
  it('restores context, cumulative cost, and completed active work from QueryMT snapshots', () => {
    const session = activeSessionFromLoadResponse('session-usage', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                timestamp: 100,
                kind: {
                  type: 'provider_changed',
                  data: { provider: 'anthropic', model: 'claude-sonnet-4', context_limit: 200_000 }
                }
              },
              { seq: 2, timestamp: 110, kind: { type: 'llm_request_start', data: { message_count: 2 } } },
              {
                seq: 3,
                timestamp: 125,
                kind: {
                  type: 'llm_request_end',
                  data: { context_tokens: 48_000, cumulative_cost_usd: 0.125 }
                }
              },
              { seq: 4, timestamp: 130, kind: { type: 'llm_request_start', data: { message_count: 4 } } },
              { seq: 5, timestamp: 138, kind: { type: 'cancelled', data: {} } }
            ]
          }
        }
      }
    });

    expect(session.usage).toEqual({
      contextUsed: 48_000,
      contextLimit: 200_000,
      cumulativeCostUsd: 0.125,
      activeWorkMs: 23_000,
      activeWorkStartedAt: null
    });
  });

  it('does not count incomplete historical work spans as wall-clock session age', () => {
    const session = activeSessionFromLoadResponse('session-usage', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [{ seq: 1, timestamp: 100, kind: { type: 'llm_request_start', data: {} } }]
          }
        }
      }
    });

    expect(session.usage.activeWorkMs).toBe(0);
    expect(session.usage.activeWorkStartedAt).toBeNull();
  });

  it('hydrates assistant messages and tool calls from QueryMT load snapshots', () => {
    const session = activeSessionFromLoadResponse('session-1', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                kind: { type: 'prompt_received', data: { message_id: 'u1', content: 'read file' } }
              },
              {
                seq: 2,
                kind: { type: 'assistant_message_stored', data: { message_id: 'a1', content: 'I read it.' } }
              },
              {
                seq: 3,
                kind: {
                  type: 'tool_call_start',
                  data: { tool_call_id: 't1', tool_name: 'read_tool', assistant_message_id: 'a1', arguments: '{"path":"README.md"}' }
                }
              },
              {
                seq: 4,
                kind: {
                  type: 'tool_call_end',
                  data: { tool_call_id: 't1', tool_name: 'read_tool', assistant_message_id: 'a1', result: 'contents', is_error: false }
                }
              }
            ]
          }
        }
      }
    });

    expect(session.transcript).toHaveLength(2);
    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({
      id: 't1',
      title: 'read_tool',
      status: 'completed',
      messageId: 'a1',
      arguments: '{"path":"README.md"}',
      result: 'contents'
    });
  });

  it('hydrates stored assistant thinking as reasoning from QueryMT load snapshots', () => {
    const session = activeSessionFromLoadResponse('session-1', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                kind: { type: 'prompt_received', data: { message_id: 'u1', content: 'plan the fix' } }
              },
              {
                seq: 2,
                kind: {
                  type: 'assistant_message_stored',
                  data: { message_id: 'a1', content: 'I have a plan.', thinking: '**Planning tests** and implementation steps.' }
                }
              }
            ]
          }
        }
      }
    });

    expect(session.transcript).toEqual([
      expect.objectContaining({ kind: 'user_message_chunk', messageId: 'u1', text: 'plan the fix' }),
      expect.objectContaining({ kind: 'agent_thought_chunk', messageId: 'a1', text: '**Planning tests** and implementation steps.' }),
      expect.objectContaining({ kind: 'agent_message_chunk', messageId: 'a1', text: 'I have a plan.' })
    ]);

    const turns = buildSessionConversation(session);
    expect(turns).toHaveLength(1);
    expect(turns[0].content.map((item) => item.type)).toEqual(['reasoning', 'assistant']);
    expect(turns[0].content[0]).toMatchObject({ type: 'reasoning', html: expect.stringContaining('Planning tests') });
    expect(turns[0].content[1]).toMatchObject({ type: 'assistant', html: expect.stringContaining('I have a plan.') });
  });

  it('hydrates reasoning-only stored assistant messages without empty assistant output', () => {
    const session = activeSessionFromLoadResponse('session-1', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                kind: { type: 'prompt_received', data: { message_id: 'u1', content: 'think only' } }
              },
              {
                seq: 2,
                kind: {
                  type: 'assistant_message_stored',
                  data: { message_id: 'a1', content: '', thinking: 'Need inspect existing session hydration.' }
                }
              }
            ]
          }
        }
      }
    });

    expect(session.transcript).toEqual([
      expect.objectContaining({ kind: 'user_message_chunk', messageId: 'u1' }),
      expect.objectContaining({ kind: 'agent_thought_chunk', messageId: 'a1', text: 'Need inspect existing session hydration.' })
    ]);
    expect(session.transcript.some((item) => item.kind === 'agent_message_chunk')).toBe(false);

    const turns = buildSessionConversation(session);
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toEqual([expect.objectContaining({ type: 'reasoning' })]);
  });

  it('merges tool start and end events by tool_call_id even when the end arrives first', () => {
    const session = activeSessionFromLoadResponse('session-1', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                kind: {
                  type: 'tool_call_end',
                  data: { tool_call_id: 't-42', tool_name: 'read_tool', assistant_message_id: 'a1', result: 'done', is_error: false }
                }
              },
              {
                seq: 2,
                kind: {
                  type: 'tool_call_start',
                  data: { tool_call_id: 't-42', tool_name: 'read_tool', assistant_message_id: 'a1', arguments: '{"path":"src/app.ts"}' }
                }
              }
            ]
          }
        }
      }
    });

    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({
      id: 't-42',
      title: 'read_tool',
      status: 'completed',
      messageId: 'a1',
      arguments: '{"path":"src/app.ts"}',
      result: 'done',
      eventIndex: 1
    });
  });

  it('marks orphaned historical tool starts as completed after later terminal session events in snapshots', () => {
    const session = activeSessionFromLoadResponse('session-1', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: {
            events: [
              {
                seq: 1,
                kind: { type: 'prompt_received', data: { message_id: 'u1', content: 'inspect repo' } }
              },
              {
                seq: 2,
                kind: {
                  type: 'tool_call_start',
                  data: { tool_call_id: 't-orphan', tool_name: 'read_tool', assistant_message_id: 'a1', arguments: '{"path":"README.md"}' }
                }
              },
              {
                seq: 3,
                kind: { type: 'assistant_message_stored', data: { message_id: 'a1', content: 'Done inspecting.' } }
              },
              {
                seq: 4,
                kind: { type: 'llm_request_end', data: { tool_calls: 1 } }
              }
            ]
          }
        }
      }
    });

    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]).toMatchObject({
      id: 't-orphan',
      status: 'completed',
      arguments: '{"path":"README.md"}'
    });
    expect(session.runState).toBe('completed');
    expect(session.activeToolCallId).toBeNull();
  });

  it('uses successful session/load completion as the terminal state for replayed history', () => {
    const session: ActiveSessionViewModel = {
      sessionId: 'session-1',
      transcript: [],
      toolCalls: [
        {
          id: 't-orphan',
          title: 'Run shell',
          status: 'in_progress',
          kind: 'execute',
          messageId: null,
          arguments: '{"command":"echo hi"}',
          eventIndex: 0
        }
      ],
      plans: [],
      events: [],
      configOptions: [],
      runState: 'tool-running',
      activityLabel: 'Running tool: Run shell',
      activeToolCallId: 't-orphan',
      lastStopReason: null,
      lastError: null,
      usage: {
        contextUsed: null,
        contextLimit: null,
        cumulativeCostUsd: null,
        activeWorkMs: 0,
        activeWorkStartedAt: null
      }
    };

    const normalized = normalizeHistoricalSession(session, { loadCompleted: true });

    expect(normalized.runState).toBe('completed');
    expect(normalized.activityLabel).toBe('Loaded from session history.');
    expect(normalized.activeToolCallId).toBeNull();
    expect(normalized.toolCalls[0]).toMatchObject({
      id: 't-orphan',
      status: 'completed',
      arguments: '{"command":"echo hi"}'
    });
  });
});
