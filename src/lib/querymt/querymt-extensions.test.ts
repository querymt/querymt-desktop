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
  const extMethod = vi.fn(async () => ({}));
  const extensions = new QuerymtExtensions({
    extMethod
  } as unknown as ClientSideConnection);
  return { extensions, extMethod };
}

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
