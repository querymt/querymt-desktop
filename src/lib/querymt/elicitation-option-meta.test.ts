import { describe, expect, it, vi } from 'vitest';
import type { AnyMessage } from '@agentclientprotocol/sdk/unstable';
import {
  hoistElicitationOptionDescriptions,
  optionDescriptionsFromMeta,
  preserveElicitationOptionDescriptionsOnStream
} from './elicitation-option-meta';

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

describe('preserveElicitationOptionDescriptionsOnStream', () => {
  it('passes non-elicitation messages through as the same objects', async () => {
    const update: AnyMessage = { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-1' } };
    const writable = new WritableStream<AnyMessage>();
    const wrapped = preserveElicitationOptionDescriptionsOnStream({
      readable: new ReadableStream<AnyMessage>({
        start(controller) {
          controller.enqueue(update);
          controller.close();
        }
      }),
      writable
    });

    const reader = wrapped.readable.getReader();
    expect((await reader.read()).value).toBe(update);
    expect((await reader.read()).done).toBe(true);
    expect(wrapped.writable).toBe(writable);
  });

  it('hoists descriptions on elicitation requests read from the stream', async () => {
    const message = elicitationMessage({ const: 'a', title: 'A', description: 'First option' });
    const wrapped = preserveElicitationOptionDescriptionsOnStream({
      readable: new ReadableStream<AnyMessage>({
        start(controller) {
          controller.enqueue(message);
          controller.close();
        }
      }),
      writable: new WritableStream<AnyMessage>()
    });

    const { value } = await wrapped.readable.getReader().read();
    expect(optionDescriptionsFromMeta((value as { params: { _meta: unknown } }).params._meta)).toEqual({
      selection: { a: 'First option' }
    });
  });

  it('propagates cancel on the wrapped readable to the source stream', async () => {
    const cancel = vi.fn(async (_reason?: unknown) => undefined);
    const wrapped = preserveElicitationOptionDescriptionsOnStream({
      readable: new ReadableStream<AnyMessage>({ cancel }),
      writable: new WritableStream<AnyMessage>()
    });

    await wrapped.readable.cancel('closing');
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('closing'));
  });
});
