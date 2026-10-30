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

/**
 * `creating`: `session/new`, launch config writes or the first prompt dispatch are still running.
 * `failed`: the launch needs the user (retry, review or restore the prompt).
 * `ready`: the first prompt was handed to the agent.
 */
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
  /** Real session id, set as soon as `session/new` has been answered and the session is selected. */
  sessionId: string | null;
}

export interface SessionCreateOptions {
  /** Temporary id of the launch on screen; the session is only selected while it still is. */
  launchId?: string;
  cwd?: string;
  settings?: LaunchSettings;
  /** Called once the new session is the selected one, before launch config writes. */
  onSelected?: (sessionId: string) => void;
  /**
   * Launch creations are background work: failures go here and never touch the
   * shared composer error, which belongs to whatever the user is looking at.
   */
  onError?: (message: string) => void;
}

/**
 * The first prompt of a launch, sent explicitly because the composer was already
 * cleared when the launch began.
 */
export interface PromptSendInput {
  launchId: string;
  agentId: string;
  sessionId: string;
  prompt: string;
  attachments: PromptAttachment[];
  clientPromptId: string;
  /** Set when the optimistic user turn is already in the transcript. */
  turnEventIndex?: number;
  /** False once the agent endpoint was replaced; the prompt must not go to the new one. */
  isCurrentSource: () => boolean;
}
