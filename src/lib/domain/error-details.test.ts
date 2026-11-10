import { RequestError } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { describeError } from './error-details';

describe('describeError', () => {
  it('adds the agent reason from data.error to the summary', () => {
    const error = new RequestError(-32602, 'Invalid params', { error: 'missing field `type`' });
    const report = describeError(error, 'Failed', { stage: 'create schedule' });

    expect(report.summary).toBe('Invalid params: missing field `type`');
    const parsed = JSON.parse(report.details);
    expect(parsed.stage).toBe('create schedule');
    expect(parsed.error).toMatchObject({ name: 'RequestError', code: -32602, message: 'Invalid params', data: { error: 'missing field `type`' } });
  });

  it('does not repeat a reason the message already contains', () => {
    const error = new RequestError(-32602, 'Invalid params: bad cron', { message: 'bad cron' });
    expect(describeError(error, 'Failed').summary).toBe('Invalid params: bad cron');
  });

  it('handles plain errors, strings and unknown values', () => {
    expect(describeError(new Error('boom'), 'Failed').summary).toBe('boom');
    expect(describeError(undefined, 'Failed').summary).toBe('Failed');
    expect(describeError(new RequestError(-32603, 'Internal error', 'disk full'), 'Failed').summary).toBe('Internal error: disk full');
    expect(JSON.parse(describeError('nope', 'Failed').details).error.name).toBe('string');
  });
});
