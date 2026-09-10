import { describe, expect, it, vi } from 'vitest';
import { DelegateReasoningEffort } from '$lib/querymt/generated/types';
import {
  QMT_METHOD_AUTH_CLEAR_API_TOKEN,
  QMT_METHOD_AUTH_SET_API_TOKEN,
  QMT_METHOD_AUTH_SET_METHOD,
  QMT_METHOD_SESSION_DELEGATE_MODELS,
  QMT_METHOD_SESSION_REDO,
  QMT_METHOD_SESSION_SET_DELEGATE_MODEL,
  QMT_METHOD_SESSION_UNDO,
  QMT_METHOD_SESSION_UNDO_STACK,
  QuerymtExtensions,
  normalizeQuerymtModelInfoResponse,
  normalizeQuerymtModelsResponse,
  toAcpExtensionMethod
} from './querymt-extensions';

const model = {
  id: 'anthropic/claude-sonnet-4',
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  label: 'Claude Sonnet 4'
};

describe('toAcpExtensionMethod', () => {
  it('uses the desktop ACP extension method prefix', () => {
    expect(toAcpExtensionMethod('querymt/models')).toBe('_querymt/models');
  });
});

describe('QuerymtExtensions undo and redo', () => {
  it('calls the desktop extension methods with session and message ids', async () => {
    const extMethod = vi.fn(async (method: string) => {
      if (method.endsWith('undoStack')) return { undo_stack: [{ message_id: 'm1' }] };
      if (method.endsWith('undo')) return { success: true, undo_stack: [{ message_id: 'm1' }] };
      return { success: true, restored: true, undo_stack: [] };
    });
    const extensions = new QuerymtExtensions({ extMethod } as never);

    await expect(extensions.undoStack('s1')).resolves.toEqual({ undo_stack: [{ message_id: 'm1' }] });
    await extensions.undoSession('s1', 'm1');
    await extensions.redoSession('s1');

    expect(extMethod).toHaveBeenNthCalledWith(1, toAcpExtensionMethod(QMT_METHOD_SESSION_UNDO_STACK), { session_id: 's1' });
    expect(extMethod).toHaveBeenNthCalledWith(2, toAcpExtensionMethod(QMT_METHOD_SESSION_UNDO), { session_id: 's1', message_id: 'm1' });
    expect(extMethod).toHaveBeenNthCalledWith(3, toAcpExtensionMethod(QMT_METHOD_SESSION_REDO), { session_id: 's1' });
  });
});

describe('QuerymtExtensions delegate model assignments', () => {
  it('reads and writes the versioned session assignment contract', async () => {
    const extMethod = vi.fn(async (method: string) => {
      if (method.endsWith('delegateModels')) {
        return {
          version: 1,
          reasoning_effort_supported: true,
          session_id: 's1',
          profile_id: 'quorum',
          revision: 4,
          durable: true,
          editable: true,
          assignments: [],
          orphaned_overrides: []
        };
      }
      return {
        version: 1,
        reasoning_effort_supported: true,
        session_id: 's1',
        agent_id: 'coder',
        model: { model_id: 'codex/gpt-5.6-sol' },
        reasoning_effort: 'high',
        revision: 5,
        durable: true
      };
    });
    const extensions = new QuerymtExtensions({ extMethod } as never);

    await extensions.delegateModels({ session_id: 's1' });
    await extensions.setDelegateModel({
      session_id: 's1',
      agent_id: 'coder',
      model_id: 'codex/gpt-5.6-sol',
      node_id: null,
      reasoning_effort: DelegateReasoningEffort.High,
      expected_revision: 4
    });

    expect(extMethod).toHaveBeenNthCalledWith(1, toAcpExtensionMethod(QMT_METHOD_SESSION_DELEGATE_MODELS), {
      session_id: 's1'
    });
    expect(extMethod).toHaveBeenNthCalledWith(2, toAcpExtensionMethod(QMT_METHOD_SESSION_SET_DELEGATE_MODEL), {
      session_id: 's1',
      agent_id: 'coder',
      model_id: 'codex/gpt-5.6-sol',
      node_id: null,
      reasoning_effort: 'high',
      expected_revision: 4
    });
  });

  it('accepts the older model-only version-one response shape', async () => {
    const extMethod = vi.fn(async (method: string) => method.endsWith('delegateModels')
      ? {
        version: 1,
        session_id: 's1',
        profile_id: 'quorum',
        revision: 4,
        durable: true,
        editable: true,
        assignments: [{
          agent_id: 'coder',
          name: 'Coder',
          description: 'Writes code',
          model: null,
          source: 'profile_default',
          configured_default_model_id: 'codex/gpt-5.6-sol'
        }],
        orphaned_overrides: [{ agent_id: 'removed-role', model: { model_id: 'legacy/model' } }]
      }
      : {
        version: 1,
        session_id: 's1',
        agent_id: 'removed-role',
        model: null,
        revision: 5,
        durable: true
      });
    const extensions = new QuerymtExtensions({ extMethod } as never);

    const state = await extensions.delegateModels({ session_id: 's1' });
    const response = await extensions.setDelegateModel({
      session_id: 's1',
      agent_id: 'removed-role',
      model_id: null,
      expected_revision: 4
    });

    expect(state.reasoning_effort_supported).toBeUndefined();
    expect(state.assignments[0].reasoning_effort).toBeUndefined();
    expect(state.orphaned_overrides[0].reasoning_effort).toBeUndefined();
    expect(response.reasoning_effort).toBeUndefined();
  });

  it('rejects unknown contract versions instead of guessing their meaning', async () => {
    const extMethod = vi.fn(async () => ({
      version: 2,
      session_id: 's1',
      profile_id: 'quorum',
      revision: 0,
      durable: true,
      editable: true,
      assignments: [],
      orphaned_overrides: []
    }));
    const extensions = new QuerymtExtensions({ extMethod } as never);

    await expect(extensions.delegateModels({ session_id: 's1' })).rejects.toThrow(
      'Unsupported delegate-model contract version 2'
    );
  });
});

describe('QuerymtExtensions auth token mutations', () => {
  it('calls set/clear/method with the ACP extension wire names and params', async () => {
    const extMethod = vi.fn(async () => ({ provider: 'groq', success: true, message: 'ok' }));
    const extensions = new QuerymtExtensions({ extMethod } as never);

    await extensions.setApiToken('groq', 'sk-test');
    await extensions.clearApiToken('groq');
    await extensions.setAuthMethod('groq', 'api_key' as never);

    expect(extMethod).toHaveBeenNthCalledWith(1, toAcpExtensionMethod(QMT_METHOD_AUTH_SET_API_TOKEN), {
      provider: 'groq',
      api_key: 'sk-test'
    });
    expect(extMethod).toHaveBeenNthCalledWith(2, toAcpExtensionMethod(QMT_METHOD_AUTH_CLEAR_API_TOKEN), {
      provider: 'groq'
    });
    expect(extMethod).toHaveBeenNthCalledWith(3, toAcpExtensionMethod(QMT_METHOD_AUTH_SET_METHOD), {
      provider: 'groq',
      method: 'api_key'
    });
  });
});

describe('normalizeQuerymtModelInfoResponse', () => {
  it('normalizes flattened model capabilities, limits, and pricing', () => {
    expect(
      normalizeQuerymtModelInfoResponse({
        models: {
          'xai/grok-4.6': {
            id: 'grok-4.6',
            name: 'Grok 4.6',
            attachment: true,
            reasoning: true,
            temperature: false,
            tool_call: true,
            modalities: { input: ['text', 'image'], output: ['text'] },
            limit: { context: 200000, output: 32000 },
            cost: { input: 3, output: 15 }
          }
        }
      }).models['xai/grok-4.6']
    ).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({
        attachment: true,
        modalities: { input: ['text', 'image'], output: ['text'] }
      }),
      limits: { context: 200000, output: 32000 },
      pricing: { input: 3, output: 15 }
    }));
  });

  it('preserves null entries for unknown models', () => {
    expect(normalizeQuerymtModelInfoResponse({ models: { 'custom/model': null } }).models).toEqual({
      'custom/model': null
    });
  });
});

describe('normalizeQuerymtModelsResponse', () => {
  it('supports direct model responses', () => {
    expect(normalizeQuerymtModelsResponse({ models: [model] }).models).toEqual([model]);
  });

  it('supports wrapped all_models_list responses', () => {
    expect(
      normalizeQuerymtModelsResponse({
        type: 'all_models_list',
        data: { models: [model] }
      }).models
    ).toEqual([model]);
  });
});
