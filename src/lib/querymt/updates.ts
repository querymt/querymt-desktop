import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type UpdateChannel = 'stable' | 'nightly';
export type InstallKind = 'macApp' | 'nsis' | 'appImage' | 'deb' | 'portable';
export type RefusalReason = 'qmtcodeDowngrade' | 'qmtcodeMissing' | 'invalidVersion';
export type FailureKind = 'network' | 'feedMissing' | 'invalidFeed' | 'other';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'waiting'; running: string; offered: string }
  | {
      kind: 'available';
      version: string;
      notes: string | null;
      date: string | null;
      qmtcodeVersion: string | null;
      canInstall: boolean;
      releaseUrl: string;
      skipped: boolean;
    }
  | { kind: 'refused'; version: string; reason: RefusalReason; message: string }
  | { kind: 'installing'; version: string }
  | { kind: 'installed'; version: string }
  | { kind: 'error'; message: string; failure: FailureKind; manual: boolean };

export interface UpdatesStatus {
  channel: UpdateChannel;
  buildChannel: UpdateChannel;
  currentVersion: string;
  qmtcodeVersion: string | null;
  installKind: InstallKind;
  autoCheck: boolean;
  skippedVersion: string | null;
  /** Unix seconds of the last finished check. */
  lastCheck: number | null;
  state: UpdateState;
}

export interface UpdatePreferencesPatch {
  channel?: UpdateChannel;
  autoCheck?: boolean;
  /** An empty string clears the skipped version. */
  skippedVersion?: string;
}

export type InstallEvent =
  | { event: 'started'; contentLength: number | null }
  | { event: 'progress'; chunkLength: number }
  | { event: 'finished' }
  | { event: 'installed' };

export const UPDATE_STATE_EVENT = 'updates://state';

/** Reads the update status. */
export function getUpdatesStatus(): Promise<UpdatesStatus> {
  return invoke<UpdatesStatus>('updates_status');
}

/** Saves update preferences and returns the new status. */
export function setUpdatePreferences(patch: UpdatePreferencesPatch): Promise<UpdatesStatus> {
  return invoke<UpdatesStatus>('updates_set_preferences', { patch });
}

/** Runs an update check and returns the new status. */
export function checkForUpdates(manual: boolean): Promise<UpdatesStatus> {
  return invoke<UpdatesStatus>('updates_check', { manual });
}

/** Installs the pending update, reporting progress through `onEvent`. */
export function installUpdate(onEvent: (event: InstallEvent) => void): Promise<void> {
  const channel = new Channel<InstallEvent>();
  channel.onmessage = onEvent;
  return invoke<void>('updates_install', { onEvent: channel });
}

/** Restarts into the installed version. */
export function restartForUpdate(): Promise<void> {
  return invoke<void>('updates_restart');
}

/** Subscribes to update state changes. */
export function listenUpdateState(handler: (state: UpdateState) => void): Promise<() => void> {
  return listen<UpdateState>(UPDATE_STATE_EVENT, ({ payload }) => handler(payload));
}
