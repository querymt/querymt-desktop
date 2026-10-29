import { describe, expect, it } from 'vitest';
import { RequestError } from '@agentclientprotocol/sdk';
import {
  buildSessionWorkspaceRequest,
  describeSessionAccess,
  describeWorktreeError,
  isReadOnlyErrorCode,
  isWorkspaceArchivedAccess,
  isWorkspaceUsable,
  parseWorktreeSessionResult,
  readSessionAccess,
  readSessionWorkspace,
  readWorkspaceCapability,
  readWorktreeErrorCode,
  validateWorktreeCreateOptions,
  worktreeTooltip
} from './session-workspace';

const caps = (workspace: unknown) => ({ _meta: { querymt: { workspace } } });

describe('readWorkspaceCapability', () => {
  it('is null unless workspace support is explicitly advertised', () => {
    expect(readWorkspaceCapability(undefined)).toBeNull();
    expect(readWorkspaceCapability({})).toBeNull();
    expect(readWorkspaceCapability(caps({ supported: 'yes' }))).toBeNull();
    expect(readWorkspaceCapability(caps({ supported: false }))).toBeNull();
    expect(readWorkspaceCapability(caps('nope'))).toBeNull();
  });

  it('parses optional features and requires handoff for summaries', () => {
    expect(readWorkspaceCapability(caps({ supported: true }))).toEqual({
      supported: true, defaultBaseline: null, sourceSession: false, handoff: false, handoffSummary: false
    });
    expect(readWorkspaceCapability(caps({ supported: true, handoffSummary: true }))?.handoffSummary).toBe(false);
    expect(readWorkspaceCapability(caps({
      supported: true, defaultBaseline: 'head', sourceSession: true, handoff: true, handoffSummary: true
    }))).toEqual({ supported: true, defaultBaseline: 'head', sourceSession: true, handoff: true, handoffSummary: true });
  });
});

describe('readSessionWorkspace', () => {
  it('parses list metadata and load disclosure', () => {
    const list = readSessionWorkspace({ querymt: { workspace: {
      workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p/app',
      baselineMode: 'head', lifecycle: 'ready', ownerSessionId: 'o', handedOffTo: 'n'
    } } });
    expect(list).toEqual({
      workspaceId: 'ws_1', branch: 'qmt/ws_1', checkoutPath: '/w/ws_1', sourceCwd: '/p/app',
      baselineMode: 'head', lifecycle: 'ready', ownerSessionId: 'o', handedOffTo: 'n'
    });
    const load = readSessionWorkspace({ querymt: { sessionWorkspace: { workspaceId: 'ws_2', baseline: 'dirty' } } });
    expect(load?.baselineMode).toBe('dirty');
    expect(load?.sourceCwd).toBeNull();
  });

  it('returns null for malformed values', () => {
    expect(readSessionWorkspace(undefined)).toBeNull();
    expect(readSessionWorkspace({ querymt: { workspace: 'x' } })).toBeNull();
    expect(readSessionWorkspace({ querymt: { workspace: { branch: 'b' } } })).toBeNull();
    expect(readSessionWorkspace({ querymt: { workspace: { workspaceId: '  ' } } })).toBeNull();
    const partial = readSessionWorkspace({ querymt: { workspace: { workspaceId: 'w', branch: 3, sourceCwd: {} } } });
    expect(partial?.branch).toBeNull();
    expect(partial?.sourceCwd).toBeNull();
  });
});

describe('readSessionAccess', () => {
  it('only accepts an explicit read-only grant', () => {
    expect(readSessionAccess(undefined)).toBeNull();
    expect(readSessionAccess({ querymt: { sessionAccess: { mode: 'read_write' } } })).toBeNull();
    expect(readSessionAccess({ querymt: { sessionAccess: 'read_only' } })).toBeNull();
    expect(readSessionAccess({ querymt: { sessionAccess: { mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'new' } } }))
      .toEqual({ mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'new' });
    expect(readSessionAccess({ querymt: { sessionAccess: { mode: 'read_only' } } }))
      .toEqual({ mode: 'read_only', reason: null, ownerSessionId: null });
  });
});

describe('archived read-only access', () => {
  it('parses workspace_archived access without an owner', () => {
    const access = readSessionAccess({ querymt: { sessionAccess: { mode: 'read_only', reason: 'workspace_archived', workspaceId: 'ws_1' } } });
    expect(access).toEqual({ mode: 'read_only', reason: 'workspace_archived', ownerSessionId: null });
    expect(isWorkspaceArchivedAccess(access)).toBe(true);
    expect(isWorkspaceArchivedAccess({ mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'n' })).toBe(false);
    expect(isWorkspaceArchivedAccess(null)).toBe(false);
  });

  it('recognises both read-only error codes', () => {
    expect(isReadOnlyErrorCode('owner_transferred')).toBe(true);
    expect(isReadOnlyErrorCode('workspace_archived')).toBe(true);
    expect(isReadOnlyErrorCode('owner_active')).toBe(false);
    expect(isReadOnlyErrorCode(null)).toBe(false);
  });

  it('words the notice per reason and keeps unknown reasons generic', () => {
    expect(describeSessionAccess({ mode: 'read_only', reason: 'workspace_archived', ownerSessionId: null })).toContain('archived');
    expect(describeSessionAccess({ mode: 'read_only', reason: 'owner_transferred', ownerSessionId: 'n' })).toContain('handed off');
    expect(describeSessionAccess({ mode: 'read_only', reason: null, ownerSessionId: 'n' })).toContain('handed off');
    expect(describeSessionAccess({ mode: 'read_only', reason: 'future_reason', ownerSessionId: null })).toBe('This conversation is read-only.');
  });

  it('maps the archive and removal codes', () => {
    for (const code of ['workspace_archived', 'workspace_not_archived', 'unpreserved_content', 'unpreserved_commits']) {
      expect(describeWorktreeError(new RequestError(-32602, 'x', { code, message: 'agent says' }))).not.toBe('agent says');
    }
  });
});

describe('buildSessionWorkspaceRequest', () => {
  it('sends nothing for local and the right metadata for worktrees', () => {
    expect(buildSessionWorkspaceRequest('local')).toBeNull();
    expect(buildSessionWorkspaceRequest('worktree')).toEqual({ execution: 'worktree' });
    expect(buildSessionWorkspaceRequest('worktree_local_changes')).toEqual({ execution: 'worktree', includeLocalChanges: true });
  });
});

describe('validateWorktreeCreateOptions', () => {
  it('keeps base ref and local changes exclusive', () => {
    expect(validateWorktreeCreateOptions({})).toBeNull();
    expect(validateWorktreeCreateOptions({ baseRef: 'main' })).toBeNull();
    expect(validateWorktreeCreateOptions({ includeLocalChanges: true, baseRef: '  ' })).toBeNull();
    expect(validateWorktreeCreateOptions({ includeLocalChanges: true, baseRef: 'main' })).toContain('not both');
    expect(validateWorktreeCreateOptions({ name: 'a b' })).toContain('Name');
  });
});

describe('parseWorktreeSessionResult', () => {
  it('parses create and handoff responses', () => {
    expect(parseWorktreeSessionResult({
      session_id: 's2', previous_session_id: 's1', workspace_id: 'ws', session_cwd: '/w', checkout_path: '/w', branch: 'b', summary_seeded: true
    })).toEqual({ sessionId: 's2', workspaceId: 'ws', sessionCwd: '/w', checkoutPath: '/w', branch: 'b', previousSessionId: 's1', summarySeeded: true });
    expect(parseWorktreeSessionResult({ session_id: 's' }).summarySeeded).toBe(false);
  });

  it('rejects responses without a session id', () => {
    expect(() => parseWorktreeSessionResult(null)).toThrow();
    expect(() => parseWorktreeSessionResult({ workspace_id: 'w' })).toThrow();
  });
});

describe('worktree errors', () => {
  it('maps stable codes and falls back to the agent message', () => {
    const owner = new RequestError(-32602, 'x', { code: 'owner_active' });
    expect(readWorktreeErrorCode(owner)).toBe('owner_active');
    expect(describeWorktreeError(owner)).toContain('Stop the running turn');
    expect(describeWorktreeError(new RequestError(-32602, 'x', { code: 'invalid_options', message: 'bad ref' }))).toContain('bad ref');
    expect(describeWorktreeError(new RequestError(-32603, 'x', { code: 'brand_new', message: 'agent says' }))).toBe('agent says');
    expect(describeWorktreeError(new Error('plain'))).toBe('plain');
    expect(describeWorktreeError('weird', 'fallback')).toBe('fallback');
    expect(readWorktreeErrorCode(new Error('x'))).toBeNull();
  });
});

describe('worktree presentation helpers', () => {
  it('treats missing lifecycle as usable and reports non-ready states', () => {
    expect(isWorkspaceUsable(null)).toBe(true);
    expect(isWorkspaceUsable({ lifecycle: 'ready' } as never)).toBe(true);
    expect(isWorkspaceUsable({ lifecycle: 'missing' } as never)).toBe(false);
    const tip = worktreeTooltip({
      workspaceId: 'w', branch: 'qmt/w', checkoutPath: '/w', sourceCwd: null, baselineMode: 'local_changes',
      lifecycle: 'missing', ownerSessionId: null, handedOffTo: 'n'
    });
    expect(tip).toContain('Branch qmt/w');
    expect(tip).toContain('Checkout /w');
    expect(tip).toContain('local changes');
    expect(tip).toContain('Worktree missing');
    expect(tip).toContain('Handed off');
  });
});
