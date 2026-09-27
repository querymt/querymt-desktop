// Desktop-local session-mode preferences. Keyed by agent, session, and mode so
// each session can restore the model and reasoning effort last confirmed for a
// mode. The document never leaves this desktop: it is not sent through ACP and
// is not treated as server-owned session state.

export const SESSION_MODE_PREFERENCES_STORAGE_KEY = 'querymt-desktop.session-mode-preferences';
export const SESSION_MODE_PREFERENCES_VERSION = 1 as const;

export type SessionModePreference = {
  /** Existing model selection key, including mesh node identity when present. */
  modelId?: string;
  reasoningId?: string;
};

export type SessionModePreferenceDocument = {
  version: typeof SESSION_MODE_PREFERENCES_VERSION;
  agents: Record<
    string,
    {
      sessions: Record<
        string,
        {
          modes: Record<string, SessionModePreference>;
          updatedAt: string;
        }
      >;
    }
  >;
};

export function emptySessionModePreferenceDocument(): SessionModePreferenceDocument {
  return { version: SESSION_MODE_PREFERENCES_VERSION, agents: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parsePreference(value: unknown): SessionModePreference | null {
  if (!isRecord(value)) return null;
  const preference: SessionModePreference = {};
  if (nonEmptyString(value.modelId)) preference.modelId = value.modelId;
  if (nonEmptyString(value.reasoningId)) preference.reasoningId = value.reasoningId;
  // An entry without any learned field means "not learned yet"; keep the
  // document free of such placeholders.
  return preference.modelId || preference.reasoningId ? preference : null;
}

function parseDocument(value: unknown): SessionModePreferenceDocument {
  if (!isRecord(value) || value.version !== SESSION_MODE_PREFERENCES_VERSION || !isRecord(value.agents)) {
    return emptySessionModePreferenceDocument();
  }

  const agents: SessionModePreferenceDocument['agents'] = {};
  for (const [agentId, agentValue] of Object.entries(value.agents)) {
    if (!isRecord(agentValue) || !isRecord(agentValue.sessions)) continue;
    const sessions: SessionModePreferenceDocument['agents'][string]['sessions'] = {};
    for (const [sessionId, sessionValue] of Object.entries(agentValue.sessions)) {
      if (!isRecord(sessionValue) || !isRecord(sessionValue.modes) || !nonEmptyString(sessionValue.updatedAt)) {
        continue;
      }
      const modes: Record<string, SessionModePreference> = {};
      for (const [modeId, modeValue] of Object.entries(sessionValue.modes)) {
        const preference = parsePreference(modeValue);
        if (preference) modes[modeId] = preference;
      }
      sessions[sessionId] = { modes, updatedAt: sessionValue.updatedAt };
    }
    agents[agentId] = { sessions };
  }

  return { version: SESSION_MODE_PREFERENCES_VERSION, agents };
}

/** Loads the preference document, discarding malformed data without throwing. */
export function loadSessionModePreferences(): SessionModePreferenceDocument {
  if (typeof localStorage === 'undefined') {
    return emptySessionModePreferenceDocument();
  }

  try {
    const raw = localStorage.getItem(SESSION_MODE_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return emptySessionModePreferenceDocument();
    }
    return parseDocument(JSON.parse(raw));
  } catch {
    return emptySessionModePreferenceDocument();
  }
}

/**
 * Persists the document. Failures are swallowed so the confirmed in-memory
 * state stays usable when local storage is unavailable or rejects the write.
 */
export function persistSessionModePreferences(document: SessionModePreferenceDocument) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(SESSION_MODE_PREFERENCES_STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Ignore persistence failures; in-memory preferences remain authoritative.
  }
}

export function readSessionModePreference(
  document: SessionModePreferenceDocument,
  agentId: string,
  sessionId: string,
  modeId: string
): SessionModePreference | undefined {
  return document.agents[agentId]?.sessions[sessionId]?.modes[modeId];
}

export type SessionModePreferencePatch = {
  /** `undefined` leaves the saved value untouched; `null` clears it. */
  modelId?: string | null;
  reasoningId?: string | null;
};

export function withSessionModePreference(
  document: SessionModePreferenceDocument,
  agentId: string,
  sessionId: string,
  modeId: string,
  patch: SessionModePreferencePatch
): SessionModePreferenceDocument {
  if (!agentId || !sessionId || !modeId) return document;

  const now = new Date().toISOString();
  const agent = document.agents[agentId] ?? { sessions: {} };
  const session = agent.sessions[sessionId] ?? { modes: {}, updatedAt: now };
  const current = session.modes[modeId] ?? {};
  const preference: SessionModePreference = {
    ...current,
    ...(patch.modelId !== undefined ? { modelId: patch.modelId ?? undefined } : {}),
    ...(patch.reasoningId !== undefined ? { reasoningId: patch.reasoningId ?? undefined } : {})
  };
  if (!preference.modelId) delete preference.modelId;
  if (!preference.reasoningId) delete preference.reasoningId;

  return {
    ...document,
    agents: {
      ...document.agents,
      [agentId]: {
        sessions: {
          ...agent.sessions,
          [sessionId]: { modes: { ...session.modes, [modeId]: preference }, updatedAt: now }
        }
      }
    }
  };
}

export function withoutSessionModePreferences(
  document: SessionModePreferenceDocument,
  agentId: string,
  sessionId: string
): SessionModePreferenceDocument {
  const sessions = document.agents[agentId]?.sessions;
  if (!sessions || !(sessionId in sessions)) return document;

  const nextSessions = { ...sessions };
  delete nextSessions[sessionId];
  return {
    ...document,
    agents: {
      ...document.agents,
      [agentId]: { sessions: nextSessions }
    }
  };
}
