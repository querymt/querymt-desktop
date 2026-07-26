import { describe, expect, it, vi } from 'vitest';
import {
  QMT_METHOD_SESSION_REDO,
  QMT_METHOD_SESSION_UNDO,
  QMT_METHOD_SESSION_UNDO_STACK,
  QuerymtExtensions,
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
