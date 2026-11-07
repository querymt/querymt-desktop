import { describe, expect, it } from 'vitest';
import { evaluateReadiness, firstOpenCheck, type ReadinessInput } from './readiness';
import { OAuthStatus, type AuthProviderStatus, type CapabilitiesInfo } from '$lib/querymt/generated/types';
import type { AgentConfig, ModelEntry } from '$lib/domain/types';

const agent = (id: string, enabled = true): AgentConfig => ({ id, name: id.toUpperCase(), transport: 'stdio', commandLine: 'qmtcode --acp', enabled, autoStart: true });
const caps = (auth: boolean) => ({ features: { auth } }) as unknown as CapabilitiesInfo;
const provider = (patch: Partial<AuthProviderStatus> = {}): AuthProviderStatus => ({
  provider: 'openai', display_name: 'OpenAI', has_stored_api_key: false, has_env_api_key: false, supports_oauth: true, ...patch
});
const model: ModelEntry = { id: 'openai/gpt', provider: 'openai', model: 'gpt' };

function input(patch: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    configs: [agent('a')],
    primaryAgentId: 'a',
    statuses: { a: { agentId: 'a', state: 'running', commandLine: '', pid: 1, version: null, message: '', lastError: null } },
    connectionStates: { a: 'initialized' },
    agentErrors: {},
    capabilities: { a: caps(true) },
    authProviders: { a: [provider({ has_stored_api_key: true })] },
    authLoading: {},
    authErrors: {},
    models: { a: [model] },
    modelLoading: {},
    launchModelIds: { a: 'openai/gpt' },
    initializing: false,
    ...patch
  };
}

const status = (report: ReturnType<typeof evaluateReadiness>) => Object.fromEntries(report.checks.map((c) => [c.id, c.status]));

describe('evaluateReadiness', () => {
  it('is complete when everything is ready', () => {
    const report = evaluateReadiness(input());
    expect(status(report)).toEqual({ agent: 'ok', providers: 'ok', models: 'ok', model: 'ok' });
    expect(report.setupComplete).toBe(true);
    expect(firstOpenCheck(report)).toBeNull();
  });

  it('blocks on a failed agent with its error and a retry action', () => {
    const report = evaluateReadiness(input({
      statuses: { a: { agentId: 'a', state: 'failed', commandLine: '', pid: null, version: null, message: '', lastError: 'Could not find qmtcode' } }
    }));
    expect(status(report)).toEqual({ agent: 'blocked', providers: 'not_applicable', models: 'not_applicable', model: 'not_applicable' });
    expect(report.checks[0].reason).toBe('Could not find qmtcode');
    expect(report.checks[0].action).toEqual({ kind: 'retry-agent', agentId: 'a' });
    expect(report.setupComplete).toBe(false);
  });

  it('is pending while initializing or starting', () => {
    expect(status(evaluateReadiness(input({ statuses: {}, connectionStates: {}, initializing: true }))).agent).toBe('pending');
    expect(status(evaluateReadiness(input({ statuses: {}, connectionStates: { a: 'connecting' } }))).agent).toBe('pending');
  });

  it('blocks with no enabled agent', () => {
    const report = evaluateReadiness(input({ configs: [agent('a', false)] }));
    expect(report.checks[0]).toMatchObject({ status: 'blocked', action: { kind: 'open-agents' } });
  });

  it('accepts one working agent among several and checks it', () => {
    const report = evaluateReadiness(input({
      configs: [agent('a'), agent('b')],
      statuses: {
        a: { agentId: 'a', state: 'failed', commandLine: '', pid: null, version: null, message: '', lastError: 'boom' },
        b: { agentId: 'b', state: 'running', commandLine: '', pid: 2, version: null, message: '', lastError: null }
      },
      connectionStates: { b: 'initialized' },
      capabilities: { b: caps(true) },
      authProviders: { b: [provider({ has_env_api_key: true })] },
      models: { b: [model] },
      launchModelIds: { b: 'openai/gpt' }
    }));
    expect(report.agentId).toBe('b');
    expect(report.setupComplete).toBe(true);
  });

  it('treats provider auth as not applicable when unsupported', () => {
    const report = evaluateReadiness(input({ capabilities: { a: caps(false) }, authProviders: { a: [] } }));
    expect(status(report).providers).toBe('not_applicable');
    expect(report.setupComplete).toBe(true);
  });

  it('counts environment keys as connected', () => {
    expect(status(evaluateReadiness(input({ authProviders: { a: [provider({ has_env_api_key: true })] } }))).providers).toBe('ok');
  });

  it('blocks without providers and explains missing models', () => {
    const report = evaluateReadiness(input({ authProviders: { a: [provider()] }, models: { a: [] } }));
    expect(status(report)).toEqual({ agent: 'ok', providers: 'blocked', models: 'blocked', model: 'not_applicable' });
    expect(report.checks[1].action).toEqual({ kind: 'open-providers', agentId: 'a' });
    expect(report.checks[2].reason).toMatch(/Connect a provider/);
    expect(firstOpenCheck(report)?.id).toBe('providers');
  });

  it('warns on expired OAuth', () => {
    const report = evaluateReadiness(input({ authProviders: { a: [provider({ oauth_status: OAuthStatus.Expired })] } }));
    expect(report.checks[1]).toMatchObject({ status: 'warning', action: { kind: 'open-providers' } });
    expect(report.checks[1].reason).toMatch(/expired/);
  });

  it('is pending while auth or models load', () => {
    expect(status(evaluateReadiness(input({ authProviders: {}, authLoading: { a: true } }))).providers).toBe('pending');
    expect(status(evaluateReadiness(input({ models: { a: [] }, modelLoading: { a: true } }))).models).toBe('pending');
  });

  it('offers refresh when providers are fine but no models came back', () => {
    const report = evaluateReadiness(input({ models: { a: [] } }));
    expect(report.checks[2]).toMatchObject({ status: 'blocked', action: { kind: 'refresh-models', agentId: 'a' } });
  });

  it('requires a launch model that resolves', () => {
    const report = evaluateReadiness(input({ launchModelIds: { a: 'gone/model' } }));
    expect(report.checks[3]).toMatchObject({ status: 'blocked', action: { kind: 'choose-model', agentId: 'a' } });
  });
});

describe('evaluateReadiness provider edge cases', () => {
  it('ignores connected MCP connector logins', () => {
    const report = evaluateReadiness(input({
      authProviders: { a: [provider(), provider({ provider: 'mcp:github', display_name: 'GitHub', oauth_status: OAuthStatus.Connected })] },
      models: { a: [] }
    }));
    expect(status(report).providers).toBe('blocked');
    expect(report.checks[2].action).toEqual({ kind: 'open-providers', agentId: 'a' });
  });

  it('blocks with a retry when the provider list failed to load', () => {
    const report = evaluateReadiness(input({ authProviders: {}, authErrors: { a: 'timeout' } }));
    expect(report.checks[1]).toMatchObject({ status: 'blocked', action: { kind: 'refresh-providers', agentId: 'a' } });
    expect(report.checks[1].reason).toContain('timeout');
  });
});
