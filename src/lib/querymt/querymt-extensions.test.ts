import { describe, expect, it, vi } from 'vitest';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import {
  QMT_ELICITATION_RECOVERY_VERSION,
  QMT_METHOD_ELICITATION_ATTACH_SESSION,
  QMT_METHOD_ELICITATION_LIST_PENDING,
  QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
  QuerymtExtensionResponseError,
  QuerymtExtensions,
  parseQuerymtElicitationRecoveryAuthority,
  parseQuerymtElicitationRecoveryCapability
} from './querymt-extensions';
import type { CapabilitiesInfo } from './generated/types';

function capabilitiesFixture(
  overrides: Partial<Record<string, unknown>> = {}
): CapabilitiesInfo {
  return {
    querymt_control_version: 1,
    agent: { id: 'agent-1', display_name: 'Agent', kind: 'local' },
	transport: { acp: true, stdio: false, websocket: true, mesh: false, mesh_transport: 'none' },
    features: {
      auth: true,
      models: true,
      steering: true,
      schedules: true,
      mesh: false,
      mesh_invites: false,
      remote_sessions: false,
      remote_schedules: false,
      profiles: false
    },
    methods: [
      'querymt/capabilities',
      QMT_METHOD_ELICITATION_LIST_PENDING,
      QMT_METHOD_ELICITATION_ATTACH_SESSION
    ],
    notifications: [
      QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
      'querymt/elicitation/validationFailed',
      'querymt/elicitation/completed'
    ],
    elicitation_recovery: {
      version: QMT_ELICITATION_RECOVERY_VERSION,
      authority_notification: QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
      list_pending_method: QMT_METHOD_ELICITATION_LIST_PENDING,
      attach_method: QMT_METHOD_ELICITATION_ATTACH_SESSION
    },
    ...overrides
  } as CapabilitiesInfo;
}

function extensionClient() {
  const extMethod = vi.fn(async (): Promise<unknown> => ({}));
  const extensions = new QuerymtExtensions({
    extMethod
  } as unknown as ClientSideConnection);
  return { extensions, extMethod };
}

describe('QuerymtExtensions owner profiles', () => {
  it('requires an owner-confirmed catalog instead of accepting an older proxy local list', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ profiles: [{ id: 'cdr', name: 'A coder' }] });
    await expect(extensions.profiles('B')).rejects.toThrow('Update both agents');
    extMethod.mockResolvedValueOnce({ node_id: 'B', profiles: [{ id: 'cdr', name: 'B coder' }] });
    expect((await extensions.profiles('B')).profiles[0].name).toBe('B coder');
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/profiles', { node_id: 'B' });
  });
});

describe('QuerymtExtensions elicitation recovery contract', () => {
  it('lists pending sessions with the versioned v1 wire method', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ version: 1, session_ids: ['session-a', 'session-b'] });

    const response = await extensions.listPendingElicitationSessions({
      version: 1,
      resume_authority: 'process-secret'
    });

    expect(extMethod).toHaveBeenCalledWith('_querymt/elicitation/listPendingSessions', {
      version: 1,
      resume_authority: 'process-secret'
    });
    expect(response).toEqual({ version: 1, session_ids: ['session-a', 'session-b'] });
  });

  it('attaches pending sessions with the versioned v1 wire method', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({
      version: 1,
      session_id: 'session-a',
      elicitation_ids: ['elicitation-1']
    });

    const response = await extensions.attachPendingElicitationSession({
      version: 1,
      session_id: 'session-a',
      resume_authority: 'process-secret'
    });

    expect(extMethod).toHaveBeenCalledWith('_querymt/elicitation/attachSession', {
      version: 1,
      session_id: 'session-a',
      resume_authority: 'process-secret'
    });
    expect(response).toEqual({
      version: 1,
      session_id: 'session-a',
      elicitation_ids: ['elicitation-1']
    });
  });

  it('accepts an attach response whose session_id differs from the request', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ version: 1, session_id: 'canonical-session', elicitation_ids: [] });

    await expect(
      extensions.attachPendingElicitationSession({
        version: 1,
        session_id: 'requested-session',
        resume_authority: 'process-secret'
      })
    ).resolves.toEqual({ version: 1, session_id: 'canonical-session', elicitation_ids: [] });
  });

  it.each([
    ['a missing version', { session_ids: ['session-a'] }],
    ['a wrong version', { version: 2, session_ids: ['session-a'] }],
    ['missing session_ids', { version: 1 }],
    ['non-string session ids', { version: 1, session_ids: ['session-a', 7] }],
    ['session_ids that is not an array', { version: 1, session_ids: 'session-a' }]
  ])('rejects listPendingSessions responses with %s', async (_label, payload) => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce(payload);

    await expect(
      extensions.listPendingElicitationSessions({ version: 1, resume_authority: 'process-secret' })
    ).rejects.toThrow(QuerymtExtensionResponseError);
  });

  it.each([
    ['a missing version', { session_id: 'session-a', elicitation_ids: [] }],
    ['a wrong version', { version: 2, session_id: 'session-a', elicitation_ids: [] }],
    ['a missing session_id', { version: 1, elicitation_ids: [] }],
    ['an empty session_id', { version: 1, session_id: '', elicitation_ids: [] }],
    ['non-string elicitation ids', { version: 1, session_id: 'session-a', elicitation_ids: [1] }],
    ['elicitation_ids that is not an array', { version: 1, session_id: 'session-a', elicitation_ids: 'x' }]
  ])('rejects attachSession responses with %s', async (_label, payload) => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce(payload);

    await expect(
      extensions.attachPendingElicitationSession({
        version: 1,
        session_id: 'session-a',
        resume_authority: 'process-secret'
      })
    ).rejects.toThrow(QuerymtExtensionResponseError);
  });
});

describe('parseQuerymtElicitationRecoveryCapability', () => {
  it('accepts a complete compatible advertisement', () => {
    const capability = parseQuerymtElicitationRecoveryCapability(capabilitiesFixture());
    expect(capability).toEqual({
      version: 1,
      authority_notification: QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
      list_pending_method: QMT_METHOD_ELICITATION_LIST_PENDING,
      attach_method: QMT_METHOD_ELICITATION_ATTACH_SESSION
    });
  });

  it('returns null for legacy capabilities without the recovery field', () => {
    const { elicitation_recovery: _omitted, ...legacy } = capabilitiesFixture() as CapabilitiesInfo &
      Record<string, unknown>;
    expect(parseQuerymtElicitationRecoveryCapability(legacy)).toBeNull();
  });

  it('returns null for an unsupported contract version', () => {
    const capabilities = capabilitiesFixture({
      elicitation_recovery: {
        version: QMT_ELICITATION_RECOVERY_VERSION + 1,
        authority_notification: QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
        list_pending_method: QMT_METHOD_ELICITATION_LIST_PENDING,
        attach_method: QMT_METHOD_ELICITATION_ATTACH_SESSION
      }
    });
    expect(parseQuerymtElicitationRecoveryCapability(capabilities)).toBeNull();
  });

  it('returns null when the contract methods are not advertised', () => {
    const capabilities = capabilitiesFixture({
      methods: ['querymt/capabilities']
    });
    expect(parseQuerymtElicitationRecoveryCapability(capabilities)).toBeNull();
  });
});

describe('parseQuerymtElicitationRecoveryAuthority', () => {
  it('accepts a well-formed authority notification', () => {
    expect(
      parseQuerymtElicitationRecoveryAuthority({
        version: 1,
        session_id: 'session-1',
        resume_authority: 'process-secret'
      })
    ).toEqual({ version: 1, session_id: 'session-1', resume_authority: 'process-secret' });
  });

  it.each([
    ['null payload', null],
    ['wrong version', { version: 2, session_id: 's', resume_authority: 'secret' }],
    ['empty session id', { version: 1, session_id: '', resume_authority: 'secret' }],
    ['missing secret', { version: 1, session_id: 'session-1' }]
  ])('rejects %s', (_label, params) => {
    expect(parseQuerymtElicitationRecoveryAuthority(params)).toBeNull();
  });
});

describe('QuerymtExtensions session lifecycle', () => {
  describe.each(['getSessionLifecycle', 'setSessionLifecycle'] as const)('%s validation', (method) => {
    const wireMethod = method === 'getSessionLifecycle' ? 'querymt/session/getLifecycle' : 'querymt/session/setLifecycle';
    const lifecycle = { session_id: 'session-a', resolved: false, archived: false, resolved_at: null, archived_at: null };

    it('accepts authoritative state with null timestamps', async () => {
      const { extensions, extMethod } = extensionClient();
      extMethod.mockResolvedValueOnce(lifecycle);
      await expect(extensions[method]('session-a', { resolved: false })).resolves.toEqual(lifecycle);
    });

    it.each([
      ['null', null],
      ['missing flags', { session_id: 'session-a' }],
      ['a different session', { ...lifecycle, session_id: 'other-session' }],
      ['a non-boolean resolved flag', { ...lifecycle, resolved: 'false' }],
      ['a non-boolean archived flag', { ...lifecycle, archived: 0 }]
    ])('rejects %s with a method-specific response error', async (_label, payload) => {
      const { extensions, extMethod } = extensionClient();
      extMethod.mockResolvedValueOnce(payload);
      await expect(extensions[method]('session-a', { resolved: true }))
        .rejects.toEqual(new QuerymtExtensionResponseError(wireMethod));
    });
  });

  it('uses the exact wire names and sends only the requested independent patch', async () => {
    const { extensions, extMethod } = extensionClient();
    const lifecycle = { session_id: 'session-a', resolved: true, archived: false, resolved_at: '2026-10-18T00:00:00Z', archived_at: null };
    extMethod.mockResolvedValue(lifecycle);
    expect(await extensions.getSessionLifecycle('session-a')).toEqual(lifecycle);
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/session/getLifecycle', { session_id: 'session-a' });
    expect(await extensions.setSessionLifecycle('session-a', { resolved: false })).toEqual(lifecycle);
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/session/setLifecycle', { session_id: 'session-a', resolved: false });
    expect(await extensions.setSessionLifecycle('session-a', { archived: true })).toEqual(lifecycle);
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/session/setLifecycle', { session_id: 'session-a', archived: true });
  });
});

describe('QuerymtExtensions session pins', () => {
  it('uses the exact wire contract with an explicit desired state, not a local toggle', async () => {
    const { extensions, extMethod } = extensionClient();
    const pin = { session_id: 'session-a', pinned: true, pinned_at: '2026-10-20T10:00:00Z' };
    extMethod.mockResolvedValueOnce(pin);
    expect(await extensions.setSessionPinned('session-a', true)).toEqual(pin);
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/session/setPinned', { session_id: 'session-a', pinned: true });
    await extensions.setSessionPinned('session-a', false);
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/session/setPinned', { session_id: 'session-a', pinned: false });
  });
});

describe('QuerymtExtensions worktrees', () => {
  it('uses the exact wire methods and payloads', async () => {
    const { extensions, extMethod } = extensionClient();
    await extensions.worktreeCreate({ cwd: '/p', source_session_id: 's', include_local_changes: true });
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/worktree/create', { cwd: '/p', source_session_id: 's', include_local_changes: true });
    await extensions.worktreeHandoff({ session_id: 's', summary: true });
    expect(extMethod).toHaveBeenLastCalledWith('_querymt/worktree/handoff', { session_id: 's', summary: true });
  });
});

describe('QuerymtExtensions control methods', () => {
  it('fetches profiles through the profiles method', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ profiles: [{ id: 'p1', name: 'Profile' }], active_profile_id: 'p1' });

    await expect(extensions.profiles()).resolves.toEqual({
      profiles: [{ id: 'p1', name: 'Profile' }],
      active_profile_id: 'p1'
    });
    expect(extMethod).toHaveBeenCalledWith('_querymt/profiles', {});
  });

  it('fetches and normalizes models from enveloped and direct payloads', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ type: 'ok', data: { models: [{ id: 'm1' }] }, meta: { stale: true } });

    await expect(extensions.models()).resolves.toEqual({ models: [{ id: 'm1' }], meta: { stale: true } });
    expect(extMethod).toHaveBeenCalledWith('_querymt/models', {});

    extMethod.mockResolvedValueOnce({ models: [{ id: 'm2' }] });
    await expect(extensions.models()).resolves.toEqual({ models: [{ id: 'm2' }] });
  });

  it.each([false, true])('carries per-node availability into models without changing identity (envelope=%s)', async (enveloped) => {
    const { extensions, extMethod } = extensionClient();
    const local = { id: 'codex/shared', provider: 'codex', model: 'shared' };
    const remote = { ...local, node_id: 'B' };
    const other = { ...local, node_id: 'C' };
    const models = [local, remote, other];
    const meta = { remote_node_availability: { B: 'unavailable', C: 'available' } };
    extMethod.mockResolvedValueOnce(enveloped ? { data: { models }, meta } : { models, meta });
    await expect(extensions.models()).resolves.toEqual({ models: [local, { ...remote, availability: 'unavailable' }, { ...other, availability: 'available' }], meta });
    expect(remote).not.toHaveProperty('availability');
    extMethod.mockResolvedValueOnce({ models, meta: { remote_node_availability: { B: 'available', C: 'unknown' } } });
    const recovered = await extensions.refreshModels();
    expect(recovered.models[1]).toEqual({ ...remote, availability: 'available' });
    expect(recovered.models[2]).toEqual({ ...other, availability: 'unknown' });
    extMethod.mockResolvedValueOnce({ models });
    expect((await extensions.models()).models).toEqual(models);
    extMethod.mockResolvedValueOnce({ models, meta: { remote_node_availability: { B: 'invalid', '': 'unavailable' } } });
    expect((await extensions.models()).models).toEqual(models);
  });

  it.each(['models', 'refreshModels'] as const)('merges both metadata levels and node maps for %s', async (method) => {
    const { extensions, extMethod } = extensionClient();
    const model = { id: 'codex/shared', provider: 'codex', model: 'shared' };
    extMethod.mockResolvedValueOnce({
      meta: { stale: true, refresh_in_progress: true, remote_node_availability: { A: 'unavailable', B: 'unavailable' } },
      data: {
        models: ['A', 'B', 'C'].map((node_id) => ({ ...model, node_id })),
        meta: { stale: false, remote_node_count: 3, remote_node_availability: { B: 'available', C: 'unknown' } }
      }
    });
    await expect(extensions[method]()).resolves.toEqual({
      models: ['unavailable', 'available', 'unknown'].map((availability, index) => ({ ...model, node_id: ['A', 'B', 'C'][index], availability })),
      meta: { stale: false, refresh_in_progress: true, remote_node_count: 3,
        remote_node_availability: { A: 'unavailable', B: 'available', C: 'unknown' } }
    });
    extMethod.mockResolvedValueOnce({ data: { models: [{ ...model, node_id: 'A' }], meta: {} },
      meta: { remote_node_availability: { A: 'unavailable' } } });
    expect((await extensions[method]()).models[0].availability).toBe('unavailable');
  });

  it('fetches model info and folds flat wire fields into capabilities', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({
      models: {
        'prov/model': { id: 'model', name: 'Model', attachment: true, limit: { context: 128 }, cost: { input: 1 } },
        'prov/missing': null
      }
    });

    await expect(extensions.modelInfo([{ provider: 'prov', model: 'model' }])).resolves.toEqual({
      models: {
        'prov/model': {
          id: 'model',
          name: 'Model',
          capabilities: { attachment: true },
          limits: { context: 128 },
          pricing: { input: 1 }
        },
        'prov/missing': null
      }
    });
    expect(extMethod).toHaveBeenCalledWith('_querymt/modelInfo', { models: [{ provider: 'prov', model: 'model' }] });
  });

  it('steers and queues session input through turn-control methods', async () => {
    const { extensions, extMethod } = extensionClient();
    const request = {
      session_id: 'session-1',
      prompt: [{ type: 'text', text: 'go' }],
      client_input_id: 'input-1'
    };
    extMethod.mockResolvedValueOnce({ status: 'accepted' });
    extMethod.mockResolvedValueOnce({ status: 'queued' });

    await expect(extensions.steerSession(request as never)).resolves.toEqual({ status: 'accepted' });
    await expect(extensions.queueSession(request as never)).resolves.toEqual({ status: 'queued' });
    expect(extMethod).toHaveBeenNthCalledWith(1, '_querymt/session/steer', request);
    expect(extMethod).toHaveBeenNthCalledWith(2, '_querymt/session/queue', request);
  });

  it('discards queued input and reads session runtime state', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ discarded: true });
    extMethod.mockResolvedValueOnce({ state: 'idle' });

    await expect(extensions.discardQueuedInput('session-1', 'input-1')).resolves.toEqual({ discarded: true });
    await expect(extensions.sessionRuntimeState('session-1')).resolves.toEqual({ state: 'idle' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/discardQueuedInput', {
      session_id: 'session-1',
      input_id: 'input-1'
    });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/runtimeState', { session_id: 'session-1' });
  });

  it('reads the undo stack, undoes a message, and redoes', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ undo_stack: [{ message_id: 'm1' }] });
    extMethod.mockResolvedValueOnce({ success: true, message_id: 'm1', reverted_files: ['a.ts'], undo_stack: [] });
    extMethod.mockResolvedValueOnce({ success: true, restored: true, undo_stack: [] });

    await expect(extensions.undoStack('session-1')).resolves.toEqual({ undo_stack: [{ message_id: 'm1' }] });
    await expect(extensions.undoSession('session-1', 'm1')).resolves.toEqual({
      success: true,
      message_id: 'm1',
      reverted_files: ['a.ts'],
      undo_stack: []
    });
    await expect(extensions.redoSession('session-1')).resolves.toEqual({ success: true, restored: true, undo_stack: [] });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/undoStack', { session_id: 'session-1' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/undo', { session_id: 'session-1', message_id: 'm1' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/redo', { session_id: 'session-1' });
  });

  it('fetches delegate assignments and assigns delegate models', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({
      version: 1,
      reasoning_effort_supported: true,
      assignments: [{ delegate: 'reviewer', model: 'gpt' }],
      orphaned_overrides: []
    });
    extMethod.mockResolvedValueOnce({ version: 1, success: true });

    await expect(extensions.delegateModels({ session_id: 'session-1' } as never)).resolves.toEqual({
      version: 1,
      reasoning_effort_supported: true,
      assignments: [{ delegate: 'reviewer', model: 'gpt' }],
      orphaned_overrides: []
    });
    await expect(
      extensions.setDelegateModel({ session_id: 'session-1', delegate: 'reviewer', model: 'gpt' } as never)
    ).resolves.toEqual({ version: 1, success: true });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/delegateModels', { session_id: 'session-1' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/session/setDelegateModel', {
      session_id: 'session-1',
      delegate: 'reviewer',
      model: 'gpt'
    });
  });

  it('performs auth status and mutations through the auth methods', async () => {
    const { extensions, extMethod } = extensionClient();
    extMethod.mockResolvedValueOnce({ providers: [{ provider: 'prov', status: 'signed_in' }] });

    await expect(extensions.authStatus()).resolves.toEqual({
      providers: [{ provider: 'prov', status: 'signed_in' }]
    });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/status', {});

    const authResult = { provider: 'prov', success: true };
    extMethod.mockResolvedValue(authResult);
    await expect(extensions.startAuth('prov')).resolves.toEqual(authResult);
    await expect(extensions.completeAuth('flow-1', 'code')).resolves.toEqual(authResult);
    await expect(extensions.logoutAuth('prov')).resolves.toEqual(authResult);
    await expect(extensions.setApiToken('prov', 'token')).resolves.toEqual(authResult);
    await expect(extensions.clearApiToken('prov')).resolves.toEqual(authResult);
    await expect(extensions.setAuthMethod('prov', 'api_key' as never)).resolves.toEqual(authResult);
    await expect(extensions.updatePlugins()).resolves.toEqual({ results: [] });

    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/start', { provider: 'prov' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/complete', { flow_id: 'flow-1', response: 'code' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/logout', { provider: 'prov' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/setApiToken', { provider: 'prov', api_key: 'token' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/clearApiToken', { provider: 'prov' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/auth/setMethod', { provider: 'prov', method: 'api_key' });
    expect(extMethod).toHaveBeenCalledWith('_querymt/updatePlugins', {});
  });
});
