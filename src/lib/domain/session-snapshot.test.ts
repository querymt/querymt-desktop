import { describe, expect, it } from 'vitest';
import type { ActiveSessionViewModel } from './types';
import { activeSessionFromLoadResponse, normalizeHistoricalSession } from './session-snapshot';

describe('activeSessionFromLoadResponse', () => {
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
      lastError: null
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
