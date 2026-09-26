import { describe, expect, it, vi } from 'vitest';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import {
  QMT_ELICITATION_RECOVERY_VERSION,
  QMT_METHOD_ELICITATION_ATTACH_SESSION,
  QMT_METHOD_ELICITATION_LIST_PENDING,
  QMT_NOTIFICATION_ELICITATION_RECOVERY_AUTHORITY,
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
