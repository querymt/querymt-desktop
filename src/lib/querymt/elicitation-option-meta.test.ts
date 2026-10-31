import { describe, expect, it } from 'vitest';
import type { AnyMessage } from '@agentclientprotocol/sdk/dist/jsonrpc.js';
import { hoistElicitationOptionDescriptions, optionDescriptionsFromMeta } from './elicitation-option-meta';

function elicitationMessage(option: Record<string, unknown>, meta?: Record<string, unknown>): AnyMessage {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'elicitation/create',
    params: {
      mode: 'form',
      sessionId: 'session-1',
      message: 'Choose a target',
      ...(meta ? { _meta: meta } : {}),
      requestedSchema: {
        type: 'object',
        properties: {
          selection: {
            type: 'string',
            oneOf: [option]
          }
        }
      }
    }
  };
}

describe('elicitation option meta', () => {
  it('hoists querymt option descriptions onto request meta before SDK parsing', () => {
    const hoisted = hoistElicitationOptionDescriptions(
      elicitationMessage(
        {
          const: 'Reject unsupported setup (Recommended)',
          title: 'Reject unsupported setup (Recommended)',
          _meta: {
            querymt: {
              description: 'Return a clear construction error for a non-local planner.'
            }
          }
        },
        { querymt: { source: 'builtin:question' } }
      )
    );

    expect(optionDescriptionsFromMeta((hoisted as { params: { _meta: unknown } }).params._meta)).toEqual({
      selection: {
        'Reject unsupported setup (Recommended)': 'Return a clear construction error for a non-local planner.'
      }
    });
    expect((hoisted as { params: { _meta: { querymt: { source: string } } } }).params._meta.querymt.source).toBe(
      'builtin:question'
    );
  });

  it('leaves unrelated messages unchanged', () => {
    const message: AnyMessage = { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1' } };
    expect(hoistElicitationOptionDescriptions(message)).toBe(message);
  });
});
