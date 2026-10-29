import { RequestError } from '@agentclientprotocol/sdk';

/**
 * Managed Git worktree support (agent change `add-git-worktree-isolation`).
 * Every parser is defensive: malformed or missing values become `null`
 * (feature unavailable), never a guessed state.
 */

export interface WorkspaceCapability {
  supported: boolean;
  defaultBaseline: string | null;
  /** `querymt/worktree/create` accepts `source_session_id` (lineage). */
  sourceSession: boolean;
  /** `querymt/worktree/handoff` exists. */
  handoff: boolean;
  /** Handoff accepts `summary: true`. */
  handoffSummary: boolean;
}

/** Durable worktree description of a listed or loaded session. */
export interface SessionWorkspaceInfo {
  workspaceId: string;
  branch: string | null;
  checkoutPath: string | null;
  /** cwd the agent groups the session under (the originating project). */
  sourceCwd: string | null;
  baselineMode: string | null;
  lifecycle: string | null;
  ownerSessionId: string | null;
  handedOffTo: string | null;
}

export interface SessionAccessInfo {
  mode: 'read_only';
  reason: string | null;
  ownerSessionId: string | null;
}

export type ComposerWorkspaceMode = 'local' | 'worktree' | 'worktree_local_changes';

export const WORKSPACE_MODE_OPTIONS: Array<{ id: ComposerWorkspaceMode; label: string }> = [
  { id: 'local', label: 'Local checkout' },
  { id: 'worktree', label: 'New worktree' },
  { id: 'worktree_local_changes', label: 'New worktree with local changes' }
];

export interface WorktreeCreateOptions {
  name?: string | null;
  baseRef?: string | null;
  includeLocalChanges?: boolean;
}

export interface WorktreeHandoffOptions {
  name?: string | null;
  summary?: boolean;
}

export interface WorktreeSessionResult {
  sessionId: string;
  workspaceId: string | null;
  sessionCwd: string | null;
  checkoutPath: string | null;
  branch: string | null;
  previousSessionId: string | null;
  summarySeeded: boolean;
}

export const WORKTREE_FORK_ORIGIN = 'worktree';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Parse `initialize` → `agentCapabilities._meta.querymt.workspace`. */
export function readWorkspaceCapability(agentCapabilities: unknown): WorkspaceCapability | null {
  const workspace = record(record(record(record(agentCapabilities)?._meta)?.querymt)?.workspace);
  if (!workspace || workspace.supported !== true) return null;
  return {
    supported: true,
    defaultBaseline: str(workspace.defaultBaseline),
    sourceSession: workspace.sourceSession === true,
    handoff: workspace.handoff === true,
    handoffSummary: workspace.handoff === true && workspace.handoffSummary === true
  };
}

/** Parse list metadata (`_meta.querymt.workspace`) or a load disclosure (`_meta.querymt.sessionWorkspace`). */
export function readSessionWorkspace(meta: unknown): SessionWorkspaceInfo | null {
  const querymt = record(record(meta)?.querymt);
  const value = record(querymt?.workspace) ?? record(querymt?.sessionWorkspace);
  const workspaceId = str(value?.workspaceId);
  if (!value || !workspaceId) return null;
  return {
    workspaceId,
    branch: str(value.branch),
    checkoutPath: str(value.checkoutPath),
    sourceCwd: str(value.sourceCwd),
    baselineMode: str(value.baselineMode) ?? str(value.baseline),
    lifecycle: str(value.lifecycle),
    ownerSessionId: str(value.ownerSessionId),
    handedOffTo: str(value.handedOffTo)
  };
}

/** Execution cwd disclosed by `session/new` / `session/load` (`_meta.querymt.sessionWorkspace.sessionCwd`). */
export function readDisclosedSessionCwd(meta: unknown): string | null {
  return str(record(record(record(meta)?.querymt)?.sessionWorkspace)?.sessionCwd);
}

/** Reasons the agent gives for a read-only session (`sessionAccess.reason` / prompt error code). */
export const READ_ONLY_REASON_OWNER_TRANSFERRED = 'owner_transferred';
export const READ_ONLY_REASON_WORKSPACE_ARCHIVED = 'workspace_archived';

/** Error codes that put a session into the read-only presentation. */
export function isReadOnlyErrorCode(code: string | null): code is string {
  return code === READ_ONLY_REASON_OWNER_TRANSFERRED || code === READ_ONLY_REASON_WORKSPACE_ARCHIVED;
}

export function isWorkspaceArchivedAccess(access: SessionAccessInfo | null | undefined): boolean {
  return access?.reason === READ_ONLY_REASON_WORKSPACE_ARCHIVED;
}

/** Notice shown in place of the composer; an unknown reason keeps the generic wording. */
export function describeSessionAccess(access: SessionAccessInfo | null | undefined): string {
  if (isWorkspaceArchivedAccess(access)) {
    return 'This worktree was archived, so this conversation is read-only. To delete the checkout, run /worktree remove from another session.';
  }
  if (access?.reason === READ_ONLY_REASON_OWNER_TRANSFERRED || access?.ownerSessionId) {
    return 'This worktree was handed off, so this conversation is read-only.';
  }
  return 'This conversation is read-only.';
}

/** Parse `_meta.querymt.sessionAccess`; only an explicit read-only grant counts. */
export function readSessionAccess(meta: unknown): SessionAccessInfo | null {
  const access = record(record(record(meta)?.querymt)?.sessionAccess);
  if (!access || access.mode !== 'read_only') return null;
  return { mode: 'read_only', reason: str(access.reason), ownerSessionId: str(access.ownerSessionId) };
}

/** `session/new` `_meta.querymt.sessionWorkspace` for a composer choice; `null` keeps local behavior. */
export function buildSessionWorkspaceRequest(mode: ComposerWorkspaceMode): Record<string, unknown> | null {
  if (mode === 'local') return null;
  return mode === 'worktree_local_changes'
    ? { execution: 'worktree', includeLocalChanges: true }
    : { execution: 'worktree' };
}

/** Validate dialog options against the agent's rule: base ref and local changes are exclusive. */
export function validateWorktreeCreateOptions(options: WorktreeCreateOptions): string | null {
  if (options.includeLocalChanges && options.baseRef?.trim()) {
    return 'Choose either a base ref or include local changes, not both.';
  }
  for (const [label, value] of [['Name', options.name], ['Base ref', options.baseRef]] as const) {
    if (value && /\s/.test(value.trim())) return `${label} must be a single word without spaces.`;
  }
  return null;
}

export function parseWorktreeSessionResult(value: unknown): WorktreeSessionResult {
  const response = record(value);
  const sessionId = str(response?.session_id) ?? str(response?.sessionId);
  if (!response || !sessionId) throw new Error('The agent did not return the new worktree session.');
  return {
    sessionId,
    workspaceId: str(response.workspace_id),
    sessionCwd: str(response.session_cwd),
    checkoutPath: str(response.checkout_path),
    branch: str(response.branch),
    previousSessionId: str(response.previous_session_id),
    summarySeeded: response.summary_seeded === true
  };
}

const WORKTREE_ERROR_MESSAGES: Record<string, string> = {
  owner_active: 'Stop the running turn, queued input and any shared delegates before changing this worktree.',
  owner_transferred: 'This worktree was handed off to another session. This conversation is now read-only.',
  owner_conflict: 'This worktree already belongs to another session.',
  workspace_archived: 'This worktree is archived. Its session is read-only and can no longer run turns.',
  workspace_not_archived: 'Archive the worktree before removing it, or remove it with the archive option.',
  unpreserved_content: 'The worktree has uncommitted, untracked or ignored files. Commit, publish or delete them first.',
  unpreserved_commits: 'The worktree has commits that are not preserved. Publish the branch before removing it.',
  workspace_missing: 'The worktree checkout is missing on disk.',
  workspace_service_unavailable: 'Worktrees are not enabled on this agent.',
  isolation_unsupported_layout: 'This repository layout cannot be isolated in a worktree.',
  invalid_options: 'The worktree options were rejected by the agent.'
};

export function readWorktreeErrorCode(error: unknown): string | null {
  const data = error instanceof RequestError ? error.data : record(error)?.data;
  return str(record(data)?.code);
}

/** Actionable message for a worktree failure; unknown codes fall back to the agent's message. */
export function describeWorktreeError(error: unknown, fallback = 'Worktree operation failed.'): string {
  const code = readWorktreeErrorCode(error);
  const known = code ? WORKTREE_ERROR_MESSAGES[code] : undefined;
  const detail = str(record(error instanceof RequestError ? error.data : record(error)?.data)?.message);
  if (known) return code === 'invalid_options' && detail ? `${known} ${detail}` : known;
  return detail ?? (error instanceof Error && error.message ? error.message : fallback);
}

export function isWorkspaceUsable(workspace: SessionWorkspaceInfo | null | undefined): boolean {
  return !workspace?.lifecycle || workspace.lifecycle === 'ready';
}

export function worktreeTooltip(workspace: SessionWorkspaceInfo): string {
  return [
    workspace.branch ? `Branch ${workspace.branch}` : null,
    workspace.checkoutPath ? `Checkout ${workspace.checkoutPath}` : null,
    workspace.baselineMode ? `Baseline ${workspace.baselineMode.replace(/_/g, ' ')}` : null,
    !isWorkspaceUsable(workspace) ? `Worktree ${workspace.lifecycle}` : null,
    workspace.handedOffTo ? 'Handed off to another session' : null
  ].filter(Boolean).join('\n');
}
