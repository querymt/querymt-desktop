import {
  checkForUpdates,
  getUpdatesStatus,
  installUpdate,
  listenUpdateState,
  restartForUpdate,
  setUpdatePreferences,
  type InstallEvent,
  type UpdatePreferencesPatch,
  type UpdateState,
  type UpdatesStatus
} from '$native';
import { isTauriRuntime, platformCapabilities } from '$lib/platform/runtime';

export interface DownloadProgress {
  received: number;
  total: number | null;
}

/** Extracts a displayable message from a thrown value. */
function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export class UpdatesStore {
  status = $state<UpdatesStatus | null>(null);
  progress = $state<DownloadProgress | null>(null);
  /** Last failed action (manual check, preference save, install, restart). */
  actionError = $state<string | null>(null);
  checking = $state(false);
  /** Version the user chose "Later" for; the prompt stays hidden for it until the app restarts. */
  dismissedVersion = $state<string | null>(null);
  /** Version the user explicitly asked to review; overrides a saved skip for that version. */
  reviewVersion = $state<string | null>(null);
  /** Message of a failed user-initiated install; keeps the prompt visible so it can be retried. */
  installError = $state<string | null>(null);
  supported = $state(false);
  initialized = $state(false);

  private unlisten: (() => void) | null = null;

  /** The current update state, `idle` before the first status arrives. */
  get state(): UpdateState {
    return this.status?.state ?? { kind: 'idle' };
  }

  /**
   * The non-modal prompt: a pending update the user has not skipped or postponed, a finished
   * install, or the failure of an install the user started. Failed automatic checks never prompt.
   */
  get prompt(): UpdateState | null {
    const state = this.state;
    if (state.kind === 'available') {
      if (this.dismissedVersion === state.version) return null;
      return state.skipped && this.reviewVersion !== state.version ? null : state;
    }
    if (state.kind === 'error') return this.installError ? state : null;
    if (state.kind === 'installing') return state;
    if (state.kind === 'installed') {
      return this.dismissedVersion === state.version ? null : state;
    }
    return null;
  }

  /** Loads the status and subscribes to state events; a no-op outside supported Tauri builds. */
  async initialize(): Promise<void> {
    if (this.initialized || !platformCapabilities.selfUpdate || !isTauriRuntime()) return;
    this.initialized = true;
    this.supported = true;
    try {
      this.unlisten = await listenUpdateState((state) => this.applyState(state));
      this.status = await getUpdatesStatus();
    } catch (error) {
      this.actionError = errorMessage(error, 'Could not read the update status.');
    }
  }

  /** Unsubscribes from state events. */
  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.initialized = false;
  }

  /** Applies a state pushed by the backend. */
  private applyState(state: UpdateState): void {
    if (this.status) this.status = { ...this.status, state };
  }

  private async savePreferences(patch: UpdatePreferencesPatch): Promise<void> {
    this.actionError = null;
    try {
      this.status = await setUpdatePreferences(patch);
    } catch (error) {
      this.actionError = errorMessage(error, 'Could not save the update settings.');
    }
  }

  /** Switches the update channel. */
  setChannel(channel: 'stable' | 'nightly'): Promise<void> {
    return this.savePreferences({ channel });
  }

  /** Turns background update checks on or off. */
  setAutoCheck(autoCheck: boolean): Promise<void> {
    return this.savePreferences({ autoCheck });
  }

  /** Automatic checks stop prompting for this version; "Check now" still shows it. */
  skip(version: string): Promise<void> {
    this.dismissedVersion = version;
    return this.savePreferences({ skippedVersion: version });
  }

  /** Shows the prompt again, e.g. from Settings after "Later" or "Skip", without another check. */
  reopen(): void {
    this.dismissedVersion = null;
    const state = this.state;
    this.reviewVersion = state.kind === 'available' ? state.version : null;
  }

  /** Hides the failure of a user-initiated install. */
  dismissInstallError(): void {
    this.installError = null;
    this.actionError = null;
  }

  /** Hides the prompt until the next launch without touching the saved preferences. */
  later(version: string): void {
    this.dismissedVersion = version;
  }

  /** Runs a user-initiated check. */
  async checkNow(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.actionError = null;
    try {
      this.status = await checkForUpdates(true);
      this.installError = null;
      // An explicit check surfaces the update again, even if the user chose "Later" for it.
      const state = this.status.state;
      if (state.kind === 'available' && state.version === this.dismissedVersion) {
        this.dismissedVersion = null;
      }
    } catch (error) {
      this.actionError = errorMessage(error, 'The update check failed.');
    } finally {
      this.checking = false;
    }
  }

  /** Downloads and installs the pending update, reporting progress. */
  async install(): Promise<void> {
    this.actionError = null;
    this.installError = null;
    this.progress = { received: 0, total: null };
    /** Accumulates download progress. */
    const onEvent = (event: InstallEvent) => {
      const current = this.progress ?? { received: 0, total: null };
      if (event.event === 'started') this.progress = { received: 0, total: event.contentLength };
      else if (event.event === 'progress') {
        this.progress = { ...current, received: current.received + event.chunkLength };
      }
    };
    try {
      await installUpdate(onEvent);
    } catch (error) {
      this.actionError = errorMessage(error, 'The update could not be installed.');
      this.installError = this.actionError;
    } finally {
      this.progress = null;
    }
  }

  /** Restarts into the installed version. */
  async restart(): Promise<void> {
    this.actionError = null;
    try {
      await restartForUpdate();
    } catch (error) {
      this.actionError = errorMessage(error, 'The app could not restart.');
    }
  }
}

export const updatesStore = new UpdatesStore();
