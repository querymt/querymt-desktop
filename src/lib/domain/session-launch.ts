import type { ComposerWorkspaceMode } from '$lib/domain/session-workspace';
import type { PromptAttachment } from '$lib/domain/types';

/**
 * A launch is the client-side stand-in for a session whose `session/new` is
 * still in flight. It lives in the normal session route under a temporary id,
 * so the view can open immediately and then swap in the real session id.
 */
const PENDING_LAUNCH_PREFIX = 'pending-launch-';

export function createPendingLaunchId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${PENDING_LAUNCH_PREFIX}${random}`;
}

export function isPendingLaunchId(sessionId: string | null | undefined): sessionId is string {
  return typeof sessionId === 'string' && sessionId.startsWith(PENDING_LAUNCH_PREFIX);
}

/** Composer selections captured at click time; later composer edits never affect a launch. */
export interface LaunchSettings {
  targetId: string;
  workspaceMode: ComposerWorkspaceMode;
  profileId: string;
  modeId: string;
  reasoningId: string;
  modelId: string;
}

export type PendingLaunchStatus = 'creating' | 'failed' | 'ready';

export interface PendingLaunch {
  id: string;
  agentId: string;
  cwd: string;
  status: PendingLaunchStatus;
  error: string | null;
  prompt: string;
  attachments: PromptAttachment[];
  clientPromptId: string;
  settings: LaunchSettings;
  /** Human label of the remote owner, when launching on a mesh node. */
  targetLabel: string | null;
  /** Real session id, set once the session is created and configured. */
  sessionId: string | null;
}

export interface SessionCreateOptions {
  /** Temporary id of the launch on screen; the session is only selected while it still is. */
  launchId?: string;
  cwd?: string;
  settings?: LaunchSettings;
  /** Called once the new session is the selected one, before launch config writes. */
  onSelected?: (sessionId: string) => void;
}

/**
 * An explicit prompt to send, instead of reading the composer. Used by launches
 * (the composer was already cleared) and by retries of a failed prompt.
 */
export interface PromptSendInput {
  prompt: string;
  attachments: PromptAttachment[];
  clientPromptId?: string;
  /** Set when the optimistic user turn is already in the transcript. */
  turnEventIndex?: number;
}
