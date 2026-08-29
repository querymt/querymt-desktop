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
  it('prefers structured v1 user prompts and restores native/resource attachments', () => {
    const session = activeSessionFromLoadResponse('session-structured', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          user_prompt_records: [
            {
              message_id: 'u1',
              event_index: 1,
              content_blocks: [
                { type: 'image', data: 'aW1n', mimeType: 'image/png', _meta: { querymt: { filename: 'first.png' } } },
                { type: 'text', text: 'Review these' },
                { type: 'resource', resource: { uri: 'attachment:///f/notes.txt', blob: 'dGV4dA==', mimeType: 'text/plain' }, _meta: { querymt: { filename: 'notes.txt', size: 4 } } }
              ]
            }
          ],
          audit: { events: [{ seq: 1, kind: { type: 'prompt_received', data: { message_id: 'u1', content: 'lossy fallback' } } }] }
        }
      }
    });

    expect(session.transcript).toHaveLength(1);
    expect(session.transcript[0]).toMatchObject({ messageId: 'u1', text: 'Review these', eventIndex: 1 });
    expect(session.transcript[0].blocks?.map((block) => block.type)).toEqual(['image', 'text', 'resource']);
    expect(session.transcript[0].blocks?.[0]).toMatchObject({ type: 'image', name: 'first.png', data: 'aW1n' });
    expect(session.transcript[0].blocks?.[2]).toMatchObject({ type: 'resource', name: 'notes.txt', size: 4 });
  });

  it('restores actual backend-shaped prompts at matching audit sequences without using messageOrder as event order', () => {
    const session = activeSessionFromLoadResponse('session-backend-wire', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          userPrompts: [
            {
              messageId: 'user-2',
              messageOrder: 2,
              timestamp: 1710000020,
              blocks: [
                { type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg', _meta: { querymt: { filename: 'second.jpg' } } }
              ]
            },
            {
              messageId: 'user-1',
              messageOrder: 1,
              timestamp: 1710000000,
              blocks: [
                { type: 'text', text: 'first' },
                { type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png', _meta: { querymt: { filename: 'first.png' } } }
              ]
            }
          ],
          audit: {
            events: [
              { seq: 10, kind: { type: 'prompt_received', data: { message_id: 'user-1', content: 'lossy first' } } },
              {
                seq: 11,
                kind: {
                  type: 'tool_call_start',
                  data: { tool_call_id: 'tool-1', tool_name: 'inspect', assistant_message_id: 'assistant-1', arguments: '{}' }
                }
              },
              {
                seq: 12,
                kind: {
                  type: 'tool_call_end',
                  data: { tool_call_id: 'tool-1', tool_name: 'inspect', assistant_message_id: 'assistant-1', result: 'done' }
                }
              },
              { seq: 13, kind: { type: 'assistant_message_stored', data: { message_id: 'assistant-1', content: 'first answer' } } },
              { seq: 20, kind: { type: 'prompt_received', data: { message_id: 'user-2', content: 'lossy second' } } },
              { seq: 21, kind: { type: 'assistant_message_stored', data: { message_id: 'assistant-2', content: 'second answer' } } }
            ]
          }
        }
      }
    });

    expect(session.transcript.map((item) => [item.messageId, item.eventIndex])).toEqual([
      ['user-1', 10],
      ['assistant-1', 13],
      ['user-2', 20],
      ['assistant-2', 21]
    ]);
    expect(session.transcript.find((item) => item.messageId === 'user-1')?.blocks).toEqual([
      { type: 'text', text: 'first' },
      expect.objectContaining({ type: 'image', data: 'Zmlyc3Q=', mimeType: 'image/png', name: 'first.png' })
    ]);
    expect(session.transcript.find((item) => item.messageId === 'user-2')?.blocks).toEqual([
      expect.objectContaining({ type: 'image', data: 'c2Vjb25k', mimeType: 'image/jpeg', name: 'second.jpg' })
    ]);

    const turns = buildSessionConversation(session);
    expect(turns.map((turn) => turn.user?.messageId)).toEqual(['user-1', 'user-2']);
    expect(turns[0].content.map((item) => item.id)).toEqual(['tool-1', 'snapshot-13']);
    expect(turns[1].content.map((item) => item.id)).toEqual(['snapshot-21']);
    expect(turns[1].user).toMatchObject({ text: '', eventIndex: 20 });
    expect(turns[1].user?.blocks?.[0]).toMatchObject({ type: 'image', name: 'second.jpg' });
  });

  it('materializes a structured prompt only once when duplicate prompt_received events are present', () => {
    const session = activeSessionFromLoadResponse('session-duplicate-prompt-event', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          userPrompts: [
            { messageId: 'user-1', messageOrder: 1, timestamp: 1710000000, blocks: [{ type: 'text', text: 'once' }] }
          ],
          audit: {
            events: [
              { seq: 4, kind: { type: 'prompt_received', data: { message_id: 'user-1', content: 'lossy' } } },
              { seq: 5, kind: { type: 'prompt_received', data: { message_id: 'user-1', content: 'duplicate' } } }
            ]
          }
        }
      }
    });

    expect(session.transcript).toEqual([
      expect.objectContaining({ messageId: 'user-1', text: 'once', eventIndex: 4 })
    ]);
  });

  it('appends unmatched structured prompts in deterministic history order without journal indexes', () => {
    const session = activeSessionFromLoadResponse('session-unmatched', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          userPrompts: [
            { messageId: 'later', messageOrder: 9, timestamp: 200, blocks: [{ type: 'text', text: 'later' }] },
            { messageId: 'earlier', messageOrder: 4, timestamp: 100, blocks: [{ type: 'text', text: 'earlier' }] }
          ]
        }
      }
    });

    expect(session.transcript.map((item) => ({ messageId: item.messageId, eventIndex: item.eventIndex }))).toEqual([
      { messageId: 'earlier', eventIndex: undefined },
      { messageId: 'later', eventIndex: undefined }
    ]);
  });

  it('degrades malformed historical images to an unavailable preview', () => {
    const session = activeSessionFromLoadResponse('session-malformed', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          userPrompts: [{ messageId: 'u1', content: [{ type: 'image', data: 42, mimeType: 'image/png' }] }]
        }
      }
    });
    expect(session.transcript[0].blocks?.[0]).toMatchObject({ type: 'image', data: null, unavailable: true });
  });

  it('reads legacy resource content arrays from prompt audit events', () => {
    const session = activeSessionFromLoadResponse('legacy-resource', {
      _meta: {
        'querymt/sessionLoadSnapshot.v1': {
          audit: { events: [{ seq: 1, kind: { type: 'prompt_received', data: { message_id: 'u1', content: [{ type: 'resource', resource: { uri: 'attachment:///old/image.png', blob: 'b2xk', mimeType: 'image/png' } }] } } }] }
        }
      }
    });
    expect(session.transcript[0].blocks?.[0]).toMatchObject({ type: 'image', data: 'b2xk', mimeType: 'image/png' });
  });

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
      },
      undo: {
        stack: [],
        pendingOperation: null,
        lastRevertedFiles: [],
        lastMessage: null
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
