import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_MODE_PREFERENCES_STORAGE_KEY,
  emptySessionModePreferenceDocument,
  loadSessionModePreferences,
  persistSessionModePreferences,
  readSessionModePreference,
  withSessionModePreference,
  withoutSessionModePreferences
} from './session-mode-preferences';

const validDocument = {
  version: 1,
  agents: {
    'agent-1': {
      sessions: {
        'session-a': {
          modes: {
            build: { modelId: 'xai/grok-4.6', reasoningId: 'high' },
            plan: { modelId: 'querymt:model:["codex/gpt-5.6-sol","node-1"]' }
          },
          updatedAt: '2026-09-27T00:00:00.000Z'
        },
        'session-b': {
          modes: { build: { reasoningId: 'low' } },
          updatedAt: '2026-09-27T01:00:00.000Z'
        }
      }
    },
    'agent-2': {
      sessions: {
        'session-a': {
          modes: { build: { modelId: 'zai/glm-5.3-flash' } },
          updatedAt: '2026-09-27T02:00:00.000Z'
        }
      }
    }
  }
};

describe('session-mode-preferences storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty document when nothing is stored', () => {
    expect(loadSessionModePreferences()).toEqual(emptySessionModePreferenceDocument());
  });

  it('round-trips a document through persistence and reload', () => {
    persistSessionModePreferences(validDocument as never);
    expect(loadSessionModePreferences()).toEqual(validDocument);
  });

  it('returns an empty document for malformed storage payloads', () => {
    for (const raw of ['not json', 'null', '[]', '"version"', '{"version":2,"agents":{}}', '{"version":1}']) {
      localStorage.setItem(SESSION_MODE_PREFERENCES_STORAGE_KEY, raw);
      expect(loadSessionModePreferences()).toEqual(emptySessionModePreferenceDocument());
    }
  });

  it('discards malformed agent, session, and mode entries while keeping valid ones', () => {
    localStorage.setItem(
      SESSION_MODE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        agents: {
          broken: 'nope',
          empty: { sessions: null },
          'agent-1': {
            sessions: {
              missingUpdatedAt: { modes: { build: { modelId: 'x' } } },
              missingModes: { updatedAt: '2026-09-27T00:00:00.000Z' },
              'session-a': {
                updatedAt: '2026-09-27T00:00:00.000Z',
                modes: {
                  bad: 'nope',
                  emptyPreference: {},
                  invalidFields: { modelId: 42, reasoningId: null },
                  build: { modelId: 'xai/grok-4.6' }
                }
              }
            }
          }
        }
      })
    );

    const document = loadSessionModePreferences();
    expect(document.agents.broken).toBeUndefined();
    expect(document.agents.empty).toBeUndefined();
    const sessions = document.agents['agent-1'].sessions;
    expect(sessions.missingUpdatedAt).toBeUndefined();
    expect(sessions.missingModes).toBeUndefined();
    expect(sessions['session-a'].modes).toEqual({ build: { modelId: 'xai/grok-4.6' } });
  });

  it('treats unavailable local storage as an empty document and ignores failed writes', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSessionModePreferences()).toEqual(emptySessionModePreferenceDocument());
    expect(() => persistSessionModePreferences(validDocument as never)).not.toThrow();

    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded');
      })
    };
    vi.stubGlobal('localStorage', throwingStorage);
    expect(loadSessionModePreferences()).toEqual(emptySessionModePreferenceDocument());
    expect(() => persistSessionModePreferences(validDocument as never)).not.toThrow();
  });
});

describe('session-mode-preference document helpers', () => {
  it('reads preferences per agent, session, and mode in isolation', () => {
    const document = validDocument as never as ReturnType<typeof loadSessionModePreferences>;
    expect(readSessionModePreference(document, 'agent-1', 'session-a', 'build')).toEqual({
      modelId: 'xai/grok-4.6',
      reasoningId: 'high'
    });
    expect(readSessionModePreference(document, 'agent-2', 'session-a', 'build')).toEqual({
      modelId: 'zai/glm-5.3-flash'
    });
    expect(readSessionModePreference(document, 'agent-1', 'session-a', 'review')).toBeUndefined();
    expect(readSessionModePreference(document, 'agent-1', 'session-c', 'build')).toBeUndefined();
    expect(readSessionModePreference(document, 'agent-3', 'session-a', 'build')).toBeUndefined();
  });

  it('adds and updates preferences without mutating the input document', () => {
    const base = emptySessionModePreferenceDocument();
    const updated = withSessionModePreference(base, 'agent-1', 'session-a', 'plan', {
      modelId: 'xai/grok-4.6'
    });

    expect(base.agents).toEqual({});
    expect(readSessionModePreference(updated, 'agent-1', 'session-a', 'plan')).toEqual({
      modelId: 'xai/grok-4.6'
    });
    expect(updated.agents['agent-1'].sessions['session-a'].updatedAt).toBeTruthy();

    const merged = withSessionModePreference(updated, 'agent-1', 'session-a', 'plan', {
      reasoningId: 'high'
    });
    expect(readSessionModePreference(merged, 'agent-1', 'session-a', 'plan')).toEqual({
      modelId: 'xai/grok-4.6',
      reasoningId: 'high'
    });

    const cleared = withSessionModePreference(merged, 'agent-1', 'session-a', 'plan', {
      modelId: null
    });
    expect(readSessionModePreference(cleared, 'agent-1', 'session-a', 'plan')).toEqual({
      reasoningId: 'high'
    });
  });

  it('removes only the targeted session entries', () => {
    const document = validDocument as never as ReturnType<typeof loadSessionModePreferences>;
    const cleaned = withoutSessionModePreferences(document, 'agent-1', 'session-a');

    expect(cleaned.agents['agent-1'].sessions['session-a']).toBeUndefined();
    expect(cleaned.agents['agent-1'].sessions['session-b']).toBeDefined();
    expect(cleaned.agents['agent-2'].sessions['session-a']).toBeDefined();

    expect(withoutSessionModePreferences(document, 'agent-9', 'session-a')).toBe(document);
  });
});
