export interface SearchSessionDocument {
  key: string;
  title: string;
  agentName: string;
  sessionId: string;
  cwd: string;
}

export interface SearchGroupDocument {
  key: string;
  name: string;
  path: string;
  special: boolean;
  sessionKeys: string[];
}

export interface SessionSearchPatch {
  sessions: SearchSessionDocument[];
  removedSessions: string[];
  groups: SearchGroupDocument[];
  removedGroups: string[];
  order: string[];
}

export interface SessionSearchMatch {
  key: string;
  sessionKeys: string[];
}

export type SessionSearchRequest =
  | { type: 'patch'; patch: SessionSearchPatch }
  | { type: 'search'; id: number; query: string };
export interface SessionSearchResponse {
  id: number;
  matches: SessionSearchMatch[];
}

/** Text is normalized once per document change, not once per keystroke. */
export class SessionSearchIndex {
  private sessions = new Map<string, { text: string[]; workspace: string[] }>();
  private groups = new Map<string, SearchGroupDocument & { text: string[] }>();
  private order: string[] = [];

  apply(patch: SessionSearchPatch) {
    for (const key of patch.removedSessions) this.sessions.delete(key);
    for (const key of patch.removedGroups) this.groups.delete(key);
    for (const session of patch.sessions) {
      const cwd = session.cwd.toLowerCase();
      this.sessions.set(session.key, {
        text: [session.title.toLowerCase(), session.agentName.toLowerCase(), session.sessionId.toLowerCase()],
        workspace: [cwd, cwd.split('/').filter(Boolean).at(-1) ?? 'no workspace']
      });
    }
    for (const group of patch.groups) {
      this.groups.set(group.key, { ...group, text: [group.name.toLowerCase(), group.path.toLowerCase()] });
    }
    this.order = patch.order;
  }

  private *scan(query: string): Generator<void, SessionSearchMatch[]> {
    const normalized = query.trim().toLowerCase();
    const matches: SessionSearchMatch[] = [];
    let visited = 0;
    for (const key of this.order) {
      const group = this.groups.get(key);
      if (!group) continue;
      const workspaceMatches = !normalized || (!group.special && group.text.some((text) => text.includes(normalized)));
      const sessionKeys: string[] = [];
      for (const sessionKey of group.sessionKeys) {
        const session = this.sessions.get(sessionKey);
        if (session && (workspaceMatches || session.text.some((text) => text.includes(normalized)) ||
          (group.special && session.workspace.some((text) => text.includes(normalized))))) sessionKeys.push(sessionKey);
        if (++visited % 256 === 0) yield;
      }
      if (sessionKeys.length) matches.push({ key, sessionKeys });
    }
    return matches;
  }

  search(query: string): SessionSearchMatch[] {
    const scan = this.scan(query);
    let result = scan.next();
    while (!result.done) result = scan.next();
    return result.value;
  }

  async searchYielding(query: string, cancelled: () => boolean): Promise<SessionSearchMatch[] | null> {
    const scan = this.scan(query);
    while (!cancelled()) {
      const result = scan.next();
      if (result.done) return result.value;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return null;
  }
}
