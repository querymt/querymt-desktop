import { describe, expect, it } from 'vitest';
import type { CreateElicitationRequest, ElicitationSchema } from '@agentclientprotocol/sdk';
import { buildElicitationResponse, mapElicitationRequestToInboxItem } from './inbox';

function request(requestedSchema: ElicitationSchema, querymtMeta?: Record<string, unknown>): CreateElicitationRequest {
  return {
    mode: 'form',
    sessionId: 'session-1',
    message: 'Choose environments',
    requestedSchema,
    ...(querymtMeta ? { _meta: { querymt: querymtMeta } } : {})
  };
}

describe('elicitation inbox mapping', () => {
  it('maps ACP oneOf and anyOf options', () => {
    const item = mapElicitationRequestToInboxItem(
      request({
        type: 'object',
        properties: {
          target: {
            type: 'string',
            oneOf: [
              {
                const: 'prod',
                title: 'Production',
                description: 'Live traffic. Changes take effect immediately.'
              }
            ]
          },
          environments: {
            type: 'array',
            items: {
              anyOf: [
                { const: 'staging', title: 'Staging', description: 'Shared preview environment.' },
                { const: 'prod', title: 'Production' }
              ]
            }
          }
        },
        required: ['target', 'environments']
      }),
      'item-1'
    );

    expect(item.formFields?.[0].options).toEqual([
      {
        value: 'prod',
        label: 'Production',
        description: 'Live traffic. Changes take effect immediately.'
      }
    ]);
    expect(item.formFields?.[1].options).toEqual([
      { value: 'staging', label: 'Staging', description: 'Shared preview environment.' },
      { value: 'prod', label: 'Production' }
    ]);
  });

  it('maps option descriptions from querymt option meta and hoisted request meta', () => {
    const fromOptionMeta = mapElicitationRequestToInboxItem(
      request({
        type: 'object',
        properties: {
          selection: {
            type: 'string',
            oneOf: [
              {
                const: 'Reject unsupported setup (Recommended)',
                title: 'Reject unsupported setup (Recommended)',
                _meta: {
                  querymt: {
                    description:
                      'Return a clear construction error for a non-local planner with local delegation enabled.'
                  }
                }
              }
            ]
          }
        }
      }),
      'item-meta'
    );

    const fromRequestMeta = mapElicitationRequestToInboxItem(
      request(
        {
          type: 'object',
          properties: {
            selection: {
              type: 'string',
              oneOf: [
                {
                  const: 'Preserve remote planner support',
                  title: 'Preserve remote planner support'
                }
              ]
            }
          }
        },
        {
          optionDescriptions: {
            selection: {
              'Preserve remote planner support':
                'Pause that part for a compatible design rather than introducing a new construction error.'
            }
          }
        }
      ),
      'item-hoisted'
    );

    expect(fromOptionMeta.formFields?.[0].options).toEqual([
      {
        value: 'Reject unsupported setup (Recommended)',
        label: 'Reject unsupported setup (Recommended)',
        description: 'Return a clear construction error for a non-local planner with local delegation enabled.'
      }
    ]);
    expect(fromRequestMeta.formFields?.[0].options).toEqual([
      {
        value: 'Preserve remote planner support',
        label: 'Preserve remote planner support',
        description: 'Pause that part for a compatible design rather than introducing a new construction error.'
      }
    ]);
  });

  it('omits blank or title-identical option descriptions', () => {
    const item = mapElicitationRequestToInboxItem(
      request({
        type: 'object',
        properties: {
          target: {
            type: 'string',
            oneOf: [
              { const: 'prod', title: 'Production', description: '   ' },
              { const: 'staging', title: 'Staging', description: 'Staging' }
            ]
          }
        }
      }),
      'item-blank'
    );

    expect(item.formFields?.[0].options).toEqual([
      { value: 'prod', label: 'Production' },
      { value: 'staging', label: 'Staging' }
    ]);
  });

  it('allows custom values for built-in questions but keeps MCP enums strict', () => {
    const schema: ElicitationSchema = {
      type: 'object',
      properties: {
        selection: {
          type: 'string',
          oneOf: [{ const: 'prod', title: 'Production' }]
        }
      }
    };

    const builtIn = mapElicitationRequestToInboxItem(
      request(schema, { source: 'builtin:question' }),
      'built-in'
    );
    const mcp = mapElicitationRequestToInboxItem(request(schema, { source: 'mcp:server' }), 'mcp');
    const explicit = mapElicitationRequestToInboxItem(
      request(schema, { source: 'mcp:server', allow_custom: true }),
      'explicit'
    );

    expect(builtIn.formFields?.[0].allowCustom).toBe(true);
    expect(mcp.formFields?.[0].allowCustom).toBe(false);
    expect(explicit.formFields?.[0].allowCustom).toBe(true);
  });

  it('builds custom single and multi responses without UI sentinel values', () => {
    expect(
      buildElicitationResponse('accept', [
        {
          key: 'single',
          label: 'Single',
          kind: 'string',
          required: true,
          value: '',
          allowCustom: true,
          customActive: true,
          customValue: '  My own answer  '
        },
        {
          key: 'multiple',
          label: 'Multiple',
          kind: 'array',
          required: true,
          value: [],
          allowCustom: true,
          customActive: true,
          customValue: 'Only custom'
        }
      ])
    ).toEqual({
      action: 'accept',
      content: { single: 'My own answer', multiple: ['Only custom'] }
    });
  });

  it('builds accepted structured content from form values', () => {
    expect(
      buildElicitationResponse('accept', [
        {
          key: 'environments',
          label: 'Environments',
          kind: 'array',
          required: true,
          value: ['staging', 'prod']
        }
      ])
    ).toEqual({ action: 'accept', content: { environments: ['staging', 'prod'] } });
  });
});
